"""Recovering removed editions from the Internet Archive: parsing archived pages, the catalogue,
and the fetch. The Archive here is a dictionary; nothing touches the network."""
import json
import re

import httpx
import pytest
from conftest import NOTE_PATH, PDF_URL, PUB_PATH, govuk

from cpin import config, recover
from cpin.fingerprint import sha256_bytes
from cpin.http import PoliteClient
from cpin.recover import (CATALOGUE, Guard, Stopped, asset_key, pair_attachments, parse_collection_page,
                          parse_country_page, pdf_problem, sha1_base32)
from cpin.sync import sync

OLD_PATH = "/government/publications/kenia-country-policy-and-information-notes"
GONE_PATH = "/government/publications/angola-country-policy-and-information-notes"
COLLECTION = config.GOVUK + config.COLLECTION_PATH

# GOV.UK's layout to about 2023: a relative link to www.gov.uk's own uploads, an <h2 class="title">.
OLD_ATTACHMENT = """
<section class="attachment embedded" id="attachment_1800387">
  <div class="attachment-thumb"><a aria-hidden="true" class="thumbnail" href="{href}"><img alt="" src="t.png"></a></div>
  <div class="attachment-details">
    <h2 class="title"><a aria-describedby="x" href="{href}">{title}</a></h2>
    <p class="metadata"><span class="type"><abbr title="Portable Document Format">PDF</abbr></span>,
       <span class="file-size">451KB</span>, <span class="page-length">44 pages</span></p>
    <div class="accessibility-warning"><h2>This file may not be suitable for users of assistive technology.
       <a class="toggler" href="#request">Request an accessible format.</a></h2></div>
  </div>
</section>"""
# The later layout: gem-c-attachment, absolute asset links, an HTML attachment beside its PDF.
NEW_ATTACHMENT = """
<section data-module="ga4-link-tracker" class="gem-c-attachment govuk-!-margin-bottom-6">
  <div class="gem-c-attachment__thumbnail govuk-!-display-none-print"><a class="govuk-link" href="{href}"><svg></svg></a></div>
  <div class="gem-c-attachment__details">
    <h3 class="gem-c-attachment__title"><a class="govuk-link gem-c-attachment__link" href="{href}">{title}</a></h3>
    <p class="gem-c-attachment__metadata">{meta}</p>
  </div>
</section>"""
PDF_META = ('<span class="gem-c-attachment__attribute"><abbr title="Portable Document Format">PDF</abbr></span>, '
            '<span class="gem-c-attachment__attribute">1.18 MB</span>, <span class="gem-c-attachment__attribute">80 pages</span>')
HTML_META = '<span class="gem-c-attachment__attribute">HTML</span>'

V1_HREF = "/government/uploads/system/uploads/attachment_data/file/566222/Kenya_security_v1.pdf"
V1_TITLE = "Country information and guidance: Kenya, security situation, June 2015"
V2_URL = "https://assets.publishing.service.gov.uk/government/uploads/system/uploads/attachment_data/file/784644/Kenya_security_v2.0.pdf"
V2_TITLE = "Country policy and information note: security situation, Kenya, March 2019"
OLD_NOTE = OLD_PATH + "/country-policy-and-information-note-security-situation-kenya-may-2022-accessible"
PDF_V1 = b"%PDF-1.4\nfirst edition\n%%EOF\n"


def page(*attachments, title="Kenya: country policy and information notes"):
    return f"<html><body><h1>{title}</h1>{''.join(attachments)}</body></html>".encode()


def old(href, title):
    return OLD_ATTACHMENT.format(href=href, title=title)


def new(href, title, meta=PDF_META):
    return NEW_ATTACHMENT.format(href=href, title=title, meta=meta)


# --- Parsing ---------------------------------------------------------------------------------------
def test_old_layout_gives_absolute_url_title_size_and_pages():
    [a] = parse_country_page(page(old(V1_HREF, V1_TITLE)))
    assert a == {"kind": "file", "url": config.GOVUK + V1_HREF, "title": V1_TITLE, "type": "PDF",
                 "size": "451KB", "pages": 44}


def test_new_layout_lists_html_and_pdf_in_page_order():
    html = parse_country_page(page(
        new(NOTE_PATH, "Country policy and information note: actors of protection, Kenya, July 2026 (accessible)", HTML_META),
        new(PDF_URL, "Country policy and information note: actors of protection, Kenya, July 2026")))
    assert [(a["kind"], a["type"], a["size"], a["pages"]) for a in html] == [
        ("html", "HTML", None, None), ("file", "PDF", "1.18 MB", 80)]
    assert html[0]["url"] == config.GOVUK + NOTE_PATH
    assert pair_attachments(html, "Kenya") == {config.GOVUK + NOTE_PATH: PDF_URL}


def test_a_reference_number_is_not_the_file_type():
    meta = '<span class="gem-c-attachment__attribute">Ref: IRN-001-02-26</span>, ' + PDF_META
    [a] = parse_country_page(page(new(PDF_URL, "Country bulletin Iran: protests", meta)))
    assert (a["type"], a["size"], a["pages"]) == ("PDF", "1.18 MB", 80)


def test_an_empty_capture_lists_nothing():
    assert parse_country_page(b"") == [] and parse_country_page(b"   ") == [] and parse_collection_page("") == []


def test_collection_page_lists_country_pages_only():
    html = (f'<a href="{PUB_PATH}">Kenya: country policy and information notes</a>'
            f'<a href="https://www.gov.uk{OLD_PATH}">Kenia: country policy and information notes</a>'
            '<a href="/government/publications/some-other-guidance">Other guidance</a>'
            f'<a href="{PUB_PATH}/a-note">A note</a><a href="https://example.org{PUB_PATH}">elsewhere</a>')
    assert parse_collection_page(html) == [
        {"base_path": PUB_PATH, "title": "Kenya: country policy and information notes"},
        {"base_path": OLD_PATH, "title": "Kenia: country policy and information notes"}]


def test_a_file_is_the_same_file_on_either_host():
    assert asset_key(config.GOVUK + V1_HREF) == asset_key("https://assets.publishing.service.gov.uk" + V1_HREF) \
        == "attachment_data/566222"
    assert asset_key("https://assets.publishing.service.gov.uk/media/67360c8f2469c5b71dbc7b85/PSE+CPIN.pdf") \
        == "media/67360c8f2469c5b71dbc7b85"


def test_an_html_note_is_not_paired_with_another_editions_pdf():
    listed = parse_country_page(page(
        new(NOTE_PATH, "Country policy and information note: actors of protection, Kenya, July 2026 (accessible)", HTML_META),
        new(V2_URL, "Country policy and information note: actors of protection, Kenya, March 2019")))
    assert pair_attachments(listed, "Kenya") == {}
    retitled = parse_country_page(page(
        new(NOTE_PATH, "Country policy and information note: PKK, Kenya, July 2026 (accesible)", HTML_META),
        new(V2_URL, "Country policy and information note: Kurdistan Workers' Party (PKK), Kenya, July 2026")))
    assert pair_attachments(retitled, "Kenya") == {config.GOVUK + NOTE_PATH: V2_URL}


def test_a_file_moved_to_a_media_address_is_still_one_file():
    """GOV.UK moved uploads to /media/<id>/ in 2023: the same file, listed before and after, is one edition."""
    media = "https://assets.publishing.service.gov.uk/media/5c3f0f65e5274a6e4a5da041/Kenya_security_v2.0.pdf"
    before = {"timestamp": "20190401000000", "digest": "A", "attachments": parse_country_page(page(old(V2_URL, V2_TITLE)))}
    after = {"timestamp": "20231102000000", "digest": "B", "attachments": parse_country_page(page(new(media, V2_TITLE)))}
    items, pairs = recover.collect_items({OLD_PATH: [before, after]}, "Kenya")
    assert len(items) == 2                                   # two asset ids
    for item in items.values():
        item["url"], item["also_listed_as"], item["pages"] = item["urls"][-1], item["urls"][:-1], 67
    capture = {"timestamp": "20190726161037", "original": V2_URL, "mimetype": "application/pdf", "digest": "D1", "length": 5}
    items["file:attachment_data/784644"]["archive"] = [capture]
    merged, _ = recover.merge_same_files(dict(items), pairs)   # no capture of the later address: title, name, pages agree
    [only] = merged.values()
    assert (only["url"], only["also_listed_as"]) == (media, [V2_URL])
    assert (only["first_listed"], only["last_listed"]) == ("2019-04-01T00:00:00Z", "2023-11-02T00:00:00Z")
    assert only["archive"] == [capture]

    items, pairs = recover.collect_items({OLD_PATH: [before, after]}, "Kenya")
    for item, digest in zip(items.values(), ("D1", "D2")):     # both captured, with different content: two files
        item["url"], item["also_listed_as"], item["pages"] = item["urls"][-1], item["urls"][:-1], 67
        item["archive"] = [{**capture, "digest": digest}]
    assert len(recover.merge_same_files(items, pairs)[0]) == 2


def test_one_html_address_can_carry_several_editions(store):
    """GOV.UK edits an HTML attachment in place for the next edition: same address, new title and text."""
    feb, apr = "fear of the Taliban, Kenya, February 2022", "fear of the Taliban, Kenya, April 2022"
    pdf = "https://assets.publishing.service.gov.uk/government/uploads/system/uploads/attachment_data/file/{}/Taliban.pdf"
    states = [("20220213000000", feb, pdf.format(1)), ("20220501000000", apr, pdf.format(2))]
    listings = [{"timestamp": ts, "digest": ts, "attachments": parse_country_page(page(
        new(NOTE_PATH, f"Country policy and information note: {title} (accessible)", HTML_META),
        new(url, f"Country policy and information note: {title}")))} for ts, title, url in states]
    items, pairs = recover.collect_items({PUB_PATH: listings}, "Kenya")
    assert sorted(i["edition"] for i in items.values() if i["kind"] == "html") == ["2022-02", "2022-04"]
    assert all(len(files) == 1 for files in pairs.values()) and len(pairs) == 2      # each with its own PDF

    note = NOTE_PATH.rsplit("/", 1)[-1]
    store.record_version("kenya", note, body="<p>February text</p>", meta={}, seen_at="2026-10-03T00:00:00Z",
                         source="wayback", title=f"Country policy and information note: {feb} (accessible)",
                         base_path=NOTE_PATH, capture={"captured_at": "2022-02-14T00:00:00Z", "archive_url": "x", "digest": "F"})
    index = store.load_note("kenya", note)
    index["wayback_digests"] = ["F"]
    store.save_note("kenya", note, index)
    row = lambda ts, digest: {"timestamp": ts, "original": config.GOVUK + NOTE_PATH, "digest": digest}
    children = {NOTE_PATH: {"F": row("20220214000000", "F"), "A": row("20220601000000", "A")}}
    assert recover.html_holdings(items, children, store, "kenya", "Kenya", {}) == 1   # one capture not read yet
    by_edition = {i["edition"]: i for i in items.values() if i["kind"] == "html"}
    assert (by_edition["2022-02"]["held_versions"], by_edition["2022-02"]["captures_to_read"]) == (1, 0)
    assert (by_edition["2022-04"]["held_versions"], by_edition["2022-04"]["captures_to_read"]) == (0, 1)
    for item in items.values():
        if item["kind"] == "file":
            item.update(url=item["urls"][-1], also_listed_as=[], held=None, archive=[])
    statuses = {e["title"]: e["status"] for e in recover.build_editions(items, pairs)}
    assert statuses == {f"Country policy and information note: {feb}": "held",
                        f"Country policy and information note: {apr}": "recoverable-html"}


def test_only_a_whole_pdf_is_accepted():
    assert pdf_problem(PDF_V1) is None
    assert pdf_problem(b"<!DOCTYPE html><html>not found</html>").startswith("not a PDF")
    assert pdf_problem(b"%PDF-1.4\n" + b"x" * 5000) == "PDF is cut short (no end-of-file marker)"


def test_the_archives_digest_is_checked_in_either_notation():
    import hashlib
    assert recover.matches_digest(PDF_V1, sha1_base32(PDF_V1)) and recover.matches_digest(PDF_V1, hashlib.sha1(PDF_V1).hexdigest())
    assert not recover.matches_digest(PDF_V1 + b" ", sha1_base32(PDF_V1))


def test_a_refusal_stops_the_run():
    guard = Guard(limit=2)
    with pytest.raises(Stopped):
        guard(recover.FetchResult("https://web.archive.org/x", "blocked", error="403 Forbidden"))
    with pytest.raises(Stopped):
        guard(recover.FetchResult("https://web.archive.org/x", "error", error="HTTP 429"))
    guard(recover.FetchResult("https://web.archive.org/x", "error", error="HTTP 503"))    # one failure: carry on
    with pytest.raises(Stopped):
        guard(recover.FetchResult("https://web.archive.org/x", "error", error="HTTP 503"))


# --- A small Internet Archive ------------------------------------------------------------------------
class FakeArchive:
    """web.archive.org as two dictionaries: index rows by (url, prefix?), and captures by (timestamp, url)."""

    def __init__(self, site):
        self.site = site
        self.index: dict[tuple[str, bool], list] = {}
        self.captures: dict[tuple[str, str], bytes] = {}
        self.requests: list[str] = []
        self.refuse = False

    def capture(self, timestamp, url, data: bytes, *, mimetype="text/html"):
        self.captures[(timestamp, url)] = data
        row = [timestamp, url, mimetype, "200", sha1_base32(data), str(len(data))]
        self.index.setdefault((url, False), []).append(row)
        self.index.setdefault((url.rsplit("/", 1)[0] + "/", True), []).append(row)    # everything under its directory

    def handler(self, request: httpx.Request) -> httpx.Response:
        if request.url.host != "web.archive.org":
            return self.site.handler(request)
        if request.url.path == "/robots.txt":
            return httpx.Response(404)
        self.requests.append(str(request.url))
        if self.refuse:
            return httpx.Response(403)
        if request.url.path == "/cdx/search/cdx":
            rows = self.index.get((request.url.params["url"], request.url.params.get("matchType") == "prefix"), [])
            return httpx.Response(200, json=[recover.CDX_FIELDS, *rows] if rows else [])
        m = re.match(r"https://web\.archive\.org/web/(\d+)id_/(.+)$", str(request.url))
        data = self.captures.get((m.group(1), m.group(2))) if m else None
        return httpx.Response(200, content=data) if data is not None else httpx.Response(404)


@pytest.fixture
def archive(site, store):
    """Kenya, synced from GOV.UK (one HTML note and its PDF held), and an Archive that remembers more:
    the page's earlier address, two earlier PDF-only editions (one captured, one not) and an HTML note."""
    govuk(site)
    a = FakeArchive(site)
    with PoliteClient(transport=httpx.MockTransport(a.handler), sleep=lambda s: None, max_retries=0) as c:
        sync(c, store)
    listing = (f'<a href="{OLD_PATH}">Kenia: country policy and information notes</a>'
               f'<a href="{GONE_PATH}">Angola: country policy and information notes</a>')
    a.capture("20170301000000", COLLECTION, f"<html><body>{listing}</body></html>".encode())
    a.capture("20260901000000", COLLECTION,
              f'<html><body><a href="{PUB_PATH}">Kenya: country policy and information notes</a></body></html>'.encode())
    site.json(config.CONTENT_API + OLD_PATH, {"document_type": "redirect", "schema_name": "redirect",
                                              "redirects": [{"path": OLD_PATH, "type": "exact", "destination": PUB_PATH}]})
    site.json(config.CONTENT_API + GONE_PATH, {"document_type": "guidance", "title": "Angola: country policy and information notes"})
    old_url, new_url = config.GOVUK + OLD_PATH, config.GOVUK + PUB_PATH
    a.capture("20170101000000", old_url, page(old(V1_HREF, V1_TITLE)))
    a.capture("20190401000000", old_url, page(old(V1_HREF, V1_TITLE), old(V2_URL, V2_TITLE)))
    a.capture("20190901000000", old_url, page(old(V2_URL, V2_TITLE)))
    a.capture("20260801000000", new_url, page(
        new(NOTE_PATH, "Country policy and information note: actors of protection, Kenya, July 2026 (accessible)", HTML_META),
        new(PDF_URL, "Country policy and information note: actors of protection, Kenya, July 2026")))
    a.capture("20170105000000", config.GOVUK + V1_HREF, PDF_V1, mimetype="application/pdf")
    a.capture("20170105000001", config.GOVUK + V1_HREF.replace("Kenya_", "thumbnail_Kenya_") + ".png", b"PNG",
              mimetype="image/png")                                              # its preview image: not the file
    a.capture("20220601000000", config.GOVUK + OLD_NOTE,
              b'<html><body><h1>Security situation, Kenya, May 2022</h1><div class="govspeak"><p>Archived text.</p></div></body></html>')
    return a


@pytest.fixture
def archive_client(archive):
    c = PoliteClient(transport=httpx.MockTransport(archive.handler), sleep=lambda s: None, max_retries=0)
    yield c
    c.close()


def editions(store):
    catalogue = json.loads((store.root / CATALOGUE).read_text())
    return catalogue, {e["title"]: e for e in catalogue["countries"]["kenya"]["editions"]}


def test_catalogue_finds_the_earlier_address_and_every_edition_listed(archive, archive_client, store):
    report = recover.recover(archive_client, store, discover_only=True, log=lambda m: None)
    assert report.errors == []
    catalogue, by_title = editions(store)
    kenya = catalogue["countries"]["kenya"]
    earlier = next(a for a in kenya["addresses"] if not a["current"])
    assert earlier["base_path"] == OLD_PATH and earlier["how"].startswith("discovered")
    assert earlier["govuk"]["destination"] == PUB_PATH and earlier["captures"] == 3
    assert [p["base_path"] for p in catalogue["other_pages"]] == [GONE_PATH]      # a country since dropped
    assert catalogue["other_pages"][0]["govuk"]["status"] == "published"

    v1, v2 = by_title[V1_TITLE], by_title[V2_TITLE]
    assert v1["status"] == "recoverable-pdf" and v2["status"] == "not-archived"
    assert (v1["first_listed"], v1["last_listed"]) == ("2017-01-01T00:00:00Z", "2019-04-01T00:00:00Z")
    assert (v2["first_listed"], v2["last_listed"]) == ("2019-04-01T00:00:00Z", "2019-09-01T00:00:00Z")
    assert v1["listed_at"] == [OLD_PATH] and v1["files"][0]["pages"] == 44
    assert v1["files"][0]["archive"][0]["length"] == len(PDF_V1)
    current = by_title["Country policy and information note: actors of protection, Kenya, July 2026"]
    assert current["status"] == "held" and current["files"][0]["held"]["by"] == "url"
    assert current["files"][0]["held"]["source"] == "live" and current["files"][0]["archive"] is None
    assert current["html"][0]["held_versions"] == 1
    archived_note = next(e for e in kenya["editions"] if e["html"] and e["html"][0]["path"] == OLD_NOTE)
    assert archived_note["status"] == "recoverable-html" and archived_note["first_listed"] is None
    assert kenya["summary"] == {"editions": 4, "held": 1, "held_under_another_listing": 0, "recoverable_html": 1,
                                "recoverable_pdf_only": 1, "not_archived": 1, "other_files": 0,
                                "not_held": 3, "not_held_in_archive": 2, "not_held_not_in_archive": 1,
                                "html_captures_to_read": 1, "pdfs_to_fetch": 1, "pdf_bytes_to_fetch": len(PDF_V1),
                                "pdfs_beside_held_web_versions": 0, "listing_captures_read": 4}
    assert store.load_pdf_manifest().keys() == {PDF_URL}                         # discovery downloads no edition


def test_fetch_stores_archived_pdfs_and_html_with_their_provenance(archive, archive_client, store):
    held_before = dict(store.load_pdf_manifest()[PDF_URL])
    report = recover.recover(archive_client, store, log=lambda m: None)
    assert report.errors == [] and report.pdfs["downloaded"] == 1
    manifest = store.load_pdf_manifest()
    entry = manifest[config.GOVUK + V1_HREF]
    assert entry == {
        "sha256": sha256_bytes(PDF_V1), "bytes": len(PDF_V1), "etag": None, "country": "kenya", "title": V1_TITLE,
        "first_seen": report.started, "last_seen": None, "source": "wayback",
        "archive_url": "https://web.archive.org/web/20170105000000/" + config.GOVUK + V1_HREF,
        "captured_at": "2017-01-05T00:00:00Z", "original_url": config.GOVUK + V1_HREF,
        "archive_digest": sha1_base32(PDF_V1), "digest_verified": True,
        "first_listed": "2017-01-01T00:00:00Z", "last_listed": "2019-04-01T00:00:00Z", "listed_at": [OLD_PATH],
        "pages": None, "pages_listed": 44}
    assert store.pdf_path(entry["sha256"]).read_bytes() == PDF_V1
    assert manifest[PDF_URL] == held_before                                      # nothing held is touched

    note = store.load_note("kenya", OLD_NOTE.rsplit("/", 1)[-1])                 # the note id from its original path
    [version] = note["versions"]
    assert version["source"] == "wayback" and note["base_path"] == OLD_NOTE
    assert version["captures"][0]["archive_url"] == "https://web.archive.org/web/20220601000000/" + config.GOVUK + OLD_NOTE
    assert store.read_body("kenya", note["note"], version["sha256"]) == '<div class="govspeak"><p>Archived text.</p></div>'

    _, by_title = editions(store)                                                # the catalogue now says so
    assert by_title[V1_TITLE]["status"] == "held"
    held = by_title[V1_TITLE]["files"][0]
    assert held["held"]["sha256"] == entry["sha256"] and held["held"]["source"] == "wayback"
    assert held["archive"][0]["timestamp"] == "20170105000000"                  # where it came from stays on record

    archive.requests.clear()                                                     # a second run asks for nothing
    again = recover.recover(archive_client, store, log=lambda m: None)
    assert archive.requests == [] and again.new_versions == [] and again.pdfs["downloaded"] == 0


def test_a_recovered_pdf_missing_from_this_disk_is_fetched_again(archive, archive_client, store):
    """The manifest is committed and the files are not: a fresh checkout has the entry and no PDF."""
    recover.recover(archive_client, store, log=lambda m: None)
    entry = dict(store.load_pdf_manifest()[config.GOVUK + V1_HREF])
    store.pdf_path(entry["sha256"]).unlink()
    archive.requests.clear()
    report = recover.recover(archive_client, store, log=lambda m: None)
    assert report.errors == [] and store.pdf_path(entry["sha256"]).read_bytes() == PDF_V1
    assert archive.requests == ["https://web.archive.org/web/20170105000000id_/" + config.GOVUK + V1_HREF]
    assert store.load_pdf_manifest()[config.GOVUK + V1_HREF] == entry              # the record is not touched
    # If the Archive now serves something else at that capture, it is refused and the record stands.
    store.pdf_path(entry["sha256"]).unlink()
    archive.captures[("20170105000000", config.GOVUK + V1_HREF)] = PDF_V1.replace(b"first", b"other")
    report = recover.recover(archive_client, store, log=lambda m: None)
    assert "sha256 differs" in report.errors[0]["error"] and not store.pdf_path(entry["sha256"]).exists()


def test_a_capture_that_is_not_a_pdf_is_reported_not_stored(archive, archive_client, store):
    archive.captures[("20170105000000", config.GOVUK + V1_HREF)] = b"<html>Page not found</html>"
    report = recover.recover(archive_client, store, log=lambda m: None)
    [error] = report.errors
    assert error["error"].startswith("not a PDF") and error["url"] == config.GOVUK + V1_HREF
    assert config.GOVUK + V1_HREF not in store.load_pdf_manifest()
    catalogue, by_title = editions(store)
    assert by_title[V1_TITLE]["status"] == "recoverable-pdf" and catalogue["failures"] == [error]


def test_an_archived_page_without_a_body_is_skipped_and_not_asked_for_again(archive, archive_client, store):
    archive.captures[("20220601000000", config.GOVUK + OLD_NOTE)] = b"<html><body><h1>Sorry</h1></body></html>"
    report = recover.recover(archive_client, store, log=lambda m: None)
    assert [e["error"] for e in report.errors] == ["no govspeak body"]
    assert store.load_note("kenya", OLD_NOTE.rsplit("/", 1)[-1]) is None
    catalogue, _ = editions(store)
    assert list(catalogue["countries"]["kenya"]["unextractable"].values()) == ["no govspeak body"]
    archive.requests.clear()
    recover.recover(archive_client, store, log=lambda m: None)
    assert archive.requests == []


def test_an_edition_held_under_another_address_or_title_is_not_fetched_again(archive, archive_client, store):
    """The same report and month, listed again at another address with another file: one edition, and held."""
    again = "https://assets.publishing.service.gov.uk/media/5c3f0f65e5274a6e4a5da099/Kenya_actors.pdf"
    second = "https://assets.publishing.service.gov.uk/media/5c3f0f65e5274a6e4a5da098/Kenya_security_v2.0__1_.pdf"
    archive.capture("20260715000000", config.GOVUK + OLD_PATH, page(
        new(again, "Country policy and information note: actors of protection, Kenya, July 2026"),     # held as a web version
        new(second, V2_TITLE.replace("security situation", "Security situation"))))                     # V2 again: not held
    archive.capture("20260716000000", again, b"%PDF-1.4\nanother file\n%%EOF\n", mimetype="application/pdf")
    archive.capture("20260716000000", second, b"%PDF-1.4\nsecond edition\n%%EOF\n", mimetype="application/pdf")
    recover.recover(archive_client, store, discover_only=True, log=lambda m: None)
    catalogue, _ = editions(store)
    kenya = catalogue["countries"]["kenya"]
    held = next(e for e in kenya["editions"] if e["files"] and e["files"][0]["url"] == again)
    assert held["status"] == "held" and held["held_as"]["by"] == "title and month"
    assert held["held_as"]["web_version"] == NOTE_PATH.rsplit("/", 1)[-1]
    repeat = next(e for e in kenya["editions"] if e["files"] and e["files"][0]["url"] == second)
    assert repeat["status"] == "recoverable-pdf" and repeat["repeat_of"] == {"title": V2_TITLE, "first_listed": "2019-04-01T00:00:00Z"}
    summary = kenya["summary"]
    assert (summary["editions"], summary["held"], summary["held_under_another_listing"]) == (6, 2, 1)
    # V1, V2 (listed twice, counted once: its second file is in the Archive) and the archived web page
    assert (summary["not_held"], summary["not_held_in_archive"], summary["not_held_not_in_archive"]) == (3, 3, 0)
    assert summary["pdfs_to_fetch"] == 2

    recover.recover(archive_client, store, log=lambda m: None)
    assert again not in store.load_pdf_manifest() and second in store.load_pdf_manifest()


def test_only_what_is_not_held_is_fetched_unless_asked(archive, archive_client, store):
    """A PDF beside a web version that is held, and a further archived copy of a web page that is held,
    are left alone by default."""
    beside = "https://assets.publishing.service.gov.uk/media/5c3f0f65e5274a6e4a5da097/Kenya_actors_July_2026.pdf"
    archive.capture("20260720000000", config.GOVUK + PUB_PATH, page(
        new(NOTE_PATH, "Country policy and information note: actors of protection, Kenya, July 2026 (accessible)", HTML_META),
        new(beside, "Country policy and information note: actors of protection, Kenya, July 2026")))
    archive.capture("20260721000000", beside, b"%PDF-1.4\nbeside\n%%EOF\n", mimetype="application/pdf")
    archive.capture("20260722000000", config.GOVUK + NOTE_PATH,
                    b'<html><body><h1>Country policy and information note: actors of protection, Kenya, July 2026 (accessible)</h1>'
                    b'<div class="govspeak"><p>An earlier state of the page.</p></div></body></html>')
    recover.recover(archive_client, store, log=lambda m: None)
    catalogue, _ = editions(store)
    summary = catalogue["countries"]["kenya"]["summary"]
    assert (summary["pdfs_beside_held_web_versions"], summary["html_captures_to_read"]) == (1, 1)
    assert beside not in store.load_pdf_manifest()
    assert len(store.load_note("kenya", NOTE_PATH.rsplit("/", 1)[-1])["versions"]) == 1
    assert store.load_note("kenya", OLD_NOTE.rsplit("/", 1)[-1])                # an edition not held: its page was read

    recover.recover(archive_client, store, html=True, all_pdfs=True, log=lambda m: None)
    assert beside in store.load_pdf_manifest()
    assert len(store.load_note("kenya", NOTE_PATH.rsplit("/", 1)[-1])["versions"]) == 2


def test_over_budget_fetches_nothing(archive, archive_client, store):
    report = recover.recover(archive_client, store, max_files=1, log=lambda m: None)
    assert report.errors[-1]["stage"] == "stopped" and "over budget" in report.errors[-1]["error"]
    assert store.load_pdf_manifest().keys() == {PDF_URL}
    assert store.load_note("kenya", OLD_NOTE.rsplit("/", 1)[-1]) is None


def test_a_403_from_the_archive_stops_everything(archive, archive_client, store):
    archive.refuse = True
    report = recover.recover(archive_client, store, log=lambda m: None)
    assert report.errors[-1]["stage"] == "stopped" and "refused" in report.errors[-1]["error"]
    assert len(archive.requests) == 1                                            # one refusal is enough


def test_replaced_archive_files_keep_each_editions_metadata_and_aliases(site, client, store):
    """Two editions at one address, followed by a new address for the first edition's bytes."""
    from cpin.sync import RunReport
    url = 'https://example.org/a.pdf'
    first, second = b'%PDF-1.4\nfirst\n%%EOF\n', b'%PDF-1.4\nsecond\n%%EOF\n'
    def job(stamp, data, title, address=url):
        return dict(url=address, timestamp=stamp, original=address, digest=sha1_base32(data),
                    country='kenya', title=title, first_listed=stamp, last_listed=stamp,
                    listed_at=[OLD_PATH], pages=None, also_listed_as=[])
    jobs = [job('20170101000000', first, 'First edition'), job('20180101000000', second, 'Second edition'),
            job('20190101000000', first, 'First edition', 'https://example.org/z.pdf')]
    for entry, data in zip(jobs, (first, second, first)):
        site.raw(recover.page_url(entry['timestamp'], entry['original']), data)
    report = RunReport(kind='recover', mode='wayback', started='2026-10-04T00:00:00Z')
    stats = recover.fetch_pdfs(client, store, jobs, report, Guard(), log=lambda _: None)
    entry = store.load_pdf_manifest()[url]
    assert stats['downloaded'] == 2 and stats['already_fetched'] == 1 and not report.errors
    assert entry['title'] == 'Second edition' and 'also_listed_as' not in entry
    previous = entry['previous'][0]
    assert previous['title'] == 'First edition' and previous['source'] == 'wayback'
    assert previous['also_listed_as'] == ['https://example.org/z.pdf']
    store.pdf_path(previous['sha256']).unlink()
    restored = recover.restore_missing_pdfs(client, store, report, Guard(), log=lambda _: None)
    assert restored == dict(missing=1, restored=1, failed=0)
    assert store.pdf_path(previous['sha256']).read_bytes() == first
    assert store.load_pdf_manifest()[url] == entry


def test_held_lookup_identifies_the_earlier_bytes_at_a_reused_url(store):
    url = 'https://example.org/reused.pdf'
    old = {'sha256': 'old-bytes', 'source': 'wayback', 'archive_digest': 'OLD',
           'title': 'Country policy and information note: actors of protection, Kenya, July 2020'}
    new = {'sha256': 'new-bytes', 'source': 'wayback', 'archive_digest': 'NEW',
           'title': 'Country policy and information note: actors of protection, Kenya, July 2026', 'previous': [old]}
    store.save_pdf_manifest({url: new})
    held = recover.Held(store)
    assert held.find({'url': url, 'title': old['title']})['sha256'] == 'old-bytes'
    assert held.find({'url': 'https://example.org/alias.pdf', 'title': old['title'], 'archive': [{'digest': 'OLD'}]})['sha256'] == 'old-bytes'
    assert held.find({'url': url, 'title': 'Country policy and information note: actors of protection, Kenya, July 2018'}) is None
