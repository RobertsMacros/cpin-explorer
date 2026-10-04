"""Hashes and plain-text views of a note body.

The stored body is never altered. These are derived views, used to compare versions and to
cross-check the HTML edition of a note against its PDF.
"""
import hashlib
import re

from lxml import html as lxml_html

# The number ends where the digits end: list items can run together in the text ("version 5.0valid from").
VERSION_RE = re.compile(r"\bversion\s+(\d+\.\d+)(?![\d.]\d)", re.IGNORECASE)


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_text(text: str) -> str:
    return sha256_bytes(text.encode("utf-8"))


def visible_text(body_html: str, *, drop_footnote_refs: bool = False) -> str:
    """The text a reader sees, with whitespace collapsed.

    drop_footnote_refs removes inline markers such as '[footnote 12]', which the PDF edition
    renders as superscript digits instead.
    """
    if not body_html or not body_html.strip():
        return ""
    root = lxml_html.fragment_fromstring(body_html, create_parent="div")
    for el in root.xpath("//script|//style"):
        el.drop_tree()
    if drop_footnote_refs:
        for el in root.xpath("//sup[a[starts-with(@href, '#fn')]] | //a[@role='doc-noteref']"):
            el.drop_tree()
    return " ".join(root.text_content().split())


# What the text fingerprint does not see: white space of any kind, and the arrow that leads back from a
# footnote (with the selectors that only say how to draw it).
_UNSEEN = re.compile("[\\s\u21a9\ufe0e\ufe0f]+")


def text_sha256(body_html: str) -> str:
    """A fingerprint of the words alone, to tell a change of wording from a change of markup.

    Blind to all white space and to the footnote return arrow. An archive page is the same body written
    out again by a browser, and differs from GOV.UK's in just those: a space after a line break, none
    before the arrow. Counted, they made 79 of 215 consecutive "editions" out of copies of one text. A
    letter, a digit or a punctuation mark that differs still gives another fingerprint.

    Indexes store this value, so after changing it run `./cpin rederive`."""
    return sha256_text(_UNSEEN.sub("", visible_text(body_html)))


# A note states its own version in two places: just under 'Version control' ("… when this note was
# cleared: version 5.0", within about 80 characters in every edition held) and in the banner at its very
# top ("Version 3.0, October 2024"). A 'version N.N' anywhere else is about another document: Albania's
# 2026 bulletin on trafficking has no version of its own but cites "the … CPIN (version 16.0)".
_VERSION_WINDOW = 200


def version_banner(body_html: str) -> str | None:
    """The note's own version number, e.g. '5.0', preferring the 'Version control' section; None when
    the note does not state one (some country bulletins)."""
    text = visible_text(body_html)
    section = re.search(r"version control", text, re.IGNORECASE)
    hit = VERSION_RE.search(text, section.end(), section.end() + _VERSION_WINDOW) if section else None
    hit = hit or VERSION_RE.search(text, 0, _VERSION_WINDOW)
    return hit.group(1) if hit else None
