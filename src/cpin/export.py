"""Export what the site needs from the store. Derived data only: the store is never changed.

Note titles and GOV.UK change notes are passed through verbatim; the only additions are
labels computed from them (kind, topic, month), counts of what we hold, how much of the
previous edition's wording each edition keeps (`similarity_to_previous`, see `similarity`),
which report each change note is about (see `about_another_report`), and the editions GOV.UK
publishes as a PDF only: as editions like any other where their text has been extracted (`source: pdf`,
see `pdf_version` and pdftext.py), else listed as `pdf_editions` (see `build_series`). An edition GOV.UK no
longer lists, recovered as a PDF from the Internet Archive (recover.py), is an edition too: `source: pdf`
with `archive_url` and `captured_at`, never current (see `recovered_pdf_version`).
"""
import html
import json
import re
from pathlib import Path

from . import config, pdftext, webpdf
from .changes import change_statement, change_statement_html, matching_change_notes, valid_from
from .fingerprint import text_sha256, version_banner
from .govuk import file_attachments, html_attachments, note_slug
from .pdfs import is_pdf
from .store import Store, now_iso, to_utc, version_date
from .titles import parse_note_title, series_key
from .verify import pair_pdfs

COUNTRIES_CONFIG = config.ROOT / "config" / "countries.json"

# Display labels for the kinds of note GOV.UK publishes, including its own misspellings.
KIND_LABELS = [
    (r"country (?:policy|police) and information note|country and policy information note", "CPIN"),
    (r"country information note", "Country information note"),
    (r"country bulletin", "Country bulletin"),
    (r"fact[- ]finding mission", "Report of a fact-finding mission"),      # the Home Office's own term
    (r"country information and guidance", "Country information and guidance (legacy)"),
]


def kind_label(kind: str) -> str:
    for pattern, label in KIND_LABELS:
        if re.search(pattern, kind, re.IGNORECASE):
            return label
    # A page in the collection with no document type in its title is not a report: e.g. Albania's 2022
    # "All Albania country policy and information notes have been removed for review".
    return kind.capitalize() or "GOV.UK notice"


def series_path(country: str, key: str) -> str:
    """Path of a series file, relative to the series directory: 'afghanistan/note--fear-taliban.json'."""
    return f"{country}/{key.replace(':', '--')}.json"


# --- How much wording an edition keeps -----------------------------------------------------------
# Five-word phrases ("shingles") of the body's words, lower-cased with punctuation stripped. The share of
# phrases two editions have in common, out of the larger edition's phrases, says how much wording carries
# over: 1.0 for an unchanged text, around 0.05 for a wholesale rewrite (a redline of which marks almost
# everything). The report page flags editions below its rewrite threshold. The same measure is computed
# in the browser for other pairs (prototypes/shared/report-history.js, wordingKept), so keep them alike.
SHINGLE_WORDS = 5
SIMILARITY_METHOD = "five-word-shingles/1"       # bump when the measure changes (invalidates the cache)
_TAGS = re.compile(r"<(script|style)\b.*?</\1\s*>|<!--.*?-->|<[^>]*>", re.S | re.I)
_WORDS = re.compile(r"[^\W_]+")                   # letters and digits, any script


def body_words(body: str) -> list[str]:
    """The words of a body's text, lower-cased, punctuation stripped (tags dropped, entities decoded)."""
    return _WORDS.findall(html.unescape(_TAGS.sub(" ", body or "")).lower())


def shingles(words: list[str], n: int = SHINGLE_WORDS) -> set:
    """Every run of n consecutive words (a text shorter than n words is one phrase)."""
    if len(words) < n:
        return {tuple(words)} if words else set()
    return set(zip(*(words[i:] for i in range(n))))


def similarity(old: set, new: set) -> float:
    """Phrases in common ÷ phrases in the larger edition, to 3 decimals (1.0 when both are empty)."""
    larger = max(len(old), len(new))
    return round(len(old & new) / larger, 3) if larger else 1.0


def add_similarity(editions: list, cache: dict | None = None) -> None:
    """Set `similarity_to_previous` on each edition (None on the first): its wording against the previous
    edition held. cache maps 'old id:new id' (body hashes) to known values, so unchanged pairs are not
    recomputed; new values are added to it."""
    phrases: dict[str, set] = {}

    def of(e):
        if e["id"] not in phrases:
            phrases[e["id"]] = shingles(body_words(e["body"]))
        return phrases[e["id"]]

    for prev, e in zip([None, *editions], editions):
        if prev is None:
            e["similarity_to_previous"] = None
            continue
        key = f"{prev['id']}:{e['id']}"
        if cache is not None and isinstance(cache.get(key), (int, float)):
            e["similarity_to_previous"] = cache[key]
            continue
        e["similarity_to_previous"] = similarity(of(prev), of(e))
        if cache is not None:
            cache[key] = e["similarity_to_previous"]
        phrases.pop(prev["id"], None)                # only the latest edition's phrases are needed next


SIMILARITY_CACHE = "similarity-cache.json"         # beside the series files (derived, like them)


def load_similarity_cache(series_out: Path | None) -> dict | None:
    if not series_out:
        return None
    try:
        data = json.loads((Path(series_out) / SIMILARITY_CACHE).read_text("utf-8"))
    except (OSError, ValueError):
        return {}
    return data.get("pairs", {}) if data.get("method") == SIMILARITY_METHOD else {}


def save_similarity_cache(series_out: Path | None, cache: dict | None) -> None:
    if not series_out or cache is None:
        return
    path = Path(series_out) / SIMILARITY_CACHE
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"method": SIMILARITY_METHOD, "pairs": dict(sorted(cache.items()))},
                               separators=(",", ":")), "utf-8")


def own_date(valid: str | None, month: str | None) -> dict:
    """When an edition was published, by the note's own account: its "valid from" date when it states one,
    else the month in its title, else nothing. `published_from` says which, and `published_precision`
    whether it is a day or only a month (then given as the month's first day).

    Never GOV.UK's `public_updated_at`: every note on a country page carries the page's date, which moves
    whenever any note there changes. China's note on medical treatment, valid from 5 July 2022, showed as
    published on 1 September 2026. The export keeps that date apart, as `page_updated`."""
    if valid:
        return {"published": valid, "published_precision": "day", "published_from": "valid from"}
    if month:
        return {"published": f"{month}-01T00:00:00Z", "published_precision": "month", "published_from": "title"}
    return {"published": None, "published_precision": None, "published_from": None}


def _edition(store: Store, country: str, name: str, note: str, index: dict, v: dict) -> dict:
    title = (v.get("title") or index["title"]).strip()
    captures = v.get("captures") or []
    captured = captures[0]["captured_at"] if captures else None
    body = store.read_body(country, note, v["sha256"])
    valid = valid_from(body)
    own = own_date(valid, parse_note_title(title, name).month)
    is_current = index.get("status") == "live" and v["sha256"] == index.get("current_sha256")
    return {
        "left_govuk": None if is_current else _left_govuk(index, v),
        "id": v["sha256"][:16],
        "note": note,
        "title": title,
        "source": v["source"],                                  # live (Content API) or wayback (archive copy)
        **own,                                                  # published, published_precision, published_from
        "page_updated": v.get("public_updated_at"),             # GOV.UK's date for the country page when this was read
        "valid_from": valid,                                    # from the note's own version control
        "change_statement": change_statement(body),             # verbatim, from 'Changes from last version'
        "change_statement_html": change_statement_html(body),   # the same section with any tables, verbatim
        "captured_at": captured,
        "first_seen": v["first_seen"],
        # Where it stands among the editions. With no date of its own: when the Archive first had it, else
        # the page's date (no later than which it was published), else when this copy first saw it.
        "date": own["published"] or captured or v.get("public_updated_at") or v["first_seen"],
        "version": v.get("version_banner"),
        "current": is_current,
        "govuk_url": config.GOVUK + index["base_path"] if is_current else None,
        "archive_url": captures[-1]["archive_url"] if captures else None,
        "text_sha256": v["text_sha256"],
        "body": body,                                           # verbatim
        # Each title and page date GOV.UK has given this same body, where it has given more than one.
        **({"title_log": v["title_log"]} if v.get("title_log") else {}),
    }


def _left_govuk(index: dict, v: dict) -> dict | None:
    """When an edition we held live stopped being the one on GOV.UK, as this copy saw it: `at` is the sync
    that first found it replaced (a newer text at the same address) or gone (the note no longer listed), and
    `last_seen` the last sync that fetched it live (or, for one no longer listed, that still found it listed),
    so the change happened between the two. None for an
    edition we never saw live (an archive copy), which has only its capture dates."""
    if v.get("source") != "live":
        return None
    order = {x["sha256"]: (x.get("first_seen") or "", i) for i, x in enumerate(index["versions"]) if x.get("source") == "live"}
    later = sorted(k for k in order.values() if k > order[v["sha256"]])           # first seen after this one
    if later:
        return {"at": later[0][0], "last_seen": v.get("last_seen"), "by": "newer text at the same address"}
    gone = [e for e in index.get("status_log", []) if e.get("status") == "removed"]
    if index.get("status") == "removed" and gone:
        seen = max(filter(None, (v.get("last_seen"), gone[-1].get("last_listed"))), default=None)
        return {"at": gone[-1]["at"], "last_seen": seen, "by": gone[-1].get("why") or "no longer listed"}
    return None


def _copy_to_list(earlier: dict, later: dict) -> tuple[dict, dict]:
    """Two copies of one text (the same words, different markup): the one to list as the edition, then the
    other. The copy on GOV.UK now comes first: listing the other would leave the report with no current
    edition, and it would show as archived. Then a copy read from GOV.UK before an archive copy of it. Of
    two read from GOV.UK (the markup was changed in place, such as a corrected link), the later: it is the
    one that was replaced when the words next changed. Otherwise the earlier."""
    rank = lambda e: (e["current"], e["source"] == "live")
    both_live = earlier["source"] == later["source"] == "live"
    if rank(later) > rank(earlier) or (both_live and not earlier["current"]):
        return later, earlier
    return earlier, later


def build_series(store: Store, country: str, name: str, key: str, members: list, image_files: dict,
                 history: list | None = None, similarity_cache: dict | None = None,
                 reports=(), pdfs=(), pdf_versions=(), pdf_figures=(), pdf_compares=(), listed: bool = True) -> dict:
    """Every edition of one report, oldest first, with verbatim bodies. An edition held twice with the
    same text (an archive copy of one we also hold live, or a change of markup only) is listed once: the
    copy on GOV.UK now, else the live copy (see `_copy_to_list`); the others are named in `also_held_as`.
    Each edition also says how much of the previous one's wording it keeps (`similarity_to_previous`).

    reports: the series keys of all the country's reports, so a change note about another is left out.
    pdf_versions: the report's editions published as a PDF only whose text has been extracted (see
    `pdf_version`). They take their place among the editions by date, marked `source: pdf`; the newest is
    the current edition when the country page lists it and no HTML edition is live. One for a month an
    HTML edition already covers is left out (the HTML is GOV.UK's own text; the PDF's is an extraction).
    Among them may be editions recovered from the Internet Archive (`recovered_pdf_version`: `listed`
    False, with `archive_url`): they are never current, and a report with nothing else is `archived`.
    pdfs: PDF-only editions with no text extracted (the PDF is not on this disk, or is a scan). They are
    returned as `pdf_editions`, newest first; `current` marks the one that is the report's current
    edition. The report is then `live` with `current_pdf_only` set, though `versions` ends earlier.
    pdf_figures: for a web edition with a PDF beside it, the PDF's pictures that GOV.UK's web version leaves
    out: [(pdf url, what `pdftext.load_figures` holds)]. The edition whose body they were worked out for gets
    `pdf_figures` (where each goes: after the n-th element of a tag), for the site to show beside the text,
    marked as from the PDF. The body itself is not touched.
    pdf_compares: for a web edition with a PDF beside it, where the two really differ: [(pdf url, what
    `webpdf.load_comparison` holds)]. The edition it was worked out for gets `pdf_compare` (see `pdf_compare`).
    listed: False when the collection no longer lists the country's page. The page held is then the last one
    seen, and a PDF it lists is not a current edition of anything."""
    editions = [_edition(store, country, name, note, index, v) for note, index in members for v in index["versions"]]
    html_months = {parse_note_title(e["title"], name).month for e in editions} - {None}
    live = [index for _, index in members if index.get("status") == "live"]
    from_pdf = [dict(v) for v in pdf_versions if parse_note_title(v["title"], name).month not in html_months]
    for v in from_pdf:                                           # an archive copy is of a PDF no page lists now
        v["listed"] = bool(listed and v["listed"])
    newest_pdf = max((v for v in from_pdf if v["listed"]), key=lambda v: v["date"] or "", default=None)
    for v in from_pdf:
        v["current"] = bool(v["listed"] and not live and v is newest_pdf and not pdfs)
    # Two states of one edition carry the same date (GOV.UK edits a note in place). The one known to exist
    # first comes first: an archive copy by its capture, a copy read live by when it was first seen.
    editions = sorted(editions + from_pdf, key=lambda e: (e["date"] or "", e["captured_at"] or e["first_seen"] or ""))
    collapsed = []
    for e in editions:
        if collapsed and collapsed[-1]["text_sha256"] == e["text_sha256"]:
            keep, other = _copy_to_list(collapsed[-1], e)
            keep["also_held_as"] = [*keep.get("also_held_as", []), *other.pop("also_held_as", []),
                                    {k: other[k] for k in ("id", "note", "source", "captured_at", "archive_url")}]
            collapsed[-1] = keep
            continue
        collapsed.append(e)
    add_similarity(collapsed, similarity_cache)
    for i, e in enumerate(collapsed):                           # what took its place: a newer edition, or nothing
        if e.get("left_govuk"):
            e["left_govuk"]["how"] = "replaced" if i + 1 < len(collapsed) else "withdrawn"
    for e in collapsed:                                          # GOV.UK's own dated change notes, verbatim
        e["govuk_change_notes"] = [h for h in matching_change_notes(history or [], e["published"], topic_words(key),
                                                                    month=e["published_precision"] == "month")
                                   if not about_another_report(h["note"], key, reports)]
    latest = parse_note_title(collapsed[-1]["title"], name)
    images = {url: f"../../data/images/files/{entry['sha256']}{entry.get('ext', '')}"
              for url, entry in image_files.items()
              if any(url in e["body"] for e in collapsed)}
    for e in collapsed:                                          # figures rendered from a PDF's pages (pdftext.py)
        if e["source"] == "pdf":
            for name_ in re.findall(re.escape(pdftext.IMAGE_SRC) + f"({pdftext.IMAGE_NAME})", e["body"]):
                images[pdftext.IMAGE_SRC + name_] = f"../../data/pdfs/text/images/{name_}"
    for pdf_url, held in pdf_figures:
        e = next((e for e in collapsed if e["source"] != "pdf" and e["id"] == (held.get("body_sha256") or "")[:16]), None)
        if e is None or not held.get("figures"):
            continue                                             # worked out for a body that is no longer an edition here
        e["pdf_figures"] = {"pdf_url": pdf_url, "figures": [
            {"src": pdftext.IMAGE_SRC + f["image"], "tag": f["tag"], "index": f["index"], "key": f["key"], "page": f.get("page")}
            for f in held["figures"]]}
        for f in held["figures"]:
            images[pdftext.IMAGE_SRC + f["image"]] = f"../../data/pdfs/text/images/{f['image']}"
    for pdf_url, held in pdf_compares:
        e = next((e for e in collapsed if e["source"] != "pdf" and e["id"] == (held.get("body_sha256") or "")[:16]), None)
        if e is not None:
            e["pdf_compare"] = pdf_compare(pdf_url, held)
    pdf_editions = sorted(pdfs, key=lambda p: (p["month"] or "", p["first_seen"] or ""), reverse=True)
    pdf_editions = [{**p, "current": listed and not live and i == 0} for i, p in enumerate(pdf_editions)]
    current_pdf = pdf_editions[0] if pdf_editions and pdf_editions[0]["current"] else None
    months = [parse_note_title(e["title"], name).month or (e["date"] or "")[:7] for e in collapsed]
    return {"country": country, "country_name": name, "key": key, "topic": latest.topic or kind_label(latest.kind),
            "kind": kind_label(latest.kind),
            "status": ("live" if live or current_pdf or any(e["current"] for e in collapsed)
                       else members[0][1].get("status", "archived") if members else "archived"),
            "current_pdf_only": bool(current_pdf), "pdf_editions": pdf_editions,
            "left_govuk": None if live or current_pdf else collapsed[-1].get("left_govuk"),
            "history": with_pdf_publication(topic_history(history or [], key, reports), current_pdf,
                                            last_html_month=max(months), last_html_date=collapsed[-1]["date"]),
            "versions": collapsed, "images": images}


def pdf_compare(pdf_url: str, held: dict) -> dict:
    """What the site needs of a comparison record (webpdf.py) for one web edition: how much of its wording
    really differs from the PDF's and whether it is a note to read (`flagged`); each difference of wording
    that the record lists, with the web's words and the PDF's; any signs that the two are different drafts;
    and `numbering`, the paragraphs the PDF numbers differently, which a citation of the web version gives
    beside its own number. For the numbers under `repeated` (the web version uses them for more than one
    paragraph) and `unconfirmed` (a second reader of the PDF did not bear the PDF's number out) no PDF
    number can be given, and the web's must not be taken to be the PDF's. Differences that are not wording
    (words for a picture, notices, list markers) are left out: they are not what a reader quoting the note
    needs to check."""
    summary = held["summary"]
    wording = [d for d in held["differences"] if d["group"] == "wording"]
    return {
        "pdf_url": pdf_url, "method": held["method"],
        "wording": {k: summary["wording"][k] for k in ("differences", "web_words", "pdf_words", "share", "passages")},
        "flagged": summary["wording"]["share"] >= webpdf.FLAG_SHARE or summary["opening"]["passages"] > 0,
        "drafts": summary["drafts"],
        "numbering": {"repeated": [], "unconfirmed": [],
                      **(held.get("paragraphs") or {"same": 0, "different": {}, "pdf_unnumbered": []})},
        "differences": [{k: d[k] for k in ("kind", "web", "pdf", "web_words", "pdf_words", "before", "before_pdf", "after", "where", "size", "second") if k in d}
                        for d in wording],
        "not_listed": max(0, summary["wording"]["differences"] - len(wording)),
    }


# --- Which report a GOV.UK change note is about --------------------------------------------------
# A country page has one change log for all its reports, so a note is matched to a report by the words of
# the report's topic (its series key). Reports of one country share words ('security situation in Gaza',
# 'humanitarian situation in Gaza'), and a bulletin or fact-finding report can share its whole topic with a
# CPIN, so a note that matches is still left out where it reads as being about another report:
#   - every topic word it shares with this report belongs to other reports that it matches more fully; or
#   - it names a kind of document that this report is not ('country bulletin', 'fact-finding mission',
#     'country policy and information note') and the country has a report of that kind on the same topic.
# A missed match is preferred to a wrong one: a note left out here still shows in the country's history.
ATTRIBUTION_SHARE = 0.6                             # the share of a report's topic words a note must mention
# How a change note names each family of report (the families of titles.series_key). GOV.UK calls only a
# CPIN or its forerunners a 'note' ('the note on ...', 'country and policy information note', 'CIPN').
_KIND_NAMED = {
    "bulletin": re.compile(r"\bbulletins?\b"),
    "fact-finding": re.compile(r"\bfact[- ]finding\b"),
    "note": re.compile(r"\bnotes?\b|\bcpins?\b|\bcipn\b|\binformation and guidance\b"),
}


def topic_words(key: str) -> frozenset[str]:
    """The words of a report's topic, from its series key: 'note:fear-taliban' -> {'fear', 'taliban'}."""
    return frozenset(key.split(":", 1)[1].split("-")) - {"untitled"}


def _share(topic: frozenset[str], words: set[str]) -> float:
    return len(topic & words) / len(topic) if topic else 0.0


def about_another_report(note: str, key: str, reports) -> bool:
    """True when a change note that mentions a report's topic reads as being about a different report of
    the same country. reports: the series keys of the country's reports (this one's may be among them)."""
    text = note.lower()
    words = set(re.findall(r"[a-z0-9]+", text))
    family, topic = key.split(":", 1)[0], topic_words(key)
    matched = [(k.split(":", 1)[0], topic_words(k)) for k in reports]
    matched = [(f, t) for f, t in matched if _share(t, words) >= ATTRIBUTION_SHARE]
    fuller = [t for _, t in matched if _share(t, words) > _share(topic, words)]
    if fuller and topic & words <= frozenset().union(*fuller):
        return True
    kinds = {f for f, named in _KIND_NAMED.items() if named.search(text)}
    return family not in kinds and any(f in kinds and (t <= topic or topic <= t) for f, t in matched)


def topic_history(history: list, key: str, reports=()) -> list:
    """GOV.UK change notes (verbatim) that mention most of a report's topic words and are not about another
    report of the country, newest first."""
    topic = topic_words(key)
    return [h for h in history
            if _share(topic, set(re.findall(r"[a-z0-9]+", h["note"].lower()))) >= ATTRIBUTION_SHARE
            and not about_another_report(h["note"], key, reports)]


# --- Editions published as a PDF only -------------------------------------------------------------
def pdf_only_files(store: Store):
    """(country, title, url) of every PDF a country page lists with no HTML version beside it."""
    for slug in sorted(store.load_state()["countries"]):
        publication = store.load_publication(slug) or {}
        paired = set(pair_pdfs(publication).values()) if publication else set()
        for a in file_attachments(publication):
            if is_pdf(a) and a["url"] not in paired:
                yield slug, (a.get("title") or "").strip(), a["url"]


def _from_pdf(body: str, meta: dict, entry: dict, title: str, name: str) -> dict:
    """What every edition read from a PDF has: its own date and version, what it says changed, and how the
    text was got (`extracted`). The body is the extraction (pdftext.py), not GOV.UK's text."""
    valid = valid_from(body)
    return {
        "id": entry["sha256"][:16],
        "note": None,                                           # it has no page of its own on GOV.UK
        "title": title,
        "source": "pdf",
        **own_date(valid, parse_note_title(title, name).month),
        "valid_from": valid,
        "change_statement": change_statement(body),
        "change_statement_html": change_statement_html(body),
        "first_seen": entry.get("first_seen"),
        "version": version_banner(body) or meta.get("cover_version"),
        "current": False,                                       # settled in build_series, among its editions
        "text_sha256": text_sha256(body),
        "body": body,                                           # extracted, not verbatim
        "extracted": {"extractor": meta.get("extractor"), "pages": meta.get("pages"), "pdf_sha256": entry["sha256"],
                      "warnings": len(meta.get("warnings", []))},
    }


def pdf_version(store: Store, name: str, attachment: dict, manifest: dict, page_url: str,
                page_updated: str | None = None) -> dict | None:
    """An edition published as a PDF only, as an edition like any other: its body is the text extracted
    from the PDF (pdftext.py), marked `source: pdf` with `extracted` saying how, so the site can say that
    the layout is a reconstruction. None when no text has been extracted for it (./cpin pdftext).
    page_updated: GOV.UK's date for the country page that lists the PDF."""
    entry = manifest.get(attachment["url"])
    held = pdftext.load_text(store, entry["sha256"]) if entry else None
    if not held:
        return None
    body, meta = held
    edition = _from_pdf(body, meta, entry, (attachment.get("title") or "").strip(), name)
    return {
        **edition,
        "page_updated": page_updated,
        "captured_at": None,
        "date": edition["published"] or entry.get("first_seen"),
        "listed": True,                                         # the country page lists this PDF now
        "govuk_url": page_url,
        "archive_url": None,
        "pdf_url": attachment["url"],
    }


def recovered_pdfs(manifest: dict, slug: str) -> list[tuple[str, dict]]:
    """The PDFs recovered from the Internet Archive for a country (recover.py): [(the address GOV.UK listed
    the file at, its manifest entry)], oldest capture first. No country page lists them now."""
    return sorted(((url, {**entry, **record}) for url, entry in manifest.items()
                   for record in (entry, *entry.get("previous", []))
                   if record.get("source") in {"wayback", "national-archives", "repository"}
                   and record.get("country", entry.get("country")) == slug),
                  key=lambda item: (item[1].get("captured_at") or "", item[0]))


def recovered_pdf_files(store: Store):
    """(country, title, url) of every recovered PDF that is an edition with no web version held: the ones
    to read (./cpin pdftext) and to show. A PDF recovered beside a web version of the same report and
    month is left: GOV.UK's own text of that edition is held."""
    for slug, title, url, _ in recovered_pdf_jobs(store):
        yield slug, title, url


def recovered_pdf_jobs(store: Store):
    """As recovered_pdf_files, with the actual manifest record: one URL can have several files."""
    manifest, countries = store.load_pdf_manifest(), store.load_state()["countries"]
    for slug in sorted(countries):
        name = countries[slug]["name"]
        web = set()
        for _, index in store.notes_for(slug):
            for v in index["versions"]:
                parsed = parse_note_title(v.get("title") or index["title"], name)
                web.add((series_key(parsed), parsed.month))
        for url, entry in recovered_pdfs(manifest, slug):
            parsed = parse_note_title(entry.get("title") or "", name)
            if not parsed.month or (series_key(parsed), parsed.month) not in web:
                yield slug, (entry.get("title") or "").strip(), url, entry


def recovered_pdf_version(store: Store, name: str, entry: dict) -> dict | None:
    """An edition GOV.UK no longer lists, recovered as a PDF from an archive or repository, as an edition of its
    report: `source: pdf` (its body is the text extracted from the PDF, as in `pdf_version`) and an archive
    copy besides, with the Archive's address (`archive_url`, also its `pdf_url`: GOV.UK's own address for
    the file now leads to a later edition, or nowhere) and the capture time. It is never the current
    edition (`listed` False). `listed_from` and `listed_until` are the first and last archived copies of
    the country page that listed the file. None when its text has not been extracted (./cpin pdftext)."""
    held = pdftext.load_text(store, entry["sha256"])
    if not held:
        return None
    body, meta = held
    edition = _from_pdf(body, meta, entry, (entry.get("title") or "").strip(), name)
    return {
        **edition,
        "page_updated": None,
        "captured_at": entry.get("captured_at"),
        "date": edition["published"] or entry.get("captured_at") or entry.get("first_seen"),
        "listed": False,
        "govuk_url": None,
        "archive_url": entry.get("archive_url"),
        "archive_provider": entry.get("archive_provider", "Internet Archive"),
        "pdf_url": entry.get("archive_url"),
        "listed_from": entry.get("first_listed"),
        "listed_until": entry.get("last_listed"),
    }


def pdf_edition(attachment: dict, month: str | None, manifest: dict) -> dict:
    """A PDF the country page lists with no HTML version beside it: its title (verbatim), the month the
    title gives, GOV.UK's URL for the file, and when this mirror first saw it (None if not mirrored)."""
    return {"title": (attachment.get("title") or "").strip(), "month": month, "pdf_url": attachment["url"],
            "first_seen": manifest.get(attachment["url"], {}).get("first_seen")}


def with_pdf_publication(history: list, pdf: dict | None, *, last_html_month: str, last_html_date: str) -> list:
    """A report's history, with the update that published its PDF-only current edition marked: the entry
    gains `pdf_url` and `pdf_title`, so it can be shown as held (as a PDF) rather than as not held.

    Marked only where the store establishes it. The PDF is mirrored, and its title gives a later month
    than any HTML edition held; the update is the last one about this report before the mirror first saw
    the file, and is dated in or after that month and after the last HTML edition. Otherwise no entry is
    marked."""
    if not pdf or not pdf["first_seen"] or not pdf["month"] or pdf["month"] <= last_html_month:
        return history
    for i, h in enumerate(history):                              # newest first
        if not h["date"] or h["date"] > pdf["first_seen"]:
            continue
        if h["date"][:7] >= pdf["month"] and h["date"] > last_html_date:
            return [*history[:i], {**h, "pdf_url": pdf["pdf_url"], "pdf_title": pdf["title"]}, *history[i + 1:]]
        break
    return history


def report_summary(country: str, series: dict, pdf_url: str | None) -> dict:
    """One entry per report for the country view: the latest edition and what changed in it.

    `latest` is always an HTML edition held. Where the report's current edition is a PDF only, the entry
    also has `current_pdf_only` and `current_pdf` (that edition, as in the series file's `pdf_editions`)."""
    latest = series["versions"][-1]
    live_editions = [e for e in series["versions"] if e["current"]]
    current = live_editions[-1] if live_editions else latest
    current_pdf = next((p for p in series["pdf_editions"] if p["current"]), None)
    return {
        "key": series["key"],
        "topic": series["topic"],
        "kind": series["kind"],
        "status": series["status"],
        "withdrawn_at": series.get("withdrawn_at"),
        "left_govuk": series.get("left_govuk"),                 # when it was found gone, if that happened on our watch
        "pdf_differs": ({"words": current["pdf_compare"]["wording"]["web_words"] + current["pdf_compare"]["wording"]["pdf_words"],
                         "flagged": current["pdf_compare"]["flagged"]} if current.get("pdf_compare") else None),
        "editions": len(series["versions"]),
        "earliest": series["versions"][0]["date"],
        "latest": {"version": current["version"], "published": current["published"],
                   "published_precision": current["published_precision"], "published_from": current["published_from"],
                   "page_updated": current["page_updated"], "note": current["note"],
                   "govuk_url": current["govuk_url"], "archive_url": current["archive_url"],
                   "pdf_url": current.get("pdf_url") or pdf_url,
                   **({"text_from_pdf": True} if current["source"] == "pdf" else {})},
        "latest_change": ({"version": current["version"], "statement": current["change_statement"],
                           "has_table": bool(current["change_statement_html"] and "<table" in current["change_statement_html"])}
                          if current["change_statement"] else None),
        "history_count": len(series["history"]),
        "read_url": f"../reader/index.html?country={country}&series={series['key']}",
        **({"current_pdf_only": True, "current_pdf": current_pdf} if current_pdf else {}),
    }


def _note_entry(store: Store, country: str, name: str, note: str, index: dict, pdf_url: str | None,
                series: dict | None = None) -> dict:
    parsed = parse_note_title(index["title"], name)
    current = next((v for v in index["versions"] if v["sha256"] == index.get("current_sha256")), index["versions"][-1])
    archived = [v for v in index["versions"] if v["source"] == "wayback"]
    editions = series["versions"] if series else []
    return {
        "id": note,
        "title": index["title"].strip(),
        "kind": kind_label(parsed.kind),
        "topic": parsed.topic,
        "month": parsed.month,
        "status": index["status"],
        "version": current.get("version_banner"),
        "updated": version_date(current),
        "series": series["key"] if series else None,
        "editions": len(editions) or len(index["versions"]),           # editions of this report, across URLs
        # Editions held only as an archive copy at this address. Several copies of one text are one edition,
        # and a copy of an edition also read from GOV.UK is not another: `archive_copies` counts them all.
        "archived_editions": (sum(1 for e in editions if e["source"] == "wayback" and e["note"] == note)
                              if series else len(archived)),
        "archive_copies": len(archived),
        "earliest": editions[0]["date"] if editions else version_date(index["versions"][0]),
        "latest_change": ({"version": editions[-1]["version"], "statement": editions[-1]["change_statement"]}
                          if editions and editions[-1]["change_statement"] else None),
        "compare_url": (f"../reader/index.html?country={country}&series={series['key']}&changes=1"
                        if series and len(editions) > 1 else None),
        "govuk_url": config.GOVUK + index["base_path"] if index["status"] == "live" else None,
        "archive_url": (archived[-1].get("captures") or [{}])[-1].get("archive_url") if archived else None,
        "pdf_url": pdf_url,
    }


def build_dashboard(store: Store, countries_config: dict, series_out: Path | None = None) -> dict:
    """The dashboard's data. With series_out, also writes one history file per report."""
    state = store.load_state()
    manifest = store.load_pdf_manifest()
    image_files = store.load_image_manifest()
    mapping = countries_config["countries"]
    countries, recent = [], []
    note_paths: dict[str, dict] = {}         # GOV.UK path of any note we hold -> where it lives here
    similarity_cache = load_similarity_cache(series_out)
    written: set[Path] = set()               # the series files of this run; any other is from an old grouping
    for slug, known in sorted(state["countries"].items(), key=lambda kv: kv[1]["name"]):
        publication = store.load_publication(slug) or {}
        pairs = pair_pdfs(publication) if publication else {}
        paired_pdfs = set(pairs.values())
        dropped = known.get("dropped_from_collection")        # when the collection was found not to list this page
        withdrawn = known.get("withdrawn_at")
        notes = []
        live_by_url = {note_slug(a["url"]): pairs.get(a["url"]) for a in html_attachments(publication)}
        history = [{"date": to_utc(h.get("public_timestamp")), "note": " ".join((h.get("note") or "").split())}
                   for h in publication.get("details", {}).get("change_history", [])]
        history.sort(key=lambda h: h["date"] or "", reverse=True)
        groups: dict[str, list] = {}
        reports = []
        for note, index in store.notes_for(slug):
            groups.setdefault(series_key(parse_note_title(index["title"], known["name"])), []).append((note, index))
        pdf_only = []                        # PDFs the page lists with no HTML version: (series key, attachment, title)
        for a in file_attachments(publication):
            if is_pdf(a) and a["url"] not in paired_pdfs:
                parsed = parse_note_title(a.get("title", ""), known["name"])
                pdf_only.append((series_key(parsed), a, parsed))
        page_url = config.GOVUK + known["base_path"]
        page_updated = to_utc(publication.get("public_updated_at"))
        with_text = {a["url"]: v for _, a, _ in pdf_only
                     if (v := pdf_version(store, known["name"], a, manifest, page_url, page_updated))}
        # Editions GOV.UK no longer lists, recovered as PDFs from the Internet Archive: (series key, edition).
        recovered = [(series_key(parse_note_title(v["title"], known["name"])), v) for _, entry in recovered_pdfs(manifest, slug)
                     if (v := recovered_pdf_version(store, known["name"], entry))]
        known_reports = set(groups) | {k for k, _, _ in pdf_only} | {k for k, _ in recovered}
        from_pdf_only = dict.fromkeys([*(k for k, a, _ in pdf_only if a["url"] in with_text), *(k for k, _ in recovered)])
        archived_pdfs = 0                    # editions shown that are an archive copy of a PDF: they have no note entry
        for key in [*groups, *(k for k in from_pdf_only if k not in groups)]:
            members = groups.get(key, [])
            series = build_series(store, slug, known["name"], key, members, image_files, history, similarity_cache,
                                  reports=known_reports, listed=not dropped,
                                  pdfs=[pdf_edition(a, parsed.month, manifest) for k, a, parsed in pdf_only
                                        if k == key and a["url"] not in with_text],
                                  pdf_versions=[*(with_text[a["url"]] for k, a, _ in pdf_only if k == key and a["url"] in with_text),
                                                *(v for k, v in recovered if k == key)],
                                  pdf_figures=[(url, held) for note, _ in members
                                               if (url := live_by_url.get(note)) and url in manifest
                                               and (held := pdftext.load_figures(store, manifest[url]["sha256"]))],
                                  pdf_compares=[(url, held) for note, _ in members
                                                if (url := live_by_url.get(note)) and url in manifest
                                                and (held := webpdf.load_comparison(store, manifest[url]["sha256"]))])
            if withdrawn:
                series.update(status="removed", withdrawn_at=withdrawn)
            if series_out:                       # every report, so every report has a timeline
                path = Path(series_out) / series_path(slug, key)
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(json.dumps(series, ensure_ascii=False, separators=(",", ":")), "utf-8")
                written.add(path)
            pdf = next((live_by_url.get(note) for note, index in members if index.get("status") == "live"), None)
            reports.append(report_summary(slug, series, pdf))
            archived_pdfs += sum(1 for e in series["versions"] if e["source"] == "pdf" and e.get("archive_url"))
            for note, index in members:
                notes.append(_note_entry(store, slug, known["name"], note, index, live_by_url.get(note), series))
                note_paths[index["base_path"]] = {"country": slug, "series": key, "note": note,
                                                  "status": index.get("status")}
            for e in series["versions"]:                         # a current edition read from its PDF counts as a live note
                if e["source"] == "pdf" and e["current"]:
                    parsed = parse_note_title(e["title"], known["name"])
                    notes.append({"id": f"pdf-{e['id']}", "title": e["title"], "kind": kind_label(parsed.kind),
                                  "topic": parsed.topic, "month": parsed.month, "status": "live", "text_from_pdf": True,
                                  "pdf_sha256": e["extracted"]["pdf_sha256"],
                                  "version": e["version"], "updated": e["date"], "series": key,
                                  "editions": len(series["versions"]), "archived_editions": 0,
                                  "earliest": series["versions"][0]["date"], "latest_change": None, "compare_url": None,
                                  "govuk_url": page_url, "archive_url": None, "pdf_url": e["pdf_url"]})
        # PDF-only notes, listed for a country whose page has no HTML edition at all. One whose series holds
        # earlier HTML editions is that report's current edition (its `current_pdf`), not a report of its own.
        for key, a, parsed in ([] if html_attachments(publication) else pdf_only):
            if a["url"] in with_text:                            # readable here: it is a report like any other, above
                continue
            entry = manifest.get(a["url"], {})
            notes.append({"id": a["url"].rsplit("/", 1)[-1], "title": a.get("title", "").strip(),
                          "kind": kind_label(parsed.kind), "topic": parsed.topic, "month": parsed.month,
                          "status": "removed" if dropped else "live", "pdf_only": True, "version": None,
                          "updated": to_utc(publication.get("public_updated_at")), "editions": 1,
                          "archived_editions": 0, "earliest": entry.get("first_seen"),
                          "govuk_url": config.GOVUK + known["base_path"], "archive_url": None,
                          "pdf_url": a["url"]})
            if key not in groups:
                reports.append({"key": f"pdf:{a['url'].rsplit('/', 1)[-1]}", "topic": parsed.topic, "kind": kind_label(parsed.kind),
                                "status": "removed" if dropped else "live", "pdf_only": True, "editions": 1,
                                "earliest": entry.get("first_seen"),
                                "latest": {"version": None, **own_date(None, parsed.month), "page_updated": page_updated,
                                           "note": None, "pdf_url": a["url"],
                                           "govuk_url": config.GOVUK + known["base_path"], "archive_url": None},
                                "latest_change": None, "history_count": 0, "read_url": None})
        reports.sort(key=lambda r: (r["status"] != "live", -(int((r["latest"]["published"] or "0")[:10].replace("-", "")))))
        order = {"live": 0, "removed": 1, "archived": 2}
        notes.sort(key=lambda n: (order.get(n["status"], 3), -(int((n["updated"] or "0")[:10].replace("-", "")))))
        cfg = mapping.get(slug, {})
        countries.append({
            "slug": slug,
            "name": known["name"],
            "iso_n3": cfg.get("iso_n3"),
            "iso_a2": cfg.get("iso_a2"),
            "marker": cfg.get("marker"),
            "caveat": cfg.get("caveat"),
            "updated": to_utc(known.get("public_updated_at")),
            "dropped_from_collection": dropped or None,
            "withdrawn_at": withdrawn,
            "archived_pdf_editions": archived_pdfs,
            "govuk_url": config.GOVUK + known["base_path"],
            "reports": reports,
            "notes": notes,
            "history": history,
        })
        recent += [{"country": slug, "name": known["name"], **h} for h in history]
    save_similarity_cache(series_out, similarity_cache)
    if series_out:
        # These files are derived (rebuilt every run from the store, which is never pruned). One that
        # this run did not write belongs to a report since regrouped or renamed: left behind, it would
        # still open as a stale copy of part of a report's history.
        for stale in sorted(set(Path(series_out).glob("*/*.json")) - written):
            stale.unlink()
    recent.sort(key=lambda h: h["date"] or "", reverse=True)
    live_notes = [n for c in countries for n in c["notes"] if n["status"] == "live"]
    runs = store.runs()
    return {
        "generated_at": now_iso(),
        "last_sync": next((r["finished"] for r in reversed(runs) if r["kind"] == "sync"), None),
        "source": config.GOVUK + config.COLLECTION_PATH,
        "licence": "Contains public sector information licensed under the Open Government Licence v3.0.",
        "totals": {
            "countries": sum(not c["dropped_from_collection"] for c in countries),
            "former_countries": sum(bool(c["dropped_from_collection"]) for c in countries),
            "notes": len(live_notes),
            "pdfs": sum(e.get("country") in state["countries"] for e in manifest.values()),
            # Editions held only as an archive copy: of a web page (counted on its note), or of a PDF.
            "archived_editions": (sum(n["archived_editions"] for c in countries for n in c["notes"])
                                  + sum(c["archived_pdf_editions"] for c in countries)),
            "archived_pdf_editions": sum(c["archived_pdf_editions"] for c in countries),
            "archive_copies": sum(n.get("archive_copies", 0) for c in countries for n in c["notes"]),
            "removed_or_archived_notes": sum(1 for c in countries for n in c["notes"] if n["status"] != "live"),
        },
        "countries": countries,
        "recent_changes": recent[:60],
        "note_paths": note_paths,
        "country_paths": {c["govuk_url"].removeprefix(config.GOVUK): c["slug"] for c in countries},
        "feature_aliases": countries_config.get("feature_aliases", {}),
        "boundary_patches": countries_config.get("boundary_patches", []),
    }


def export_dashboard(store: Store, out: Path, countries_config_path: Path = COUNTRIES_CONFIG,
                     series_out: Path | None = None) -> dict:
    # The Home Office's own account, kept separately from country reports and their counts.
    about = store.root / "about" / "text.json"
    if series_out and about.exists():
        target = Path(series_out).parent / "about.json"
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(about.read_text("utf-8"), "utf-8")
    data = build_dashboard(store, json.loads(Path(countries_config_path).read_text("utf-8")), series_out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n", "utf-8")
    return data
