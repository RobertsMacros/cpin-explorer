import json

import httpx
import pytest

from cpin import config
from cpin.http import PoliteClient
from cpin.store import Store

COLLECTION_URL = config.CONTENT_API + config.COLLECTION_PATH


class FakeSite:
    """A tiny stand-in for GOV.UK: url -> (content bytes, etag). Records every request."""

    def __init__(self):
        self.routes: dict[str, tuple[bytes, str | None, int, str]] = {}
        self.requests: list[str] = []

    def json(self, url, obj, etag=None):
        self.routes[url] = (json.dumps(obj, ensure_ascii=False).encode("utf-8"), etag, 200, "application/json")

    def raw(self, url, data: bytes, etag=None, content_type="application/octet-stream"):
        self.routes[url] = (data, etag, 200, content_type)

    def fail(self, url, status=500):
        self.routes[url] = (b"", None, status, "")

    def handler(self, request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        if request.url.path == "/robots.txt":
            return httpx.Response(404)
        self.requests.append(url)
        if url not in self.routes:
            return httpx.Response(404)
        content, etag, status, content_type = self.routes[url]
        if status != 200:
            return httpx.Response(status)
        if etag and request.headers.get("if-none-match") == etag:
            return httpx.Response(304, headers={"etag": etag})
        headers = {"content-type": content_type, **({"etag": etag} if etag else {})}
        return httpx.Response(200, content=content, headers=headers)


@pytest.fixture
def site():
    return FakeSite()


@pytest.fixture
def client(site):
    c = PoliteClient(transport=httpx.MockTransport(site.handler), sleep=lambda s: None, max_retries=1)
    yield c
    c.close()


@pytest.fixture
def store(tmp_path):
    return Store(tmp_path / "data")


PUB_PATH = "/government/publications/kenya-country-policy-and-information-notes"
NOTE_PATH = PUB_PATH + "/country-policy-and-information-note-actors-of-protection-kenya-july-2026-accessible"
PDF_URL = "https://assets.publishing.service.gov.uk/media/abc/Kenya_CPIN_Actors_of_protection.pdf"
# Deliberately awkward: curly quotes, a non-breaking space, a footnote ref, odd whitespace.
BODY = ('<div class="govspeak"><h2 id="assessment">Assessment</h2>\n'
        '<p>In general, the state is willing and able to offer ‘effective’ protection.'
        '<sup id="fnref:1"><a href="#fn:1" class="footnote" role="doc-noteref">[footnote 1]</a></sup></p>  \n'
        '<p>See <a href="https://example.org/report">the source report</a>.</p>'
        '<p>Version control and feedback. This is Version 2.0 of the note.</p></div>')


def govuk(site, *, body=BODY, pub_updated="2026-07-27T15:09:18+01:00", collection_etag='W/"c1"',
          with_note=True, with_pdf=True, pdf=b"%PDF-1.4 fake"):
    """Populate the fake site with one country (Kenya) holding one HTML note and its PDF."""
    site.json(COLLECTION_URL, {"links": {"documents": [{
        "title": "Kenya: country policy and information notes", "base_path": PUB_PATH,
        "content_id": "k1", "public_updated_at": pub_updated}]}}, etag=collection_etag)
    attachments = []
    if with_note:
        attachments.append({"attachment_type": "html", "url": NOTE_PATH,
                            "title": "Country policy and information note: actors of protection, Kenya, July 2026 (accessible)"})
    if with_pdf:
        attachments.append({"attachment_type": "file", "url": PDF_URL, "content_type": "application/pdf",
                            "title": "Country policy and information note: actors of protection, Kenya, July 2026"})
    site.json(config.CONTENT_API + PUB_PATH, {"title": "Kenya: country policy and information notes",
                                              "schema_name": "publication", "base_path": PUB_PATH,
                                              "public_updated_at": pub_updated,
                                              "details": {"attachments": attachments, "change_history": []}})
    site.json(config.CONTENT_API + NOTE_PATH, {
        "title": "Country policy and information note: actors of protection, Kenya, July 2026 (accessible)",
        "schema_name": "html_publication", "public_updated_at": "2026-07-27T15:09:18+01:00",
        "details": {"body": body, "headers": []}})
    site.raw(PDF_URL, pdf, etag='"p1"')
