import json

import pytest
from conftest import BODY, COLLECTION_URL, NOTE_PATH, PDF_URL, PUB_PATH, govuk

from cpin import config
from cpin.sync import sync

NOTE = NOTE_PATH.rsplit("/", 1)[-1]
EDITED = BODY.replace("able to offer", "able to provide")
UGANDA_PATH = "/government/publications/uganda-country-policy-and-information-notes"
UGANDA_NOTE_PATH = UGANDA_PATH + "/country-policy-and-information-note-opposition-uganda-may-2026-accessible"
UGANDA_NOTE = UGANDA_NOTE_PATH.rsplit("/", 1)[-1]


def with_uganda(site, *, body=BODY, pub_updated="2026-05-11T09:00:00+01:00"):
    """Add a second country, Uganda, with one HTML note and no PDF, to the collection `govuk` set up."""
    content, etag, _, _ = site.routes[COLLECTION_URL]
    collection = json.loads(content)
    collection["links"]["documents"].append({"title": "Uganda: country policy and information notes", "base_path": UGANDA_PATH,
                                             "content_id": "u1", "public_updated_at": pub_updated})
    site.json(COLLECTION_URL, collection, etag=etag)
    title = "Country policy and information note: opposition, Uganda, May 2026 (accessible)"
    site.json(config.CONTENT_API + UGANDA_PATH, {
        "title": "Uganda: country policy and information notes", "schema_name": "publication", "base_path": UGANDA_PATH,
        "public_updated_at": pub_updated,
        "details": {"attachments": [{"attachment_type": "html", "url": UGANDA_NOTE_PATH, "title": title}], "change_history": []}})
    site.json(config.CONTENT_API + UGANDA_NOTE_PATH, {
        "title": title, "schema_name": "html_publication", "public_updated_at": pub_updated,
        "details": {"body": body, "headers": []}})


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


# --- A failure is tried again on the very next run -------------------------------------------------
NEW_EDITION = {"body": EDITED, "pub_updated": "2026-09-01T10:00:00+01:00", "collection_etag": 'W/"c2"'}


def test_a_country_page_that_failed_is_fetched_again_on_the_next_quick_run(site, client, store):
    govuk(site)
    sync(client, store)
    govuk(site, **NEW_EDITION)
    site.fail(config.CONTENT_API + PUB_PATH, 503)
    failed = sync(client, store)
    assert failed.errors and failed.pending == ["kenya"]
    govuk(site, **NEW_EDITION)                               # GOV.UK is well again; nothing else has changed
    report = sync(client, store)
    assert [v["note"] for v in report.new_versions] == [NOTE] and report.pending == []
    assert store.read_body("kenya", NOTE, store.load_note("kenya", NOTE)["current_sha256"]) == EDITED
    site.requests.clear()
    assert sync(client, store).collection == "unchanged" and site.requests == [COLLECTION_URL]   # and then it is quiet again


def test_a_note_that_failed_is_fetched_again_on_the_next_quick_run(site, client, store):
    govuk(site)
    sync(client, store)
    govuk(site, **NEW_EDITION)
    site.fail(config.CONTENT_API + NOTE_PATH, 503)
    failed = sync(client, store)
    assert failed.errors and failed.new_versions == [] and failed.pending == ["kenya"]
    # The country's date is not moved on: this copy does not yet hold what GOV.UK published on that date.
    assert store.load_state()["countries"]["kenya"]["public_updated_at"] == "2026-07-27T15:09:18+01:00"
    assert store.load_note("kenya", NOTE)["status"] == "live"
    govuk(site, **NEW_EDITION)
    report = sync(client, store)
    assert [v["note"] for v in report.new_versions] == [NOTE]
    state = store.load_state()
    assert state["countries"]["kenya"]["public_updated_at"] == "2026-09-01T10:00:00+01:00" and "pending" not in state


def test_a_note_that_failed_in_a_full_run_is_retried_though_no_date_changed(site, client, store):
    govuk(site)
    sync(client, store)
    govuk(site, body=EDITED)                                 # a silent edit: same dates, same ETag
    site.fail(config.CONTENT_API + NOTE_PATH, 503)
    assert sync(client, store, full=True).pending == ["kenya"]
    govuk(site, body=EDITED)
    report = sync(client, store)                             # a quick run: it would have been a 304
    assert [v["note"] for v in report.new_versions] == [NOTE]


def test_a_pdf_that_failed_is_fetched_again_on_the_next_quick_run(site, client, store):
    govuk(site)
    site.fail(PDF_URL, 503)
    first = sync(client, store)
    assert first.errors and first.pending == ["kenya"] and store.load_pdf_manifest() == {}
    govuk(site)
    report = sync(client, store)
    assert report.pdfs["downloaded"] == 1 and report.errors == [] and report.pending == []


def test_a_run_limited_to_one_country_does_not_hide_changes_in_the_others(site, client, store):
    govuk(site)
    with_uganda(site)
    sync(client, store)
    govuk(site, collection_etag='W/"c2"')
    with_uganda(site, body=EDITED, pub_updated="2026-09-02T10:00:00+01:00")
    only = sync(client, store, only={"kenya"})
    assert only.new_versions == [] and only.pending == ["uganda"]
    report = sync(client, store)
    assert [(v["country"], v["note"]) for v in report.new_versions] == [("uganda", UGANDA_NOTE)]
    assert report.pending == []


def test_a_note_gone_after_a_failed_check_was_last_listed_at_the_check_before(site, client, store, monkeypatch):
    times = iter(["2026-10-01T06:17:00Z", "2026-10-01T06:18:00Z", "2026-10-02T06:17:00Z", "2026-10-02T06:18:00Z",
                  "2026-10-03T06:17:00Z", "2026-10-03T06:18:00Z"])
    monkeypatch.setattr("cpin.sync.now_iso", lambda: next(times))
    govuk(site)
    sync(client, store)                                      # 1 October: the note is listed
    govuk(site, with_note=False, pub_updated="2026-09-01T10:00:00+01:00", collection_etag='W/"c2"')
    site.fail(config.CONTENT_API + PUB_PATH, 503)
    sync(client, store)                                      # 2 October: the page could not be read
    govuk(site, with_note=False, pub_updated="2026-09-01T10:00:00+01:00", collection_etag='W/"c2"')
    sync(client, store)                                      # 3 October: found gone
    gone = store.load_note("kenya", NOTE)["status_log"][-1]
    assert gone == {"status": "removed", "at": "2026-10-03T06:17:00Z", "last_listed": "2026-10-01T06:17:00Z"}


def test_a_pdf_missing_from_this_disk_is_downloaded_again(site, client, store):
    govuk(site)
    sync(client, store)
    entry = store.load_pdf_manifest()[PDF_URL]
    store.pdf_path(entry["sha256"]).unlink()                 # a fresh checkout: the manifest is in git, the files are not
    report = sync(client, store, full=True)
    assert report.pdfs["downloaded"] == 1 and report.pdfs["replaced_same_url"] == 0
    assert store.pdf_path(entry["sha256"]).read_bytes() == b"%PDF-1.4 fake"
    assert store.load_pdf_manifest()[PDF_URL]["first_seen"] == entry["first_seen"]
    site.requests.clear()
    assert sync(client, store, full=True).pdfs["unchanged"] == 1     # held now, so an unchanged file costs a 304


# --- Nothing is marked removed on a doubtful answer ------------------------------------------------

@pytest.mark.parametrize("answer", [
    {"title": "Kenya: country policy and information notes", "schema_name": "publication", "base_path": PUB_PATH, "details": {}},
    {"title": "Kenya: country policy and information notes", "schema_name": "publication", "base_path": PUB_PATH,
     "details": {"attachments": None}},
    {"schema_name": "redirect", "base_path": PUB_PATH, "redirects": [{"path": PUB_PATH, "destination": "/"}]},
    {"schema_name": "publication", "base_path": "/government/publications/something-else", "details": {"attachments": []}},
    ["not", "an", "object"],
])
def test_a_country_page_that_is_not_plainly_its_publication_removes_nothing(site, client, store, answer):
    govuk(site)
    sync(client, store)
    held = store.load_publication("kenya")
    govuk(site, pub_updated="2026-09-01T10:00:00+01:00", collection_etag='W/"c2"')
    site.json(config.CONTENT_API + PUB_PATH, answer)
    report = sync(client, store)
    assert report.removed == [] and report.pending == ["kenya"]
    assert [(e["country"], e["status"]) for e in report.errors] == [("kenya", 200)] and report.errors[0]["error"]
    assert store.load_note("kenya", NOTE)["status"] == "live"
    assert store.load_publication("kenya") == held, "the page held is not written over"


def test_a_publication_that_lists_no_notes_at_all_still_removes_them(site, client, store):
    # Albania in 2022: the page stayed, with every note taken down. An empty list is still a list.
    govuk(site)
    sync(client, store)
    govuk(site, with_note=False, with_pdf=False, pub_updated="2026-09-01T10:00:00+01:00", collection_etag='W/"c2"')
    assert [r["note"] for r in sync(client, store).removed] == [NOTE]


@pytest.mark.parametrize("answer", [{"title": "Country policy and information notes", "links": {}},
                                    {"links": {"documents": []}}, {"schema_name": "gone"}])
def test_a_collection_that_lists_no_countries_drops_none(site, client, store, answer):
    govuk(site)
    sync(client, store)
    held = store.load_collection()
    site.json(COLLECTION_URL, answer, etag='W/"c2"')
    report = sync(client, store)
    assert report.collection == "error" and report.removed == [] and report.errors[0]["status"] == 200
    state = store.load_state()
    assert "dropped_from_collection" not in state["countries"]["kenya"] and state["collection_etag"] == 'W/"c1"'
    assert store.load_note("kenya", NOTE)["status"] == "live" and store.load_collection() == held


def test_a_country_dropped_from_the_collection_has_its_notes_marked_and_kept(site, client, store):
    govuk(site)
    with_uganda(site)
    first = sync(client, store)
    govuk(site, collection_etag='W/"c2"')                    # the collection now lists Kenya only
    report = sync(client, store)
    assert [(r["country"], r["note"]) for r in report.removed] == [("uganda", UGANDA_NOTE)]
    assert store.load_state()["countries"]["uganda"]["dropped_from_collection"] == report.started
    index = store.load_note("uganda", UGANDA_NOTE)
    assert index["status"] == "removed" and store.read_body("uganda", UGANDA_NOTE, index["current_sha256"]) == BODY
    assert index["status_log"][-1] == {"status": "removed", "at": report.started, "last_listed": first.started,
                                       "why": "country page no longer in the collection"}
    site.requests.clear()
    assert sync(client, store).removed == [] and site.requests == [COLLECTION_URL]      # said once, not every day

    govuk(site, collection_etag='W/"c3"')                    # and it comes back, its page unchanged
    with_uganda(site)
    back = sync(client, store)
    assert [(r["country"], r["note"]) for r in back.restored] == [("uganda", UGANDA_NOTE)]
    assert "dropped_from_collection" not in store.load_state()["countries"]["uganda"]
    assert store.load_note("uganda", UGANDA_NOTE)["status"] == "live"


# --- An answer that is not JSON is an error for that page, and the run goes on --------------------
HTML_ERROR = b"<html><body><h1>Sorry, there is a problem with the service</h1></body></html>"


def test_a_note_that_answers_200_without_json_is_an_error_and_the_run_goes_on(site, client, store):
    govuk(site)
    with_uganda(site)
    site.raw(config.CONTENT_API + NOTE_PATH, HTML_ERROR, content_type="text/html")
    report = sync(client, store)
    assert [(e["country"], e["note"], e["status"]) for e in report.errors] == [("kenya", NOTE, 200)]
    assert "not JSON" in report.errors[0]["error"] and report.pending == ["kenya"]
    assert store.load_note("uganda", UGANDA_NOTE)["status"] == "live", "the country after it was still fetched"
    assert store.runs()[-1]["errors"] == report.errors and store.load_state()["collection_etag"] == 'W/"c1"'


def test_a_country_page_that_answers_200_without_json_is_an_error_and_the_run_goes_on(site, client, store):
    govuk(site)
    with_uganda(site)
    site.raw(config.CONTENT_API + PUB_PATH, HTML_ERROR, content_type="text/html")
    report = sync(client, store)
    assert [(e["country"], e["status"]) for e in report.errors] == [("kenya", 200)] and "not JSON" in report.errors[0]["error"]
    assert report.countries_checked == ["uganda"] and report.pending == ["kenya"]
    assert len(store.runs()) == 1


def test_a_collection_that_answers_200_without_json_is_logged(site, client, store):
    govuk(site)
    sync(client, store)
    site.raw(COLLECTION_URL, HTML_ERROR, etag='W/"c2"', content_type="text/html")
    report = sync(client, store)
    assert report.collection == "error" and "not JSON" in report.errors[0]["error"] and report.finished
    assert store.runs()[-1]["collection"] == "error" and store.load_state()["collection_etag"] == 'W/"c1"'


# --- A new title or date on the same body leaves a trace -------------------------------------------
def retitled(site, title, public_updated_at="2026-07-27T15:09:18+01:00"):
    item = json.loads(site.routes[config.CONTENT_API + NOTE_PATH][0])
    site.json(config.CONTENT_API + NOTE_PATH, {**item, "title": title, "public_updated_at": public_updated_at})


def test_a_new_title_on_the_same_body_is_logged_without_making_a_version(site, client, store):
    govuk(site)
    first = sync(client, store)
    was = "Country policy and information note: actors of protection, Kenya, July 2026 (accessible)"
    now = "Country policy and information note: actors of protection, Kenya, August 2026 (accessible)"
    govuk(site)
    retitled(site, now)
    second = sync(client, store, full=True)
    index = store.load_note("kenya", NOTE)
    (version,) = index["versions"]
    assert second.new_versions == [] and (version["title"], index["title"]) == (now, now)
    assert version["title_log"] == [{"at": first.started, "title": was, "public_updated_at": "2026-07-27T14:09:18Z"},
                                    {"at": second.started, "title": now, "public_updated_at": "2026-07-27T14:09:18Z"}]
    assert second.retitled == [{"country": "kenya", "note": NOTE, "title": now, "was": was}] and second.changed
    third = sync(client, store, full=True)
    assert len(store.load_note("kenya", NOTE)["versions"][0]["title_log"]) == 2 and third.retitled == [], "said once"


def test_a_new_date_on_the_same_body_is_logged_too(site, client, store):
    govuk(site)
    first = sync(client, store)
    govuk(site, pub_updated="2026-09-01T10:00:00+01:00", collection_etag='W/"c2"')
    retitled(site, json.loads(site.routes[config.CONTENT_API + NOTE_PATH][0])["title"], "2026-09-01T10:00:00+01:00")
    second = sync(client, store)
    (version,) = store.load_note("kenya", NOTE)["versions"]
    assert version["public_updated_at"] == "2026-09-01T09:00:00Z" and second.retitled == [] and second.new_versions == []
    assert [(e["at"], e["public_updated_at"]) for e in version["title_log"]] == [
        (first.started, "2026-07-27T14:09:18Z"), (second.started, "2026-09-01T09:00:00Z")]
    assert len({e["title"] for e in version["title_log"]}) == 1
