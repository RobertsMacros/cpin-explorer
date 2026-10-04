"""The web version of a note against its PDF: where the two publications really differ.

The Home Office publishes each edition twice, as a web page and as a PDF. They are meant to be the same
text. They are not always: the web page loses the end of a sentence, repeats a run of paragraphs, numbers
its paragraphs differently, or still carries the previous edition's wording under the new version number.
This module finds those places and says what kind each is (docs/methods/pdf-and-web.md, rules 1 to 3).

The method, worked out and checked by hand in docs/reviews/2026-10-03-pdf-vs-web.md:

  1  every word of the web body is lined up with every word of the extraction of the PDF (pdftext.py):
     paragraphs, headings, list items, table cells, captions, footnotes;
  2  each place where they differ is looked up in the PDF's own raw text, read three ways. If the raw
     text has the web's wording there, the difference is ours (an extraction artefact). Only when the raw
     text confirms the extraction's wording is the difference recorded as real;
  3  each real difference is given a kind, so that words the web adds for a picture, a paragraph number,
     or the notice on a withheld section are never counted as a difference of wording.

Nothing here is reported from the extraction alone, and no LLM is involved (AGENTS.md rule 1). `compare`
is pure: it is handed the two bodies and the PDF's raw record. `read_pdf` makes that record from a file;
`compare_into_store` keeps one result per pair in data/pdfs/compare/; `summarise` makes the standard table.
"""
import bisect
import difflib
import re
import shutil
import subprocess
import unicodedata
from collections import Counter

METHOD = "webpdf-8"              # bump when the result for the same inputs would change

CONTEXT = 8                      # words kept on each side of a difference, to find it again in the raw text
LISTED = 80                      # real differences listed per record (all are counted)
LISTED_OURS = 12                 # extraction artefacts listed per record, as examples for mending the extractor
QUOTED = 1200                    # characters of each side's words kept in a listed difference: most paragraphs, whole
QUOTED_ROUND = 90                # characters kept of the shared words before and after a listed difference
FLAG_SHARE = 0.005               # a note whose wording differs by this share of its words is named
PASSAGE = 4                      # a difference of this many words is a passage, not a slip
LABEL = 12                       # a one-sided difference no longer than this, met three times over in a note, is a label

# ------------------------------------------------------------------------------------------- words

_SOFT = dict.fromkeys(map(ord, "\u00ad\u200b\u200c\u200d\u2060\ufeff"), None)
_WORD = re.compile(r"[^\W_]+", re.UNICODE)


def _nfkc(text: str) -> str:
    return unicodedata.normalize("NFKC", text.translate(_SOFT))


def words(text: str) -> list[str]:
    """The words and numbers of a text, lower-cased: ligatures split, soft hyphens gone, and every kind of
    quotation mark, dash and space ignored, since GOV.UK changes those and the wording is what is compared."""
    return [w.lower() for w in _WORD.findall(_nfkc(text))]


def _words_with_gaps(text: str) -> list[list]:
    """[[word as written, lower-cased word, what follows it up to the next word]]."""
    text = _nfkc(text)
    out, last = [], 0
    for m in _WORD.finditer(text):
        if out:
            out[-1][2] = text[last:m.start()]
        out.append([m.group(0), m.group(0).lower(), ""])
        last = m.end()
    if out:
        out[-1][2] = text[last:]
    return out


# ------------------------------------------------------------------------------------------- blocks

_BLOCK_TAGS = {"p", "li", "h1", "h2", "h3", "h4", "h5", "h6", "td", "th", "figcaption", "caption", "dt", "dd",
               "blockquote", "address", "pre", "summary", "div", "section", "figure", "ul", "ol", "table", "tr",
               "thead", "tbody"}
_HEADINGS = ("h2", "h3", "h4", "h5", "h6")
PARA_NO = re.compile(r"^\s*(\d{1,3}(?:\.\d{1,3}){1,4})\.?(?=\s|$|[A-Za-z(‘'“\"])")
_SECTION_NO = re.compile(r"^\s*(\d{1,3})\.?\s+(?=[A-Z])")


def blocks(body_html: str) -> tuple[list[dict], list[dict]]:
    """A note body (GOV.UK's, or an extraction shaped like it) as blocks in reading order, and its pictures.

    Every piece of text belongs to exactly one block: its nearest block-level ancestor. So nothing is
    missed (a caption, an address, text set straight in a div), which a list of tags to look in would risk.
    Footnote marks and the "↩" back-links are not text; the marks are kept beside the block they sit in.
    A block: kind (its tag), text, fn (the footnote it belongs to), table / row (if a cell), box (inside a
    withheld-section box), figure, depth and ordered (if a list item), marks, id; then, added here, lead (its
    paragraph number), para (the nearest paragraph number at or before it), head and head_id (the nearest
    heading before it), section (the nearest h2)."""
    from lxml import html as lxml_html
    root = lxml_html.fragment_fromstring(body_html, create_parent="div")
    for tag in ("table", "tr"):                           # numbered in the tree itself: this parse is ours alone
        for k, el in enumerate(root.iter(tag)):
            el.set("data-n", str(k))
    found, pictures = [], []
    current = [None]

    def setting(el) -> dict:
        c = {"kind": el.tag, "fn": None, "table": None, "row": None, "box": False, "figure": False, "depth": 0, "ordered": False}
        node, nearest_list = el, True
        while node is not None:
            tag, cls = node.tag, node.get("class") or ""
            if tag in ("ul", "ol"):
                c["depth"] += 1
                if nearest_list:
                    c["ordered"], nearest_list = tag == "ol", False
            elif tag == "li" and (node.get("id") or "").startswith("fn:"):
                c["fn"] = node.get("id")[3:]
            elif tag == "tr" and c["row"] is None:
                c["row"] = int(node.get("data-n"))
            elif tag == "table" and c["table"] is None:
                c["table"] = int(node.get("data-n"))
            elif tag == "figure":
                c["figure"] = True
            elif "call-to-action" in cls:
                c["box"] = True
            node = node.getparent()
        if c["fn"] is not None:
            c["depth"] -= 1                               # the footnotes' own <ol> is not a list in the text
        return c

    def open_block(el) -> dict:
        b = setting(el)
        b.update({"parts": [], "marks": [], "id": el.get("id")})
        found.append(b)
        current[0] = el
        return b

    def emit(el, text, bold):
        if not text:
            return
        b = found[-1] if found and current[0] is el else open_block(el)
        b["parts"].append((text, bold))

    def walk(el, block_el, bold):
        if not isinstance(el.tag, str):
            return
        tag, cls = el.tag, el.get("class") or ""
        if tag == "sup" and (el.get("id") or "").startswith("fnref"):
            b = found[-1] if found and current[0] is block_el else open_block(block_el)
            b["marks"].append(el.get("id")[6:])
            return
        if tag == "a" and "reversefootnote" in cls:
            return
        if tag == "img":
            pictures.append({"src": el.get("src"), "after": len(found) - 1})
            return
        if tag == "br":                                   # GOV.UK's addresses: lines parted by <br>, not spaces
            emit(block_el, " ", bold)
            return
        if tag in _BLOCK_TAGS:
            block_el = el
        bold = bold or tag in ("strong", "b")
        emit(block_el, el.text, bold)
        for child in el:
            walk(child, block_el, bold)
            emit(block_el, child.tail, bold)

    walk(root, root, False)
    out, kept = [], {}
    for k, b in enumerate(found):
        text = "".join(t for t, _ in b["parts"])
        if not text.strip() and not b["marks"]:
            kept[k] = len(out) - 1
            continue
        kept[k] = len(out)
        b["text"] = " ".join(text.split())
        b["n"] = len(out)
        del b["parts"]
        out.append(b)
    for p in pictures:
        p["after"] = kept.get(p["after"], -1)
    para = head = head_id = section = None
    for b in out:
        m = PARA_NO.match(b["text"])
        b["lead"] = m.group(1) if m else None
        if b["kind"] in _HEADINGS:
            head, head_id = b["text"], b["id"] or head_id
            if b["kind"] == "h2":
                section = b["text"]
        elif b["lead"] and b["fn"] is None and b["table"] is None:
            para = b["lead"]
        b["para"], b["head"], b["head_id"], b["section"] = para, head, head_id, section
    return out, pictures


def _lead_words(b: dict) -> int:
    """How many of a block's first words are its paragraph or section number."""
    if b["lead"]:
        return len(words(b["lead"]))
    return 1 if b["kind"] in _HEADINGS and _SECTION_NO.match(b["text"]) else 0


def _stream(body_blocks: list[dict]) -> list[tuple]:
    """The blocks' words as one run: (word, block number, as written, what follows it, place in its block,
    is it part of the block's number). What follows a block's last word ends with a pilcrow."""
    out = []
    for b in body_blocks:
        lead = _lead_words(b)
        ws = _words_with_gaps(b["text"])
        for k, (written, low, gap) in enumerate(ws):
            out.append((low, b["n"], written, gap + ("¶" if k == len(ws) - 1 else ""), k, k < lead))
    return out


# ------------------------------------------------------------------------------------------- the PDF's raw text

_PAGE_NO = re.compile(r"^(page\s+)?\d+(\s+of\s+\d+)?$", re.I)
_BACK = re.compile(r"^back to contents?$", re.I)
_CONTENTS_LINE = re.compile(r"\.{4,}\s*\d+\s*$")
_RAISED_NUMBERS = re.compile(r"[\s,;]*\d{1,4}(?:[\s,;]+\d{1,4})*[\s,;]*")


def read_pdf(path) -> dict:
    """A PDF's own text, with no layout and no judgement: for each page its height, `page.get_text()`, and
    its lines as PyMuPDF gives them, each a list of runs (text, size, raised?). This is the second reading
    of the PDF, independent of pdftext.py, that every difference is checked against."""
    import pymupdf
    pages = []
    with pymupdf.open(path) as doc:
        flags = pymupdf.TEXTFLAGS_DICT & ~pymupdf.TEXT_PRESERVE_IMAGES
        for page in doc:
            lines = []
            for block in page.get_text("dict", flags=flags)["blocks"]:
                for line in block.get("lines", []):
                    runs = [(s["text"], round(s["size"], 2), bool(s["flags"] & 1)) for s in line["spans"]]
                    if any(t.strip() for t, _, _ in runs):
                        lines.append({"y0": round(line["bbox"][1], 1), "y1": round(line["bbox"][3], 1), "runs": runs})
            pages.append({"height": page.rect.height, "text": page.get_text(), "lines": lines})
    return {"pages": pages}


def raw_from_text(page_texts: list[str]) -> dict:
    """The same record from plain page texts (one string per page), for a PDF whose lines are not to hand:
    each line of text is one run of ordinary size, set down the page in order."""
    pages = []
    for text in page_texts:
        rows = [r for r in text.splitlines() if r.strip()]
        lines = [{"y0": 1000 * (k + 0.2) / max(1, len(rows)), "y1": 1000 * (k + 0.8) / max(1, len(rows)), "runs": [(r, 12.0, False)]}
                 for k, r in enumerate(rows)]
        pages.append({"height": 1000.0, "text": text, "lines": lines})
    return {"pages": pages}


def _readings(raw: dict) -> dict:
    """The raw text as runs of words, read three ways, each a string ' word word word ' to search in:

      plain    every page's get_text(), as it comes
      nomark   the same lines with raised numbers (footnote marks) taken out
      flow     the body-size lines of all pages in order, so a sentence runs on over a page end, then the
               small type (footnotes); page numbers, "Back to Contents" and raised numbers taken out

    A wording is in the PDF if any reading has it: the web version has no pages and no marks in its words,
    so each reading removes one thing that would otherwise part words that belong together. Also the
    words of each page (to say which page a difference is on) and which pages are a contents list."""
    sizes = Counter()
    for page in raw["pages"]:
        for line in page["lines"]:
            for text, size, _ in line["runs"]:
                sizes[round(size, 1)] += len(text.strip())
    body = sizes.most_common(1)[0][0] if sizes else 12.0
    per_page, flow_body, flow_small, contents, notes = [], [], [], set(), []
    for pno, page in enumerate(raw["pages"]):
        kept, entries = [], 0
        for line in page["lines"]:
            runs = line["runs"]
            main = max(runs, key=lambda r: len(r[0].strip()))
            # A footnote: small type low on the page that opens with a tiny number.
            if (len(runs) > 1 and runs[0][0].strip().isdigit() and runs[0][1] < body * 0.7 and line["y0"] > page["height"] * 0.3
                    and max(runs[1:], key=lambda r: len(r[0]))[1] < body * 0.92):
                notes.append(int(runs[0][0]))
            text = "".join(" " if (raised or size < main[1] * 0.8) and _RAISED_NUMBERS.fullmatch(t) else t for t, size, raised in runs)
            if not text.strip():
                continue
            entries += bool(_CONTENTS_LINE.search(text))
            w = " ".join(words(text))
            kept.append(w)
            t = text.strip()
            at_edge = line["y0"] > page["height"] * 0.88 or line["y1"] < page["height"] * 0.1
            if (_PAGE_NO.match(t) and at_edge) or _BACK.match(t):
                continue
            (flow_small if main[1] < body * 0.9 else flow_body).append(w)
        per_page.append(kept)
        if entries >= 3:
            contents.add(pno + 1)
    pad = lambda s: " " + " ".join(s.split()) + " "
    pages = [pad(" ".join(p)) for p in per_page]
    return {"plain": pad(" ".join(" ".join(words(p["text"])) for p in raw["pages"])),
            "nomark": pad(" ".join(pages)),
            "flow": pad(" ".join(flow_body) + " § " + " ".join(flow_small)),
            "pages": pages, "page_words": [p.split() for p in pages], "contents_pages": contents, "footnote_numbers": notes}


def _count(haystack: str, run: list[str]) -> int:
    """How often a run of words occurs in a string of words. Two occurrences end to end share the space
    between them, which str.count would take for one: a passage printed twice running must count as two."""
    query = " " + " ".join(run) + " "
    if query not in haystack:
        return 0
    n, at = 0, haystack.find(query)
    while at >= 0:
        n, at = n + 1, haystack.find(query, at + 1)
    return n


def _count_raw(readings: dict, run: list[str], marks: bool = True) -> int:
    """How often a run of words is in the PDF's raw text, by its best reading. With marks=False the plain
    reading is left out: there a footnote number glued to a word ("example70") passes for a word."""
    return max(_count(readings[name], run) for name in (("flow", "nomark", "plain") if marks else ("flow", "nomark")))


def _page_of(readings: dict, run: list[str]) -> int | None:
    """The first page that has this run of words, passing over the contents list (which has every heading)."""
    query = " " + " ".join(run) + " "
    on = [n + 1 for n, page in enumerate(readings["pages"]) if query in page]
    return next((n for n in on if n not in readings["contents_pages"]), on[0] if on else None)


def _together_on_a_page(run: list[str], readings: dict) -> bool:
    """Are these words all found close together on one PDF page, in any order? A table is the same table
    whether its text is read across or down, and the raw text of one with wrapped cells comes line by line."""
    need = Counter(run)
    keys = set(need)
    span = len(run) * 2 + 12
    for page in readings["page_words"]:
        if not keys <= set(page):
            continue
        if len(page) <= span:
            if not need - Counter(page):
                return True
            continue
        window = Counter(page[:span])
        if not need - window:
            return True
        for start in range(1, len(page) - span + 1):
            window[page[start - 1]] -= 1
            window[page[start + span - 1]] += 1
            if all(window[k] >= v for k, v in need.items()):
                return True
    return False


# ------------------------------------------------------------------------------------------- lining the words up

def _rising(pairs: list[tuple]) -> list[tuple]:
    """The longest run of (i, j) pairs, given in order of i, in which j rises too."""
    tails, at, back = [], [], [None] * len(pairs)
    for n, (_, j) in enumerate(pairs):
        k = bisect.bisect_left(tails, j)
        if k == len(tails):
            tails.append(j)
            at.append(n)
        else:
            tails[k], at[k] = j, n
        back[n] = at[k - 1] if k else None
    out, n = [], at[-1] if at else None
    while n is not None:
        out.append(pairs[n])
        n = back[n]
    return out[::-1]


def _anchors(a, b, a0, a1, b0, b1, k):
    """Runs of k words that occur once in each stretch: fixed points the two texts certainly share."""
    seen_a = Counter(tuple(a[i:i + k]) for i in range(a0, a1 - k + 1))
    seen_b = Counter(tuple(b[j:j + k]) for j in range(b0, b1 - k + 1))
    where = {}
    for j in range(b0, b1 - k + 1):
        run = tuple(b[j:j + k])
        if seen_b[run] == 1:
            where[run] = j
    pairs = []
    for i in range(a0, a1 - k + 1):
        run = tuple(a[i:i + k])
        if seen_a[run] == 1 and run in where:
            pairs.append((i, where[run]))
    return _rising(pairs)


def _matching(a: list[str], b: list[str], small: int = 1500) -> list[tuple]:
    """Where two long lists of words agree, in order: [(i, j, n)]. Unique phrases are matched first and the
    stretches between them handed to difflib (a patience diff), so two texts of 40,000 words cost a fraction
    of a second where difflib alone would take minutes, and a passage that has moved shows as a difference
    in both places and not as a mis-pairing of everything between."""
    found = []

    def solve(a0, a1, b0, b1, k):
        stack = [(a0, a1, b0, b1, k)]
        while stack:
            a0, a1, b0, b1, k = stack.pop()
            if a0 >= a1 or b0 >= b1:
                continue
            n = 0
            while a0 + n < a1 and b0 + n < b1 and a[a0 + n] == b[b0 + n]:
                n += 1
            if n:
                found.append((a0, b0, n))
                a0, b0 = a0 + n, b0 + n
            m = 0
            while a1 - m > a0 and b1 - m > b0 and a[a1 - m - 1] == b[b1 - m - 1]:
                m += 1
            if m:
                found.append((a1 - m, b1 - m, m))
                a1, b1 = a1 - m, b1 - m
            if a0 >= a1 or b0 >= b1:
                continue
            if a1 - a0 <= small and b1 - b0 <= small:
                for i, j, n in difflib.SequenceMatcher(None, a[a0:a1], b[b0:b1], autojunk=False).get_matching_blocks():
                    if n:
                        found.append((a0 + i, b0 + j, n))
                continue
            anchors = _anchors(a, b, a0, a1, b0, b1, k)
            if not anchors:
                if k > 2:
                    stack.append((a0, a1, b0, b1, k - 2 if k > 3 else 2))
                elif (a1 - a0) * (b1 - b0) <= 6e7:
                    for i, j, n in difflib.SequenceMatcher(None, a[a0:a1], b[b0:b1], autojunk=False).get_matching_blocks():
                        if n:
                            found.append((a0 + i, b0 + j, n))
                continue
            pa, pb = a0, b0
            for i, j in anchors:
                if i < pa or j < pb:
                    continue
                stack.append((pa, i, pb, j, k))
                n = 0
                while i + n < a1 and j + n < b1 and a[i + n] == b[j + n]:
                    n += 1
                found.append((i, j, n))
                pa, pb = i + n, j + n
            stack.append((pa, a1, pb, b1, k))

    solve(0, len(a), 0, len(b), 6)
    found.sort()
    merged = []
    for i, j, n in found:
        if merged and merged[-1][0] + merged[-1][2] == i and merged[-1][1] + merged[-1][2] == j:
            merged[-1] = (merged[-1][0], merged[-1][1], merged[-1][2] + n)
        else:
            merged.append((i, j, n))
    return merged


def _gaps(a: list[str], b: list[str], matching: list[tuple]) -> list[tuple]:
    """The places between the matching stretches: [(i1, i2, j1, j2)], where a[i1:i2] and b[j1:j2] differ."""
    out, pi, pj = [], 0, 0
    for i, j, n in matching + [(len(a), len(b), 0)]:
        if i > pi or j > pj:
            out.append((pi, i, pj, j))
        pi, pj = i + n, j + n
    return out


# ------------------------------------------------------------------------------------------- looking a difference up

def _with_context(before: list[str], run: list[str], after: list[str]) -> list[list[str]]:
    """The run with its neighbouring words, strictest first, to search the raw text for. Context on both
    sides is the proof that the words are at this place; one side only allows for a page end or a footnote
    coming between. A run that is only numbers (a paragraph number) needs more: "9 4 6 the" turns up by chance."""
    numbers = bool(run) and all(w.isdigit() for w in run)
    if numbers:
        shapes = ((4, 4), (3, 3), (0, 8), (8, 0))
    else:
        shapes = ((4, 4), (3, 3), (6, 0), (0, 6), (2, 2)) + (((4, 0), (0, 4)) if len(run) >= 2 else ())
    out = []
    for left, right in shapes:
        l, r = before[-left:] if left else [], after[:right]
        if len(l) < left or len(r) < right:
            continue
        if l + run + r not in out:
            out.append(l + run + r)
    if len(run) >= 6 and not numbers and run not in out:
        out.append(run)
    return out


def _covered(run: list[str], before: list[str], after: list[str], there, here, k: int = 6) -> int:
    """How many of the run's words sit in some k-word window (with up to 3 words of context) that is found
    there at least as often as here. For a long passage, which a page end or a footnote may interrupt."""
    seq = before[-3:] + run + after[:3]
    offset = len(before[-3:])
    hit = [False] * len(run)
    for start in range(max(1, len(seq) - k + 1)):
        window = seq[start:start + k]
        n = there(window)
        if n and n >= here(window):
            for t in range(start, start + len(window)):
                if 0 <= t - offset < len(run):
                    hit[t - offset] = True
    return sum(hit)


def _without_marks(run: list[str], marks: set) -> list[str]:
    """The run less the footnote numbers the web version has as marks at this place: a word that is one of
    them goes, and one that ends in one of them ("example70") loses it. The extraction reads a mark as text
    when it cannot tell that the number is raised."""
    if not marks:
        return run
    out = []
    for w in run:
        if w in marks:
            continue
        m = re.fullmatch(r"(.*?[a-z].*?|\d{4})(\d{1,4})", w)
        out.append(m.group(1) if m and m.group(2) in marks else w)
    return out


class _Texts:
    """The two bodies and the raw text, set out for looking differences up."""

    def __init__(self, web_html: str, extraction_html: str, raw: dict):
        self.wb, self.wpics = blocks(web_html)
        self.eb, self.epics = blocks(extraction_html)
        self.ws, self.es = _stream(self.wb), _stream(self.eb)
        self.a, self.b = [t[0] for t in self.ws], [t[0] for t in self.es]
        self.web_text = " " + " ".join(self.a) + " "
        self.pdf_text = " " + " ".join(self.b) + " "
        self.raw = _readings(raw)
        # The rows of the web version's tables: block numbers by (table, row).
        self.rows = {}
        for blk in self.wb:
            if blk["table"] is not None:
                self.rows.setdefault((blk["table"], blk["row"]), []).append(blk["n"])
        # Where the web version has turned a table into headings repeated for each row ("Occupation", "Date
        # arrested" under every person): from the first such heading to the last, the text is a table's.
        plain = lambda x: x["kind"] in _HEADINGS[1:] and not x["lead"] and not _SECTION_NO.match(x["text"])
        seen = Counter(x["text"].strip().lower() for x in self.wb if plain(x))
        self.labels = {text for text, n in seen.items() if n >= 5}
        at = [x["n"] for x in self.wb if plain(x) and x["text"].strip().lower() in self.labels]
        self.label_zone = (min(at) - 2, max(at) + 3) if at else None

    def on_web(self, run):
        return _count(self.web_text, run)

    def in_extraction(self, run):
        return _count(self.pdf_text, run)

    def in_raw(self, run):
        return _count_raw(self.raw, run)

    def in_raw_unmarked(self, run):
        return _count_raw(self.raw, run, marks=False)


def _written(stream: list[tuple], start: int, end: int) -> str:
    """The words as they are written, with a line break where a block ends."""
    return "".join(t[2] + t[3] for t in stream[start:end]).replace("¶", "\n").strip()


def _shown_from(stream: list[tuple], start: int, end: int) -> int:
    """Where a difference is shown from: when it begins part-way through a paragraph's number ("3" of "7.1.3",
    because "7.1." is the same on both sides), from the start of the number, so a reader sees it whole."""
    if start < end:
        while start > 0 and stream[start - 1][5] and stream[start - 1][1] == stream[start][1]:
            start -= 1
    return start


def _examine(t: _Texts, gap: tuple) -> dict:
    """One place where the web version and the extraction differ: its words on each side, where it sits,
    and what the PDF's raw text says about it.

      web_in_pdf   how the web's wording was found in the raw text, if it was: then the difference is ours
      pdf_in_raw   how the extraction's wording was found in the raw text, if it was: then it is real

    Repeated sentences are settled by counting: the raw text must hold a wording at least as often as the
    web does, or the web has one more than the PDF."""
    i1, i2, j1, j2 = gap
    wb, eb, ws, es = t.wb, t.eb, t.ws, t.es
    web_run, pdf_run = t.a[i1:i2], t.b[j1:j2]
    web_before, web_after = t.a[max(0, i1 - CONTEXT):i1], t.a[i2:i2 + CONTEXT]
    pdf_before, pdf_after = t.b[max(0, j1 - CONTEXT):j1], t.b[j2:j2 + CONTEXT]
    web_from, pdf_from = _shown_from(ws, i1, i2), _shown_from(es, j1, j2)
    d = {"i": (i1, i2), "j": (j1, j2), "web": _written(ws, i1, i2), "pdf": _written(es, j1, j2),
         "web_shown": _written(ws, web_from, i2), "pdf_shown": _written(es, pdf_from, j2),
         # The words round it, which the two versions share: a one-word difference means little without them.
         # Each side's lead-in stops where that side is shown from, so a number is not given twice.
         "before": _written(ws, max(0, web_from - CONTEXT), web_from), "before_pdf": _written(es, max(0, pdf_from - CONTEXT), pdf_from),
         "after": _written(ws, i2, i2 + CONTEXT)}
    web_at = wb[ws[min(i1, len(ws) - 1)][1]] if ws else None
    pdf_at = eb[es[min(j1, len(es) - 1)][1]] if es else None
    for side, blk in (("w", web_at), ("e", pdf_at)):
        for key in ("kind", "table", "fn", "box", "para", "head", "head_id", "section", "n"):
            d[f"{side}_{key}"] = blk[key] if blk else None
    web_blocks = sorted({x[1] for x in ws[i1:i2]})
    pdf_blocks = sorted({x[1] for x in es[j1:j2]})
    d["w_tables"] = sorted({wb[n]["table"] for n in web_blocks if wb[n]["table"] is not None})
    d["w_all_table"] = bool(web_run) and all(wb[n]["table"] is not None for n in web_blocks)
    d["w_all_figure"] = bool(web_run) and all(wb[n]["figure"] for n in web_blocks)
    d["w_all_fn"] = bool(web_run) and all(wb[n]["fn"] is not None for n in web_blocks)
    d["e_all_fn"] = bool(pdf_run) and all(eb[n]["fn"] is not None for n in pdf_blocks)
    d["w_lead"] = bool(web_run) and all(x[5] for x in ws[i1:i2])
    d["e_lead"] = bool(pdf_run) and all(x[5] for x in es[j1:j2])
    d["w_block_start"] = bool(web_run) and ws[i1][4] == 0
    d["e_block_start"] = bool(pdf_run) and es[j1][4] == 0
    # Footnote marks the web version has at or beside this place, and the pictures in the gap on each side.
    w0 = ws[i1 - 1][1] if i1 > 0 else 0
    w1 = ws[i2][1] if i2 < len(ws) else len(wb) - 1
    marks = {m for n in range(w0, w1 + 1) for m in wb[n]["marks"]}
    e0 = es[j1 - 1][1] if j1 > 0 else -1
    e1 = es[j2][1] if j2 < len(es) else len(eb)
    d["pdf_pictures"] = sum(1 for p in t.epics if e0 <= p["after"] < e1)
    d["web_pictures"] = sum(1 for p in t.wpics if (w0 if i1 > 0 else -1) <= p["after"] < (w1 if i2 < len(ws) else len(wb)))
    d["web_marks"] = sorted(marks)
    unmarked = _without_marks(pdf_run, marks)
    d["marks_only"] = unmarked != pdf_run and unmarked == web_run
    pdf_run = unmarked
    if marks:
        pdf_before, pdf_after = _without_marks(pdf_before, marks), _without_marks(pdf_after, marks)
    d["tw"], d["te"] = web_run, pdf_run
    in_label_zone = bool(t.label_zone and web_at and t.label_zone[0] <= web_at["n"] <= t.label_zone[1])
    d["near_table"] = near_table = (any(eb[n]["table"] is not None for n in range(max(0, e0), min(len(eb), e1 + 1)))
                                    or (web_at is not None and web_at["table"] is not None) or bool(d["w_tables"]) or in_label_zone)

    # --- is the web's wording in the PDF's raw text after all?
    web_in_pdf = None
    if web_run:
        # A passage the web has more often than the PDF is a repeat on the web, whatever stands beside it:
        # the copy left unmatched may be followed by the very words that follow the PDF's only one.
        repeated = len(web_run) >= 6 and t.on_web(web_run) > t.in_raw(web_run) >= 1
        for run in () if repeated else _with_context(web_before, web_run, web_after):
            there = t.in_raw(run)
            if there and there >= t.on_web(run):
                web_in_pdf = "context"
                break
        if web_in_pdf is None and len(web_run) >= 6 and _covered(web_run, web_before, web_after, t.in_raw, t.on_web) >= 0.9 * len(web_run):
            web_in_pdf = "windows"
        if web_in_pdf is None and d["w_all_table"]:
            # A table the raw text gives in another order: each row's words together on one page.
            touched = sorted({(wb[n]["table"], wb[n]["row"]) for n in web_blocks})
            row_words = [[w for n in t.rows[key] for w in words(wb[n]["text"])] for key in touched]
            if touched and all(len(r) >= 3 and _together_on_a_page(r, t.raw) for r in row_words):
                web_in_pdf = "rows"
        if web_in_pdf is None and near_table:
            # Beside a table: the web's blocks one at a time (a table laid out differently reads in another order).
            missing = 0
            for n in web_blocks:
                piece = [x[0] for x in ws[i1:i2] if x[1] == n]
                there = t.in_raw(piece)
                label = wb[n]["kind"] in _HEADINGS and wb[n]["text"].strip().lower() in t.labels
                if not ((there and there >= t.on_web(piece)) or (len(piece) >= 3 and not label and _together_on_a_page(piece, t.raw))):
                    missing += len(piece)
            d["web_missing"] = missing
            if missing == 0:
                web_in_pdf = "pieces"
    else:                                               # nothing on the web here: are its neighbours side by side in the PDF?
        run = web_before[-4:] + web_after[:4]
        if len(run) >= 6 and t.in_raw(run) and t.in_raw(run) >= t.on_web(run):
            web_in_pdf = "adjacent"

    # --- is the extraction's wording really in the PDF's raw text?
    pdf_in_raw = None
    if pdf_run:
        for run in _with_context(pdf_before, pdf_run, pdf_after):
            there = t.in_raw_unmarked(run)
            if there and there > t.on_web(run):
                pdf_in_raw = "context"
                d["page"] = _page_of(t.raw, run)
                break
        if pdf_in_raw is None and len(pdf_run) >= 6 and _covered(pdf_run, pdf_before, pdf_after, t.in_raw_unmarked, lambda run: 0) >= 0.9 * len(pdf_run):
            pdf_in_raw = "windows"
        if near_table:
            # Beside a table: the extraction's blocks one at a time. A block counts as on the web if the web
            # has it as often, or has its words close by in another order (the web may set one table out as
            # three); a lone word must be matched by count, a lone figure may be anywhere close by.
            missing = 0
            nearby = Counter(t.a[max(0, i1 - 200):i2 + 200])
            for n in pdf_blocks:
                piece = _without_marks([x[0] for x in es[j1:j2] if x[1] == n], marks)
                if not piece or t.on_web(piece) >= max(1, t.in_extraction(piece)):
                    continue
                if (len(piece) >= 2 or piece[0].isdigit()) and not (Counter(piece) - nearby):
                    continue
                missing += len(piece)
            d["pdf_missing"] = missing
    else:
        run = pdf_before[-4:] + pdf_after[:4]
        if len(run) >= 6 and t.in_raw_unmarked(run):
            pdf_in_raw = "adjacent"
    if pdf_run and not web_run and len(pdf_run) >= 3:
        query = " " + " ".join(pdf_run) + " "
        on = [n + 1 for n, page in enumerate(t.raw["pages"]) if query in page]
        d["contents_only"] = bool(on) and all(n in t.raw["contents_pages"] for n in on)
    if d.get("page") is None:
        for run in (pdf_before[-4:] + pdf_run[:6], pdf_run[:8] + pdf_after[:4] if pdf_run else [], pdf_before[-4:], pdf_after[:4]):
            if len(run) >= 4 and (page := _page_of(t.raw, run)):
                d["page"] = page
                break
    d["web_in_pdf"], d["pdf_in_raw"] = web_in_pdf, pdf_in_raw
    return d


# ------------------------------------------------------------------------------------------- whose difference, and what kind

# The kinds, and the group each is counted under. Only the first group is a difference of wording
# (docs/methods/pdf-and-web.md, rule 2): the rest are reported on their own and never added to it.
GROUPS = {
    "wording": ("text", "heading", "footnote", "bibliography", "table cell", "section updated"),
    "numbering": ("numbering",),
    "picture": ("table for a picture", "picture in words", "caption"),
    "withheld": ("withheld notice",),
    "address": ("address as text",),
    "form": ("list marker", "spacing", "ligature", "number format", "repeated label", "stray characters", "arabic letters"),
    "furniture": ("back to contents", "attachment label", "version line"),
}
GROUP_OF = {kind: group for group, kinds in GROUPS.items() for kind in kinds}

_MARKER = re.compile(r"^(\d{1,3}|[a-z]|[ivx]{1,5})$")
_LIGATURE = "(?:fi|fl|ff|ffi|ffl|ti|tt|ft|th|tf)?"
_ATTACHED = re.compile(r"^(pdf|html|ods|odt|csv|xlsx?|docx?|zip|ms word document|ms excel spreadsheet|opendocument \w+)( \d+)+ ?(kb|mb|gb|bytes)?( \d+ pages?)?$")
_ADDRESS = re.compile(r"\b(homeoffice gov uk|icibi gov uk|icinspector gov uk)\b")
_URL = re.compile(r"\b(https?|www)\b")
_WITHHELD = re.compile(r"information (in|on) this (section|page) has been removed|official sensitive")
_UPDATED_WORDS = re.compile(r"(section|assessment)? ?updated \d{1,2} \w+ \d{4}")
_BIBLIOGRAPHY = re.compile(r"(bibliography|sources)", re.I)
_ARABIC = re.compile("[\u0600-\u06ff\u0750-\u077f\ufb50-\ufdff\ufe70-\ufeff]")
_ANCHOR = re.compile(r"\{?#?\w+(?:_\w+)+\}?")
_OPENING = re.compile(r"(executive summary|assessment|about the assessment)", re.I)


def _side(d: dict) -> str:
    """W: words on the web only. P: in the PDF only. C: both have words here, and they differ."""
    return "W" if d["tw"] and not d["te"] else "P" if d["te"] and not d["tw"] else "C"


def _marks_run_together(d: dict) -> bool:
    """Is the PDF side the web side with footnote numbers run into it ("fire178179180181" for "fire", with
    marks 178 to 181 on the web here)? Several marks set together are read by the extraction as one word."""
    marks = d["web_marks"]
    if not marks or not d["te"]:
        return False
    mark = "(?:" + "|".join(sorted(map(re.escape, marks), key=len, reverse=True)) + ")"
    if not d["tw"]:
        return bool(re.fullmatch(f"{mark}(?: {mark})*", " ".join(d["te"])))
    pattern = f"(?:{mark} )*" + "".join(re.escape(w) + f"(?:{mark})*(?: {mark})*" + (" " if k < len(d["tw"]) - 1 else "")
                                        for k, w in enumerate(d["tw"]))
    return bool(re.fullmatch(pattern, " ".join(d["te"])))


def _verdict(d: dict) -> str:
    """real | artefact | unresolved. (That a passage has only moved is settled later, across the note.)
    The rule of the method: the web's wording found in the raw text makes the difference ours; failing
    that, the extraction's wording found in the raw text makes it real; neither, and it is left unresolved."""
    side, web_in_pdf, pdf_in_raw = _side(d), d["web_in_pdf"], d["pdf_in_raw"]
    if d["marks_only"] or not (d["tw"] or d["te"]) or (side in ("P", "C") and _marks_run_together(d)):
        return "artefact"                                 # a footnote mark the extraction read as a word
    if side == "P" and (re.search(r"\.{6,}\s*\d+", d["pdf"]) or d.get("contents_only")):
        return "artefact"                                 # a line of the contents list left in
    if d["e_n"] == 0 and d["j"][0] <= 6 and side in ("P", "C"):
        return "real"                                     # the version line, which the extraction takes from the cover
    if side == "P" and d["e_n"] is not None and d["e_n"] <= 3 and d["j"][0] <= 60 and re.match(r"\d+(\.\d+)* ", d["pdf"]):
        return "artefact"                                 # the first line of a contents entry that wraps
    if side == "W":
        return "artefact" if web_in_pdf else "real"
    if side == "P":
        if pdf_in_raw in ("context", "windows"):
            return "real"
        return "artefact" if web_in_pdf == "adjacent" else "unresolved"
    return "artefact" if web_in_pdf else "real" if pdf_in_raw else "unresolved"


def _kind(d: dict) -> str:
    """What sort of difference this is: the first description that fits, most particular first."""
    side, tw, te = _side(d), d["tw"], d["te"]
    web, pdf = " ".join(tw), " ".join(te)
    both = (web + " " + pdf).strip()
    numbers = lambda run: bool(run) and all(w.isdigit() for w in run)
    if d["e_n"] == 0 and d["j"][0] <= 6 and side in ("P", "C"):
        return "version line"
    if side == "W" and re.fullmatch(r"\d{2}", web) and any(m.endswith(web) and len(m) == 3 for m in d["web_marks"]):
        return "stray characters"                         # "[footnote 100](00)"
    if _ARABIC.search(d["web"] + d["pdf"]):
        return "arabic letters"                           # a PDF's text layer gives them out of order ("خالل" for "خلال"), in any reader
    if side == "W" and _ANCHOR.fullmatch(d["web"].strip()):
        return "stray characters"                         # "{#Organisations_responsible_for}": a broken anchor left in the web text
    if (d["w_lead"] or not tw) and (d["e_lead"] or not te) and (numbers(tw) or not tw) and (numbers(te) or not te):
        return "numbering"
    if side == "C" and "".join(tw) == "".join(te):
        return "spacing"                                  # "longas" for "long as", "3 500" for "3500"
    if side == "C" and (re.fullmatch(_LIGATURE.join(map(re.escape, tw)), "".join(te)) or re.fullmatch(_LIGATURE.join(map(re.escape, te)), "".join(tw))):
        return "ligature"                                 # "speci c" for "specific"
    if side == "C" and len(tw) == 1 and len(te) == 1 and numbers(tw) and numbers(te) and int(tw[0]) == int(te[0]):
        return "number format"                            # "5 November" for "05 November"
    if re.fullmatch(r"(back to contents ?)+", both + " "):
        return "back to contents"
    if side == "W" and _ATTACHED.match(web):
        return "attachment label"                         # GOV.UK's "(PDF, 173KB)" after a link
    if side == "P" and len(te) <= 2 and all(_MARKER.match(w) for w in te) and d["e_block_start"]:
        return "list marker"
    if side == "W" and len(tw) <= 2 and all(_MARKER.match(w) for w in tw) and (d["w_block_start"] or numbers(tw)) and not d["w_lead"]:
        return "list marker"                              # "9.1.3 1. The report…": a list number left in the text
    if (side == "P" and d["e_lead"] and numbers(te)) or (side == "W" and d["w_lead"] and numbers(tw)):
        return "numbering"
    if re.search(r"\bbookmark\d+\b", web):
        return "stray characters"
    pictured = d["pdf_pictures"] >= 1 or d["web_pictures"] >= 1
    if side in ("W", "C") and len(tw) >= 8 and len(te) <= 2 and pictured and not d["w_all_table"] and not d["w_all_figure"]:
        return "picture in words"                         # a description of a map, a chart's numbers, an email typed out
    if side == "P" and len(te) >= 6 and d["pdf_pictures"] >= 1 and sum(w.isdigit() for w in te) >= 0.4 * len(te):
        return "picture in words"                         # a chart's lettering that the extraction read as text
    if _ADDRESS.search(web + " | " + pdf) or (_URL.search(web) and side in ("W", "C")) or (_URL.search(pdf) and side in ("P", "C")):
        return "address as text"
    if _UPDATED_WORDS.search(both) and max(len(tw), len(te)) <= 8:
        return "section updated"
    if _WITHHELD.search(both) or d["w_box"] or d["e_box"]:
        return "withheld notice"
    if side == "W" and d["w_all_figure"]:
        return "caption"
    if side == "W" and d["w_all_table"]:
        return "table cell"                               # or a whole table the PDF has only as a picture: settled later
    if side == "W" and len(tw) >= 5 and d["pdf_pictures"] > d["web_pictures"]:
        return "picture in words"
    if side == "W" and d["pdf_pictures"] > d["web_pictures"] and d["before"].rstrip().endswith(":"):
        return "picture in words"                         # "…by governorate: Human rights violations": a name where the PDF has the picture
    if (d["w_all_fn"] and tw) or (d["e_all_fn"] and te and not tw):
        return "footnote"
    if ((d["w_kind"] or "") in _HEADINGS and tw) or ((d["e_kind"] or "") in _HEADINGS and te and not tw):
        return "heading"
    if _BIBLIOGRAPHY.match(d["w_section"] or "") or _BIBLIOGRAPHY.match(d["e_section"] or ""):
        return "bibliography"
    return "text"


def _edits(a: str, b: str) -> int:
    """Letters to change to turn one word into the other (9 when their lengths are far apart)."""
    if abs(len(a) - len(b)) > 3:
        return 9
    row = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        new = [i]
        for j, cb in enumerate(b, 1):
            new.append(min(row[j] + 1, new[j - 1] + 1, row[j - 1] + (ca != cb)))
        row = new
    return row[-1]


def _size(d: dict) -> str:
    """For a difference of wording, how much: a number, a spelling, a word or two, or a passage."""
    tw, te = d["tw"], d["te"]
    if _side(d) == "C" and len(tw) == 1 and len(te) == 1:
        if tw[0].isdigit() or te[0].isdigit():
            return "number"
        return "spelling" if _edits(tw[0], te[0]) <= 2 and min(len(tw[0]), len(te[0])) >= 3 else "word"
    if any(c.isdigit() for w in tw + te for c in w) and len(tw) < PASSAGE + 1 and len(te) < PASSAGE + 1:
        return "number"
    return "word" if len(tw) < PASSAGE and len(te) < PASSAGE else "passage"


def _among(run: list[str], haystack: str, k: int = 6) -> float:
    """The share of a run's words that sit in some k-word window found in the haystack."""
    k = min(k, len(run))
    hit = [False] * len(run)
    for start in range(len(run) - k + 1):
        if " " + " ".join(run[start:start + k]) + " " in haystack:
            hit[start:start + k] = [True] * k
    return sum(hit) / max(1, len(run))


def _settle(t: _Texts, found: list[dict]) -> list[dict]:
    """Give every difference its verdict, kind and the number of words it counts for, then settle what can
    only be seen across the whole note: a passage that has merely moved, a web table the PDF has only as a
    picture, a label the web repeats for every row of a table it has turned into headings."""
    for d in found:
        d["side"], d["verdict"], d["kind"] = _side(d), _verdict(d), _kind(d)
        d["web_words"], d["pdf_words"] = len(d["tw"]), len(d["te"])
        if d["verdict"] in ("real", "unresolved") and d["near_table"]:
            # Beside a table only the blocks not found on the other side count as different.
            d["web_words"] = d.get("web_missing", d["web_words"])
            d["pdf_words"] = d.get("pdf_missing", d["pdf_words"])
            if d["web_words"] == 0 and d["pdf_words"] == 0:
                d["verdict"] = "artefact"                 # a table read in another order
            elif d["verdict"] == "unresolved":
                d["verdict"] = "real"
    # Moved: words unmatched on both sides. A web-side difference whose words are among the PDF-side
    # differences' words (and the reverse) is the same text in another place, not a difference of wording.
    web_side = " " + " | ".join(" ".join(d["tw"]) for d in found if d["tw"]) + " "
    pdf_side = " " + " | ".join(" ".join(d["te"]) for d in found if d["te"]) + " "
    for k, d in enumerate(found):
        if d["verdict"] not in ("real", "unresolved"):
            continue
        if d["side"] == "W" and len(d["tw"]) >= PASSAGE and _among(d["tw"], pdf_side) >= 0.9:
            d["verdict"] = "moved"
        elif d["side"] == "P" and len(d["te"]) >= PASSAGE and _among(d["te"], web_side) >= 0.9:
            d["verdict"] = "moved"
        elif d["side"] in ("W", "P") and 2 <= max(len(d["tw"]), len(d["te"])) < PASSAGE and d["kind"] not in ("numbering", "list marker"):
            mine = sorted(d["tw"] or d["te"])             # a heading set before a dated line in one, after it in the other
            for other in found[max(0, k - 3):k + 4]:
                if other is not d and other["side"] != d["side"] and other["side"] != "C" and sorted(other["tw"] or other["te"]) == mine:
                    d["verdict"] = other["verdict"] = "moved"
                    break
    # A web table most of whose words are on the web only is one the PDF does not have as text: it gives the
    # numbers of a chart that the PDF shows as a picture.
    table_words, web_only = Counter(), Counter()
    for blk in t.wb:
        if blk["table"] is not None:
            table_words[blk["table"]] += len(words(blk["text"]))
    cells = [d for d in found if d["verdict"] == "real" and d["kind"] == "table cell" and d["side"] == "W" and d["w_all_table"]]
    for d in cells:
        for table in d["w_tables"]:
            web_only[table] += len(d["tw"]) / max(1, len(d["w_tables"]))
    absent = {table for table, n in table_words.items() if web_only[table] >= 0.6 * n}
    for d in cells:
        if set(d["w_tables"]) & absent:
            d["kind"] = "table for a picture"
    # The same small difference many times over is a label, not wording, where the web has made it a heading.
    # So is a short run that only one side has, met three times over: the label before every entry of a list
    # ("Name:"), or a table's heading row set again at the top of each page of the PDF.
    small = [d for d in found if d["verdict"] == "real" and d["kind"] in ("text", "heading", "bibliography", "table cell", "footnote")
             and max(len(d["tw"]), len(d["te"])) <= LABEL]
    times = Counter((d["side"], tuple(d["tw"]), tuple(d["te"])) for d in small)
    for d in small:
        d["repeats"] = times[(d["side"], tuple(d["tw"]), tuple(d["te"]))]
        short = max(len(d["tw"]), len(d["te"])) <= PASSAGE
        if d["repeats"] >= 4 and short and d["kind"] == "heading" and d["side"] == "W":
            d["kind"] = "repeated label"
        elif d["repeats"] >= 3 and d["side"] in ("W", "P") and d["kind"] in ("text", "heading", "table cell"):
            d["kind"] = "repeated label"
    for d in found:
        d["group"] = GROUP_OF[d["kind"]]
        if d["verdict"] == "real" and d["group"] == "wording":
            d["size"] = _size(d)
    return found


# ------------------------------------------------------------------------------------------- what else differs

_MONTHS = "January|February|March|April|May|June|July|August|September|October|November|December"
_VERSION = re.compile(r"\bversion:?\s+(\d+(?:\.\d+)?)", re.I)
_DATE = re.compile(rf"(?:(?<![\d.])(\d{{1,2}})\s+)?\b({_MONTHS})\s+(20\d\d)\b")
_UPDATED = re.compile(rf"^\s*(?:(?:this\s+)?(?:section|assessment|annex)\s*(?:\d+\s*)?)?(?:was\s+)?(?:last\s+)?updated\s*(?:on)?\s*:?\s*"
                      rf"(\d{{1,2}}\s+(?:{_MONTHS})\s+20\d\d)\s*\.?\s*$", re.I)
_BOX_START = re.compile(r"official\s*[–-]\s*sensitive.{0,40}?start of section", re.I)
_NOTICE = re.compile(r"the information (?:in|on) this (?:section|page) has been removed", re.I)


def _version_and_date(text: str) -> tuple:
    """The version number and the date beside it, from the top of a web body or a PDF's cover. A bulletin or
    a mission report has no version: its date follows "Published" or its reference."""
    version = _VERSION.search(text)
    date = _DATE.search(text[version.end():version.end() + 60]) if version else None
    if date is None and (m := re.search(r"published:?\s*", text, re.I)):
        date = _DATE.search(text[m.end():m.end() + 40])
    if date is None and (m := re.search(r"reference(?: number)?:?\s*\S+", text, re.I)):
        date = _DATE.search(text[m.end():m.end() + 40])
    return (version.group(1) if version else None, " ".join(x for x in date.groups() if x) if date else None)


def _same_day(a: str, b: str) -> bool:
    return re.sub(r"^0", "", a) == re.sub(r"^0", "", b)


def _counts(t: _Texts, raw: dict) -> dict:
    """What is compared by counting, from the web body and the PDF's raw text: the version line, the dates
    of the "Section updated" lines, the withheld-section boxes and their notices; and, from the extraction
    (the only reading of the PDF that has them), footnotes, pictures, tables and headings."""
    first_heading = next((b["n"] for b in t.wb if b["kind"] in ("h2", "h3")), len(t.wb))
    web_top = " | ".join(b["text"] for b in t.wb[:min(first_heading, 8)])
    cover = " ".join(raw["pages"][0]["text"].split()) if raw["pages"] else ""
    web_version, web_date = _version_and_date(web_top)
    pdf_version, pdf_date = _version_and_date(cover)
    web_all = " ".join(b["text"] for b in t.wb)
    pdf_all = " ".join(" ".join(p["text"].split()) for p in raw["pages"])
    web_updated = [" ".join(m.group(1).split()) for b in t.wb if b["fn"] is None and (m := _UPDATED.match(b["text"]))]
    pdf_updated = [" ".join(m.group(1).split()) for p in raw["pages"] for line in p["text"].splitlines() if (m := _UPDATED.match(line))]
    footnotes = lambda bs: len({b["fn"] for b in bs if b["fn"] is not None})
    # Footnotes are counted twice in the PDF: by the extraction, and from the raw text (the highest footnote
    # number, and how many different ones). The count differs from the web's only if neither reading matches it.
    seen = t.raw["footnote_numbers"]
    web_notes, pdf_notes = footnotes(t.wb), footnotes(t.eb)
    notes_differ = pdf_notes != web_notes and (not seen or (max(seen) != web_notes and len(set(seen)) != web_notes))
    tables = lambda bs: len({b["table"] for b in bs if b["table"] is not None})
    headings = lambda bs: sum(1 for b in bs if b["kind"] in _HEADINGS and b["fn"] is None)
    return {
        "version": {"web": web_version, "web_date": web_date, "pdf": pdf_version, "pdf_date": pdf_date},
        "section_updated": {"web": web_updated, "pdf": pdf_updated,
                            "same": len(web_updated) == len(pdf_updated) and all(_same_day(a, b) for a, b in zip(web_updated, pdf_updated))},
        "boxes": {"web": len(_BOX_START.findall(web_all)), "pdf": len(_BOX_START.findall(pdf_all)),
                  "web_notices": len(_NOTICE.findall(web_all)), "pdf_notices": len(_NOTICE.findall(pdf_all))},
        "footnotes": {"web": web_notes, "pdf": pdf_notes, "pdf_raw": max(seen) if seen else None, "differ": notes_differ},
        "pictures": {"web": len(t.wpics), "pdf": len(t.epics)},
        "tables": {"web": tables(t.wb), "pdf": tables(t.eb)},
        "headings": {"web": headings(t.wb), "pdf": headings(t.eb)},
    }


def _drafts(found: list[dict], counts: dict) -> list[str]:
    """Signs that the web page and the PDF are different drafts of the text under one version number: one
    was edited and the other left. Each is a fact about the pair, not a judgement of which is right."""
    signs = []
    version = counts["version"]
    if version["web"] and version["pdf"] and version["web"] != version["pdf"]:
        signs.append(f"version number differs: web {version['web']}, PDF {version['pdf']}")
    updated = counts["section_updated"]
    day = lambda d: re.sub(r"^0", "", d)
    web_only = Counter(map(day, updated["web"])) - Counter(map(day, updated["pdf"]))
    pdf_only = Counter(map(day, updated["pdf"])) - Counter(map(day, updated["web"]))
    if web_only and pdf_only:                             # each has a date the other lacks (not merely fewer lines)
        signs.append(f"a 'Section updated' date differs: web {next(iter(web_only))}, PDF {next(iter(pdf_only))}")
    if counts["footnotes"]["differ"]:
        signs.append(f"footnote count differs: web {counts['footnotes']['web']}, PDF {counts['footnotes']['pdf']}")
    real = [d for d in found if d["verdict"] == "real" and d["group"] == "wording"]
    years = [d for d in real if d["kind"] == "text" and d["side"] == "C" and len(d["tw"]) == 1 and len(d["te"]) == 1
             and re.fullmatch(r"(19|20)\d\d", d["tw"][0]) and re.fullmatch(r"(19|20)\d\d", d["te"][0])]
    if years:
        signs.append(f"a year differs in the text: web {years[0]['tw'][0]}, PDF {years[0]['te'][0]}")
    control = re.compile(r"version control|changes from", re.I)
    if any(d["kind"] == "text" and max(d["web_words"], d["pdf_words"]) >= PASSAGE
           and (control.match(d["w_head"] or "") or control.match(d["e_head"] or "")) for d in real):
        signs.append("the text under 'Version control' differs (what changed since the last version, or the feedback details)")
    passages = lambda side: sum(1 for d in real if d.get("size") == "passage" and d["kind"] == "text" and (d["web_words"] if side == "web" else d["pdf_words"]) >= PASSAGE)
    if passages("web") >= 3 and passages("pdf") >= 3:
        signs.append(f"passages of text on both sides that the other lacks: {passages('web')} on the web, {passages('pdf')} in the PDF")
    return signs


# ------------------------------------------------------------------------------------------- the comparison

def _in_opening(d: dict) -> bool:
    """Is this difference inside the Executive summary or the Assessment: the part a decision rests on?"""
    return bool(_OPENING.match((d["w_section"] or d["e_section"] or "").strip()))


def _opening_passage(d: dict) -> bool:
    """A difference of PASSAGE words or more in the opening. A 'Section updated' line is not one: it is a
    date, counted on its own."""
    return _in_opening(d) and d["kind"] != "section updated" and max(d["web_words"], d["pdf_words"]) >= PASSAGE


def _listed(d: dict) -> dict:
    """A difference as it is kept in a record: what it is, where, and each side's words, cut to length."""
    cut = lambda s: s if len(s) <= QUOTED else s[:QUOTED].rstrip() + " …"
    out = {"kind": d["kind"], "group": d["group"], "verdict": d["verdict"],
           "web": cut(d["web_shown"]), "pdf": cut(d["pdf_shown"]), "web_words": d["web_words"], "pdf_words": d["pdf_words"],
           "before": d["before"][-QUOTED_ROUND:], "after": d["after"][:QUOTED_ROUND],
           **({"before_pdf": d["before_pdf"][-QUOTED_ROUND:]} if d["before_pdf"][-QUOTED_ROUND:] != d["before"][-QUOTED_ROUND:] else {}),
           "where": {"heading": d["w_head_id"], "paragraph": d["w_para"], "section": d["w_section"], "page": d.get("page")}}
    if d.get("size"):
        out["size"] = d["size"]
    if d.get("second"):
        out["second"] = d["second"]
    if _in_opening(d):
        out["opening"] = True
        out["opening_passage"] = _opening_passage(d)
    return out


# ------------------------------------------------------------------------------------------- a second reader
# Rule 1 checks the extraction against the PDF's raw text, but both come from one program (PyMuPDF). Where
# that program misreads a PDF, the two agree with each other and a "difference" is confirmed that is not in
# the document. So each difference of wording is also put to a second program, poppler's pdftotext, which
# shares no code with the first. One it reads the way the WEB has it is not reported as real.

def read_pdf_second(path) -> list[str] | None:
    """The PDF's text page by page as poppler's pdftotext reads it; None where pdftotext is not installed or fails."""
    program = shutil.which("pdftotext")
    if not program:
        return None
    try:
        done = subprocess.run([program, "-enc", "UTF-8", str(path), "-"], capture_output=True, timeout=300)
    except (OSError, subprocess.TimeoutExpired):
        return None
    if done.returncode != 0:
        return None
    # Page numbers and "Back to Contents" are left out, as they are from the first reading: they sit between a
    # heading and the paragraph before it, and would hide every difference at the top or foot of a page.
    furniture = lambda line: _PAGE_NO.match(line.strip()) or _BACK.match(line.strip())
    return ["\n".join(line for line in page.split("\n") if not furniture(line)) for page in done.stdout.decode("utf-8", "replace").split("\f")]


def _has(run: list[str], there: list[str]) -> bool:
    """Is this run of words in the second reader's words? A footnote number set between two words, or stuck to
    the end of one ("persons4"), is passed over: readers place raised numbers differently."""
    if not run:
        return True
    same = lambda word, want: word == want or (word[-1:].isdigit() and word.rstrip("0123456789") == want and len(word) - len(want) <= 3)
    for start in range(len(there)):
        if not same(there[start], run[0]):
            continue
        at, k, passed = start, 0, 0
        while at < len(there) and k < len(run):
            if same(there[at], run[k]):
                at, k = at + 1, k + 1
            elif there[at].isdigit() and len(there[at]) <= 3 and passed < 3:
                at, passed = at + 1, passed + 1
            else:
                break
        if k == len(run):
            return True
    return False


def _second_opinion(t: _Texts, d: dict, pages: list[list[str]]) -> str:
    """What the second reader says of one difference: "agrees" (it reads the PDF as our extraction does),
    "disputes" (it reads the PDF the way the web has it: the difference is in our reading, not the document)
    or "cannot tell". The test needs the shared words on both sides of the difference: with one side only, a
    version that simply lacks the words would always seem to be there. A reworded place can be told with one."""
    (i1, i2), (j1, j2) = d["i"], d["j"]
    web_run, pdf_run = t.a[i1:i2], t.b[j1:j2]
    page = d.get("page")
    there = [w for p in (pages[max(0, page - 2):page + 1] if page else pages) for w in p]

    def reads(run, before, after):
        if len(run) <= 8:
            return _has(before + run + after, there)
        return _has(before + run[:6], there) and _has(run[-6:] + after, there)      # a long passage: its two ends

    for k in (4, 3, 2):
        before, after = t.a[max(0, i1 - k):i1], t.a[i2:i2 + k]
        if len(before) < 2 or len(after) < 2:
            continue
        as_web, as_pdf = reads(web_run, before, after), reads(pdf_run, before, after)
        if as_web != as_pdf:
            return "disputes" if as_web else "agrees"
        if as_web:
            return "cannot tell"                              # both are there: a phrase the page repeats
    if web_run and pdf_run:
        for before, after in ((t.a[max(0, i1 - 4):i1], []), ([], t.a[i2:i2 + 4])):
            if len(before) + len(after) >= 2:
                as_web, as_pdf = reads(web_run, before, after), reads(pdf_run, before, after)
                if as_web != as_pdf:
                    return "disputes" if as_web else "agrees"
    return "cannot tell"


def compare(web_html: str, extraction_html: str, raw, second: list[str] | None = None) -> dict:
    """The web version of a note against its PDF. Pure: no file is read and nothing is written.

    web_html is GOV.UK's body as stored; extraction_html is pdftext's reading of the PDF; raw is the PDF's
    own text (`read_pdf(path)`, or a list of each page's `get_text()`). Returns the word counts on each side,
    a summary (the words that really differ, by group and by kind; the wording share, which is the figure
    that matters; what is ours; what else differs by count; any signs of different drafts) and the
    differences themselves, the real ones first and largest first, cut to LISTED.

    second: the PDF's pages as a second program reads them (`read_pdf_second`). Each difference of wording is
    put to it; one it disputes is left unresolved, not real."""
    if isinstance(raw, (list, tuple)):
        raw = raw_from_text(list(raw))
    t = _Texts(web_html, extraction_html, raw)
    matching = _matching(t.a, t.b)
    found = _settle(t, [_examine(t, gap) for gap in _gaps(t.a, t.b, matching)])
    opinions = Counter()
    pages = None
    if second is not None:
        pages = [words(page) for page in second]
        for d in found:
            if d["verdict"] == "real" and d["group"] == "wording":
                d["second"] = _second_opinion(t, d, pages)
                opinions[d["second"]] += 1
                if d["second"] == "disputes":
                    d["verdict"] = "unresolved"
                    d.pop("size", None)
    counts = _counts(t, raw)
    real = [d for d in found if d["verdict"] == "real"]
    groups = {g: {"differences": 0, "web_words": 0, "pdf_words": 0} for g in GROUPS}
    kinds: dict[str, dict] = {}
    for d in real:
        for tally in (groups[d["group"]], kinds.setdefault(d["kind"], {"differences": 0, "web_words": 0, "pdf_words": 0})):
            tally["differences"] += 1
            tally["web_words"] += d["web_words"]
            tally["pdf_words"] += d["pdf_words"]
    other = {v: {"differences": sum(1 for d in found if d["verdict"] == v),
                 "web_words": sum(len(d["tw"]) for d in found if d["verdict"] == v),
                 "pdf_words": sum(len(d["te"]) for d in found if d["verdict"] == v)} for v in ("artefact", "moved", "unresolved")}
    wording = [d for d in real if d["group"] == "wording"]
    opening = [d for d in wording if _in_opening(d)]
    total = len(t.a) + len(t.b)
    differing = groups["wording"]["web_words"] + groups["wording"]["pdf_words"]
    order = lambda d: (d["group"] != "wording", -(d["web_words"] + d["pdf_words"]), d["i"][0])
    summary = {
        "wording": {**groups["wording"], "share": round(differing / total, 6) if total else 0.0,
                    "passages": sum(1 for d in wording if d.get("size") == "passage"),
                    "sizes": dict(Counter(d["size"] for d in wording))},
        "opening": {"differences": len(opening), "passages": sum(1 for d in opening if _opening_passage(d)),
                    "words": sum(d["web_words"] + d["pdf_words"] for d in opening)},
        "groups": groups, "kinds": dict(sorted(kinds.items())),
        "ours": other["artefact"], "moved": other["moved"], "unresolved": other["unresolved"],
        **counts, "drafts": _drafts(found, counts),
        "second": {"reader": "pdftotext" if second is not None else None, "agrees": opinions["agrees"],
                   "cannot_tell": opinions["cannot tell"], "disputes": opinions["disputes"]},
    }
    return {"method": METHOD, "words": {"web": len(t.a), "pdf": len(t.b)}, "summary": summary,
            "differences": [_listed(d) for d in sorted(real, key=order)[:LISTED]],
            "ours": [_listed(d) for d in sorted((d for d in found if d["verdict"] == "artefact"), key=order)[:LISTED_OURS]],
            "unresolved": [_listed(d) for d in sorted((d for d in found if d["verdict"] == "unresolved"), key=order)[:LISTED_OURS]],
            "not_listed": max(0, len(real) - LISTED), "paragraphs": _paragraph_numbers(t, matching, pages)}


OPENING = 4                      # words after a paragraph's number that say which paragraph it is


def _paragraph_numbers(t: _Texts, matching: list[tuple], second: list[list[str]] | None = None) -> dict:
    """Each numbered paragraph and section of the web version against the same one in the PDF: how many carry
    the same number, those numbered differently ({web number: PDF number}), and those the PDF does not number.
    This is what a citation needs: "para 18.4.1" of the web version can be 18.3.1 in the PDF.

    A paragraph is found in the PDF by its first words: the first of the four after its number that the two
    versions share, standing at the same place in its block. One that opens differently in the PDF is left
    out, not guessed at.

    A number the web version uses more than once says nothing about which paragraph is meant (Iran, Kurds and
    Kurdish political groups, October 2025: "12.2.5" is a paragraph of section 12 and one of section 14). It
    is listed under `repeated` and left out of everything else: a map keyed by it would give one paragraph
    the other's PDF number.

    The numbers are the extraction's reading of the PDF. second: the PDF's pages as a second program reads
    them, as words. A different number is then kept only if that reader has it too, straight before the
    paragraph's opening words. The web numbers of those it does not have are listed under `unconfirmed`:
    for them, as for `repeated`, no PDF number can be given, and none must be assumed. A citation should
    still say which version it is of."""
    across = {i + k: j + k for i, j, n in matching for k in range(n)}
    first: dict[int, int] = {}
    for i, word in enumerate(t.ws):
        first.setdefault(word[1], i)
    numbered = lambda b: bool(b["lead"]) and b["fn"] is None and b["table"] is None
    uses = Counter(b["lead"] for b in t.wb if numbered(b))
    there_words = [w for page in second for w in page] if second is not None else None
    starts: dict[str, list[int]] = {}
    for k, w in enumerate(there_words or []):
        starts.setdefault(w, []).append(k)
    same, different, unnumbered, unconfirmed = 0, {}, [], []

    def second_has(b: dict) -> bool:
        """Does the second reader have this PDF paragraph's number straight before its opening words?"""
        if there_words is None:
            return True
        number = _lead_words(b)
        run = words(b["text"])[:number + OPENING]
        return any(_has(run, there_words[k:k + len(run) + 3]) for k in starts.get(run[0], ()))

    def opposite(b: dict, stream: list[tuple], start: int, other: list[tuple], blocks_there: list[dict], over: dict):
        """The block on the other side that opens with the same words as b, if one does."""
        for i in range(start, min(start + 4, len(stream))):
            if stream[i][1] != b["n"]:
                return None
            if i in over:
                _, block, _, _, place, _ = other[over[i]]
                there = blocks_there[block]
                return there if place - _lead_words(there) == i - start else None      # else: the same words further into another paragraph
        return None

    for b in t.wb:
        if not numbered(b) or uses[b["lead"]] > 1 or b["n"] not in first:
            continue
        there = opposite(b, t.ws, first[b["n"]] + _lead_words(b), t.es, t.eb, across)
        if there is None:
            continue
        if there["lead"] == b["lead"]:
            same += 1
        elif not there["lead"]:
            unnumbered.append(b["lead"])
        elif second_has(there):
            different[b["lead"]] = there["lead"]
        else:
            unconfirmed.append(b["lead"])
    # The other way: paragraphs the PDF numbers and the web version does not (a few notes have no paragraph
    # numbers on the web at all). Counted only: a citation of the web version has no number to give for them.
    back = {j: i for i, j in across.items()}
    first_there: dict[int, int] = {}
    for j, word in enumerate(t.es):
        first_there.setdefault(word[1], j)
    web_unnumbered = 0
    for b in t.eb:
        if not numbered(b) or b["n"] not in first_there:
            continue
        here = opposite(b, t.es, first_there[b["n"]] + _lead_words(b), t.ws, t.wb, back)
        web_unnumbered += bool(here is not None and not here["lead"])
    return {"same": same, "different": different, "pdf_unnumbered": unnumbered, "web_unnumbered": web_unnumbered,
            "repeated": [lead for lead, n in uses.items() if n > 1], "unconfirmed": unconfirmed}


# ---------------------------------------------------------------- in the store: data/pdfs/compare/
# One record per pair, named by the PDF's hash, small enough to commit: the full counts, and the differences
# themselves up to LISTED. It is made again only when the web body, the extractor or this method changes.

def compare_path(store, pdf_sha256: str):
    return store.root / "pdfs" / "compare" / f"{pdf_sha256}.json"


def load_comparison(store, pdf_sha256: str) -> dict | None:
    import json
    path = compare_path(store, pdf_sha256)
    return json.loads(path.read_text("utf-8")) if path.exists() else None


def _compare_one(job):
    """(label, pdf path, pdf sha, web body, web body sha) -> the record for that pair, for the pool."""
    from . import pdftext
    label, path, pdf_sha, web, body_sha = job
    try:
        result = compare(web, pdftext.pdf_to_html(path).html, read_pdf(path), second=read_pdf_second(path))
        return {"method": METHOD, "extractor": pdftext.EXTRACTOR, "note": label, "pdf_sha256": pdf_sha, "body_sha256": body_sha,
                **{k: v for k, v in result.items() if k != "method"}}
    except Exception as error:                            # one bad file must not stop the rest
        return {"note": label, "pdf_sha256": pdf_sha, "error": f"{type(error).__name__}: {error}"}


def compare_into_store(store, jobs: list, workers: int = 3, force: bool = False, log=lambda *a: None) -> dict:
    """Compare each web version with its PDF and keep the result: data/pdfs/compare/<pdf sha256>.json.
    jobs: [(label, pdf path, pdf sha, web body, web body sha)], as `./cpin pdftext --figures` takes them.
    A pair already compared by this METHOD and this EXTRACTOR for the same web body is left as it is (unless
    force): reading a PDF takes seconds to a minute, and a daily run should cost nothing when GOV.UK has
    published nothing. Returns { records (one per job that has one), done, done_before, errors }."""
    import json
    from multiprocessing import Pool

    from . import pdftext
    from .store import atomic_write
    current = lambda held: bool(held) and held.get("method") == METHOD and held.get("extractor") == pdftext.EXTRACTOR
    todo = [job for job in jobs if force or not (current(held := load_comparison(store, job[2])) and held.get("body_sha256") == job[4])]
    errors = []

    def keep(record):
        if "error" in record:
            errors.append(record)
            log(f"  {record['note']}: {record['error']}")
            return
        atomic_write(compare_path(store, record["pdf_sha256"]), (json.dumps(record, indent=1, ensure_ascii=False) + "\n").encode("utf-8"))
        wording = record["summary"]["wording"]
        log(f"  {record['note']}: {wording['web_words']} words only on the web, {wording['pdf_words']} only in the PDF"
            f" ({wording['share']:.3%} of the wording)")

    if workers > 1 and len(todo) > 1:
        with Pool(min(workers, len(todo))) as pool:
            for record in pool.imap_unordered(_compare_one, todo, chunksize=1):
                keep(record)
    else:
        for job in todo:
            keep(_compare_one(job))
    records = [held for job in jobs if (held := load_comparison(store, job[2])) and held.get("body_sha256") == job[4]]
    return {"records": records, "done": len(todo) - len(errors), "done_before": len(jobs) - len(todo), "errors": errors}


# ------------------------------------------------------------------------------------------- the standard table

def summarise(records: list[dict]) -> dict:
    """The standard table over a set of records (docs/methods/pdf-and-web.md, rule 3): genuine wording
    differences as a share of a note's words at the best note, the middle one, the worst tenth and the worst,
    each with its words; the notes to open and read (at or over FLAG_SHARE of their words, or with a real
    difference of PASSAGE words or more inside the Executive summary or Assessment); the notes that show
    signs of being different drafts; and the totals by group. Never one figure, never a mean alone."""
    notes = []
    for r in records:
        s = r["summary"]
        wording = s["wording"]
        largest = next((d for d in r["differences"] if d["group"] == "wording"), None)
        opening = next((d for d in r["differences"] if d["group"] == "wording" and d.get("opening_passage")), None)
        notes.append({"note": r["note"], "pdf_sha256": r["pdf_sha256"], "share": wording["share"],
                      "web_only": wording["web_words"], "pdf_only": wording["pdf_words"], "words": r["words"],
                      "opening_passages": s["opening"]["passages"], "drafts": s["drafts"],
                      "largest": largest, "largest_in_opening": opening})
    ranked = sorted(notes, key=lambda n: (n["share"], n["web_only"] + n["pdf_only"]))
    at = lambda q: ranked[min(len(ranked) - 1, int(len(ranked) * q))] if ranked else None
    point = lambda n: None if n is None else {"note": n["note"], "share": n["share"], "words": n["web_only"] + n["pdf_only"]}
    flagged = [n for n in reversed(ranked) if n["share"] >= FLAG_SHARE or n["opening_passages"]]
    groups = {g: {"web_words": sum(r["summary"]["groups"][g]["web_words"] for r in records),
                  "pdf_words": sum(r["summary"]["groups"][g]["pdf_words"] for r in records),
                  "differences": sum(r["summary"]["groups"][g]["differences"] for r in records),
                  "notes": sum(1 for r in records if r["summary"]["groups"][g]["differences"])} for g in GROUPS}
    total = lambda key: {k: sum(r["summary"][key][k] for r in records) for k in ("differences", "web_words", "pdf_words")}
    differs = lambda test: sum(1 for r in records if test(r["summary"]))
    return {
        "method": METHOD, "pairs": len(records),
        "words": {"web": sum(r["words"]["web"] for r in records), "pdf": sum(r["words"]["pdf"] for r in records)},
        "wording": {"best": point(at(0)), "median": point(at(0.5)), "worst_tenth": point(at(0.9)), "worst": point(ranked[-1] if ranked else None),
                    "none": sum(1 for n in notes if n["web_only"] + n["pdf_only"] == 0),
                    "at_half_percent": sum(1 for n in notes if n["share"] >= 0.005), "at_one_percent": sum(1 for n in notes if n["share"] >= 0.01)},
        "flagged": flagged, "drafts": [n for n in reversed(ranked) if n["drafts"]],
        "groups": groups, "ours": total("ours"), "moved": total("moved"), "unresolved": total("unresolved"),
        "second": {"notes_read": sum(1 for r in records if r["summary"].get("second", {}).get("reader")),
                   **{k: sum(r["summary"].get("second", {}).get(k, 0) for r in records) for k in ("agrees", "cannot_tell", "disputes")}},
        "counts": {"footnotes_differ": differs(lambda s: s["footnotes"]["differ"]),
                   "boxes_differ": differs(lambda s: s["boxes"]["web"] != s["boxes"]["pdf"]),
                   "notices_differ": differs(lambda s: s["boxes"]["web_notices"] != s["boxes"]["pdf_notices"]),
                   "section_updated_differ": differs(lambda s: not s["section_updated"]["same"]),
                   "version_differs": differs(lambda s: bool(s["version"]["web"] and s["version"]["pdf"] and s["version"]["web"] != s["version"]["pdf"])),
                   "version_missing_on_web": differs(lambda s: bool(s["version"]["pdf"]) and not s["version"]["web"]),
                   "pictures_fewer_on_web": differs(lambda s: s["pictures"]["web"] < s["pictures"]["pdf"])},
    }


def table(summary: dict) -> list[str]:
    """The summary as lines to print: the same table every time, so two runs can be read side by side."""
    w = summary["wording"]
    show = lambda p: "none" if p is None else f"{p['share']:.3%} ({p['words']} words)"
    out = [f"compare ({summary['method']}): {summary['pairs']} notes with a web version and a PDF"
           f" · {summary['words']['web']:,} web words · {summary['words']['pdf']:,} PDF words",
           "  genuine wording differences, as a share of a note's words (real: confirmed in the PDF's raw text):",
           f"    best {show(w['best'])} · middle note {show(w['median'])} · worst tenth {show(w['worst_tenth'])} · worst {show(w['worst'])}",
           f"    no difference of wording: {w['none']} notes · at or over 0.5%: {w['at_half_percent']} · at or over 1%: {w['at_one_percent']}",
           "  words in real differences, by group (only on the web / only in the PDF / notes):"]
    names = {"wording": "wording", "numbering": "paragraph and section numbers", "picture": "words for a picture",
             "withheld": "withheld-section notices", "address": "addresses shown as text", "form": "list markers, spacing, labels",
             "furniture": "furniture and version line"}
    for g, label in names.items():
        t = summary["groups"][g]
        out.append(f"    {label:32} {t['web_words']:7,} / {t['pdf_words']:7,} / {t['notes']:3}")
    o, u, m = summary["ours"], summary["unresolved"], summary["moved"]
    out.append(f"  not differences: {o['differences']} ours (extraction artefacts, {o['web_words'] + o['pdf_words']:,} words)"
               f" · {m['differences']} the same words in another place · {u['differences']} unresolved ({u['web_words'] + u['pdf_words']} words)")
    sec = summary["second"]
    out.append(f"  a second reader of the PDFs (pdftotext, {sec['notes_read']} of {summary['pairs']} notes): agrees with {sec['agrees']:,} differences of wording"
               f" · cannot tell for {sec['cannot_tell']:,} · disputes {sec['disputes']:,} (left unresolved, not counted)"
               if sec["notes_read"] else "  a second reader of the PDFs: pdftotext is not installed, so no difference was put to one")
    c = summary["counts"]
    out.append(f"  by count: footnotes differ in {c['footnotes_differ']} notes · withheld boxes in {c['boxes_differ']} · their notices in {c['notices_differ']}"
               f" · 'Section updated' lines in {c['section_updated_differ']} · version number in {c['version_differs']}"
               f" (not shown at the top of the web version in {c['version_missing_on_web']}) · fewer pictures on the web in {c['pictures_fewer_on_web']}")
    out.append(f"  notes to read ({len(summary['flagged'])}): at or over {FLAG_SHARE:.1%}, or a difference of {PASSAGE}+ words in the Executive summary or Assessment")
    for n in summary["flagged"]:
        d = n["largest_in_opening"] or n["largest"]
        where = ""
        if d:
            at = d["where"]
            place = " ".join(x for x in (f"para {at['paragraph']}" if at["paragraph"] else "", f"PDF p.{at['page']}" if at["page"] else "") if x)
            side = "web only" if d["web_words"] and not d["pdf_words"] else "PDF only" if d["pdf_words"] and not d["web_words"] else "differs"
            words_ = " ".join((d["pdf"] or d["web"]).split())
            where = f" · {d['kind']}, {side}{', ' + place if place else ''}: “{words_[:90]}{'…' if len(words_) > 90 else ''}”"
        out.append(f"    {n['share']:.2%}  web {n['web_only']}, PDF {n['pdf_only']} words  {n['note']}{where}")
    out.append(f"  signs of different drafts under one version number ({len(summary['drafts'])} notes):")
    for n in summary["drafts"]:
        out.append(f"    {n['note']}: {'; '.join(n['drafts'])}")
    return out
