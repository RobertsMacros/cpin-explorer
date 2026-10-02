from conftest import BODY, COLLECTION_URL, NOTE_PATH, PDF_URL, PUB_PATH, govuk

from cpin import config
from cpin.sync import sync

NOTE = NOTE_PATH.rsplit("/", 1)[-1]


def test_first_sync_stores_body_byte_for_byte(site, client, store):
    govuk(site)
    report = sync(client, store)
    assert report.errors == []
    index = store.load_note("kenya", NOTE)
    assert index["status"] == "live"
    assert store.read_body("kenya", NOTE, index["current_sha256"]) == BODY
    assert index["versions"][0]["version_banner"] == "2.0"
    assert index["versions"][0]["public_updated_at"] == "2026-07-27T14:09:18Z"
    assert report.pdfs["downloaded"] == 1


def test_quiet_day_costs_one_request(site, client, store):
    govuk(site)
    sync(client, store)
    site.requests.clear()
    report = sync(client, store)
    assert report.collection == "unchanged"
    assert site.requests == [COLLECTION_URL]


def test_silent_edit_is_missed_by_quick_but_caught_by_full(site, client, store):
    govuk(site)
    sync(client, store)
    govuk(site, body=BODY.replace("able to offer", "able to provide"))   # same dates, same ETag
    assert sync(client, store).new_versions == []
    report = sync(client, store, full=True)
    assert [v["note"] for v in report.new_versions] == [NOTE]
    index = store.load_note("kenya", NOTE)
    assert len(index["versions"]) == 2
    assert store.read_body("kenya", NOTE, index["current_sha256"]).count("able to provide") == 1


def test_markup_only_change_is_a_new_version_with_same_text_hash(site, client, store):
    govuk(site)
    sync(client, store)
    govuk(site, body=BODY.replace('<h2 id="assessment">', '<h2 id="assessment-1">'))
    sync(client, store, full=True)
    first, second = store.load_note("kenya", NOTE)["versions"]
    assert first["sha256"] != second["sha256"]
    assert first["text_sha256"] == second["text_sha256"]


def test_removed_note_is_kept_and_marked(site, client, store):
    govuk(site)
    sync(client, store)
    govuk(site, with_note=False, pub_updated="2026-09-01T10:00:00+01:00", collection_etag='W/"c2"')
    report = sync(client, store)
    assert [r["note"] for r in report.removed] == [NOTE]
    index = store.load_note("kenya", NOTE)
    assert index["status"] == "removed"
    assert store.body_path("kenya", NOTE, index["current_sha256"]).exists()


def test_failed_fetch_never_removes_anything(site, client, store):
    govuk(site)
    sync(client, store)
    govuk(site, pub_updated="2026-09-01T10:00:00+01:00", collection_etag='W/"c2"')
    site.fail(config.CONTENT_API + PUB_PATH)
    report = sync(client, store)
    assert report.errors and report.removed == []
    assert store.load_note("kenya", NOTE)["status"] == "live"
    # state was not advanced, so the next run retries the country
    assert store.load_state()["countries"]["kenya"]["public_updated_at"] == "2026-07-27T15:09:18+01:00"


def test_pdf_replaced_at_same_url_keeps_previous_hash(site, client, store):
    govuk(site)
    sync(client, store)
    govuk(site, pdf=b"%PDF-1.4 revised")
    site.raw(PDF_URL, b"%PDF-1.4 revised", etag='"p2"')
    report = sync(client, store, full=True)
    assert report.pdfs["replaced_same_url"] == 1
    entry = store.load_pdf_manifest()[PDF_URL]
    assert len(entry["previous"]) == 1
    assert store.pdf_path(entry["previous"][0]["sha256"]).exists()
