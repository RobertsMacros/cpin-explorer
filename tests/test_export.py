import json

from conftest import BODY, NOTE_PATH, PDF_URL, govuk

from cpin.export import (add_similarity, body_words, build_dashboard, kind_label, load_similarity_cache, shingles,
                         similarity)
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
    assert note["editions"] == 2 and note["compare_url"].endswith("country=kenya&series=note:actors-protection&changes=1")
    series = json.loads((tmp_path / "series" / "kenya" / "note--actors-protection.json").read_text("utf-8"))
    assert [v["body"] for v in series["versions"]] == [BODY, edited]
    assert series["versions"][-1]["current"] and series["versions"][-1]["govuk_url"].endswith(NOTE_PATH)


def test_kind_labels_absorb_govuk_typos():
    assert kind_label("country police and information note") == "CPIN"
    assert kind_label("country and policy information note") == "CPIN"
    assert kind_label("report of a fact-finding mission") == "Report of a fact-finding mission"


def test_reports_group_editions_from_different_urls(site, client, store, tmp_path):
    govuk(site)
    sync(client, store)
    # An older edition of the same report, at a URL GOV.UK has since retired, recovered from the archive.
    store.record_version("kenya", "country-policy-and-information-note-actors-of-protection-kenya-may-2022-accessible",
                         body=BODY.replace("able to offer", "unable to offer"), meta={}, seen_at="2026-10-02T00:00:00Z",
                         source="wayback", title="Country policy and information note: actors of protection, Kenya, May 2022",
                         base_path="/government/publications/kenya/old",
                         capture={"captured_at": "2022-06-01T00:00:00Z", "archive_url": "https://web.archive.org/x", "digest": "D"})
    data = build_dashboard(store, CONFIG, series_out=tmp_path / "series")
    (kenya,) = data["countries"]
    (report,) = kenya["reports"]
    assert (report["key"], report["status"], report["editions"]) == ("note:actors-protection", "live", 2)
    assert report["latest"]["version"] == "2.0" and report["read_url"].endswith("series=note:actors-protection")
    assert len(kenya["notes"]) == 2                       # both URLs still listed for search and links
    assert data["note_paths"]["/government/publications/kenya/old"]["series"] == "note:actors-protection"


def test_words_for_similarity_ignore_markup_case_and_punctuation():
    assert body_words('<p>The <b>State</b> is “willing”&nbsp;and able.</p><!-- x --><td>A</td><td>B</td>') == \
        ["the", "state", "is", "willing", "and", "able", "a", "b"]
    assert len(shingles(["a", "b", "c", "d", "e", "f"])) == 2           # five-word phrases
    assert shingles(["too", "short"]) == {("too", "short")}


def test_similarity_is_shared_phrases_over_the_larger_edition():
    old = shingles(body_words("<p>one two three four five six seven eight nine ten</p>"))       # 6 phrases
    same = shingles(body_words("<p>One two three four five, six seven eight nine ten.</p>"))
    longer = shingles(body_words("<p>one two three four five six seven eight nine ten eleven twelve "
                                 "thirteen fourteen fifteen sixteen</p>"))                      # 12 phrases
    assert similarity(old, same) == 1.0
    assert similarity(old, longer) == 0.5                                # 6 shared of 12
    assert similarity(old, shingles(body_words("<p>an entirely different text about other things</p>"))) == 0.0


def test_each_edition_records_how_much_wording_it_keeps(site, client, store, tmp_path):
    govuk(site)
    sync(client, store)
    edited = BODY.replace("able to offer", "able to provide")                       # a small edit
    govuk(site, body=edited)
    sync(client, store, full=True)
    rewrite = ('<div class="govspeak"><h2 id="assessment">Assessment</h2><p>Kenyan courts now handle most '
               'complaints against the police within months, according to several sources consulted in 2026, '
               'though delays remain in rural counties.</p><p>Version control: this is Version 3.0.</p></div>')
    govuk(site, body=rewrite)
    sync(client, store, full=True)
    out = tmp_path / "series"
    build_dashboard(store, CONFIG, series_out=out)
    versions = json.loads((out / "kenya" / "note--actors-protection.json").read_text("utf-8"))["versions"]
    first, small, rewritten = (v["similarity_to_previous"] for v in versions)
    assert first is None
    assert 0.6 < small < 1.0                       # most five-word phrases survive a two-word edit
    assert rewritten < 0.25                        # a rewrite keeps almost none
    # Known pairs are cached beside the series files (keyed by body hashes) and reused next time.
    cache = load_similarity_cache(out)
    assert cache == {f"{versions[0]['id']}:{versions[1]['id']}": small, f"{versions[1]['id']}:{versions[2]['id']}": rewritten}
    eds = [{"id": v["id"], "body": "never read"} for v in versions]
    add_similarity(eds, cache)
    assert [e["similarity_to_previous"] for e in eds] == [None, small, rewritten]


def test_a_page_with_no_document_type_is_a_notice_not_a_report():
    from cpin.export import kind_label
    assert kind_label("") == "GOV.UK notice"
    assert kind_label("country policy and information note") == "CPIN"
    assert kind_label("report of a fact-finding mission") == "Report of a fact-finding mission"
