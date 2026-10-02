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


def change_statement(body_html: str) -> str | None:
    """The 'Changes from last version of this note' text, verbatim, or None."""
    if not body_html or "ast version of this" not in body_html:
        return None
    root = lxml_html.fragment_fromstring(body_html, create_parent="div")
    for el in root.iter():
        if not isinstance(el.tag, str) or not _is_heading(el) or not _STATEMENT_RE.match(_text(el)):
            continue
        parts = []
        for sib in el.itersiblings():
            if not isinstance(sib.tag, str) or _is_heading(sib) or sib.tag == "div":
                break                      # next heading, the footnotes or a notice box
            text = _text(sib)
            if text:
                parts.append(text)
        return " ".join(parts) or None
    return None


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


def matching_change_notes(history: list[dict], date: str | None, topic_words: set[str], days: int = 21) -> list[dict]:
    """GOV.UK change notes (verbatim) dated near an edition and mentioning its topic."""
    if not date or not topic_words:
        return []
    when = datetime.fromisoformat(date.replace("Z", "+00:00"))
    hits = []
    for h in history:
        if not h.get("date"):
            continue
        delta = datetime.fromisoformat(h["date"].replace("Z", "+00:00")) - when
        words = set(re.findall(r"[a-z0-9]+", h["note"].lower()))
        if timedelta(days=-days) <= delta <= timedelta(days=days) and topic_words & words:
            hits.append(h)
    return hits
