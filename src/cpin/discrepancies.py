"""Where the web version of a note and its PDF differ, as one page to read through.

`./cpin compare` keeps a record of the real differences for every note that has both (webpdf.py,
docs/methods/pdf-and-web.md). This lays those records out for a reader: the notes to read first, each
difference with the web's words beside the PDF's, the signs that the two are different drafts, and the
paragraphs the two number differently. It is a document to check against the sources, not a source: each
entry links the web page and the page of the PDF, and both are quoted only as far as the record keeps them.

    ./cpin compare --page differences.html

The page is self-contained (no scripts, no outside files) so it can be opened anywhere and kept.
"""
import html
from datetime import datetime, timezone

from . import config, webpdf
from .govuk import note_slug
from .verify import pair_pdfs

LISTED_MAP = 60                  # pairs of paragraph numbers shown for a note before "and N more"

esc = lambda text: html.escape(str(text if text is not None else ""), quote=True)


def notes(store) -> list[dict]:
    """Every note with a comparison on record, with what a reader needs to find it: its title, country,
    GOV.UK page and PDF. Only a record made for the web body held now is used."""
    out = []
    state, manifest = store.load_state(), store.load_pdf_manifest()
    for slug in sorted(state["countries"]):
        publication = store.load_publication(slug) or {}
        for html_url, pdf_url in pair_pdfs(publication).items():
            note, entry = note_slug(html_url), manifest.get(pdf_url)
            index = store.load_note(slug, note)
            record = webpdf.load_comparison(store, entry["sha256"]) if entry else None
            if not index or not record or record.get("body_sha256") != index.get("current_sha256"):
                continue
            out.append({"country": state["countries"][slug]["name"], "slug": slug, "note": note,
                        "title": (index.get("title") or note).strip(), "web_url": config.GOVUK + index["base_path"],
                        "pdf_url": pdf_url, "record": record})
    return out


def _count(n: int) -> str:
    return f"{n:,} word" if n == 1 else f"{n:,} words"


def _where(d: dict) -> str:
    w = d.get("where") or {}
    bits = [w.get("section"), f"para {w['paragraph']}" if w.get("paragraph") else None, f"PDF page {w['page']}" if w.get("page") else None]
    return " · ".join(b for b in bits if b)


def _difference(d: dict, n: dict) -> str:
    page = (d.get("where") or {}).get("page")
    pdf_link = f'{n["pdf_url"]}#page={page}' if page else n["pdf_url"]
    # Each side with the words round it that both versions share, so a single word can be read in its sentence.
    flat = lambda text: (text or "").replace("\n", " ")
    after = flat(d.get("after"))
    round_ = lambda before, inner: (f'<span class="ctx">{"… " if before else ""}{esc(before)}</span> {inner} '
                                    f'<span class="ctx">{esc(after)}{" …" if after else ""}</span>')
    side = lambda text, label, before: (f'<div class="side"><p class="lab">{label}</p><p class="words">{round_(before, f"<b>{esc(text)}</b>")}</p></div>' if text
                                        else f'<div class="side none"><p class="lab">{label}</p><p class="words">{round_(before, "<b>[nothing here]</b>")}</p></div>')
    second = {"agrees": " · a second reader of the PDF agrees", "cannot tell": " · a second reader of the PDF could not tell"}.get(d.get("second"), "")
    return (f'<article class="diff"><p class="where">{esc(d["kind"].capitalize())} · {esc(_where(d))}{second} · '
            f'<span class="n">{_count(d["web_words"])} on the web, {_count(d["pdf_words"])} in the PDF</span> · <a href="{esc(pdf_link)}">open the PDF here</a></p>'
            f'<div class="pair">{side(d.get("web"), "Web version", flat(d.get("before")))}'
            f'{side(d.get("pdf"), "PDF", flat(d.get("before_pdf", d.get("before"))))}</div></article>')


def _note(n: dict, *, open_: bool = False) -> str:
    r = n["record"]
    s = r["summary"]
    wording = [d for d in r["differences"] if d["group"] == "wording"]
    version = s["version"]
    edition = " · ".join(b for b in (f'version {version["pdf"] or version["web"]}' if (version["pdf"] or version["web"]) else None,
                                     version.get("pdf_date") or version.get("web_date")) if b)
    head = (f'<summary><span class="c">{esc(n["country"])}</span> <span class="t">{esc(n["title"])}</span> '
            f'<span class="n">{s["wording"]["share"]:.2%} · {_count(s["wording"]["web_words"])} only on the web, {_count(s["wording"]["pdf_words"])} only in the PDF</span></summary>')
    links = (f'<p class="links">{esc(edition)}{" · " if edition else ""}<a href="{esc(n["web_url"])}">web version on GOV.UK</a> · '
             f'<a href="{esc(n["pdf_url"])}">PDF</a></p>')
    drafts = "".join(f"<li>{esc(sign)}</li>" for sign in s["drafts"])
    drafts = f'<p class="lab">Signs that the two are different drafts</p><ul class="signs">{drafts}</ul>' if drafts else ""
    more = s["wording"]["differences"] - len(wording)
    tail = f'<p class="more">{more} smaller differences of wording are counted and not listed here.</p>' if more > 0 else ""
    return f'<details class="note"{" open" if open_ else ""}>{head}{links}{drafts}{"".join(_difference(d, n) for d in wording)}{tail}</details>'


def _numbering(n: dict) -> str:
    p = n["record"].get("paragraphs") or {}
    different, unnumbered, web_plain = p.get("different") or {}, p.get("pdf_unnumbered") or [], p.get("web_unnumbered") or 0
    repeated, unconfirmed = p.get("repeated") or [], p.get("unconfirmed") or []
    if not different and not unnumbered and not web_plain and not repeated and not unconfirmed:
        return ""
    pairs = list(different.items())
    rows = "".join(f"<li><b>{esc(web)}</b> on the web is <b>{esc(pdf)}</b> in the PDF</li>" for web, pdf in pairs[:LISTED_MAP])
    if len(pairs) > LISTED_MAP:
        rows += f"<li>and {len(pairs) - LISTED_MAP} more</li>"
    plain = f'<p class="more">Numbered on the web, not numbered in the PDF: {esc(", ".join(unnumbered[:LISTED_MAP]))}{" and more" if len(unnumbered) > LISTED_MAP else ""}.</p>' if unnumbered else ""
    plain += f'<p class="more">{web_plain} paragraphs are numbered in the PDF and carry no number on the web.</p>' if web_plain else ""
    # A number the web version gives to more than one paragraph cannot be matched to one PDF number, so none is given.
    plain += (f'<p class="more">Used for more than one paragraph on the web, so not matched to a PDF number: '
              f'{esc(", ".join(repeated[:LISTED_MAP]))}{" and more" if len(repeated) > LISTED_MAP else ""}.</p>' if repeated else "")
    plain += (f'<p class="more">Numbered differently by our reading of the PDF, which a second reader did not bear out, so no PDF number '
              f'is given: {esc(", ".join(unconfirmed[:LISTED_MAP]))}{" and more" if len(unconfirmed) > LISTED_MAP else ""}.</p>' if unconfirmed else "")
    counts = ", ".join(c for c in (f"{len(pairs)} numbered differently" if pairs else "", f"{len(unnumbered)} not numbered in the PDF" if unnumbered else "",
                                   f"{web_plain} not numbered on the web" if web_plain else "",
                                   f"{len(repeated)} numbers used more than once on the web" if repeated else "",
                                   f"{len(unconfirmed)} not confirmed" if unconfirmed else "") if c)
    return (f'<details class="note"><summary><span class="c">{esc(n["country"])}</span> <span class="t">{esc(n["title"])}</span> '
            f'<span class="n">{counts}</span></summary>'
            f'<p class="links"><a href="{esc(n["web_url"])}">web version on GOV.UK</a> · <a href="{esc(n["pdf_url"])}">PDF</a></p>'
            f'<ul class="map">{rows}</ul>{plain}</details>')


STYLE = """
:root { --bg: #fff; --ink: #0b0c10; --ink2: #50545f; --line: #d9dbe1; --blue: #0037ff; --wash: #f3f5ff; --web: #fff8e6; --pdf: #eef7f0; }
@media (prefers-color-scheme: dark) { :root { --bg: #0b0c10; --ink: #eceef2; --ink2: #a3a8b4; --line: #2a2d36; --blue: #8a8cff; --wash: #14162a; --web: #2a2413; --pdf: #14251a; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 16px/1.55 -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; }
main { max-width: 62rem; margin: 0 auto; padding: 1.5rem 1rem 4rem; }
h1 { font-size: 1.6rem; line-height: 1.2; margin: 0 0 .4rem; }
h2 { font-size: 1.15rem; margin: 2.4rem 0 .3rem; padding-top: 1rem; border-top: 2px solid var(--ink); }
p { margin: .5rem 0; } a { color: var(--blue); }
.lede, .how { color: var(--ink2); max-width: 46rem; }
table { border-collapse: collapse; margin: 1rem 0; font-variant-numeric: tabular-nums; }
th, td { text-align: left; padding: .35rem .9rem .35rem 0; border-bottom: 1px solid var(--line); vertical-align: top; }
details.note { border: 1px solid var(--line); margin: .6rem 0; }
details.note > summary { cursor: pointer; padding: .7rem .9rem; display: flex; flex-wrap: wrap; gap: .2rem .7rem; align-items: baseline; }
details.note[open] > summary { border-bottom: 1px solid var(--line); background: var(--wash); }
details.note > :not(summary) { margin-left: .9rem; margin-right: .9rem; }
.c { font-weight: 700; } .t { flex: 1 1 18rem; } .n { color: var(--ink2); font-size: .86rem; white-space: nowrap; }
.links, .where, .more { font-size: .86rem; color: var(--ink2); }
.lab { font-size: .72rem; letter-spacing: .08em; text-transform: uppercase; color: var(--ink2); margin: .2rem 0 .15rem; }
.diff { margin: 1rem 0 1.2rem; }
.pair { display: grid; grid-template-columns: 1fr 1fr; gap: .6rem; }
@media (max-width: 640px) { .pair { grid-template-columns: 1fr; } .n { white-space: normal; } }
.side { padding: .55rem .7rem; border: 1px solid var(--line); background: var(--web); }
.side + .side { background: var(--pdf); }
.side.none { background: none; }
.side.none b { font-weight: 400; font-style: italic; color: var(--ink2); }
.ctx { color: var(--ink2); }
.words { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
ul.map, ul.signs { margin: .4rem 0 .8rem; padding-left: 1.2rem; } ul.map { columns: 2 16rem; font-variant-numeric: tabular-nums; }
ul.plain { columns: 2 20rem; padding-left: 1.2rem; color: var(--ink2); font-size: .9rem; }
"""


def page(all_notes: list[dict]) -> str:
    """The whole document, as HTML, from `notes(store)`."""
    summary = webpdf.summarise([n["record"] for n in all_notes])
    by_note = {n["record"]["note"]: n for n in all_notes}
    flagged = [by_note[f["note"]] for f in summary["flagged"]]
    drafts = [by_note[f["note"]] for f in summary["drafts"] if by_note[f["note"]] not in flagged]
    rest = sorted((n for n in all_notes if n not in flagged and n not in drafts and n["record"]["summary"]["wording"]["differences"]),
                  key=lambda n: -n["record"]["summary"]["wording"]["share"])
    same = [n for n in all_notes if not n["record"]["summary"]["wording"]["differences"] and n not in drafts]
    numbered = [block for block in (_numbering(n) for n in all_notes) if block]
    w = summary["wording"]
    point = lambda p: f'{p["share"]:.3%} ({p["words"]:,} words)' if p else "none"
    made = datetime.now(timezone.utc).strftime("%-d %B %Y")
    return f"""<!doctype html>
<html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>Web version and PDF: where they differ</title><style>{STYLE}</style></head>
<body><main>
<h1>Web version and PDF: where they differ</h1>
<p class="lede">The Home Office publishes each edition of a note twice on GOV.UK, as a web page and as a PDF. They are meant to be
the same text. This lists where they are not, for the {summary["pairs"]} current notes that have both. Made on {made} from the
copies CPIN Explorer holds. Every difference here was confirmed against the PDF's own text; it is still a list to check against
the sources, which each entry links.</p>
<table>
<tr><th>Genuine differences of wording, as a share of a note's words</th><th></th></tr>
<tr><td>Best note</td><td>{point(w["best"])}</td></tr>
<tr><td>Middle note</td><td>{point(w["median"])}</td></tr>
<tr><td>Worst tenth, from</td><td>{point(w["worst_tenth"])}</td></tr>
<tr><td>Worst note</td><td>{point(w["worst"])}</td></tr>
<tr><td>Notes with no difference of wording</td><td>{w["none"]} of {summary["pairs"]}</td></tr>
<tr><td>Notes at or over 0.5% / 1%</td><td>{w["at_half_percent"]} / {w["at_one_percent"]}</td></tr>
</table>
<p class="how">Not counted as wording, and not listed below: paragraph numbers (listed in their own section), words the web adds in
place of a picture, the notice on a withheld section, addresses printed as text, list markers and spacing. In each pair the PDF is
the same edition as the web version: same version number, same "valid from" date.</p>

<h2>1. Notes to read first ({len(flagged)})</h2>
<p class="how">Wording differs by 0.5% or more, or a passage of four words or more differs inside the Executive summary or the
Assessment. Largest first. The web's words are on the left, the PDF's on the right; long passages are cut short.</p>
{"".join(_note(n, open_=i < 4) for i, n in enumerate(flagged))}

<h2>2. Other notes showing signs of different drafts ({len(drafts)})</h2>
<p class="how">A different footnote count, a "Section updated" date or a year that differs: signs that the web page and the PDF
were not made from the same draft, though both carry the same version number.</p>
{"".join(_note(n) for n in drafts)}

<h2>3. Paragraphs numbered differently ({len(numbered)} notes)</h2>
<p class="how">A citation to "paragraph 18.4.1" points at different text in the two versions of these notes. CPIN Explorer cites
the web version's numbers and says so. A PDF number is given only where a second reader of the PDF (pdftotext) has it before the
same opening words. A number the web version uses for more than one paragraph is listed, not matched.</p>
{"".join(numbered)}

<h2>4. Every other note with a difference of wording ({len(rest)})</h2>
{"".join(_note(n) for n in rest)}

<h2>5. Notes with no difference of wording ({len(same)})</h2>
<ul class="plain">{"".join(f"<li>{esc(n['country'])}: {esc(n['title'])}</li>" for n in same)}</ul>

<h2>How this was made</h2>
<p class="how">Each web version, exactly as GOV.UK serves it, is lined up word for word with the text of its PDF. Each place they
differ is then looked up in the PDF's own raw text, read three ways. A difference is listed only when the raw text confirms it.
Each is also put to a second program that reads PDFs (pdftotext), which shares no code with the first: one it reads the way the web
has it is left out, and each entry says whether it agreed or could not tell. The grey words round each difference are shared by
both versions; the words in bold are what differs.
Method {esc(summary["method"])}; the rules are in docs/methods/pdf-and-web.md and the first full review in
docs/reviews/2026-10-03-pdf-vs-web.md. Neither version is presented as the authoritative one: the Home Office has not said which is.</p>
</main></body></html>
"""


def write(store, path) -> dict:
    """Write the page; returns what it holds, for the command to report."""
    from pathlib import Path
    all_notes = notes(store)
    text = page(all_notes)
    Path(path).write_text(text, "utf-8")
    return {"path": str(path), "bytes": len(text.encode("utf-8")), "notes": len(all_notes)}
