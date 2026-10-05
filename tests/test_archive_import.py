from hashlib import sha256

import pymupdf
import pytest

from cpin.archive_import import browser_copies, reconcile_catalogue, register_copies
from cpin.export import recovered_pdfs
from cpin.store import write_json


def local_copy(store):
    doc = pymupdf.open()
    doc.new_page().insert_text((72, 72), "Kenya: actors of protection. Version 1.0. May 2022.")
    body = doc.tobytes()
    doc.close()
    digest = sha256(body).hexdigest()
    store.write_pdf(digest, body)
    url = "https://www.gov.uk/government/uploads/system/uploads/attachment_data/file/123/old.pdf"
    title = "Country policy and information note: actors of protection, Kenya, May 2022"
    item = {"url": url, "title": title, "also_listed_as": [], "archive": [], "held": None,
            "type": "PDF", "pages": 1, "first_listed": "2022-06-01T00:00:00Z", "last_listed": "2022-07-01T00:00:00Z"}
    write_json(store.root / "wayback-catalogue.json", {
        "countries": {"kenya": {"name": "Kenya", "addresses": [],
            "summary": {"html_captures_to_read": 0}, "editions": [{
                "title": title, "first_listed": item["first_listed"], "last_listed": item["last_listed"],
                "status": "not-archived", "listed_at": ["/government/publications/kenya"],
                "html": [], "files": [item]}]}},
        "failures": [{"country": "kenya", "url": url, "title": title, "error": "cut short"}]})
    copy = {"original_url": url, "sha256": digest, "bytes": len(body), "pages": 1, "title": title,
            "source": "national-archives", "archive_provider": "National Archives",
            "archive_url": "https://webarchive.nationalarchives.gov.uk/ukgwa/20220601000000/" + url,
            "captured_at": "2022-06-01T00:00:00Z"}
    return url, copy


def test_offline_import_preserves_source_and_resolves_coverage_without_erasing_failure(store):
    url, copy = local_copy(store)
    assert register_copies(store, [copy])["registered"] == 1
    entry = store.load_pdf_manifest()[url]
    assert entry["source"] == "national-archives" and entry["archive_provider"] == "National Archives"
    assert recovered_pdfs(store.load_pdf_manifest(), "kenya")[0][1]["archive_url"] == copy["archive_url"]
    result = reconcile_catalogue(store)
    assert result["totals"]["held"] == 1 and result["totals"]["not_held"] == 0
    assert result["failures"] == {"attempts_retained": 1, "editions_held": 1, "unresolved": 0}
    import json
    failure = json.loads((store.root / "wayback-catalogue.json").read_text())["failures"][0]
    assert failure["error"] == "cut short" and failure["resolution"]["status"] == "edition-held"
    assert register_copies(store, [copy])["already_registered"] == 1


def test_bad_download_prevents_partial_manifest_import(store):
    _, copy = local_copy(store)
    with pytest.raises(ValueError, match="failed validation"):
        register_copies(store, [copy, {**copy, "bytes": copy["bytes"] + 1}])
    assert store.load_pdf_manifest() == {}


def test_importing_old_pdf_keeps_live_file_and_previous_history(store):
    url, copy = local_copy(store)
    live = {"source": "live", "sha256": "a" * 64, "title": "Current edition", "previous": [{"sha256": "b" * 64}]}
    store.save_pdf_manifest({url: live})
    assert register_copies(store, [copy])["preserved_live"] == 1
    entry = store.load_pdf_manifest()[url]
    assert entry["sha256"] == live["sha256"] and entry["source"] == "live"
    assert [e["sha256"] for e in entry["previous"]] == ["b" * 64, copy["sha256"]]


def test_browser_records_keep_all_observed_dates_and_reject_timeline_addresses():
    original = "https://www.gov.uk/old.pdf"
    base = {"status": "saved", "sha256": "a" * 64, "bytes": 42, "pages": 1, "edition": "Earlier edition"}
    records = [{**base, "url": "https://webarchive.nationalarchives.gov.uk/ukgwa/20220601000000/" + original},
               {**base, "url": "https://webarchive.nationalarchives.gov.uk/ukgwa/20220701000000/" + original}]
    copy, = browser_copies({"records": records})
    assert copy["captured_at"] == "2022-06-01T00:00:00Z"
    assert copy["other_captures"][0]["captured_at"] == "2022-07-01T00:00:00Z"
    with pytest.raises(ValueError, match="dated"):
        browser_copies({"records": [{**base, "url": "https://webarchive.nationalarchives.gov.uk/ukgwa/timeline/" + original}]})
