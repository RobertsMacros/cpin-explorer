"""Links inside a note body: the sources the Home Office cites and its cross-references.

Bodies are stored verbatim, so every link is preserved as published. This module only lists
them, which the verification report and (later) the link checker use.
"""
from urllib.parse import urlsplit

from lxml import html as lxml_html


def classify(href: str, role: str | None = None) -> str:
    if href.startswith("#fn") or role in ("doc-noteref", "doc-backlink"):
        return "footnote"
    if href.startswith("#"):
        return "anchor"
    if href.startswith("mailto:"):
        return "mailto"
    host = urlsplit(href).netloc
    if href.startswith("/") or host.endswith("gov.uk"):
        return "govuk"
    return "external"


def extract_links(body_html: str) -> list[dict]:
    if not body_html or not body_html.strip():
        return []
    root = lxml_html.fragment_fromstring(body_html, create_parent="div")
    links = []
    for a in root.iter("a"):
        href = a.get("href")
        if href:
            links.append({"href": href, "text": " ".join(a.text_content().split()),
                          "kind": classify(href, a.get("role"))})
    return links
