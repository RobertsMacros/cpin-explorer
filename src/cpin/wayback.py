"""Best-effort backfill of older note editions from the Internet Archive.

GOV.UK keeps only the current edition of each note: a replaced edition's URL redirects to the
country page. Earlier editions survive only where the Wayback Machine captured them. Every
version recovered here is stored with source='wayback', the capture time and the archive URL, so
the site can label it as an archived copy. Archive pages are rendered HTML, so the body is the
page's govspeak element re-serialised: its text is verbatim, its markup is not byte-identical to
the Content API's.
"""
from dataclasses import asdict
from urllib.parse import quote, urlsplit

from lxml import html as lxml_html

from .http import PoliteClient
from .store import Store, now_iso
from .sync import RunReport

CDX = "https://web.archive.org/cdx/search/cdx"


def cdx_url(base_path: str) -> str:
    prefix = quote(f"www.gov.uk{base_path}/*", safe="/*")
    return (f"{CDX}?url={prefix}&output=json&fl=timestamp,original,digest"
            "&filter=statuscode:200&collapse=digest&limit=5000")


def _iso(timestamp: str) -> str:
    t = timestamp.ljust(14, "0")
    return f"{t[0:4]}-{t[4:6]}-{t[6:8]}T{t[8:10]}:{t[10:12]}:{t[12:14]}Z"


def extract_body(page_html: str) -> tuple[str | None, str | None]:
    """Return (govspeak body HTML, page title) from a rendered GOV.UK HTML publication page."""
    root = lxml_html.document_fromstring(page_html)
    candidates = root.xpath("//div[contains(@class, 'govspeak')]")
    h1 = root.xpath("//h1")
    title = " ".join(h1[0].text_content().split()) if h1 else None
    if not candidates:
        return None, title
    # Most text wins; when a wrapper and its inner govspeak hold the same text, take the inner one. White
    # space is not text: the wrappers sit on lines of their own, and counting the line breaks between them
    # made the outer one win every time.
    text = lambda el: len("".join(el.text_content().split()))
    best = max(candidates, key=lambda el: (text(el), len(list(el.iterancestors()))))
    return lxml_html.tostring(best, encoding="unicode", with_tail=False), title


def backfill_path(client: PoliteClient, store: Store, slug: str, base_path: str, report: RunReport, *,
                  known_bad: dict | None = None, rows: list | None = None, stop_on=None) -> tuple[int, int] | None:
    """Recover the HTML editions archived under one address of a country page (its current base path,
    or an earlier one: see recover.py). Returns (captures listed, new versions), or None when the
    archive index could not be read (the error is in the report).

    known_bad: archive URLs already found to hold no extractable body; they are not fetched again,
    and newly found ones are added to it. rows: the index rows, if the caller has already listed
    them. stop_on: called with each fetch result, so a caller can stop the run on a refusal.
    """
    base = base_path.rstrip("/")
    if rows is None:
        r = client.get(cdx_url(base))
        if stop_on:
            stop_on(r)
        if not r.ok:
            report.errors.append({"country": slug, "url": r.url, "status": r.status, "error": r.error})
            return None
        rows = r.json()[1:] if r.content.strip() else []
    new_here = 0
    for timestamp, original, digest in rows:
        parts = urlsplit(original)
        path = parts.path.rstrip("/")
        if parts.query or path == base or path.lower().endswith((".pdf", ".csv")):
            continue
        note = path.rsplit("/", 1)[-1]
        index = store.load_note(slug, note)
        if index and digest in index.get("wayback_digests", []):
            continue                 # this exact capture was processed on an earlier run
        archive_url = f"https://web.archive.org/web/{timestamp}/{original}"
        if known_bad is not None and archive_url in known_bad:
            continue                 # read on an earlier run: no body that can be taken verbatim
        page = client.get(f"https://web.archive.org/web/{timestamp}id_/{original}", follow=True)
        if stop_on:
            stop_on(page)
        if not page.ok:
            report.errors.append({"country": slug, "note": note, "url": page.url, "status": page.status, "error": page.error})
            continue
        body, title = extract_body(page.text)
        if not body:
            report.errors.append({"country": slug, "note": note, "url": page.url, "status": 200, "error": "no govspeak body"})
            if known_bad is not None:
                known_bad[archive_url] = "no govspeak body"
            continue
        capture = {"captured_at": _iso(timestamp), "archive_url": archive_url, "digest": digest}
        record, is_new = store.record_version(
            slug, note, body=body, meta={"source": "wayback", **capture, "original_url": original, "title": title},
            seen_at=report.started, source="wayback", title=title or note, base_path=path, capture=capture)
        index = store.load_note(slug, note)
        index.setdefault("wayback_digests", []).append(digest)
        store.save_note(slug, note, index)
        report.notes_checked += 1
        if is_new:
            new_here += 1
            report.new_versions.append({"country": slug, "note": note, "title": record["title"],
                                        "sha256": record["sha256"], "captured_at": capture["captured_at"]})
    return len(rows), new_here


def backfill(client: PoliteClient, store: Store, *, only: set[str] | None = None, log=print) -> RunReport:
    report = RunReport(kind="backfill", mode="wayback", started=now_iso())
    state = store.load_state()
    for slug, country in sorted(state["countries"].items()):
        if only and slug not in only:
            continue
        result = backfill_path(client, store, slug, country["base_path"], report)
        if result is None:
            e = report.errors[-1]
            log(f"  {slug}: archive index unavailable ({e['status']})")
            continue
        report.countries_checked.append(slug)
        log(f"  {slug}: {result[0]} captures, {result[1]} new versions")
    report.finished = now_iso()
    store.append_run(asdict(report))
    return report
