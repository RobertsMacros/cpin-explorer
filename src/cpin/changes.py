"""What changed in an edition, in the Home Office's own words.

Most notes end with a version-control section: the version, the date it is valid from, and
'Changes from last version of this note' followed by a sentence or two. Both are read verbatim
from the stored body. GOV.UK's own change notes on the country page are matched to an edition
by date and topic as a second source.
"""
import re
from datetime import datetime, timedelta

from lxml import html as lxml_html

_STATEMENT_RE = re.compile(r"^\s*changes from (?:the )?last version of this", re.IGNORECASE)
# No leading \b: list items can run together in text ('version 5.0valid from ...').
_VALID_FROM_RE = re.compile(r"(?<![a-z])valid from\s+(\d{1,2}\s+[A-Za-z]+\s+\d{4})", re.IGNORECASE)
_HEADINGS = {"h1", "h2", "h3", "h4", "h5", "h6"}


def _text(el) -> str:
    for sup in el.xpath(".//sup[a[starts-with(@href, '#fn')]] | .//a[@role='doc-noteref']"):
        sup.drop_tree()
    return " ".join(el.text_content().split())


def _is_heading(el) -> bool:
    if el.tag in _HEADINGS:
        return True
    # Older notes use a paragraph that is all bold as a heading.
    strong = el.xpath("./strong|./b")
    return el.tag == "p" and len(strong) == 1 and _text(strong[0]) == _text(el)


def _statement_blocks(body_html: str) -> list:
    """The elements after the 'Changes from last version of this note' heading, up to the next one."""
    if not body_html or "ast version of this" not in body_html:
        return []
    root = lxml_html.fragment_fromstring(body_html, create_parent="div")
    for el in root.iter():
        if not isinstance(el.tag, str) or not _is_heading(el) or not _STATEMENT_RE.match(_text(el)):
            continue
        blocks = []
        for sib in el.itersiblings():
            if not isinstance(sib.tag, str) or _is_heading(sib) or sib.tag == "div":
                break                      # next heading, the footnotes or a notice box
            blocks.append(sib)
        return blocks
    return []


def change_statement(body_html: str) -> str | None:
    """The statement's prose, verbatim, for a one-line caption. Tables are left out of the caption
    (they read as a jumble when flattened); change_statement_html keeps them."""
    parts = [_text(b) for b in _statement_blocks(body_html) if b.tag != "table" and not b.xpath(".//table")]
    return " ".join(p for p in parts if p) or None


def change_statement_html(body_html: str) -> str | None:
    """The whole statement as verbatim HTML (paragraphs, lists and tables), footnote markers removed."""
    blocks = _statement_blocks(body_html)
    if not blocks:
        return None
    html = []
    for b in blocks:
        for sup in b.xpath(".//sup[a[starts-with(@href, '#fn')]] | .//a[@role='doc-noteref']"):
            sup.drop_tree()
        html.append(lxml_html.tostring(b, encoding="unicode", with_tail=False).strip())
    return "\n".join(html) or None


def valid_from(body_html: str) -> str | None:
    """'valid from 9 February 2022' in the version-control section, as an ISO date."""
    if not body_html:
        return None
    m = _VALID_FROM_RE.search(" ".join(lxml_html.fragment_fromstring(body_html, create_parent="div").text_content().split()))
    if not m:
        return None
    try:
        return datetime.strptime(m.group(1), "%d %B %Y").strftime("%Y-%m-%dT00:00:00Z")
    except ValueError:
        return None


def matching_change_notes(history: list[dict], date: str | None, topic_words: set[str], days: int = 21,
                          month: bool = False) -> list[dict]:
    """GOV.UK change notes (verbatim) dated near an edition and mentioning its topic.

    month: the edition's date is known only to the month (`date` is its first day). Any day of that month
    may be the one, so the notes looked at run from `days` before the first to `days` after the last."""
    if not date or not topic_words:
        return []
    when = datetime.fromisoformat(date.replace("Z", "+00:00"))
    last = (when.replace(day=28) + timedelta(days=4)).replace(day=1) if month else when       # the month's end
    hits = []
    for h in history:
        if not h.get("date"):
            continue
        at = datetime.fromisoformat(h["date"].replace("Z", "+00:00"))
        words = set(re.findall(r"[a-z0-9]+", h["note"].lower()))
        if when - timedelta(days=days) <= at <= last + timedelta(days=days) and topic_words & words:
            hits.append(h)
    return hits
