"""A Home Office note's PDF, as HTML shaped like GOV.UK's own web version of a note.

Some editions are published as a PDF only. To read, search and compare them like any other edition
their text is taken from the PDF and laid out the way GOV.UK lays out the web versions: h2/h3/h4
headings, numbered paragraphs, lists, tables, figures, and footnotes gathered at the end.

This is an EXTRACTION, not a copy, and is always labelled as one. The words come from the PDF's own
text layer (the PDFs are made in Word; nothing is read by OCR, and a PDF with no text layer is refused),
but paragraphs, lists, tables and footnotes are rebuilt from where things sit on the page:

  headings      the PDF's bookmarks (title, level, page); failing those, type size and numbering
  paragraphs    lines closer together than a paragraph gap; one that runs over a page is rejoined when
                it had not reached a full stop, or the next page's first word would not have fitted
  lists         lines that open with a bullet glyph, nested by how far in they sit
  footnotes     the small type under the short rule at the foot of a page, matched to the raised
                numbers in the text
  links         the PDF's link rectangles, matched to the characters inside them
  tables        PyMuPDF's table finder
  figures       pictures and drawn charts, rendered as images (their lettering is part of the picture)
  left out      the cover, the contents page, page numbers and "Back to Contents"

`check` compares an extraction with GOV.UK's web version of the same edition, where both exist: that
is how its accuracy is measured (./cpin pdftext --check). No LLM is involved (AGENTS.md rule 1).
"""
import contextlib
import hashlib
import html as html_lib
import io
import os
import re
from dataclasses import dataclass, field

EXTRACTOR = "pdftext-2"          # bump when the output for the same PDF would change

BOLD, ITALIC, SUPER = 16, 2, 1
PARA_NO = re.compile(r"^\d{1,3}(?:\.\d{1,3}){1,4}\.?$")
SECTION_NO = re.compile(r"^(\d{1,3}(?:\.\d{1,3}){0,3})\.?\s+\S")
PAGE_NO = re.compile(r"^(page\s+)?\d+(\s+of\s+\d+)?$", re.I)
BACK = re.compile(r"^back to contents?$", re.I)
COVER_DATE = re.compile(r"^(version:?\s*\d+(\.\d+)*|(\d{1,2}\s+)?(january|february|march|april|may|june|july|august|september|october|november|december)(\s+20\d\d)?|20\d\d)$", re.I)
CONTENTS_LINE = re.compile(r"\.{4,}\s*\d+\s*$")       # "1.1 Credibility ........ 6"

BULLET = re.compile("^\\s*([\u2022\u00b7\uf0b7\uf0a7\u25aa\u25a0\u25e6\u25cb\u27a2\uf0d8]|o(?=\\s))\\s*")    # Word's bullet glyphs, and its hollow "o"
REDACT_START = re.compile(r"official\s*[–-]\s*sensitive.*start of section", re.I)
REDACT_END = re.compile(r"official\s*[–-]\s*sensitive.*end of section", re.I)
ENDS = re.compile(r"[.:;!?][’'”\")\]]*$")
IMAGE_SRC = "pdf-image:"         # <img src="pdf-image:<sha256>.png">: a figure rendered from the PDF (.jpg for a photograph)
IMAGE_NAME = r"[0-9a-f]{64}\.(?:png|jpg)"
JPEG_OVER = 150_000              # bytes: a rendered figure larger than this as a PNG is tried as a JPEG
# Which of a PDF's pictures are not carried over to the web edition of the same note (they stay in the PDF):
SMALL_MARK = 150                 # pixels (75 pt): shorter or narrower than this is a logo, a stamp or a signature
WORDY = 250                      # characters of real text inside it: more than a chart's lettering, so it is a table
                                 # or a panel of text drawn with shading, which the web version gives as text
esc = html_lib.escape


@dataclass
class Piece:
    """A run of characters in one style, with any link it sits on."""
    text: str
    size: float
    flags: int
    font: str
    href: str | None = None
    goto: tuple | None = None        # (page index, y) of an internal link's target
    raised: bool = False             # set above the line (a footnote mark), judged against its own line

    def but(self, text: str) -> "Piece":
        return Piece(text, self.size, self.flags, self.font, self.href, self.goto, self.raised)


@dataclass
class Line:
    page: int
    x0: float
    y0: float
    x1: float
    y1: float
    pieces: list = field(default_factory=list)
    first_word: float = 0.0          # width of the line's first word, in points

    @property
    def text(self) -> str:
        return "".join(p.text for p in self.pieces)

    @property
    def size(self) -> float:
        best = max(self.pieces, key=lambda p: len(p.text.strip()), default=None)
        return best.size if best else 0.0

    @property
    def font(self) -> str:
        best = max(self.pieces, key=lambda p: len(p.text.strip()), default=None)
        return best.font if best else ""


@dataclass
class Extraction:
    html: str
    meta: dict
    images: dict = field(default_factory=dict)       # "<sha256>.png" (or .jpg) -> bytes


class NoTextLayer(ValueError):
    """The PDF is a scan: it has pages but no text to take."""


def _norm(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", text.lower())


def _slug(text: str, used: set) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", re.sub(r"^\d+(\.\d+)*\.?\s+", "", text.lower())).strip("-") or "section"
    slug, n = base, 1
    while slug in used:
        slug, n = f"{base}-{n}", n + 1
    used.add(slug)
    return slug


def _family(font: str) -> str:
    return re.sub(r"[-,].*$", "", font).replace("MT", "").replace("PS", "").lower()


# ------------------------------------------------------------------------------------------ reading a page

def _page_lines(page, pno: int, pymupdf) -> tuple[list[Line], list[Line]]:
    """The page's visual lines, top to bottom: characters grouped by style and link, pieces on one baseline
    joined. Also the runs as the PDF has them, unjoined, which is what a table's cells are read from."""
    # Links out, and links within the document. Word also makes each footnote mark a tiny link to its
    # footnote: those are left out (the marks are rebuilt as GOV.UK writes them), or the letters beside a
    # mark would be caught up in its link.
    links = [l for l in page.get_links() if l.get("kind") == pymupdf.LINK_URI
             or (l.get("kind") == pymupdf.LINK_GOTO and l["from"].width >= 14)]
    flags = pymupdf.TEXTFLAGS_RAWDICT & ~pymupdf.TEXT_PRESERVE_LIGATURES & ~pymupdf.TEXT_PRESERVE_IMAGES
    raw = []
    for block in page.get_text("rawdict", flags=flags)["blocks"]:
        for line in block.get("lines", []):
            pieces, word_end, ink = [], None, False
            lx0, ly0, lx1, ly1 = line["bbox"]
            near = [l for l in links if l["from"].y0 <= ly1 and l["from"].y1 >= ly0]
            for span in line["spans"]:
                for ch in span["chars"]:
                    href = goto = None
                    if near:
                        cx, cy = (ch["bbox"][0] + ch["bbox"][2]) / 2, (ch["bbox"][1] + ch["bbox"][3]) / 2
                        for l in near:
                            r = l["from"]
                            if r.x0 - 1 <= cx <= r.x1 + 1 and r.y0 - 1 <= cy <= r.y1 + 1:
                                if l["kind"] == pymupdf.LINK_URI:
                                    href = l.get("uri")
                                else:
                                    to = l.get("to")
                                    goto = (l.get("page", -1), to.y if to else 0.0)
                                break
                    if word_end is None:                       # the first word: up to the first space after some ink
                        if ch["c"].strip():
                            ink = True
                        elif ink:
                            word_end = ch["bbox"][0]
                    last = pieces[-1] if pieces else None
                    if (last and last.size == span["size"] and last.flags == span["flags"] and last.font == span["font"]
                            and last.href == href and last.goto == goto):
                        last.text += ch["c"]
                    else:
                        pieces.append(Piece(ch["c"], span["size"], span["flags"], span["font"], href, goto))
            if pieces:
                raw.append(Line(pno, lx0, ly0, lx1, ly1, pieces, (word_end if word_end is not None else lx1) - lx0))
    # Word sets a paragraph number and its text as two runs on one baseline: join what shares a line.
    raw.sort(key=lambda l: (round(l.y0), l.x0))
    for l in raw:                                     # a footnote mark is small against its own run, not against the page
        for p in l.pieces:
            p.raised = bool(p.flags & SUPER) or p.size < l.size * 0.8
    lines: list[Line] = []
    for l in (Line(r.page, r.x0, r.y0, r.x1, r.y1, [p.but(p.text) for p in r.pieces], r.first_word) for r in raw):
        prev = lines[-1] if lines else None
        overlap = min(prev.y1, l.y1) - max(prev.y0, l.y0) if prev else 0
        if prev and overlap > 0.5 * min(prev.y1 - prev.y0, l.y1 - l.y0):
            if not prev.text.strip():                          # a blank run at the margin: the line starts here
                lines[-1] = l
                continue
            if not l.text.strip():
                continue
            first, second = (prev, l) if l.x0 >= prev.x0 else (l, prev)     # a paragraph number can sit a hair lower than its text
            pieces = list(first.pieces)
            if not first.text.endswith(" ") and second.x0 - first.x1 > 1.5 and second.size >= first.size * 0.8:
                pieces.append(second.pieces[0].but(" "))                      # (a raised mark sits against its word)
            lines[-1] = Line(prev.page, first.x0, min(prev.y0, l.y0), max(prev.x1, l.x1), max(prev.y1, l.y1), pieces + list(second.pieces), first.first_word)
        else:
            lines.append(l)
    lines.sort(key=lambda l: (l.y0, l.x0))
    for l in lines:
        main = l.size
        for p in l.pieces:
            p.raised = p.raised or p.size < main * 0.8
    return lines, raw


def _footnote_rule(page, lines: list[Line], body_size: float) -> float | None:
    """The y of the short rule Word draws above a page's footnotes: a rule from the left margin with only
    small type under it (underlines of links are rules too, but ordinary text follows them)."""
    left = min((l.x0 for l in lines), default=72)
    candidates = sorted(d["rect"].y0 for d in page.get_drawings()
                        if d["rect"].height <= 2 and 60 <= d["rect"].width <= 260 and abs(d["rect"].x0 - left) <= 6
                        and d["rect"].y0 > page.rect.height * 0.2)
    for y in candidates:
        below = [l for l in lines if l.y0 >= y - 0.5]
        if below and all(l.size < body_size * 0.9 for l in below) and re.match(r"^\s*\d{1,4}\b", below[0].text):
            return y
    # No rule drawn: small type at the foot of the page that opens with a tiny number.
    tail = []
    for l in reversed(lines):
        if l.size < body_size * 0.9:
            tail.append(l)
        else:
            break
    tail.reverse()
    while tail and not (re.match(r"^\s*\d{1,4}\s*$", tail[0].pieces[0].text) and tail[0].pieces[0].size < body_size * 0.7):
        tail.pop(0)
    return tail[0].y0 - 1 if tail and tail[0].y0 > page.rect.height * 0.4 else None


def _figure_boxes(page, lines: list[Line], table_boxes: list, body_font: str, pymupdf) -> list:
    """Where the page's pictures and drawn charts are. A picture is an image in the PDF. A chart is a cluster
    of drawn shapes (bars, axes) and of lettering in a typeface that is not the body's (the Home Office's
    charts come from Excel): not rules, underlines, table cells, or shading behind ordinary text."""
    width, height = page.rect.width, page.rect.height
    boxes = []
    for info in page.get_image_info():
        r = pymupdf.Rect(info["bbox"]) & page.rect
        if r.width >= 60 and r.height >= 40:
            boxes.append(r)
    in_table = lambda r: any(t.contains(r) or (t & r).get_area() > 0.5 * r.get_area() for t in table_boxes)
    body_lines = [l for l in lines if _family(l.font) == body_font]
    members = []                                      # (rect, is lettering)
    for d in page.get_drawings():
        r = d["rect"]
        if r.width <= 3 or r.height <= 3 or r.width > width * 0.97 or r.height > height * 0.9 or r.x1 < 30:
            continue                                   # rules, underlines, page furniture
        if in_table(r):
            continue
        fill = d.get("fill")
        if d.get("type") == "f" and fill and min(fill) >= 0.98:
            continue                                   # a white patch: nothing to see
        if r.height < 40 and any(r.y0 - 2 <= l.y0 and l.y1 <= r.y1 + 2 and r.x0 - 2 <= l.x0 and r.height < (l.y1 - l.y0) * 1.8 for l in body_lines):
            continue                                   # a strip behind one line of text: shading or highlighting
        members.append((pymupdf.Rect(r), False))
    for l in lines:
        r = pymupdf.Rect(l.x0, l.y0, l.x1, l.y1)
        if _family(l.font) != body_font and l.text.strip() and not in_table(r):
            members.append((r, True))
    # Things within a few points of each other are one drawing. Found on a coarse grid, so a map drawn
    # from tens of thousands of paths costs no more than a bar chart.
    cell = 12.0
    cells: dict[tuple, list] = {}
    for m in members:
        r = m[0]
        for gx in range(int(r.x0 // cell), int(r.x1 // cell) + 1):
            for gy in range(int(r.y0 // cell), int(r.y1 // cell) + 1):
                cells.setdefault((gx, gy), []).append(m)
    seen: set[tuple] = set()
    for start in cells:
        if start in seen:
            continue
        stack, group = [start], {}
        seen.add(start)
        while stack:
            gx, gy = stack.pop()
            for m in cells[(gx, gy)]:
                group[id(m)] = m
            for near in ((gx + dx, gy + dy) for dx in (-1, 0, 1) for dy in (-1, 0, 1)):
                if near in cells and near not in seen:
                    seen.add(near)
                    stack.append(near)
        g = list(group.values())
        box = pymupdf.Rect(g[0][0])
        for r, _ in g[1:]:
            box |= r
        shapes = sum(1 for _, lettering in g if not lettering)
        # Running text in it means prose set in another typeface, or shading round a passage: not a chart,
        # whose lettering is short. And a chart has something drawn: lettering alone is just text.
        prose = sum(1 for l in lines if box.contains(pymupdf.Point((l.x0 + l.x1) / 2, (l.y0 + l.y1) / 2)) and len(l.text.strip()) > 70)
        if len(g) >= 6 and shapes >= 1 and box.width >= 80 and box.height >= 60 and prose < 2:
            boxes.append(box)
    out = []
    for box in boxes:                                  # take in the lettering round the edge (axis labels, legends)
        box = pymupdf.Rect(box)
        for _ in range(3):
            near, nearer = box + (-22, -22, 22, 22), box + (-14, -14, 14, 14)
            for l in lines:
                r = pymupdf.Rect(l.x0, l.y0, l.x1, l.y1)
                if box.contains(r):
                    continue
                foreign = _family(l.font) != body_font
                # A chart's title and labels are in its own typeface; small type that overlaps it is its too.
                if (foreign and near.intersects(r)) or (not foreign and l.size <= 11.5 and box.intersects(r) and nearer.intersects(r)):
                    box |= r
        out.append(box & page.rect)
    merged: list = []
    for box in sorted(out, key=lambda b: b.y0):
        if merged and merged[-1].intersects(box + (-4, -4, 4, 4)):
            merged[-1] |= box
        else:
            merged.append(box)
    return merged


# ------------------------------------------------------------------------------------------ inline HTML

def _inline(pieces: list[Piece], *, heading_id=lambda goto: None, notes=frozenset(), marked: set | None = None) -> str:
    """Pieces as inline HTML: links, bold, italic, and raised numbers as GOV.UK-style footnote marks.
    notes: the numbers that have a footnote; marked: collects the ones given a mark (each once)."""
    out: list[tuple] = []                              # (html, link key): neighbours on one link are merged below
    for p in pieces:
        text = p.text
        if not text:
            continue
        if p.raised and notes and re.search(r"\d", text):
            # "…persons.’4": anything before the number is ordinary text that was raised with it. Two or more
            # marks can sit together: "33,34", "70 71 72", or run on as "178179180".
            m = re.match(r"^(\D*?)(\d(?:[\d,\s]*\d)?)(\D*)$", text)
            numbers = _note_numbers(m.group(2), notes) if m else None
            if numbers and (marked is None or not any(n in marked for n in numbers)):
                if marked is not None:
                    marked.update(numbers)
                marks = "".join(f'<sup id="fnref:{n}"><a href="#fn:{n}" class="footnote" rel="footnote" role="doc-noteref">[footnote {n}]</a></sup>' for n in numbers)
                out.append((esc(m.group(1)) + marks + esc(m.group(3)), None))
                continue
        body = esc(text)
        if text.strip():
            if p.raised:
                body = f"<sup>{body}</sup>"
            if p.flags & BOLD:
                body = f"<strong>{body}</strong>"
            if p.flags & ITALIC:
                body = f"<em>{body}</em>"
        key = None
        if p.href:
            key = ("href", p.href)
        elif p.goto:
            target = heading_id(p.goto)
            key = ("href", f"#{target}") if target else None
        out.append((body, key))
    parts, i = [], 0
    while i < len(out):
        body, key = out[i]
        if key is None:
            parts.append(body)
            i += 1
            continue
        j = i + 1
        while j < len(out) and out[j][1] == key:           # one link split by a line end or a change of colour
            body += out[j][0]
            j += 1
        href = key[1]
        lead, core, trail = re.match(r"^(\s*)(.*?)(\s*)$", body, re.S).groups()
        host = re.sub(r"^https?://([^/]+).*$", r"\1", href)
        rel = "" if href.startswith(("#", "mailto:")) or host.endswith("gov.uk") else ' rel="external"'
        parts.append(f'{lead}<a{rel} href="{esc(href, quote=True)}">{core}</a>{trail}' if core else body)
        i = j
    s = "".join(parts)
    s = re.sub(r"</(strong|em|sup)>(\s*)<\1>", r"\2", s)       # neighbours in one style read as one
    return re.sub(r"[ \t ]{2,}", " ", s).strip()


def _note_numbers(run: str, notes) -> list[str] | None:
    """The footnote numbers in a raised run of digits: one ("4"), several apart ("33,34", "70 71 72"), or
    several run together ("178179180": numbers that follow one another). None when it is not all footnotes."""
    tokens = [t for t in re.split(r"[,\s]+", run) if t]
    if tokens and all(t in notes for t in tokens):
        return tokens
    if len(tokens) == 1:
        s = tokens[0]
        for width in range(1, min(4, len(s) - 1) + 1):
            n, at, found = int(s[:width]), 0, []
            while at < len(s) and s.startswith(str(n), at):
                found.append(str(n))
                at += len(str(n))
                n += 1
            if at == len(s) and len(found) > 1 and all(x in notes for x in found):
                return found
    return None


def _join(lines: list[Line]) -> list[Piece]:
    """A paragraph's lines as one run of pieces: a space between lines, none after a hyphen or a slash."""
    pieces: list[Piece] = []
    for i, l in enumerate(lines):
        if i and pieces:
            prev = "".join(p.text for p in pieces).rstrip()
            glue = "" if re.search(r"[A-Za-z0-9][-/]$", prev) and re.match(r"\s*[A-Za-z0-9]", l.text) else " "
            pieces[-1] = pieces[-1].but(pieces[-1].text.rstrip() + glue)
        pieces.extend(p.but(p.text) for p in l.pieces)
    return pieces


# ------------------------------------------------------------------------------------------ the extraction

def pdf_to_html(path) -> Extraction:
    """Extract a note's PDF. Raises NoTextLayer for a scanned PDF."""
    import pymupdf
    with pymupdf.open(path) as doc:
        return _extract(doc, pymupdf)


def _extract(doc, pymupdf) -> Extraction:
    warnings: list[str] = []
    read = [_page_lines(page, i, pymupdf) for i, page in enumerate(doc)]
    pages, runs = [r[0] for r in read], [r[1] for r in read]
    chars = sum(len(l.text.strip()) for lines in pages for l in lines)
    if chars < 40 * max(1, doc.page_count):
        raise NoTextLayer(f"{chars} characters of text on {doc.page_count} pages")

    # The size and typeface most of the text is set in are the body's; footnotes are smaller, headings larger.
    weight: dict[tuple, int] = {}
    for lines in pages:
        for l in lines:
            for p in l.pieces:
                key = (round(p.size, 1), _family(p.font))
                weight[key] = weight.get(key, 0) + len(p.text.strip())
    body_size, body_font = max(weight, key=weight.get)

    # Headings from the bookmarks: GOV.UK's web versions use h2 for the top level ("Assessment"), h3 for
    # numbered sections, h4 for their subsections.
    toc = [(lvl, title.strip(), pno - 1) for lvl, title, pno in doc.get_toc() if title.strip() and pno >= 1]
    wanted: dict[int, list] = {}
    for lvl, title, pno in toc:
        wanted.setdefault(pno, []).append([min(4, lvl + 1), title, _norm(title)])
    first_page = min((pno for _, _, pno in toc), default=None)
    if first_page is None:
        first_page = _first_body_page(pages)
        warnings.append("no bookmarks: headings found by type size and numbering")

    # Where lines end when they are full: the far edge reached by the body's lines (in a document too short
    # to show it, the left margin mirrored).
    edges = sorted(l.x1 for lines in pages[first_page:] for l in lines if abs(l.size - body_size) < 0.6 and len(l.text.strip()) > 40)
    text_right = edges[int(len(edges) * 0.995)] if len(edges) >= 40 else None

    used_ids: set[str] = set()
    blocks: list[dict] = []                 # in reading order: heading | para | item | table | figure | page-end
    footnotes: dict[str, list[Piece]] = {}
    heading_at: list[tuple] = []            # (page, y, id) for internal links
    images: dict[str, bytes] = {}
    last_fn = None
    para: list[Line] = []
    para_meta: dict = {}

    def flush():
        nonlocal para, para_meta
        if para:
            blocks.append({**para_meta, "lines": para})
        para, para_meta = [], {}

    # Reading starts at the cover, though the bookmarks begin later: GOV.UK's web version keeps what a cover
    # says under its title (a bulletin's reference and summary, a mission's dates), and the Preface that older
    # notes carry, with no bookmark, before the contents list.
    cover = _cover(pages[0] if pages else [])
    in_contents = False                                                 # the page before held part of the contents list
    version_lead = first_page > 0 and bool(cover["cover_version"])      # "Version 2.0, July 2026" opens the text
    for pno in range(0, doc.page_count):
        page = doc[pno]
        height, width = page.rect.height, page.rect.width
        lines = [l for l in pages[pno] if l.text.strip()]
        lines = [l for l in lines if not (PAGE_NO.match(l.text.strip()) and (l.y0 > height * 0.9 or l.y1 < height * 0.08))]
        lines = [l for l in lines if not BACK.match(l.text.strip())]
        lines, in_contents = _without_contents(lines, carried=in_contents)
        # The cover is read without its title (the page's own heading on GOV.UK), and nothing on it is taken
        # for a section heading. Its version and date are not repeated where they already open the text.
        on_cover = pno == 0 and (first_page > 0 or not toc) and any(l.size >= body_size * 1.8 for l in lines)
        if on_cover:
            lines = [l for l in lines if l.size < body_size * 1.5 and not (version_lead and COVER_DATE.match(l.text.strip()))]
        rule = _footnote_rule(page, lines, body_size)
        notes = [l for l in lines if rule is not None and l.y0 >= rule - 0.5]
        body = [l for l in lines if rule is None or l.y0 < rule - 0.5]

        # Footnotes: "12 Source, Title, date": a tiny number, then the note; later lines without one continue it.
        for l in notes:
            first = l.pieces[0]
            m = re.match(r"^\s*(\d{1,4})\s*$", first.text) if first.size < body_size * 0.7 else None
            rest = [p.but(p.text) for p in (l.pieces[1:] if m else l.pieces)]
            for p in rest:
                p.raised = False
            if m:
                last_fn = m.group(1)
                footnotes.setdefault(last_fn, [])
            if last_fn is None:
                continue
            if footnotes[last_fn]:
                footnotes[last_fn].append(Piece(" ", body_size, 0, ""))
            footnotes[last_fn].extend(rest)

        with contextlib.redirect_stdout(io.StringIO()):   # PyMuPDF advertises another package on first use
            try:
                tables = [] if on_cover else [t for t in page.find_tables().tables if _is_table(t) and not _is_chart(t, lines, body_font)]
            except Exception as error:                    # a page it cannot analyse is read as plain text
                tables = []
                warnings.append(f"page {pno + 1}: tables not analysed ({error})")
        table_boxes = [pymupdf.Rect(t.bbox) for t in tables]
        # The picture on a cover is the department's logo, which is not shown here: a cover gives text only.
        figure_boxes = [] if on_cover else _figure_boxes(page, body, table_boxes, body_font, pymupdf)
        placed: set = set()
        prev: Line | None = None
        prev_began_item = False
        todo = list(wanted.get(pno, []))
        left = min((l.x0 for l in body), default=72)
        right = text_right or width - left

        i = 0
        while i < len(body):
            l = body[i]
            for k, box in enumerate(figure_boxes):          # a picture above this line goes in before it
                if ("f", k) not in placed and box.y1 <= l.y0 + 2:
                    flush()
                    placed.add(("f", k))
                    blocks.append(_figure(page, box, images, pymupdf))
                    prev = None
            cx, cy = (l.x0 + l.x1) / 2, (l.y0 + l.y1) / 2
            t_hit = next((k for k, b in enumerate(table_boxes) if b.y0 - 1 <= cy <= b.y1 + 1 and b.x0 - 2 <= cx <= b.x1 + 2), None)
            f_hit = next((k for k, b in enumerate(figure_boxes) if b.y0 - 1 <= cy <= b.y1 + 1 and b.x0 - 2 <= cx <= b.x1 + 2), None) if t_hit is None else None
            if t_hit is not None or f_hit is not None:
                key = ("t", t_hit) if t_hit is not None else ("f", f_hit)
                if key not in placed:
                    flush()
                    placed.add(key)
                    if t_hit is not None:
                        blocks.append({"kind": "table", "rows": _cells(tables[t_hit], runs[pno]), "page": pno})
                    else:
                        blocks.append(_figure(page, figure_boxes[f_hit], images, pymupdf))
                    prev = None
                i += 1
                continue
            text = l.text.strip()
            # A heading: the next lines on this page that spell out a bookmark's title.
            hit = None
            for h in todo:
                got, n = _norm(text), 1
                while len(got) < len(h[2]) and i + n < len(body) and h[2].startswith(got) and n < 4:
                    got += _norm(body[i + n].text)
                    n += 1
                if got and got == h[2]:
                    hit = (h, n)
                    break
            if hit is None and not on_cover:
                # Not bookmarked (or no bookmarks at all): a short line in heading form that stands alone.
                nxt = body[i + 1] if i + 1 < len(body) else None
                alone = (prev is None or l.y0 - prev.y1 > 3) and (nxt is None or nxt.y0 - l.y1 > 3)   # clear space above and below
                level = _heading_level(l, body_size, left, bookmarked=bool(toc) and pno >= first_page) if alone else None
                if level:
                    hit = ([level, text, _norm(text)], 1)
            if hit:
                flush()
                h, n = hit
                if h in todo:
                    todo.remove(h)
                title = re.sub(r"\s+", " ", " ".join(x.text.strip() for x in body[i:i + n])).strip()
                hid = _slug(title, used_ids)
                heading_at.append((pno, l.y0, hid))
                blocks.append({"kind": "heading", "level": h[0], "text": title, "id": hid})
                prev = None
                i += n
                continue

            starts_number = " " in text and bool(PARA_NO.match(text.split(" ", 1)[0])) and l.x0 <= left + 4
            bullet = BULLET.match(l.text)
            gap = l.y0 - prev.y0 if prev is not None else 999
            if bullet and bullet.group(1) == "o" and not l.pieces[0].font.lower().startswith("courier"):
                # Word's hollow bullet is an "o" in Courier. In another typeface a lone "o" is taken for one only
                # where a list item could begin: after a gap, a colon or another item's first line, or set out to
                # the left of the line before, as a bullet is from its item's text (a wrapped line of Portuguese
                # can open with the word "o").
                if not (prev is None or prev_began_item or prev.text.rstrip().endswith(":") or l.x0 < prev.x0 - 4
                        or gap > max(prev.size, l.size) * 1.42 or gap < -1):
                    bullet = None
            if prev is None or starts_number or bullet or gap > max(prev.size, l.size) * 1.42 or gap < -1:
                flush()
                para_meta = {"kind": "item" if bullet else "para", "indent": round(l.x0), "right": right}
                if bullet:
                    cut, kept = len(bullet.group(0)), []
                    for p in l.pieces:                    # drop the bullet glyph and the space after it
                        take = min(cut, len(p.text))
                        cut -= take
                        if p.text[take:]:
                            kept.append(p.but(p.text[take:]))
                    l = Line(l.page, l.x0, l.y0, l.x1, l.y1, kept, l.first_word)
            if l.pieces:
                para.append(l)
            prev, prev_began_item = l, bool(bullet)
            i += 1
        flush()
        for k, box in enumerate(figure_boxes):            # pictures below the last line of the page's text
            if ("f", k) not in placed:
                blocks.append(_figure(page, box, images, pymupdf))
        for h in todo:
            warnings.append(f"page {pno + 1}: bookmark not found in the text: {h[1][:60]!r}")
        blocks.append({"kind": "page-end", "page": pno})

    blocks = _rejoin_over_pages(blocks)

    def heading_id(goto):
        pno, y = goto
        at = [(yy, hid) for p, yy, hid in heading_at if p == pno]
        if pno < 0 or not at:
            return None
        # A link's target counts from the bottom of the page in some files and the top in others: the nearest heading either way.
        height = doc[pno].rect.height
        return min(at, key=lambda h: min(abs(h[0] - y), abs(h[0] - (height - y))))[1]

    lead = ""
    if version_lead:                                            # GOV.UK's web versions open with this line
        lead = f'<p>Version {cover["cover_version"]}{", " + cover["cover_date"] if cover["cover_date"] else ""}</p>'
    html = _render(blocks, footnotes, heading_id, warnings, lead)
    meta = {
        "extractor": EXTRACTOR, "pages": doc.page_count, "body_size": body_size, "body_font": body_font,
        "headings": sum(1 for b in blocks if b["kind"] == "heading"),
        "paragraphs": sum(1 for b in blocks if b["kind"] == "para"),
        "list_items": sum(1 for b in blocks if b["kind"] == "item"),
        "tables": sum(1 for b in blocks if b["kind"] == "table"),
        "figures": sum(1 for b in blocks if b["kind"] == "figure"),
        "footnotes": len(footnotes), "bookmarks": len(toc), "warnings": warnings,
        "figure_pages": {b["src"][len(IMAGE_SRC):]: b["page"] + 1 for b in blocks if b["kind"] == "figure"},
        "figure_sizes": {b["src"][len(IMAGE_SRC):]: b["px"] for b in blocks if b["kind"] == "figure"},    # pixels, at 144 dpi
        "figure_text": {b["src"][len(IMAGE_SRC):]: b["chars"] for b in blocks if b["kind"] == "figure"},  # characters of text in it
        "first_bookmark_page": first_page + 1 if toc else None,
        **cover,
    }
    return Extraction(html, meta, images)


def _is_table(t) -> bool:
    """A real table: at least two rows and columns, with text in more than one column of most rows; or one
    with shaded cells, which the finder cuts into a row for every line of text (see `_shaded`)."""
    if t.row_count < 2 or t.col_count < 2:
        return False
    filled = [sum(1 for c in row if (c or "").strip()) for row in t.extract()]
    return _mostly_full(filled) or _shaded(filled, t.col_count)


def _mostly_full(filled: list[int]) -> bool:
    return sum(1 for n in filled if n >= 2) >= max(2, len(filled) // 2)


def _shaded(filled: list[int], cols: int) -> bool:
    """A table whose cells are shaded line by line: each strip of shading reads as a row boundary, so a few
    rows are filled across and the rest hold one cell's next line. filled: the cells with text in each row."""
    return cols >= 3 and not _mostly_full(filled) and sum(1 for n in filled if n >= 3) >= 2


def _is_chart(t, lines: list[Line], body_font: str) -> bool:
    """A chart whose gridlines the table finder took for a table: its lettering is in another typeface (the
    Home Office's charts come from Excel), where a real table is set in the body's. It is then a figure."""
    x0, y0, x1, y1 = t.bbox
    inside = [l for l in lines if x0 - 1 <= (l.x0 + l.x1) / 2 <= x1 + 1 and y0 - 1 <= (l.y0 + l.y1) / 2 <= y1 + 1]
    total = sum(len(l.text.strip()) for l in inside)
    other = sum(len(l.text.strip()) for l in inside if _family(l.font) != body_font)
    return total > 0 and other / total > 0.6


def _cells(table, lines: list[Line]) -> list[list]:
    """A table's cells as runs of pieces (so their links and footnote marks survive), row by row."""
    rows = []
    for row in table.rows:
        cells = []
        for box in row.cells:
            if box is None:                              # a cell merged into its neighbour
                cells.append([])
                continue
            x0, y0, x1, y1 = box
            inside = [l for l in lines if x0 - 1 <= (l.x0 + l.x1) / 2 <= x1 + 1 and y0 - 1 <= (l.y0 + l.y1) / 2 <= y1 + 1]
            cells.append(_join(sorted(inside, key=lambda l: (l.y0, l.x0))))
        rows.append(cells)
    has = lambda cell: any(p.text.strip() for p in cell)
    if rows and _shaded([sum(1 for c in row if has(c)) for row in rows], len(rows[0])):
        rows = _regroup(rows, has)
    return rows


def _regroup(rows: list[list], has) -> list[list]:
    """A shaded table's rows put back together (see `_shaded`): a row holding only one cell's next line goes
    back into that cell of the row above; then a column that never has text beside its left neighbour's (the
    same column, split by the shading's edges) is folded into it."""
    out: list[list] = []
    for row in rows:
        at = [j for j, c in enumerate(row) if has(c)]
        if out and len(at) == 1 and at[0] > 0:
            above = out[-1][at[0]]
            if has(above):
                above.append(Piece(" ", above[-1].size, 0, above[-1].font))
            above.extend(row[at[0]])
        elif at:
            out.append([list(c) for c in row])
    j = 1
    while out and j < len(out[0]):
        if not any(has(r[j]) and has(r[j - 1]) for r in out):
            for r in out:
                r[j - 1] = r[j - 1] if has(r[j - 1]) else r[j]
                del r[j]
        else:
            j += 1
    return out


def _figure(page, box, images: dict, pymupdf) -> dict:
    """A picture or chart, rendered from the page (so a drawn chart and its lettering stay together): a PNG,
    which keeps a chart's flat colours and lettering exact; a photograph or shaded map, several times the
    size as a PNG, is kept as a JPEG instead."""
    clip = (box + (-4, -4, 4, 4)) & page.rect
    pix = page.get_pixmap(clip=clip, dpi=144, alpha=False)
    data, ext = pix.tobytes("png"), "png"
    if len(data) > JPEG_OVER:
        jpeg = pix.tobytes("jpg", jpg_quality=82)
        if len(jpeg) < len(data) * 0.6:
            data, ext = jpeg, "jpg"
    name = f"{hashlib.sha256(data).hexdigest()}.{ext}"
    images[name] = data
    lettering = sum(len(w[4]) for w in page.get_text("words", clip=clip))       # characters of real text inside it
    return {"kind": "figure", "src": IMAGE_SRC + name, "page": page.number, "px": [pix.width, pix.height], "chars": lettering}


def _without_contents(lines: list[Line], carried: bool = False) -> tuple[list[Line], bool]:
    """A page's lines less its contents list, and whether it had one: everything from the "Contents" title (or
    the first entry) down to the last entry, so an entry that runs over two lines goes whole. An entry ends
    in leader dots and a page number; three on a page make it a contents list, or one where the list carries
    on from the page before (carried). An entry's first line, when it runs over, sits close above its second."""
    entries = [l for l in lines if CONTENTS_LINE.search(l.text)]
    if len(entries) < (1 if carried else 3):
        return lines, False
    title = next((l for l in lines if l.text.strip().lower() == "contents"), None)
    top = min(title.y0 if title else entries[0].y0, min(l.y0 for l in entries))
    for l in sorted((l for l in lines if l.y1 <= top + 1), key=lambda l: -l.y0):      # upwards from the first entry
        if top - l.y1 < (l.y1 - l.y0) * 0.6 and not ENDS.search(l.text.strip()):
            top = l.y0
        else:
            break
    bottom = max(l.y1 for l in entries)
    kept = [l for l in lines if not top - 1 <= (l.y0 + l.y1) / 2 <= bottom + 1]
    for l in kept:                               # a second, stray title that a text box overprints: read as part of its line
        if len(l.pieces) > 1 and any(p.text.strip().lower() == "contents" for p in l.pieces):
            l.pieces = [p for p in l.pieces if p.text.strip().lower() != "contents"]
    return kept, True


def _first_body_page(pages) -> int:
    """Without bookmarks (a short bulletin, an old note): the first page. Its cover carries text GOV.UK's web
    version keeps (reference, date, summary) under a title it does not, and any contents list is dropped
    line by line where it is met."""
    return 0


def _heading_level(l: Line, body_size: float, left: float, *, bookmarked: bool = False) -> int | None:
    """A heading the bookmarks do not name: large type is a top heading; a short bold numbered line a
    section; a short line with two-part numbering ("2.1 Background") a subsection. With bookmarks present
    only numbered lines are taken (the bookmarks already name the rest)."""
    text = l.text.strip()
    if len(text) > 120 or text.endswith((".", ":", ";", ",")) or not re.search(r"[A-Za-z]{3}", text):
        return None
    bold = all(p.flags & BOLD for p in l.pieces if p.text.strip())
    m = SECTION_NO.match(text)
    if m and l.x0 <= left + 4:
        depth = m.group(1).count(".")
        if depth == 0 and bold and re.match(r"^\d{1,3}\.\s", text):
            return 3
        if depth == 1 and len(text) < 90:
            return 4
        return None
    if bookmarked:
        return None
    if l.size >= body_size * 1.5:
        return 2
    if bold and len(text) < 90:                       # a short line all in bold, on its own
        return 3
    return None


def _rejoin_over_pages(blocks: list[dict]) -> list[dict]:
    """A paragraph or list item cut by a page end is one paragraph: when the next page opens with text that
    has no number or bullet of its own and the line before was full (the next page's first word would not
    have fitted on it; Word only breaks a line when it must), unless the text before had plainly ended (a
    full stop) and the next page starts a new sentence."""
    out: list[dict] = []
    i = 0
    while i < len(blocks):
        b = blocks[i]
        if b["kind"] != "page-end":
            out.append(b)
            i += 1
            continue
        prev = out[-1] if out else None
        nxt = blocks[i + 1] if i + 1 < len(blocks) else None
        if prev and nxt and prev["kind"] in ("para", "item") and nxt["kind"] == "para":
            last, first = prev["lines"][-1], nxt["lines"][0]
            word = first.text.strip().split(" ", 1)[0]
            full = prev["right"] - last.x1 < first.first_word + 3
            ended = bool(ENDS.search(re.sub(r"\d{1,4}\s*$", "", last.text.strip()).strip()))
            lower = bool(re.match(r"[a-z(]", word))
            if not PARA_NO.match(word) and full and not (ended and not lower):
                prev["lines"] = prev["lines"] + nxt["lines"]
                i += 2
                continue
        i += 1
    return out


def _list_html(items: list[tuple]) -> str:
    """Bulleted items [(indent, html)] as a list; an item set further in opens a list inside the one above."""
    out, depth = [], []
    for indent, inner in items:
        if not depth:
            out.append("<ul>")
            depth.append(indent)
        elif indent > depth[-1] + 6:
            out[-1] = out[-1].removesuffix("</li>")
            out.append("<ul>")
            depth.append(indent)
        else:
            while len(depth) > 1 and indent < depth[-1] - 6:
                depth.pop()
                out.append("</ul>\n</li>")
        out.append(f"<li>{inner}</li>")
    while len(depth) > 1:
        depth.pop()
        out.append("</ul>\n</li>")
    out.append("</ul>")
    return "\n".join(out)


def _render(blocks, footnotes, heading_id, warnings, lead: str = "") -> str:
    notes = frozenset(footnotes)
    marked: set[str] = set()
    parts: list[str] = [lead] if lead else []
    items: list[tuple] = []               # the bulleted items of the list being gathered
    in_box = False

    def close_list():
        if items:
            parts.append(_list_html(items))
            items.clear()

    for b in blocks:
        kind = b["kind"]
        if kind != "item":
            close_list()
        if kind == "heading":
            if in_box:
                parts.append("</div>")
                in_box = False
            parts.append(f'<h{b["level"]} id="{b["id"]}">{esc(b["text"])}</h{b["level"]}>')
        elif kind == "para":
            inner = _inline(_join(b["lines"]), heading_id=heading_id, notes=notes, marked=marked)
            plain = re.sub(r"<[^>]+>", "", inner)
            if not plain.strip():
                continue
            if REDACT_START.search(plain) and not in_box:
                parts.append('<div class="call-to-action">')
                in_box = True
            parts.append(f"<p>{inner}</p>")
            if REDACT_END.search(plain) and in_box:
                parts.append("</div>")
                in_box = False
        elif kind == "item":
            items.append((b["indent"], _inline(_join(b["lines"]), heading_id=heading_id, notes=notes, marked=marked)))
        elif kind == "table":
            rows = [[_inline(c, heading_id=heading_id, notes=notes, marked=marked) for c in row] for row in b["rows"]]
            rows = [r for r in rows if any(r)]
            if rows:
                head, *rest = rows
                head = [re.sub(r"</?strong>", "", c) for c in head]          # a header cell is bold by being one
                parts.append("<table>\n<thead>\n<tr>" + "".join(f'<th scope="col">{c}</th>' for c in head) + "</tr>\n</thead>\n<tbody>"
                             + "".join("\n<tr>" + "".join(f"<td>{c}</td>" for c in r) + "</tr>" for r in rest) + "\n</tbody>\n</table>")
        elif kind == "figure":
            parts.append(f'<figure class="image embedded"><div class="img"><img src="{b["src"]}" alt=""></div></figure>')
    close_list()
    if in_box:
        parts.append("</div>")
    body = "\n\n".join(parts)             # one block per paragraph with a blank line between, as GOV.UK writes them

    if footnotes:
        listed = []
        for n in sorted(footnotes, key=int):
            inner = _inline(footnotes[n], heading_id=heading_id)
            listed.append(f'<li id="fn:{n}">\n<p>{inner} <a href="#fnref:{n}" class="reversefootnote" role="doc-backlink" aria-label="go to where this is referenced">↩</a></p>\n</li>')
        unused = sorted(notes - marked, key=int)
        if unused:
            warnings.append(f"footnotes with no mark found in the text: {', '.join(unused[:12])}{'…' if len(unused) > 12 else ''}")
        body += '\n\n<div class="footnotes" role="doc-endnotes">\n<ol>\n' + "\n".join(listed) + "\n</ol>\n</div>"
    return f'<div class="govspeak">{body}\n</div>'


def _cover(lines: list[Line]) -> dict:
    """What the cover says: the title, the version and the month."""
    text = " ".join(l.text.strip() for l in lines if l.text.strip())
    version = re.search(r"\bversion\s+(\d+\.\d+)", text, re.I)
    month = re.search(r"(?:(?<![\d.])(\d{1,2})\s+)?\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(20\d\d)\b", text)
    big = [l.text.strip() for l in lines if l.text.strip() and l.size >= 16]
    return {"cover_title": re.sub(r"\s+", " ", " ".join(big)).strip() or None,
            "cover_version": version.group(1) if version else None,
            "cover_date": f"{month.group(1) + ' ' if month.group(1) else ''}{month.group(2)} {month.group(3)}" if month else None}


# ---------------------------------------------------------------- how good is it? (pairs with a web version)

def block_texts(body_html: str) -> list[str]:
    """The text of each block of a note body (paragraph, list item, heading, table cell), reduced to its
    letters and digits; footnote marks, back-links and pictures left out."""
    from lxml import html as lxml_html
    root = lxml_html.fragment_fromstring(body_html, create_parent="div")
    for el in root.xpath('.//sup[starts-with(@id, "fnref")] | .//a[contains(@class, "reversefootnote")]'):
        el.drop_tree()
    out = []
    for el in root.iter("p", "li", "h2", "h3", "h4", "h5", "td", "th"):
        if el.tag == "li":
            if el.xpath("./p"):
                continue
            text = (el.text or "") + "".join(c.text_content() + (c.tail or "") if c.tag not in ("ul", "ol") else (c.tail or "") for c in el)
        else:
            text = el.text_content()
        key = _norm(text)
        if key:
            out.append(key)
    return out


def _words(body_html: str) -> list[str]:
    from lxml import html as lxml_html
    root = lxml_html.fragment_fromstring(body_html, create_parent="div")
    for el in root.xpath('.//sup[starts-with(@id, "fnref")] | .//a[contains(@class, "reversefootnote")] | .//table | .//figure'):
        el.drop_tree()
    return re.findall(r"[a-z0-9]+", root.text_content().lower())


def check(extracted_html: str, web_html: str) -> dict:
    """How closely an extraction matches GOV.UK's web version of the same edition. Tables and figures are
    left out of the wording comparison (GOV.UK often gives a chart's numbers as a table the PDF does not have)."""
    ours, theirs = block_texts(extracted_html), block_texts(web_html)
    have, want = set(ours), set(theirs)
    a, b = _words(extracted_html), _words(web_html)
    grams = lambda w: {" ".join(w[i:i + 5]) for i in range(max(0, len(w) - 4))}
    ga, gb = grams(a), grams(b)
    count = lambda html, pattern: len(re.findall(pattern, html))
    return {
        "words": (len(a), len(b)),
        "web_wording_found": round(len(ga & gb) / max(1, len(gb)), 4),          # of the web version's five-word phrases
        "extracted_wording_in_web": round(len(ga & gb) / max(1, len(ga)), 4),
        "web_blocks_found": round(sum(1 for t in theirs if t in have) / max(1, len(theirs)), 4),
        "extracted_blocks_in_web": round(sum(1 for t in ours if t in want) / max(1, len(ours)), 4),
        "headings": (count(extracted_html, r"<h[2-4]\b"), count(web_html, r"<h[2-4]\b")),
        "footnotes": (count(extracted_html, r'<li id="fn:'), count(web_html, r'<li id="fn:')),
        "list_items": (count(extracted_html, r"<li>"), count(web_html, r"<li>")),
        "tables": (count(extracted_html, r"<table"), count(web_html, r"<table")),
        "figures": (count(extracted_html, r"<figure"), count(web_html, r"<figure")),
    }


# ---------------------------------------------------------------- pictures the web version leaves out
# GOV.UK's web version of a note often drops pictures that its PDF has (the text still says "the map
# below"). Comparing the two finds them, and where each belongs in the web version: after which paragraph.

def _sequence(body_html: str) -> list[tuple]:
    """A body's blocks in reading order: ("figure", image name) for a picture, and (tag, n, key) for a
    paragraph, list item or heading: the n-th element of that tag in the body, with its text reduced to
    letters and digits (footnote marks left out). Text inside a table is not used to place anything."""
    from lxml import html as lxml_html
    root = lxml_html.fragment_fromstring(body_html, create_parent="div")
    seq, counts = [], {}
    for el in root.iter():
        if not isinstance(el.tag, str):
            continue
        tag = el.tag
        if tag == "figure":
            src = next((i.get("src") or "" for i in el.iter("img")), "")
            seq.append(("figure", src[len(IMAGE_SRC):] if src.startswith(IMAGE_SRC) else src))
            continue
        if tag not in ("p", "li", "h2", "h3", "h4", "h5"):
            continue
        n = counts.get(tag, 0)
        counts[tag] = n + 1
        if el.xpath("ancestor::table | ancestor::figure | ancestor::*[contains(@class, 'footnotes')]") or (tag == "li" and el.xpath("./p")):
            continue
        text = "".join(el.xpath("./text() | .//*[not(self::sup[starts-with(@id, 'fnref')]) and not(ancestor::sup[starts-with(@id, 'fnref')]) and not(self::ul) and not(self::ol) and not(ancestor::ul) and not(ancestor::ol)]/text()")) if tag == "li" else None
        if text is None:
            clone = lxml_html.fragment_fromstring(lxml_html.tostring(el, encoding="unicode", with_tail=False), create_parent="div")
            for mark in clone.xpath('.//sup[starts-with(@id, "fnref")]'):
                mark.drop_tree()
            text = clone.text_content()
        key = _norm(text)
        if key:
            seq.append((tag, n, key[:120]))
    return seq


def figures_missing_from_web(extracted_html: str, web_html: str) -> dict:
    """The PDF's pictures that the web version does not have, each with the web version's block it follows.

    The two bodies' blocks are aligned by their text (difflib: a block that repeats, such as the notice in a
    redacted section, cannot pull the alignment off course). Between two aligned blocks the PDF may have more
    pictures than the web version: the extra ones (the later ones) are the missing ones, and they belong after
    the first of the two blocks, or after the web block that opens like the paragraph introducing the picture
    in the PDF, when there is one between them. A web picture with no PDF picture beside it is taken to be one of the PDF's
    set in another place, so the nearest "missing" picture is not missing: the number returned is never more
    than the PDF's surplus. A picture before any aligned block cannot be placed and is only counted.
    Returns { figures: [{ image, tag, index, key }], unplaced, pdf_figures, web_figures }."""
    import difflib
    ext, web = _sequence(extracted_html), _sequence(web_html)
    et = [i for i, b in enumerate(ext) if b[0] != "figure"]
    wt = [i for i, b in enumerate(web) if b[0] != "figure"]
    matcher = difflib.SequenceMatcher(None, [ext[i][2] for i in et], [web[i][2] for i in wt], autojunk=False)
    same = [(et[a + n], wt[b + n]) for a, b, size in matcher.get_matching_blocks() for n in range(size)]
    missing, spare, unplaced = [], [], 0                     # (place in the web version, image); places of web pictures unaccounted for

    def introduced_by(at: int, e0: int, w0: int, w1: int):
        """Between two aligned blocks: the web block that opens like the PDF block just before the picture (the
        paragraph that introduces it, which the web version often words a little differently at its end)."""
        for i in range(at - 1, e0, -1):
            if ext[i][0] == "figure":
                continue
            key = ext[i][2]
            for j in range(w1 - 1, w0, -1):
                if web[j][0] != "figure" and len(os.path.commonprefix([key, web[j][2]])) >= min(30, len(key), len(web[j][2])):
                    return j
            return None                                      # only the block nearest the picture is tried

    for (e0, w0), (e1, w1) in zip([(-1, -1), *same], [*same, (len(ext), len(web))]):
        pdf = [i for i in range(e0 + 1, e1) if ext[i][0] == "figure"]
        have = sum(1 for i in range(w0 + 1, w1) if web[i][0] == "figure")
        after = w0
        for i in pdf[have:]:
            found = introduced_by(i, e0, w0, w1)
            after = max(after, found if found is not None else w0)       # in the PDF's order, never back before an earlier one
            if after < 0:
                unplaced += 1
            else:
                missing.append((after, ext[i][1]))
        spare += [max(w0, 0)] * max(0, have - len(pdf))
    for at in spare:                                         # the web version's picture, set a little earlier or later
        if missing:
            del missing[min(range(len(missing)), key=lambda k: abs(missing[k][0] - at))]
        elif unplaced:
            unplaced -= 1
    return {"figures": [{"image": image, "tag": web[w][0], "index": web[w][1], "key": web[w][2][:60]} for w, image in missing],
            "unplaced": unplaced,
            "pdf_figures": sum(1 for b in ext if b[0] == "figure"), "web_figures": sum(1 for b in web if b[0] == "figure")}


# ---------------------------------------------------------------- in the store: data/pdfs/text/
# The extraction of a PDF is derived data, kept beside the PDFs and (unlike them) committed, so the site
# can be built without the PDFs to hand:
#   data/pdfs/text/<pdf sha256>.html     the extracted body
#   data/pdfs/text/<pdf sha256>.json     what was found (pages, headings, footnotes, warnings, cover)
#   data/pdfs/text/images/<sha256>.png   its figures, rendered from the pages (.jpg for photographs)

def text_dir(store):
    return store.root / "pdfs" / "text"


def load_text(store, sha256: str):
    """(html, meta) for a PDF already extracted, else None."""
    import json
    html_path, meta_path = text_dir(store) / f"{sha256}.html", text_dir(store) / f"{sha256}.json"
    if not (html_path.exists() and meta_path.exists()):
        return None
    return html_path.read_text("utf-8"), json.loads(meta_path.read_text("utf-8"))


def extract_into_store(store, sha256: str, *, force: bool = False) -> dict | None:
    """Extract one mirrored PDF into the store. Returns what was found; None when the PDF is not on this
    disk. Already extracted by this version of the extractor: left as it is."""
    import json
    held = load_text(store, sha256)
    if held and held[1].get("extractor") == EXTRACTOR and not force:
        return held[1]
    path = store.pdf_path(sha256)
    if not path.exists():
        return held[1] if held else None
    try:
        result = pdf_to_html(path)
    except NoTextLayer as error:
        meta = {"extractor": EXTRACTOR, "no_text_layer": str(error)}
        text_dir(store).mkdir(parents=True, exist_ok=True)
        (text_dir(store) / f"{sha256}.json").write_text(json.dumps(meta, indent=1) + "\n", "utf-8")
        return meta
    out = text_dir(store)
    (out / "images").mkdir(parents=True, exist_ok=True)
    for name, data in result.images.items():
        (out / "images" / name).write_bytes(data)
    (out / f"{sha256}.html").write_text(result.html, "utf-8")
    meta = {**result.meta, "pdf_sha256": sha256, "images": sorted(result.images)}
    (out / f"{sha256}.json").write_text(json.dumps(meta, indent=1, ensure_ascii=False) + "\n", "utf-8")
    return meta


def figures_path(store, sha256: str):
    return store.root / "pdfs" / "figures" / f"{sha256}.json"


def load_figures(store, sha256: str) -> dict | None:
    import json
    path = figures_path(store, sha256)
    return json.loads(path.read_text("utf-8")) if path.exists() else None


def _figures_one(job):
    """(label, pdf path, pdf sha, web body, web body sha) -> what the web version lacks, with the images, for the pool."""
    label, path, pdf_sha, web, body_sha = job
    try:
        result = pdf_to_html(path)
        found = figures_missing_from_web(result.html, web)
        meta = result.meta
        pages, sizes, text = meta.get("figure_pages", {}), meta.get("figure_sizes", {}), meta.get("figure_text", {})
        front = meta.get("first_bookmark_page") or 0                    # before the first bookmark: the funder's emblem
        why = lambda f: ("small" if min(sizes.get(f["image"]) or [SMALL_MARK]) < SMALL_MARK else
                         "wordy" if text.get(f["image"], 0) > WORDY else
                         "front" if pages.get(f["image"], front) < front else None)
        found["left_in_pdf"] = {k: n for k in ("small", "wordy", "front") if (n := sum(1 for f in found["figures"] if why(f) == k))}
        found["figures"] = [f for f in found["figures"] if not why(f)]
        for f in found["figures"]:
            f["page"] = pages.get(f["image"])
        wanted = {f["image"] for f in found["figures"]}
        return label, {"extractor": EXTRACTOR, "note": label, "pdf_sha256": pdf_sha, "body_sha256": body_sha, **found}, {n: d for n, d in result.images.items() if n in wanted}
    except Exception as error:                               # one bad file must not stop the rest
        return label, {"error": f"{type(error).__name__}: {error}"}, {}


def missing_figures_into_store(store, jobs: list, workers: int = 4, log=lambda *a: None, force: bool = False) -> dict:
    """For each PDF with a web version beside it, work out which of its pictures the web version leaves out and
    keep them: data/pdfs/figures/<pdf sha256>.json (which picture goes after which block of the web body) and
    the pictures themselves beside the other extracted ones. jobs: [(label, pdf path, pdf sha, web body, body sha)].
    One already done for the same web body by this extractor is left as it is (unless force). Not carried
    over: a picture too small to be a map or chart (a logo, a stamp, a signature), one that is mostly text (a
    table drawn with shading), and one before the first bookmark (a funder's emblem). `left_in_pdf` counts them."""
    import json
    from multiprocessing import Pool
    todo = []
    for job in jobs:
        held = load_figures(store, job[2])
        if force or not (held and held.get("extractor") == EXTRACTOR and held.get("body_sha256") == job[4]):
            todo.append(job)
    images = text_dir(store) / "images"
    images.mkdir(parents=True, exist_ok=True)
    figures_path(store, "x").parent.mkdir(parents=True, exist_ok=True)
    summary = {"pairs": len(jobs), "done_before": len(jobs) - len(todo), "figures": 0, "unplaced": 0, "errors": 0}
    with Pool(workers) as pool:
        for label, found, pics in pool.imap_unordered(_figures_one, todo, chunksize=1):
            if "error" in found:
                summary["errors"] += 1
                log(f"  {label}: {found['error']}")
                continue
            for name, data in pics.items():
                (images / name).write_bytes(data)
            figures_path(store, found["pdf_sha256"]).write_text(json.dumps(found, indent=1, ensure_ascii=False) + "\n", "utf-8")
            if found["figures"] or found["unplaced"]:
                log(f"  {label}: {len(found['figures'])} pictures the web version leaves out"
                    f"{' (' + str(found['unplaced']) + ' more could not be placed)' if found['unplaced'] else ''}")
    for job in jobs:
        held = load_figures(store, job[2]) or {}
        summary["figures"] += len(held.get("figures", []))
        summary["unplaced"] += held.get("unplaced", 0)
    return summary


def contact_sheets(store, out_dir, columns: int = 6, rows: int = 5) -> list:
    """Every picture carried over to a web edition, small, on numbered sheets (PNG files in out_dir), each
    labelled with its note and page: for looking over after the extractor or its rules change. What must not
    be there: a logo, a signature, a stamp, a piece of a table. Returns the sheets' paths."""
    import json
    from pathlib import Path

    import pymupdf
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    for old in out.glob("sheet-*.png"):
        old.unlink()
    items = []
    for path in sorted((store.root / "pdfs" / "figures").glob("*.json")):
        held = json.loads(path.read_text("utf-8"))
        items += [(held.get("note") or held["pdf_sha256"][:8], f.get("page"), f["image"]) for f in held.get("figures", [])]
    items.sort()
    cell_w, cell_h, sheets = 300, 232, []
    for start in range(0, len(items), columns * rows):
        doc = pymupdf.open()
        page = doc.new_page(width=cell_w * columns, height=cell_h * rows)
        for k, (note, pno, image) in enumerate(items[start:start + columns * rows]):
            x, y = (k % columns) * cell_w, (k // columns) * cell_h
            page.draw_rect(pymupdf.Rect(x, y, x + cell_w, y + cell_h), color=(0.75, 0.75, 0.75), width=0.5)
            page.insert_text((x + 4, y + 10), f"#{start + k + 1}  p{pno}  {note[:58]}", fontsize=6.5)
            page.insert_text((x + 4, y + 19), note[58:124], fontsize=6.5)
            source = text_dir(store) / "images" / image
            if source.exists():
                page.insert_image(pymupdf.Rect(x + 4, y + 24, x + cell_w - 4, y + cell_h - 4), filename=str(source), keep_proportion=True)
            else:
                page.insert_text((x + 4, y + 60), "picture file missing", fontsize=9, color=(0.8, 0, 0))
        target = out / f"sheet-{start // (columns * rows) + 1:02d}.png"
        page.get_pixmap(dpi=96, alpha=False).save(target)
        sheets.append(target)
        doc.close()
    return sheets


def _check_one(job):
    """(label, pdf path, web body) -> the comparison, for the pool."""
    label, path, web = job
    try:
        result = pdf_to_html(path)
        return label, {**check(result.html, web), "pages": result.meta["pages"], "warnings": len(result.meta["warnings"]),
                       "bookmarks": result.meta["bookmarks"]}
    except Exception as error:                               # one bad file must not stop the survey
        return label, {"error": f"{type(error).__name__}: {error}"}


def check_pairs(jobs: list, workers: int = 6) -> dict:
    """Extract every PDF that has a web version beside it and compare the two. jobs: [(label, pdf path, web body)]."""
    from multiprocessing import Pool
    with Pool(workers) as pool:
        return dict(pool.imap_unordered(_check_one, jobs, chunksize=2))
