"""Full-text search records for the prototypes: one per section of each live note's current edition.

Derived data only (rule 1): the text is the stored body's own text, split at its h2/h3 headings,
with footnote markers ("[footnote 12]") left out and whitespace tidied. Nothing is reworded. The
footnote list and the back matter (bibliography, version control and feedback) are not indexed;
the footnote texts are source citations and would swamp the results.

Each note also gets one short record holding its verbatim GOV.UK title, so a query that names a
topic ranks that note first.

    PYTHONPATH=src .venv/bin/python -m cpin.search_records       # -> prototypes/data/search-records.jsonl
    cd web && node build-search.mjs                                # -> prototypes/search/pagefind/

Record shape (Pagefind custom records, see web/build-search.mjs):
    {url, content, language, meta: {title, country, slug, note, kind, version, month, section,
     anchor, level, type, iso_a2}, filters: {country: [name], kind: [kind], type: [title|text]}}

A note published as a PDF only is searched through the text extracted from its PDF (pdftext.py). That
text is a reading of the PDF, not GOV.UK's own words in GOV.UK's own markup, so every record of such a
note also carries `text_from_pdf: true` (rule 5): the site must show it as "From the PDF", never as verbatim.
"""
import argparse
import json
import re
import sys
import time
from pathlib import Path
from urllib.parse import quote

from lxml import html as lxml_html

from . import config, pdftext
from .store import Store, atomic_write, read_json

DASHBOARD = config.ROOT / "prototypes" / "dashboard" / "data.json"
OUT = config.ROOT / "prototypes" / "data" / "search-records.jsonl"
READER = "prototypes/reader/index.html"

# Headings whose sections (and the h3s under them) are back matter, not the note's substance.
BACK_MATTER = re.compile(
    r"^(bibliography|list of sources|sources (cited|consulted)( but not cited)?|version control( and feedback)?)$",
    re.IGNORECASE)
# Elements that break words apart: their text is put on a line of its own.
BLOCK = {
    "p", "div", "section", "article", "ul", "ol", "li", "dl", "dt", "dd", "table", "thead", "tbody", "tfoot",
    "tr", "td", "th", "caption", "blockquote", "figure", "figcaption", "pre", "hr", "br",
    "h1", "h2", "h3", "h4", "h5", "h6",
}
NOTICE = ("application-notice", "info-notice")


def _classes(el) -> set[str]:
    return set((el.get("class") or "").split())


def _is_footnote_marker(el) -> bool:
    """<sup><a href="#fn:12" role="doc-noteref">[footnote 12]</a></sup>, or the bare link."""
    if el.tag == "a":
        return el.get("role") == "doc-noteref" or "footnote" in _classes(el)
    if el.tag == "sup":
        return any(_is_footnote_marker(a) for a in el.iter("a"))
    return False


def _collect(el, out: list[str]):
    if not isinstance(el.tag, str) or _is_footnote_marker(el):    # comments, footnote markers
        return
    block = el.tag in BLOCK
    if block:
        out.append("\n")
    if el.text:
        out.append(el.text)
    for child in el:
        _collect(child, out)
        if child.tail:                                            # text after a skipped marker stays
            out.append(child.tail)
    if block:
        out.append("\n")


def element_text(elements) -> str:
    """The text of some elements, one line per block, footnote markers left out."""
    out: list[str] = []
    for el in elements:
        _collect(el, out)
        out.append("\n")
    lines = (" ".join(line.split()) for line in "".join(out).split("\n"))
    return "\n".join(line for line in lines if line)


def _heading_text(h) -> str:
    return " ".join(h.text_content().split())


def body_root(body: str):
    root = lxml_html.fragment_fromstring(body, create_parent="div")
    found = root.find_class("govspeak")
    return found[0] if found else root


def sections(body: str) -> list[dict]:
    """Split a body at its h2/h3 headings: [{anchor, section, level, content}], in order.

    Anchors are the headings' ids, or "section-<n>" (n counting every h2/h3) for a heading without one,
    as the reader assigns them. Text before the first heading is kept (anchor "") unless it is only the
    version notice. Sections with no text of their own (an h2 straight before its first h3) are dropped.
    """
    root = body_root(body)
    numbered = {h: f"section-{i}" for i, h in enumerate(root.iter("h2", "h3"), 1)}
    out, current, skipping = [], {"anchor": "", "section": "", "level": 1, "els": []}, False

    def flush():
        if current["level"] == 1:
            current["els"] = [el for el in current["els"] if not (_classes(el) & set(NOTICE))]
        text = element_text(current["els"])
        if text and not current.get("skip"):
            out.append({"anchor": current["anchor"], "section": current["section"], "level": current["level"],
                        "content": "\n".join(filter(None, [current["section"], text]))})

    for el in root:
        if not isinstance(el.tag, str):
            continue
        if "footnotes" in _classes(el) or el.get("role") == "doc-endnotes":
            flush()
            current = {"anchor": "", "section": "", "level": 9, "els": [], "skip": True}
            continue
        if el.tag in ("h2", "h3"):
            flush()
            title = _heading_text(el)
            if el.tag == "h2":
                skipping = bool(BACK_MATTER.match(title))
            current = {"anchor": el.get("id") or numbered[el], "section": title, "level": int(el.tag[1]), "els": [],
                       "skip": skipping or bool(BACK_MATTER.match(title))}
            continue
        current["els"].append(el)
    flush()
    return out


def _cap_first(s: str) -> str:
    return s[:1].upper() + s[1:] if s else s


def reader_url(country: str, note: str, anchor: str = "", part: int | None = None) -> str:
    q = lambda s: quote(s, safe="-_.!~*'()")                     # as encodeURIComponent
    return (f"{READER}?country={q(country)}&note={q(note)}" + (f"&part={part}" if part else "")
            + (f"#{q(anchor)}" if anchor else ""))


def note_records(country: dict, note: dict, index: dict, body: str, from_pdf: bool = False) -> list[dict]:
    """The title record and section records of one note. country/note are data.json entries.

    Pagefind treats records with the same URL as one page, so every URL is unique: the title record
    has none of a section's anchor, text before the first heading points at the reader's article
    (#doc), and a heading id GOV.UK used twice in one note gets a harmless &part=<n> on the repeat.

    from_pdf: the body is text extracted from a PDF. Each record then has `text_from_pdf: true`.
    """
    edition = next((v for v in index.get("versions", []) if v["sha256"] == index.get("current_sha256")), {})
    title = (edition.get("title") or index.get("title") or note.get("title") or "").strip()
    topic = _cap_first(note.get("topic") or title)
    kind = note.get("kind") or "Note"
    base = {
        "title": topic, "country": country["name"], "slug": country["slug"], "note": note["id"], "kind": kind,
        "version": note.get("version") or edition.get("version_banner") or "", "month": note.get("month") or "",
        "iso_a2": country.get("iso_a2") or "",
    }
    filters = {"country": [country["name"]], "kind": [kind]}

    seen: set[str] = set()

    def record(content, anchor, section, level, type_, n=0):
        url = reader_url(country["slug"], note["id"], anchor or ("doc" if type_ == "text" else ""))
        if url in seen:
            url = reader_url(country["slug"], note["id"], anchor, part=n)
        seen.add(url)
        return {"url": url, "content": content, "language": "en",
                "meta": {**base, "section": section, "anchor": anchor, "level": str(level), "type": type_},
                "filters": {**filters, "type": [type_]}, **({"text_from_pdf": True} if from_pdf else {})}

    out = [record(title, "", "", 0, "title")]
    out += [record(s["content"], s["anchor"], s["section"], s["level"], "text", n) for n, s in enumerate(sections(body), 1)]
    return out


def build_records(store: Store, dashboard: dict, log=lambda *a: None):
    """Records for every live note with an HTML edition, in data.json order."""
    for country in dashboard["countries"]:
        for note in country["notes"]:
            if note.get("status") != "live" or note.get("pdf_only"):
                continue
            if note.get("text_from_pdf"):                     # published as a PDF only: its extracted text is searched
                held = pdftext.load_text(store, note.get("pdf_sha256") or "")
                if held:
                    yield from note_records(country, note, {}, held[0], from_pdf=True)
                else:
                    log(f"skip {country['slug']}/{note['id']}: no text extracted from its PDF (./cpin pdftext)")
                continue
            index = store.load_note(country["slug"], note["id"])
            if not index or index.get("status") != "live" or not index.get("current_sha256"):
                log(f"skip {country['slug']}/{note['id']}: no live edition in the store")
                continue
            path = store.body_path(country["slug"], note["id"], index["current_sha256"])
            if not path.exists():
                log(f"skip {country['slug']}/{note['id']}: body {path.name} missing")
                continue
            yield from note_records(country, note, index, store.read_body(country["slug"], note["id"], index["current_sha256"]))


def write_records(records, out: Path) -> dict:
    lines, stats = [], {"records": 0, "notes": 0, "chars": 0}
    for r in records:
        lines.append(json.dumps(r, ensure_ascii=False))
        stats["records"] += 1
        stats["notes"] += r["meta"]["type"] == "title"
        stats["chars"] += len(r["content"])
    out.parent.mkdir(parents=True, exist_ok=True)
    atomic_write(out, ("\n".join(lines) + "\n").encode("utf-8"))
    stats["bytes"] = out.stat().st_size
    return stats


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="cpin.search_records", description=__doc__.split("\n\n")[0])
    ap.add_argument("--data", type=Path, default=config.DATA_DIR, help="store root (default: data/)")
    ap.add_argument("--dashboard", type=Path, default=DASHBOARD, help="dashboard data.json")
    ap.add_argument("--out", type=Path, default=OUT, help="JSONL to write")
    args = ap.parse_args(argv)
    dashboard = read_json(args.dashboard)
    if not dashboard:
        print(f"No dashboard data at {args.dashboard}: run ./cpin export first.", file=sys.stderr)
        return 1
    t0 = time.perf_counter()
    stats = write_records(build_records(Store(args.data), dashboard, log=lambda m: print(m, file=sys.stderr)), args.out)
    print(f"{stats['records']} records ({stats['notes']} notes, {stats['records'] - stats['notes']} sections, "
          f"{stats['chars'] / 1e6:.1f}M characters) -> {args.out} ({stats['bytes'] / 1e6:.1f} MB) "
          f"in {time.perf_counter() - t0:.1f}s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
