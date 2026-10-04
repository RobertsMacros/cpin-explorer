"""Recover removed editions from the Internet Archive: find them first, then fetch them.

GOV.UK deletes an edition's page when it publishes the next one. `backfill` (wayback.py) asks the
Archive only for HTML pages under each country page's current address, so it misses editions
published under an earlier address of the page, and every edition that existed only as a PDF
(all of them before late 2021). This module looks for both, without guessing addresses:

  discover  1. Earlier addresses of each country page. Archived copies of the collection page list
               every country page's address at the time; an address that is not a current one is
               put to GOV.UK once (an old address answers with a redirect to the current page).
            2. Every archived state of each country page, at its current and earlier addresses: the
               attachments it listed then (HTML paths, file URLs, titles, sizes).
            3. What the Archive holds of each attachment not held here (its index only: nothing is
               downloaded).
            4. What is held already under another address, file or title: the same report and
               month (see `mark_held_elsewhere`). Such an edition is not fetched again.
            The result is data/wayback-catalogue.json (shape below).
  fetch     What is not held, and no more: the PDFs of editions with no web version to be had, as
            the Archive's raw capture (its `id_` form), into the PDF store, labelled in the manifest
            (see `fetch_pdfs`); and the archived web pages of an edition none of whose text is held,
            through wayback.backfill_path, as ordinary `source: wayback` versions under the note id
            from their original path. On request (`html`, `all_pdfs`): further archived copies of
            web pages already held, and the PDFs listed beside web versions that are held.
  after     `./cpin pdftext` reads each recovered PDF's text (docs/methods/pdf-and-web.md) and
            `./cpin export` puts it among its report's editions, marked as read from the PDF and as
            an archived copy (export.py: `recovered_pdf_version`).

data/wayback-catalogue.json
  generated, tool
  collection        {url, captures_read, errors}: the archived collection pages the addresses came from
  other_pages       [{base_path, title, first_listed, last_listed, govuk}]: pages the collection once
                    listed that are not an address of a country it lists now (countries since dropped)
  countries.<slug>
    name
    addresses       [{base_path, current, how, first_listed, last_listed (in the collection captures),
                      govuk (GOV.UK's answer for an earlier address), captures (archived states of the
                      page that were read), errors}]
    editions        [{title, status, first_listed, last_listed, listed_at: [base_path],
                      held_as: {by: 'title and month', web_version | pdf},    (held under another listing)
                      repeat_of: {title, first_listed},                       (a not-held edition, listed again)
                      html:  [{path, note, title, first_listed, last_listed, held_versions,
                               archive_captures, captures_to_read}],
                      files: [{url, also_listed_as, asset, title, type, size, pages, first_listed,
                               last_listed, held: null | {by, manifest_url, sha256, source},
                               archive: [{timestamp, original, mimetype, digest, length}]}]}]
                    one per listing: an HTML attachment with the PDF listed beside it, or a PDF (or
                    other file) on its own. first_listed and last_listed are the times of the first
                    and last archived state of the country page that listed it. One HTML address can
                    carry several editions in turn (GOV.UK edits the attachment in place), so html
                    entries are per address and edition (told apart by the month in the title).
                    status: held (an HTML version or a file of it is in the store, or the same report
                    and month is: see held_as) | recoverable-html (not held; the Archive has captures
                    of its web page not read yet) | recoverable-pdf (not held; no web page to be had,
                    but a capture of its PDF) | not-archived | other-file (a file that is not a PDF)
    unextractable   {archive url: reason}: archived HTML pages with no body that could be taken verbatim
    summary         editions (listings) by status; not_held, not_held_in_archive and
                    not_held_not_in_archive count editions (a repeat listing counted once);
                    pdfs_to_fetch and pdf_bytes_to_fetch are what a fetch would download;
                    pdfs_beside_held_web_versions and html_captures_to_read are what it leaves
  failures          [{country, url, archive_url, error}]: what the last fetch could not store
  totals            the summaries added up
"""
import base64
import difflib
import gzip
import hashlib
import re
from dataclasses import asdict
from pathlib import Path
from urllib.parse import quote, urljoin, urlsplit

from lxml import etree
from lxml import html as lxml_html

from . import config
from .fingerprint import sha256_bytes
from .govuk import PUBLICATION_SUFFIX, api_url
from .http import FetchResult, PoliteClient
from .store import Store, atomic_write, now_iso, read_json, write_json
from .sync import RunReport
from .titles import _ACCESSIBLE_RE, parse_note_title, series_key
from .wayback import CDX, _iso, backfill_path

CATALOGUE = "wayback-catalogue.json"
CACHE_DIR = "wayback-cache"
COLLECTION_URL = config.GOVUK + config.COLLECTION_PATH
CDX_FIELDS = ["timestamp", "original", "mimetype", "statuscode", "digest", "length"]
MAX_FILES = 2000
MAX_BYTES = 1_500_000_000
PUBLICATION_RE = re.compile(r"^/government/publications/[^/]+$")
NOTE_RE = re.compile(r"^/government/publications/[^/]+/[^/.]+$")
FILE_EXT_RE = re.compile(r"\.[a-z0-9]{2,5}$", re.IGNORECASE)


class Stopped(RuntimeError):
    """The run must end here: the Archive (or GOV.UK) refused us, or has stopped answering."""


class Guard:
    """Looks at every answer. A 403, a robots.txt refusal, or a 429 that outlasted the client's own
    back-off ends the run: a refusal is never worked around. So does a long run of failures."""

    def __init__(self, limit: int = 8):
        self.limit = limit
        self.failures = 0

    def __call__(self, r: FetchResult) -> FetchResult:
        if r.status in ("blocked", "robots") or (r.status == "error" and "429" in (r.error or "")):
            raise Stopped(f"refused ({r.status}: {r.error}) at {r.url}")
        if r.status == "error":
            self.failures += 1
            if self.failures >= self.limit:
                raise Stopped(f"{self.failures} requests in a row failed; last: {r.error} at {r.url}")
        else:
            self.failures = 0
        return r


# --- The Archive's index and pages, read once ----------------------------------------------------
def cdx_query(url: str, *, prefix: bool = False, collapse: str = "digest") -> str:
    """One question for the Archive's index: successful captures of a URL (or of everything under it)."""
    return (f"{CDX}?url={quote(url, safe='')}{'&matchType=prefix' if prefix else ''}&output=json"
            f"&fl={','.join(CDX_FIELDS)}&filter=statuscode:200&collapse={collapse}&limit=20000")


def page_url(timestamp: str, original: str) -> str:
    """The Archive's raw copy of a capture: the bytes it recorded, with nothing added."""
    return f"https://web.archive.org/web/{timestamp}id_/{original}"


def archive_url(timestamp: str, original: str) -> str:
    return f"https://web.archive.org/web/{timestamp}/{original}"


class Cache:
    """What has already been read from the Archive, so that a re-run asks for nothing twice.

    data/wayback-cache/ (not committed; everything in it can be asked for again)
      cdx/<sha1 of the question>.json            an index answer
      pages/<timestamp>-<sha1 of the url>.html.gz  an archived listing page, as returned
    `refresh` asks the index again (new captures appear over time); pages never change.
    """

    def __init__(self, root: Path, guard: Guard, *, refresh: bool = False):
        self.root = Path(root)
        self.guard = guard
        self.refresh = refresh
        self.offline = False             # True: answer from what is stored, ask the Archive nothing
        self.requests = 0

    def cdx(self, client: PoliteClient, query: str) -> list[dict] | None:
        """Index rows for a question, or None when the index did not answer (never cached)."""
        path = self.root / "cdx" / (hashlib.sha1(query.encode()).hexdigest() + ".json")
        cached = None if (self.refresh and not self.offline) else read_json(path)
        if cached is not None:
            return cached["rows"]
        if self.offline:
            return None
        self.requests += 1
        r = self.guard(client.get(query))
        if not r.ok:
            return None
        try:
            table = r.json() if r.content.strip() else []
        except ValueError:                   # an error page served as a success
            return None
        rows = [dict(zip(CDX_FIELDS, row)) for row in table[1:]]
        write_json(path, {"query": query, "asked": now_iso(), "rows": rows})
        return rows

    def page(self, client: PoliteClient, timestamp: str, original: str) -> tuple[bytes | None, FetchResult | None]:
        """(page bytes, None), or (None, the failed answer). Failures are not cached."""
        path = self.root / "pages" / f"{timestamp}-{hashlib.sha1(original.encode()).hexdigest()[:16]}.html.gz"
        if path.exists():
            return gzip.decompress(path.read_bytes()), None
        if self.offline:
            return None, FetchResult(page_url(timestamp, original), "error", error="not read (offline)")
        self.requests += 1
        r = self.guard(client.get(page_url(timestamp, original), follow=True))
        if not r.ok:
            return None, r
        atomic_write(path, gzip.compress(r.content, mtime=0))
        return r.content, None


# --- Parsing archived pages ----------------------------------------------------------------------
def _clean(text: str | None) -> str:
    return " ".join((text or "").split())


def _has_class(name: str) -> str:
    return f"contains(concat(' ', normalize-space(@class), ' '), ' {name} ')"


def _document(page_html: str | bytes):
    """The parsed page, or None for a capture with nothing in it."""
    try:
        return lxml_html.document_fromstring(page_html) if page_html.strip() else None
    except (etree.ParserError, etree.XMLSyntaxError, ValueError):
        return None


def parse_collection_page(page_html: str | bytes) -> list[dict]:
    """Country pages an (archived) collection page links to: [{base_path, title}], in page order."""
    root = _document(page_html)
    if root is None:
        return []
    found = {}
    for a in root.xpath("//a[@href]"):
        parts = urlsplit(urljoin(config.GOVUK, a.get("href")))
        path = parts.path.rstrip("/")
        title = _clean(a.text_content())
        if parts.netloc != "www.gov.uk" or not PUBLICATION_RE.match(path):
            continue
        if path.endswith(PUBLICATION_SUFFIX) or title.lower().endswith("country policy and information notes"):
            found.setdefault(path, {"base_path": path, "title": title})
    return list(found.values())


def parse_country_page(page_html: str | bytes) -> list[dict]:
    """Attachments an (archived) country page lists, in page order.

    Each is {kind: 'html' | 'file' | 'other', url (absolute), title, type, size, pages}. Covers both
    of GOV.UK's layouts: <section class="attachment"> (to about 2023) and the later gem-c-attachment.
    """
    root = _document(page_html)
    if root is None:
        return []
    out, seen = [], set()
    for block in root.xpath(f"//*[{_has_class('attachment')} or {_has_class('gem-c-attachment')}]"):
        links = block.xpath(".//*[contains(@class, 'title')]//a[@href]")
        if not links:
            continue
        url = urljoin(config.GOVUK, links[0].get("href").strip())
        if url in seen:
            continue
        seen.add(url)
        meta = block.xpath(".//*[contains(@class, 'metadata')]")
        parts = [_clean(p) for p in meta[0].text_content().split(",")] if meta else []
        pages = next((int(m.group(1)) for p in parts if (m := re.fullmatch(r"(\d+) pages?", p))), None)
        size = next((p for p in parts if re.fullmatch(r"[\d.]+\s?[KMG]B", p, re.IGNORECASE)), None)
        kind = next((p for p in parts if p and p != size and not re.fullmatch(r"\d+ pages?", p)
                     and not re.match(r"(Ref|ISBN|Order a copy)\b", p)), None)      # 'Ref: IRN-001-02-26, PDF, …'
        out.append({"kind": attachment_kind(url), "url": url, "title": _clean(links[0].text_content()),
                    "type": kind, "size": size, "pages": pages})
    return out


def attachment_kind(url: str) -> str:
    parts = urlsplit(url)
    if parts.netloc == "www.gov.uk" and NOTE_RE.match(parts.path.rstrip("/")):
        return "html"
    if parts.netloc.endswith("gov.uk") and ("/uploads/" in parts.path or parts.path.startswith("/media/")
                                              or FILE_EXT_RE.search(parts.path)):
        return "file"
    return "other"


def asset_key(url: str) -> str:
    """What identifies a file whatever host or spelling its link used: GOV.UK's own asset id."""
    path = urlsplit(url).path
    m = re.search(r"/attachment_data/file/(\d+)/[^/]+$", path)
    if m:
        return f"attachment_data/{m.group(1)}"
    m = re.match(r"^/media/([0-9a-f]{24})/[^/]+$", path)
    if m:
        return f"media/{m.group(1)}"
    return url


def is_pdf_item(item: dict) -> bool:
    return urlsplit(item["url"]).path.lower().endswith(".pdf") or (item.get("type") or "").upper() == "PDF"


def _norm_title(title: str | None) -> str:
    return _clean(_ACCESSIBLE_RE.sub("", title or "")).lower()


def pair_attachments(attachments: list[dict], country_name: str | None = None) -> dict[str, str]:
    """HTML attachment url -> url of the PDF listed beside it on the same page.

    Same title (bar '(accessible)'), else the closest PDF title of the same month. Stricter than
    verify.pair_pdfs, because an old page may list an HTML note whose PDF is absent beside PDFs of
    other editions; those must stay unpaired.
    """
    pdfs = {a["url"]: a for a in attachments if a["kind"] == "file" and is_pdf_item(a)}
    pairs, unmatched = {}, []
    for a in attachments:
        if a["kind"] != "html":
            continue
        title = _norm_title(a["title"])
        url = next((u for u, p in pdfs.items() if _norm_title(p["title"]) == title and u not in pairs.values()), None)
        if url:
            pairs[a["url"]] = url
        else:
            unmatched.append(a)
    for a in unmatched:
        mine = parse_note_title(a["title"], country_name)
        best, best_ratio = None, 0.0
        for u, p in pdfs.items():
            if u in pairs.values():
                continue
            theirs = parse_note_title(p["title"], country_name)
            ratio = difflib.SequenceMatcher(None, _norm_title(a["title"]), _norm_title(p["title"])).ratio()
            if mine.month and theirs.month:               # two editions of one report differ only in the month
                ok = mine.month == theirs.month and (series_key(mine) == series_key(theirs) or ratio >= 0.6)
            else:
                ok = ratio >= 0.9
            if ok and ratio > best_ratio:
                best, best_ratio = u, ratio
        if best:
            pairs[a["url"]] = best
    return pairs


# --- What is held --------------------------------------------------------------------------------
def sha1_base32(data: bytes) -> str:
    """The Archive index's digest of a capture: base32 of the SHA-1 of the bytes it recorded."""
    return base64.b32encode(hashlib.sha1(data).digest()).decode()


def matches_digest(data: bytes, digest: str) -> bool:
    """Do these bytes hash to the Archive's digest of the capture? Its index gives the SHA-1 in base32, and
    for some captures of 2017 in hexadecimal."""
    return digest in (sha1_base32(data), hashlib.sha1(data).hexdigest())


class Held:
    """The PDFs in the store, findable by URL, by GOV.UK asset id and by the Archive's digest."""

    def __init__(self, store: Store):
        self.manifest = store.load_pdf_manifest()
        self.by_asset, self.by_digest = {}, {}
        known_path = store.root / CACHE_DIR / "pdf-digests.json"       # sha256 -> the Archive's digest
        known = read_json(known_path, {})
        size = len(known)
        for url, entry in self.manifest.items():
            for listed in (url, *entry.get("also_listed_as", [])):
                self.by_asset[asset_key(listed)] = url
            for capture in entry.get("other_captures", []):
                self.by_digest[capture["archive_digest"]] = url
            for record in (entry, *entry.get("previous", [])):
                if record.get("archive_digest"):
                    self.by_digest[record["archive_digest"]] = url
                path = store.pdf_path(record["sha256"])
                if record["sha256"] not in known and path.exists():
                    known[record["sha256"]] = sha1_base32(path.read_bytes())
                if record["sha256"] in known:
                    self.by_digest.setdefault(known[record["sha256"]], url)
        if len(known) != size:
            write_json(known_path, known)

    def find(self, item: dict) -> dict | None:
        """How a listed file is held: {by, manifest_url, sha256, source ('live' or 'wayback')}, or None."""
        found = None
        for listed in (item["url"], *item.get("also_listed_as", [])):
            url = listed if listed in self.manifest else self.by_asset.get(asset_key(listed))
            if url:
                found = {"by": "url" if url == listed else "asset id", "manifest_url": url}
                break
        for capture in [] if found else item.get("archive") or []:
            if capture["digest"] in self.by_digest:
                found = {"by": "content (the Archive's digest)", "manifest_url": self.by_digest[capture["digest"]]}
                break
        if found:
            entry = self.manifest[found["manifest_url"]]
            found |= {"sha256": entry["sha256"], "source": entry.get("source", "live")}
        return found


# --- Discovery -----------------------------------------------------------------------------------
def _span(record: dict, when: str):
    record["first_listed"] = min(record.get("first_listed") or when, when)
    record["last_listed"] = max(record.get("last_listed") or when, when)


def resolve_address(client: PoliteClient, guard: Guard, base_path: str) -> dict:
    """GOV.UK's answer for an address the collection no longer lists (one request)."""
    r = guard(client.get(api_url(base_path)))
    checked = now_iso()
    if r.status in (404, 410):
        return {"status": "gone", "checked": checked}
    if isinstance(r.status, int) and 300 <= r.status < 400 and r.location:
        return {"status": "redirect", "destination": urlsplit(r.location).path.removeprefix("/api/content"),
                "checked": checked}
    if not r.ok:
        return {"status": "error", "error": f"{r.status} {r.error or ''}".strip()}
    item = r.json()
    if "redirect" in (item.get("document_type"), item.get("schema_name")):
        destinations = [x.get("destination") for x in item.get("redirects", [])]
        return {"status": "redirect", "destination": destinations[0] if destinations else None, "checked": checked}
    return {"status": "published", "title": item.get("title"), "document_type": item.get("document_type"),
            "withdrawn": bool(item.get("withdrawn_notice")), "checked": checked}


def discover_addresses(client: PoliteClient, store: Store, cache: Cache, previous: dict, log=print) -> dict:
    """Every address the collection has listed, from its archived copies (one per month)."""
    state = store.load_state()
    current = {c["base_path"].rstrip("/"): slug for slug, c in state["countries"].items()}
    rows = cache.cdx(client, cdx_query(COLLECTION_URL, collapse="timestamp:6"))
    errors, read, listed = [], 0, {}
    if rows is None:
        errors.append({"url": COLLECTION_URL, "error": "archive index unavailable"})
    for row in rows or []:
        page, failed = cache.page(client, row["timestamp"], row["original"])
        if page is None:
            errors.append({"url": failed.url, "status": failed.status, "error": failed.error})
            continue
        read += 1
        for link in parse_collection_page(page):
            record = listed.setdefault(link["base_path"], {"base_path": link["base_path"], "title": link["title"]})
            _span(record, _iso(row["timestamp"]))
    log(f"  collection: {read} archived copies read, {len(listed)} addresses listed over the years")

    answers = {p["base_path"]: p["govuk"] for p in previous.get("other_pages", []) if p.get("govuk")}
    for country in previous.get("countries", {}).values():
        answers.update({a["base_path"]: a["govuk"] for a in country.get("addresses", []) if a.get("govuk")})
    by_country, others = {slug: [] for slug in current.values()}, []
    for base_path, record in sorted(listed.items()):
        if base_path in current:
            by_country[current[base_path]].append({**record, "current": True, "how": "current address"})
            continue
        answer = answers.get(base_path)
        if not answer or answer.get("status") == "error":
            answer = resolve_address(client, cache.guard, base_path)
        slug = current.get((answer.get("destination") or "").rstrip("/")) if answer["status"] == "redirect" else None
        if slug:
            by_country[slug].append({**record, "current": False, "govuk": answer,
                                     "how": "discovered: listed by archived collection pages; "
                                            "GOV.UK redirects it to the current address"})
        else:
            others.append({**record, "govuk": answer})
    for base_path, slug in current.items():         # a current page the archived collection never showed
        if not any(a["current"] for a in by_country[slug]):
            by_country[slug].append({"base_path": base_path, "title": None, "first_listed": None,
                                     "last_listed": None, "current": True, "how": "current address"})
    return {"collection": {"url": COLLECTION_URL, "captures_read": read, "errors": errors},
            "addresses": by_country, "other_pages": others}


def read_listings(client: PoliteClient, cache: Cache, address: dict) -> list[dict]:
    """Every archived state of one country page address: [{timestamp, digest, attachments}], oldest
    first. `address` gains `captures` (how many were read) and `errors`."""
    url = config.GOVUK + address["base_path"]
    rows = cache.cdx(client, cdx_query(url))
    address["errors"] = []
    if rows is None:
        address["errors"].append({"url": url, "error": "archive index unavailable"})
    listings = []
    for row in sorted(rows or [], key=lambda r: r["timestamp"]):
        if urlsplit(row["original"]).query:
            continue
        page, failed = cache.page(client, row["timestamp"], row["original"])
        if page is None:
            address["errors"].append({"url": failed.url, "status": failed.status, "error": failed.error})
            continue
        listings.append({"timestamp": row["timestamp"], "digest": row["digest"],
                         "attachments": parse_country_page(page)})
    address["captures"] = len(listings)
    address["captures_without_attachments"] = sum(1 for x in listings if not x["attachments"])
    return listings


def html_edition(title: str | None, country_name: str | None) -> str:
    """What tells one edition from the next at the same HTML address: its month, else its title."""
    return parse_note_title(title or "", country_name).month or _norm_title(title)


def collect_items(listings_by_address: dict[str, list[dict]], country_name: str | None) -> tuple[dict, dict]:
    """Merge the listings into items and the pairs seen between them.

    A file is one item per GOV.UK asset id. An HTML attachment is one item per address and edition:
    GOV.UK often edits an HTML attachment in place when the next edition comes out (new title, new
    text, same address), so one address can carry several editions over the years.
    Returns (items by key, pairs: html key -> set of file keys)."""
    items, pairs = {}, {}
    for base_path, listings in listings_by_address.items():
        for listing in listings:
            when = _iso(listing["timestamp"])
            keys = {}
            for a in listing["attachments"]:
                if a["kind"] == "other":
                    continue
                if a["kind"] == "html":
                    path = urlsplit(a["url"]).path.rstrip("/")
                    edition = html_edition(a["title"], country_name)
                    key = f"html:{path}|{edition}"
                else:
                    key = "file:" + asset_key(a["url"])
                keys[a["url"]] = key
                item = items.setdefault(key, {"kind": a["kind"], "urls": [], "listed_at": [], "captures": 0})
                if a["kind"] == "html":
                    item.update(path=path, edition=edition)
                if a["url"] in item["urls"]:
                    item["urls"].remove(a["url"])
                item["urls"].append(a["url"])                 # the spelling last listed comes last
                item.update({k: a[k] for k in ("title", "type", "size", "pages") if a.get(k) is not None})
                if base_path not in item["listed_at"]:
                    item["listed_at"].append(base_path)
                item["captures"] += 1
                _span(item, when)
            for html_url, file_url in pair_attachments(listing["attachments"], country_name).items():
                pairs.setdefault(keys[html_url], set()).add(keys[file_url])
    return items, pairs


def html_holdings(items: dict, children: dict, store: Store, slug: str, name: str | None, unextractable: dict) -> int:
    """Say, for each HTML edition, whether a version of it is held and what the Archive has of it.

    Held: a stored version of the note at that address carries the edition's month (or its title).
    The Archive's captures of an address are shared out between its editions by date: an edition's
    captures are those taken after the listing of the edition before it and before the listing of
    the edition after it. Returns how many captures, over all addresses, have not been read yet.
    """
    by_path = {}
    for item in items.values():
        if item["kind"] == "html":
            by_path.setdefault(item["path"], []).append(item)
    for path in children:                                   # archived, though no archived listing showed it
        if path not in by_path:
            item = {"kind": "html", "urls": [config.GOVUK + path], "title": None, "path": path, "edition": None,
                    "listed_at": [], "captures": 0, "first_listed": None, "last_listed": None}
            items[f"html:{path}|"] = item
            by_path[path] = [item]
    to_read = 0
    for path, editions in by_path.items():
        note = path.rsplit("/", 1)[-1]
        index = store.load_note(slug, note)
        versions = index["versions"] if index else []
        done = set(index.get("wayback_digests", [])) if index else set()
        captures = {d: _iso(row["timestamp"]) for d, row in children.get(path, {}).items()}
        unread = {d for d, row in children.get(path, {}).items()
                  if d not in done and archive_url(row["timestamp"], row["original"]) not in unextractable}
        to_read += len(unread)
        editions.sort(key=lambda i: i["first_listed"] or "")
        for n, item in enumerate(editions):
            after = editions[n - 1]["last_listed"] if n else None
            before = editions[n + 1]["first_listed"] if n + 1 < len(editions) else None
            mine = [d for d, when in captures.items() if (not after or when > after) and (not before or when < before)]
            held = [v for v in versions
                    if item["edition"] is None or html_edition(v.get("title"), name) == item["edition"]]
            item.update(note=note, held_versions=len(held), archive_captures=len(mine),
                        captures_to_read=sum(1 for d in mine if d in unread))
    return to_read


def _filename(url: str) -> str:
    return urlsplit(url).path.rsplit("/", 1)[-1]


def archive_captures(client: PoliteClient, cache: Cache, urls: list[str]) -> list[dict] | None:
    """Successful captures of a file at any address it was listed at, one per distinct content, oldest
    first. None when the index did not answer.

    Where the address carries GOV.UK's asset id, the index is asked for everything under that id
    (one directory per file) rather than for the exact address, so that a file name spelled another
    way ('+', '%20' or '_' for a space) is still found. If a file listed on www.gov.uk has no
    capture, the same path on the assets host is tried: GOV.UK moved uploads there and redirected
    the old links.
    """
    listed = list(dict.fromkeys(urls))
    fallback = []
    for url in listed:
        parts = urlsplit(url)
        alternate = "https://assets.publishing.service.gov.uk" + parts.path
        if parts.netloc == "www.gov.uk" and "/government/uploads/" in parts.path and alternate not in listed:
            fallback.append(alternate)
    found, answered = {}, False
    for group in (listed, fallback):
        if found:
            break
        for url in group:
            by_id = asset_key(url) != url
            extension = _filename(url).rsplit(".", 1)[-1].lower()
            rows = cache.cdx(client, cdx_query(url.rsplit("/", 1)[0] + "/", prefix=True) if by_id else cdx_query(url))
            if rows is None:
                continue
            answered = True
            for row in rows:
                name = _filename(row["original"])
                if by_id and (name.startswith("thumbnail_") or name.rsplit(".", 1)[-1].lower() != extension):
                    continue                              # the file's preview image, not the file
                found.setdefault(row["digest"], {k: row[k] for k in ("timestamp", "original", "mimetype", "digest")}
                                 | {"length": int(row["length"]) if row["length"].isdigit() else None})
    return sorted(found.values(), key=lambda c: c["timestamp"]) if answered else None


def merge_same_files(items: dict, pairs: dict) -> tuple[dict, dict]:
    """One file listed at two addresses is one file. GOV.UK moved every upload from
    /government/uploads/…/attachment_data/file/<number>/ to /media/<id>/ in 2023, so a file listed
    before and after has two addresses and two asset ids.

    Two listings are the same file when the Archive holds the same content for both (its digest),
    or, where it holds no capture of one of them, when title, file name and page count all agree.
    """
    kept: list[tuple[str, dict]] = []
    alias = {}
    files = sorted(((k, i) for k, i in items.items() if i["kind"] == "file"), key=lambda ki: ki[1]["first_listed"])
    for key, item in files:
        digests = {c["digest"] for c in item.get("archive") or []}
        same = None
        for other_key, other in kept:
            theirs = {c["digest"] for c in other.get("archive") or []}
            if digests & theirs:
                same = other_key, other
            elif not (digests and theirs) and (_norm_title(item["title"]), _filename(item["url"]), item.get("pages")) == \
                    (_norm_title(other["title"]), _filename(other["url"]), other.get("pages")):
                same = other_key, other
            if same:
                break
        if not same:
            kept.append((key, item))
            continue
        other_key, other = same
        alias[key] = other_key
        other["urls"] = [u for u in other["urls"] if u not in item["urls"]] + item["urls"]
        other["url"], other["also_listed_as"] = other["urls"][-1], other["urls"][:-1]
        other["listed_at"] += [p for p in item["listed_at"] if p not in other["listed_at"]]
        other["captures"] += item["captures"]
        other["first_listed"] = min(other["first_listed"], item["first_listed"])
        other["last_listed"] = max(other["last_listed"], item["last_listed"])
        other.update({k: item[k] for k in ("title", "type", "size", "pages") if item.get(k) is not None})
        other["held"] = other.get("held") or item.get("held")
        captures = {c["digest"]: c for c in (other.get("archive") or []) + (item.get("archive") or [])}
        if "archive" in other or "archive" in item:
            other["archive"] = sorted(captures.values(), key=lambda c: c["timestamp"])
    merged = {k: i for k, i in items.items() if k not in alias}
    return merged, {h: {alias.get(f, f) for f in fs} for h, fs in pairs.items()}


def is_pdf_capture(capture: dict) -> bool:
    mimetype = (capture.get("mimetype") or "").lower()
    return "pdf" in mimetype or (mimetype in ("unk", "application/octet-stream", "binary/octet-stream")
                                 and urlsplit(capture["original"]).path.lower().endswith(".pdf"))


def discover_country(client: PoliteClient, store: Store, cache: Cache, held: Held, slug: str, name: str,
                     addresses: list[dict], previous: dict) -> dict:
    listings_by_address, children = {}, {}
    for address in addresses:
        listings_by_address[address["base_path"]] = read_listings(client, cache, address)
        rows = cache.cdx(client, cdx_query(config.GOVUK + address["base_path"] + "/", prefix=True))
        if rows is None:
            address["errors"].append({"url": address["base_path"] + "/*", "error": "archive index unavailable"})
        for row in rows or []:
            parts = urlsplit(row["original"])
            path = parts.path.rstrip("/")
            if not parts.query and NOTE_RE.match(path):
                children.setdefault(path, {})[row["digest"]] = row
    items, pairs = collect_items(listings_by_address, name)
    unextractable = dict(previous.get("unextractable", {}))
    html_to_read = html_holdings(items, children, store, slug, name, unextractable)
    for item in items.values():
        if item["kind"] == "file":
            item["url"], item["also_listed_as"] = item["urls"][-1], item["urls"][:-1]
    for item in items.values():
        if item["kind"] != "file":
            continue
        item["held"] = held.find(item)
        if item["held"] and item["held"]["source"] != "wayback":
            continue                                        # held from GOV.UK itself: the Archive is not asked
        item["archive"] = archive_captures(client, cache, item["urls"])
        if item["archive"] is None:
            item["archive_error"] = "archive index unavailable"
        item["held"] = held.find(item)                      # the same file, known here under another address

    items, pairs = merge_same_files(items, pairs)
    editions = build_editions(items, pairs)
    mark_held_elsewhere(editions, held_editions(store, slug, name, held.manifest), name)
    country = {"name": name, "addresses": addresses, "editions": editions, "unextractable": unextractable}
    country["summary"] = summarise(country, html_to_read)
    return country


def edition_key(title: str | None, country_name: str | None) -> tuple[str, str] | None:
    """What makes two listings one edition: the report (titles.series_key) and the month in the title.
    None for a title with no month: nothing then says which edition of the report it is."""
    parsed = parse_note_title(title or "", country_name)
    return (series_key(parsed), parsed.month) if parsed.month else None


def held_editions(store: Store, slug: str, name: str | None, manifest: dict) -> dict:
    """What is held of a country, by report and month: {(series key, month): how it is held}. Web
    versions by the title of each stored version; PDFs by the title in the manifest."""
    known = {}
    for note, index in store.notes_for(slug):
        for v in index["versions"]:
            key = edition_key(v.get("title") or index.get("title"), name)
            if key:
                known.setdefault(key, {"by": "title and month", "web_version": note})
    for url, entry in manifest.items():
        key = edition_key(entry.get("title"), name) if entry.get("country") == slug else None
        if key:
            known.setdefault(key, {"by": "title and month", "pdf": url})
    return known


def mark_held_elsewhere(editions: list[dict], known: dict, name: str | None):
    """An edition listed again under another address, file or title is one edition, not two.

    - Not held by its own address, but the same report and month is held (a web version, or a PDF at
      another address): its status becomes `held`, and `held_as` says where.
    - Not held at all, and listed more than once (GOV.UK replaced the file, or retitled it): each later
      listing gets `repeat_of`, the title and first listing of the first. Each keeps its own status,
      because the files may differ; they are counted as one edition (see `summarise`).
    """
    first = {}
    for edition in editions:
        if edition["status"] in ("held", "other-file"):
            continue
        key = edition_key(edition["title"], name)
        if key and key in known:
            edition["status"], edition["held_as"] = "held", known[key]
        elif key and key in first:
            edition["repeat_of"] = {"title": first[key]["title"], "first_listed": first[key]["first_listed"]}
        elif key:
            first[key] = edition


def build_editions(items: dict, pairs: dict) -> list[dict]:
    """Group items into editions: an HTML attachment with the files paired with it; other files alone."""
    group = {key: key for key in items}

    def root(key):
        while group[key] != key:
            key = group[key]
        return key

    for html_key, file_keys in pairs.items():
        for file_key in file_keys:
            group[root(file_key)] = root(html_key)
    members = {}
    for key in items:
        members.setdefault(root(key), []).append(key)
    editions = []
    for keys in members.values():
        html = [items[k] for k in keys if items[k]["kind"] == "html"]
        files = [items[k] for k in keys if items[k]["kind"] == "file"]
        everything = html + files
        listed = [i for i in everything if i.get("first_listed")]
        edition = {
            "title": next((i["title"] for i in files + html if i.get("title")), None),
            "status": None,
            "first_listed": min((i["first_listed"] for i in listed), default=None),
            "last_listed": max((i["last_listed"] for i in listed), default=None),
            "listed_at": sorted({p for i in everything for p in i["listed_at"]}),
            "html": [{k: i.get(k) for k in ("path", "note", "title", "first_listed", "last_listed", "held_versions",
                                            "archive_captures", "captures_to_read")} for i in html],
            "files": [{k: i.get(k) for k in ("url", "also_listed_as", "asset", "title", "type", "size", "pages",
                                             "first_listed", "last_listed", "held", "archive")}
                      | {"asset": asset_key(i["url"])}
                      | ({"archive_error": i["archive_error"]} if i.get("archive_error") else {}) for i in files],
        }
        edition["status"] = edition_status(edition)
        editions.append(edition)
    return sorted(editions, key=lambda e: (e["first_listed"] or "", e["title"] or ""))


def edition_status(edition: dict) -> str:
    if any(h["held_versions"] for h in edition["html"]) or any(f["held"] for f in edition["files"]):
        return "held"
    if any(h["captures_to_read"] for h in edition["html"]):
        return "recoverable-html"
    pdfs = [f for f in edition["files"] if is_pdf_item(f)]
    if any(is_pdf_capture(c) for f in pdfs for c in f.get("archive") or []):
        return "recoverable-pdf"
    if edition["files"] and not pdfs and not edition["html"]:
        return "other-file"
    return "not-archived"


def pdf_jobs(slug: str, country: dict, *, all_pdfs: bool = False) -> list[dict]:
    """The PDF captures a fetch would download for a country: every distinct content of every PDF of an
    edition that is not held, oldest first for each address. With all_pdfs, also the PDFs of editions
    whose web version is held (the PDF beside a web version we have)."""
    jobs = []
    for edition in country["editions"]:
        if edition["status"] not in ("recoverable-pdf", "recoverable-html") and not (all_pdfs and "held_as" not in edition):
            continue
        for f in edition["files"]:
            if f["held"] or not is_pdf_item(f):
                continue
            for capture in f.get("archive") or []:
                if is_pdf_capture(capture):
                    jobs.append({"country": slug, "url": f["url"], "also_listed_as": f["also_listed_as"],
                                 "title": f["title"], "pages": f["pages"], "first_listed": f["first_listed"],
                                 "last_listed": f["last_listed"], "listed_at": edition["listed_at"], **capture})
    return jobs


def summarise(country: dict, html_to_read: int) -> dict:
    """Counts for one country. `editions` and the statuses count listings; `not_held` counts editions
    (a listing that repeats another is not counted again): those with a PDF in the Archive, and those
    with none. `pdfs_to_fetch` is what a fetch downloads: the PDFs of editions not held."""
    editions = country["editions"]
    statuses = [e["status"] for e in editions]
    jobs = {j["digest"]: j for j in pdf_jobs("", country)}
    beside = {j["digest"]: j for j in pdf_jobs("", country, all_pdfs=True) if j["digest"] not in jobs}
    missing = [e for e in editions if e["status"] in ("recoverable-pdf", "recoverable-html", "not-archived")]
    firsts = [e for e in missing if "repeat_of" not in e]
    copies = {(e["repeat_of"]["title"], e["repeat_of"]["first_listed"]) for e in missing
              if "repeat_of" in e and e["status"] != "not-archived"}          # a repeat listing with a copy in the Archive
    in_archive = sum(1 for e in firsts if e["status"] != "not-archived" or (e["title"], e["first_listed"]) in copies)
    return {
        "editions": len(statuses),
        "held": statuses.count("held"),
        "held_under_another_listing": sum(1 for e in editions if "held_as" in e),
        "recoverable_html": statuses.count("recoverable-html"),
        "recoverable_pdf_only": statuses.count("recoverable-pdf"),
        "not_archived": statuses.count("not-archived"),
        "other_files": statuses.count("other-file"),
        "not_held": len(firsts),
        "not_held_in_archive": in_archive,
        "not_held_not_in_archive": len(firsts) - in_archive,
        "html_captures_to_read": html_to_read,
        "pdfs_to_fetch": len(jobs),
        "pdf_bytes_to_fetch": sum(j["length"] or 0 for j in jobs.values()),
        "pdfs_beside_held_web_versions": len(beside),
        "listing_captures_read": sum(a.get("captures", 0) for a in country["addresses"]),
    }


def discover(client: PoliteClient, store: Store, cache: Cache, *, only: set[str] | None = None,
             log=print) -> dict:
    """Build (or, with `only`, update) the catalogue. Metadata only: no edition is downloaded."""
    path = store.root / CATALOGUE
    previous = read_json(path, {})
    state = store.load_state()
    found = discover_addresses(client, store, cache, previous, log=log)
    catalogue = {"generated": now_iso(), "tool": "cpin recover (see src/cpin/recover.py for the shape)",
                 "collection": found["collection"], "other_pages": found["other_pages"],
                 "countries": dict(previous.get("countries", {})), "failures": previous.get("failures", [])}
    held = Held(store)
    try:
        for slug in ordered(state["countries"], only):
            before = cache.requests
            catalogue["countries"][slug] = discover_country(
                client, store, cache, held, slug, state["countries"][slug]["name"], found["addresses"][slug],
                previous.get("countries", {}).get(slug, {}))
            s = catalogue["countries"][slug]["summary"]
            log(f"  {slug}: {s['listing_captures_read']} page states, {s['editions']} editions"
                f" ({s['held']} held, {s['recoverable_html']} HTML and {s['recoverable_pdf_only']} PDF-only recoverable,"
                f" {s['not_archived']} not archived) · {cache.requests - before} requests")
            save_catalogue(store, catalogue)                # progress survives an interruption
    finally:
        save_catalogue(store, catalogue)
    return catalogue


def ordered(countries, only: set[str] | None) -> list[str]:
    """Palestine first (the case this was built for), then the rest in order."""
    slugs = sorted(s for s in countries if not only or s in only)
    return sorted(slugs, key=lambda s: s != "palestine")


def save_catalogue(store: Store, catalogue: dict):
    countries = dict(sorted(catalogue["countries"].items()))
    keys = ("editions", "held", "held_under_another_listing", "recoverable_html", "recoverable_pdf_only",
            "not_archived", "other_files", "not_held", "not_held_in_archive", "not_held_not_in_archive",
            "html_captures_to_read", "pdfs_to_fetch", "pdf_bytes_to_fetch", "pdfs_beside_held_web_versions",
            "listing_captures_read")
    catalogue["countries"] = countries
    catalogue["totals"] = {k: sum(c["summary"].get(k, 0) for c in countries.values()) for k in keys}
    write_json(store.root / CATALOGUE, catalogue)


# --- Fetch ---------------------------------------------------------------------------------------
def pdf_problem(data: bytes) -> str | None:
    """Why these bytes are not a whole PDF, or None if they are: the header must open the file and
    the end-of-file marker must close it (a capture cut short has no marker)."""
    if b"%PDF-" not in data[:1024]:
        return f"not a PDF (starts {data[:12]!r})"
    if b"%%EOF" not in data[-2048:]:
        return "PDF is cut short (no end-of-file marker)"
    return None


def page_count(data: bytes) -> int | None:
    try:
        import pymupdf
        with pymupdf.open(stream=data, filetype="pdf") as doc:
            return doc.page_count
    except Exception:
        return None


def fetch_pdfs(client: PoliteClient, store: Store, jobs: list[dict], report: RunReport, guard: Guard,
               log=print) -> dict:
    """Download archived PDFs into the PDF store. Nothing held is overwritten.

    The manifest entry is keyed by the address GOV.UK listed the file at, like every other entry,
    and says where the bytes really came from:
      source 'wayback' · archive_url · captured_at · original_url (the address the Archive
      captured) · archive_digest and digest_verified (our bytes hash to the Archive's own digest) ·
      title (as listed) · country · first_listed, last_listed (the archived country pages that
      listed it) · listed_at · pages, pages_listed · also_listed_as · sha256 · bytes ·
      first_seen (when we fetched it; last_seen stays null: it was never seen live).
    A second, different capture of the same address is kept in `previous`, as `sync` does.
    """
    manifest = store.load_pdf_manifest()
    stats = {"checked": 0, "downloaded": 0, "unchanged": 0, "replaced_same_url": 0, "bytes_downloaded": 0,
             "already_fetched": 0, "same_content_as_held": 0, "failed": 0}
    by_digest = {r["archive_digest"]: url for url, e in manifest.items()
                 for r in (e, *e.get("previous", []), *e.get("other_captures", [])) if r.get("archive_digest")}
    for job in sorted(jobs, key=lambda j: (j["url"], j["timestamp"])):
        url, digest = job["url"], job["digest"]
        stats["checked"] += 1
        entry = manifest.get(url)
        if entry and entry.get("source") != "wayback":
            stats["unchanged"] += 1                       # held from GOV.UK itself: never replaced
            continue
        if digest in by_digest:
            holder = manifest[by_digest[digest]]
            if by_digest[digest] != url and url not in holder.setdefault("also_listed_as", []):
                holder["also_listed_as"].append(url)      # the same bytes, listed at another address
                store.save_pdf_manifest(manifest)
            stats["already_fetched"] += 1
            continue
        r = guard(client.get(page_url(job["timestamp"], job["original"]), follow=True))
        problem = None if r.ok else f"{r.status} {r.error or ''}".strip()
        problem = problem or pdf_problem(r.content)
        if problem:
            stats["failed"] += 1
            report.errors.append({"country": job["country"], "url": url, "title": job["title"],
                                  "archive_url": archive_url(job["timestamp"], job["original"]), "error": problem})
            log(f"    FAILED {url}: {problem}")
            continue
        m = re.search(r"/web/(\d{14})", r.url)
        timestamp = m.group(1) if m else job["timestamp"]
        sha = sha256_bytes(r.content)
        if store.pdf_path(sha).exists():
            stats["same_content_as_held"] += 1
        else:
            store.write_pdf(sha, r.content)
            stats["downloaded"] += 1
            stats["bytes_downloaded"] += len(r.content)
        if entry and entry["sha256"] == sha:               # another capture of the very same bytes
            entry.setdefault("other_captures", []).append({
                "archive_url": archive_url(timestamp, job["original"]), "captured_at": _iso(timestamp),
                "archive_digest": digest})
            by_digest[digest] = url
            store.save_pdf_manifest(manifest)
            continue
        previous = list(entry.get("previous", [])) if entry else []
        if entry:
            stats["replaced_same_url"] += 1
            previous.append({k: entry.get(k) for k in ("sha256", "bytes", "source", "archive_url", "captured_at",
                                                       "original_url", "archive_digest", "digest_verified", "pages")})
        manifest[url] = {
            "sha256": sha,
            "bytes": len(r.content),
            "etag": None,
            "country": job["country"],
            "title": job["title"],
            "first_seen": report.started,
            "last_seen": None,
            "source": "wayback",
            "archive_url": archive_url(timestamp, job["original"]),
            "captured_at": _iso(timestamp),
            "original_url": job["original"],
            "archive_digest": digest,
            "digest_verified": matches_digest(r.content, digest),
            "first_listed": job["first_listed"],
            "last_listed": job["last_listed"],
            "listed_at": job["listed_at"],
            "pages": page_count(r.content),
            "pages_listed": job["pages"],
            **({"also_listed_as": job["also_listed_as"]} if job["also_listed_as"] else {}),
            **({"previous": previous} if previous else {}),
        }
        by_digest[digest] = url
        store.save_pdf_manifest(manifest)                 # progress survives an interruption
    return stats


def restore_missing_pdfs(client: PoliteClient, store: Store, report: RunReport, guard: Guard, *,
                         only: set[str] | None = None, log=print) -> dict:
    """Fetch again any recovered PDF whose file is not on this disk. The manifest is committed and the files
    are not, so on a fresh checkout the entries are there and the PDFs are missing. Each is asked for at the
    capture its entry names, and kept only if it is the same file (its sha256); the entry is not changed."""
    stats = {"missing": 0, "restored": 0, "failed": 0}
    for url, entry in store.load_pdf_manifest().items():
        if (entry.get("source") != "wayback" or store.pdf_path(entry["sha256"]).exists()
                or (only and entry.get("country") not in only)):
            continue
        stats["missing"] += 1
        capture = re.match(r"https://web\.archive\.org/web/(\d{14})/(.+)$", entry.get("archive_url") or "")
        r = guard(client.get(page_url(capture.group(1), capture.group(2)), follow=True)) if capture else None
        if r is not None and r.ok and sha256_bytes(r.content) == entry["sha256"]:
            store.write_pdf(entry["sha256"], r.content)
            stats["restored"] += 1
            continue
        stats["failed"] += 1
        problem = ("no archive address recorded" if r is None else f"{r.status} {r.error or ''}".strip() if not r.ok
                   else "the Archive's copy is not the file recorded (sha256 differs)")
        report.errors.append({"country": entry.get("country"), "url": url, "title": entry.get("title"),
                              "archive_url": entry.get("archive_url"), "error": f"could not restore: {problem}"})
        log(f"    NOT RESTORED {url}: {problem}")
    return stats


def recover(client: PoliteClient, store: Store, *, only: set[str] | None = None, discover_only: bool = False,
            refresh: bool = False, max_files: int = MAX_FILES, max_bytes: int = MAX_BYTES, html: bool = False,
            all_pdfs: bool = False, log=print) -> RunReport:
    """Catalogue, then fetch. The fetch takes what is not held: the archived web pages of an edition with
    none stored, and the PDFs of an edition with no web version to be had. html: also read the archived
    web pages not read before of editions that are held (further copies of them). all_pdfs: also the PDFs
    listed beside web versions that are held."""
    report = RunReport(kind="recover", mode="discover" if discover_only else "wayback", started=now_iso())
    guard = Guard()
    cache = Cache(store.root / CACHE_DIR, guard, refresh=refresh)
    try:
        catalogue = discover(client, store, cache, only=only, log=log)
        cache.refresh = False            # the index has just been asked; the fetch works from those answers
        slugs = ordered(catalogue["countries"], only)
        report.countries_checked = slugs
        report.errors += [{"stage": "discover", **e} for e in catalogue["collection"]["errors"]]
        report.errors += [{"stage": "discover", "country": s, **e} for s in slugs
                          for a in catalogue["countries"][s]["addresses"] for e in a.get("errors", [])]
        if not discover_only:
            fetch(client, store, catalogue, slugs, report, guard, cache, max_files=max_files, max_bytes=max_bytes,
                  html=html, all_pdfs=all_pdfs, log=log)
    except Stopped as e:
        report.errors.append({"stage": "stopped", "error": str(e)})
        log(f"STOPPED: {e}")
    except (KeyboardInterrupt, SystemExit):               # what is stored stays; the next run carries on
        report.errors.append({"stage": "stopped", "error": "interrupted"})
        log("STOPPED: interrupted")
    report.finished = now_iso()
    store.append_run(asdict(report))
    return report


def fetch(client: PoliteClient, store: Store, catalogue: dict, slugs: list[str], report: RunReport,
          guard: Guard, cache: Cache, *, max_files: int, max_bytes: int, html: bool = False, all_pdfs: bool = False,
          log=print):
    jobs = {}
    for slug in slugs:
        for job in pdf_jobs(slug, catalogue["countries"][slug], all_pdfs=all_pdfs):
            jobs.setdefault(job["digest"], job)
    def wanted(country: dict) -> set | None:
        """The web addresses whose archived pages are to be read: those of editions not held (None: all)."""
        return None if html else {h["path"] for e in country["editions"] if e["status"] == "recoverable-html"
                                  for h in e["html"]}

    pages = sum(c["summary"]["html_captures_to_read"] if html else
                sum(h["captures_to_read"] for e in c["editions"] if e["status"] == "recoverable-html" for h in e["html"])
                for c in (catalogue["countries"][s] for s in slugs))
    fetched = [e for e in store.load_pdf_manifest().values() if e.get("source") == "wayback"]
    files = len(jobs) + pages + len(fetched)
    size = sum(j["length"] or 0 for j in jobs.values()) + sum(e["bytes"] for e in fetched)
    log(f"fetch: {len(jobs)} PDFs ({sum(j['length'] or 0 for j in jobs.values()) / 1e6:.1f} MB)"
        f" and {pages} archived web pages to fetch; {len(fetched)} archived PDFs already fetched")
    if files > max_files or size > max_bytes:
        raise Stopped(f"over budget: {files} files and {size / 1e6:.0f} MB (limits {max_files} files,"
                      f" {max_bytes / 1e6:.0f} MB). Nothing fetched; narrow with --country or raise the limits.")
    restored = restore_missing_pdfs(client, store, report, guard, only=set(slugs), log=log)
    if restored["missing"]:
        log(f"  {restored['restored']} of {restored['missing']} recovered PDFs missing from this disk fetched again")
    failures = {_failure_key(f): f for f in catalogue.get("failures", [])}
    touched, recorded = [], len(report.errors)

    def settle():
        """Make the catalogue say what is held now, and what could not be stored (kept until it can be)."""
        nonlocal recorded
        failures.update({_failure_key(e): e for e in report.errors[recorded:]})
        recorded = len(report.errors)
        catalogue["failures"] = [f for f in failures.values() if _still_failed(store, f)]
        cache.offline, held = True, Held(store)
        for slug in touched:
            country = catalogue["countries"][slug]
            catalogue["countries"][slug] = discover_country(
                client, store, cache, held, slug, country["name"], country["addresses"], country)
        touched.clear()
        cache.offline = False
        catalogue["generated"] = now_iso()
        save_catalogue(store, catalogue)

    try:
        for slug in slugs:
            country = catalogue["countries"][slug]
            touched.append(slug)
            before = len(report.new_versions)
            paths = wanted(country)
            for address in country["addresses"] if paths is None or paths else []:
                rows = cache.cdx(client, cdx_query(config.GOVUK + address["base_path"] + "/", prefix=True))
                rows = [(r["timestamp"], r["original"], r["digest"]) for r in rows or []
                        if NOTE_RE.match(path := urlsplit(r["original"]).path.rstrip("/")) and (paths is None or path in paths)]
                backfill_path(client, store, slug, address["base_path"], report, known_bad=country["unextractable"],
                              rows=rows, stop_on=guard)
            stats = fetch_pdfs(client, store, pdf_jobs(slug, country, all_pdfs=all_pdfs), report, guard, log=log)
            for key, value in stats.items():
                report.pdfs[key] = report.pdfs.get(key, 0) + value
            log(f"  {slug}: {stats['downloaded']} PDFs fetched ({stats['bytes_downloaded'] / 1e6:.1f} MB) · {stats['failed']} failed"
                f" · {len(report.new_versions) - before} new web versions")
            settle()                                      # progress survives an interruption
    finally:
        settle()


def _failure_key(failure: dict) -> str:
    return failure.get("archive_url") or failure.get("url") or failure.get("error")


def _still_failed(store: Store, failure: dict) -> bool:
    """False once an archived HTML page that failed before (the Archive was unwell) has been stored."""
    if failure.get("stage") or "note" not in failure:
        return failure.get("stage") != "stopped"
    index = store.load_note(failure["country"], failure["note"])
    stored = failure["url"].replace("id_/", "/", 1)
    return not (index and any(c["archive_url"] == stored for v in index["versions"] for c in v.get("captures", [])))
