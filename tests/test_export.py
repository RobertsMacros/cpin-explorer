import json

from conftest import BODY, NOTE_PATH, PDF_URL, govuk

from cpin.export import build_dashboard, kind_label
from cpin.sync import sync

CONFIG = {"countries": {"kenya": {"iso_n3": "404", "marker": [0.2, 37.9]}},
          "feature_aliases": {}, "boundary_patches": []}


def test_dashboard_lists_each_note_with_its_pdf_and_history(site, client, store):
    govuk(site)
    sync(client, store)
    data = build_dashboard(store, CONFIG)
    (kenya,) = data["countries"]
    assert (kenya["iso_n3"], kenya["marker"]) == ("404", [0.2, 37.9])
    (note,) = kenya["notes"]
    assert note["id"] == NOTE_PATH.rsplit("/", 1)[-1]
    assert (note["kind"], note["topic"], note["month"], note["version"]) == ("CPIN", "actors of protection", "2026-07", "2.0")
    assert note["pdf_url"] == PDF_URL
    assert note["govuk_url"].endswith(NOTE_PATH)
    assert data["totals"]["notes"] == 1


def test_removed_notes_stay_listed_after_live_ones(site, client, store):
    govuk(site)
    sync(client, store)
    govuk(site, with_note=False, pub_updated="2026-09-01T10:00:00+01:00", collection_etag='W/"c2"')
    sync(client, store)
    pdf_only, removed = build_dashboard(store, CONFIG)["countries"][0]["notes"]
    # GOV.UK still lists the PDF, so it shows as a live PDF-only note, ahead of the removed HTML one.
    assert pdf_only["pdf_only"] and pdf_only["pdf_url"] == PDF_URL
    assert removed["status"] == "removed" and removed["govuk_url"] is None


def test_report_with_two_editions_gets_a_series_file_with_verbatim_bodies(site, client, store, tmp_path):
    govuk(site)
    sync(client, store)
    edited = BODY.replace("able to offer", "able to provide")
    govuk(site, body=edited)
    sync(client, store, full=True)
    data = build_dashboard(store, CONFIG, series_out=tmp_path / "series")
    (note,) = data["countries"][0]["notes"]
    assert note["editions"] == 2 and note["compare_url"].endswith("country=kenya&series=note:actors-protection")
    series = json.loads((tmp_path / "series" / "kenya" / "note--actors-protection.json").read_text("utf-8"))
    assert [v["body"] for v in series["versions"]] == [BODY, edited]
    assert series["versions"][-1]["current"] and series["versions"][-1]["govuk_url"].endswith(NOTE_PATH)


def test_kind_labels_absorb_govuk_typos():
    assert kind_label("country police and information note") == "CPIN"
    assert kind_label("country and policy information note") == "CPIN"
    assert kind_label("report of a fact-finding mission") == "Fact-finding mission"
