import json
import re
import pytest

from conftest import BODY, NOTE_PATH, PDF_URL, govuk

from cpin import config
from cpin.export import (about_another_report, add_similarity, body_words, build_dashboard, kind_label,
                         load_similarity_cache, shingles, similarity, topic_history, with_pdf_publication)
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


def test_series_files_from_an_old_grouping_are_cleared(site, client, store, tmp_path):
    govuk(site)
    sync(client, store)
    out = tmp_path / "series"
    stale = out / "kenya" / "note--an-old-name.json"
    stale.parent.mkdir(parents=True)
    stale.write_text("{}", "utf-8")
    build_dashboard(store, CONFIG, series_out=out)
    assert not stale.exists()                                           # derived output: rebuilt, so cleared
    assert (out / "kenya" / "note--actors-protection.json").exists()
    assert (out / "similarity-cache.json").exists()                     # the cache beside them is kept


# --- Editions published as a PDF only, and which report a change note is about ---------------------
# Palestine's page as it stood on 2 October 2026 (synthetic bodies; the titles and change notes are GOV.UK's).
ASSETS = "https://assets.publishing.service.gov.uk/media"
SEEN = "2026-10-02T12:09:19Z"
V5_PDF = {"attachment_type": "file", "content_type": "application/pdf", "url": f"{ASSETS}/6abf/PSE_CPIN_Humanitarian_situation.pdf",
          "title": "Country policy and information note: humanitarian situation in Gaza, Palestine, September 2026"}
V5_NOTE = "Information about the humanitarian situation in Gaza has been updated to version 5.0."
BULLETIN_NOTE = ("Published the country bulletin: security situation in Gaza, Palestine, June 2026. This replaces the "
                 "country policy and information note: security situation in Gaza, Palestine, November 2024.")
REMOVED_NOTE = ("Information about the humanitarian situation in Gaza has been removed as it no longer accurately "
                "reflects the current situation.")
BOTH_NOTE = "Occupied Palestinian Territory (Gaza): security and humanitarian situation version 2.0 added."


def page(store, slug, name, attachments, changes=()):
    """Store a country page as a sync leaves it, without the network: its attachments (each PDF mirrored)
    and GOV.UK's change notes as (date, text)."""
    state = store.load_state()
    state["countries"][slug] = {"name": name, "public_updated_at": "2026-10-02T09:02:41Z",
                                "base_path": f"/government/publications/{slug}-country-policy-and-information-notes"}
    store.save_state(state)
    store.save_publication(slug, {"public_updated_at": "2026-10-02T10:02:41+01:00", "details": {
        "attachments": attachments, "change_history": [{"public_timestamp": d, "note": n} for d, n in changes]}})
    store.save_pdf_manifest({**store.load_pdf_manifest(), **{
        a["url"]: {"sha256": "0" * 64, "country": slug, "title": a["title"], "first_seen": SEEN}
        for a in attachments if a["attachment_type"] == "file"}})


def edition(store, slug, title, text, *, live=False):
    """Store one HTML edition (the live one, or a copy recovered from the Internet Archive); returns the
    attachment that lists it on the country page."""
    note = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")
    path = f"/government/publications/{slug}-country-policy-and-information-notes/{note}"
    record, _ = store.record_version(
        slug, note, body=f'<div class="govspeak"><p>{text}</p></div>', meta={}, seen_at=SEEN, title=title, base_path=path,
        source="live" if live else "wayback", public_updated_at="2026-10-02T10:02:41+01:00" if live else None,
        capture=None if live else {"captured_at": "2025-10-03T11:58:03Z", "archive_url": "https://web.archive.org/x",
                                   "digest": "D"})
    if live:
        store.set_current(slug, note, record["sha256"], at=SEEN)
    return {"attachment_type": "html", "title": title, "url": path}


def palestine(store, tmp_path):
    bulletin = edition(store, "palestine", "Country bulletin: security situation in Gaza, Palestine, June 2026 (accessible)",
                       "The security situation in Gaza in June 2026.", live=True)
    cpin = "Country policy and information note: {} situation in Gaza, Palestine, November 2024 (accessible)"
    edition(store, "palestine", cpin.format("humanitarian"),
            "Version control: version 4.0, valid from 13 November 2024. The humanitarian situation in Gaza.")
    edition(store, "palestine", cpin.format("security"),
            "Version control: version 1.0, valid from 13 November 2024. The security situation in Gaza.")
    bulletin_pdf = {"attachment_type": "file", "content_type": "application/pdf", "url": f"{ASSETS}/6a39/PSE_Country_Bulletin.pdf",
                    "title": "Country bulletin: security situation in Gaza, Palestine, June 2026"}
    page(store, "palestine", "Palestine", [V5_PDF, bulletin, bulletin_pdf], [
        ("2026-10-02T10:02:41+01:00", V5_NOTE), ("2026-06-22T16:03:22+01:00", BULLETIN_NOTE),
        ("2023-10-31T13:15:26+00:00", REMOVED_NOTE), ("2019-03-08T16:17:35+00:00", BOTH_NOTE)])
    (country,) = build_dashboard(store, CONFIG, series_out=tmp_path)["countries"]
    series = {key: json.loads((tmp_path / "palestine" / f"{key.replace(':', '--')}.json").read_text("utf-8"))
              for key in ("note:gaza-humanitarian-situation", "note:gaza-security-situation", "bulletin:gaza-security-situation")}
    return country, series


def test_a_report_whose_current_edition_is_a_pdf_only_is_live(store, tmp_path):
    country, series = palestine(store, tmp_path)
    held = {"title": V5_PDF["title"], "month": "2026-09", "pdf_url": V5_PDF["url"], "first_seen": SEEN, "current": True}
    humanitarian = series["note:gaza-humanitarian-situation"]
    assert (humanitarian["status"], humanitarian["current_pdf_only"], humanitarian["pdf_editions"]) == ("live", True, [held])
    assert [(v["version"], v["current"]) for v in humanitarian["versions"]] == [("4.0", False)]      # the HTML held is v4.0
    reports = {r["key"]: r for r in country["reports"]}
    report = reports["note:gaza-humanitarian-situation"]
    assert (report["status"], report["current_pdf_only"], report["current_pdf"]) == ("live", True, held)
    # `latest` still describes the last HTML edition held, which has no PDF here.
    assert (report["latest"]["version"], report["latest"]["pdf_url"], report["latest"]["govuk_url"]) == ("4.0", None, None)
    # The bulletin's PDF sits beside its HTML edition, so nothing changes for it; the CPIN it replaced stays archived.
    bulletin = series["bulletin:gaza-security-situation"]
    assert (bulletin["status"], bulletin["current_pdf_only"], bulletin["pdf_editions"]) == ("live", False, [])
    assert "current_pdf_only" not in reports["bulletin:gaza-security-situation"]
    assert reports["bulletin:gaza-security-situation"]["latest"]["pdf_url"].endswith("PSE_Country_Bulletin.pdf")
    assert reports["note:gaza-security-situation"]["status"] == "archived"
    assert len(country["notes"]) == 3                               # the HTML notes, as before


def test_the_update_that_published_a_pdf_only_edition_links_to_it(store, tmp_path):
    country, series = palestine(store, tmp_path)
    newest, *older = series["note:gaza-humanitarian-situation"]["history"]
    assert newest == {"date": "2026-10-02T09:02:41Z", "note": V5_NOTE, "pdf_url": V5_PDF["url"], "pdf_title": V5_PDF["title"]}
    assert [h["note"] for h in older] == [REMOVED_NOTE, BOTH_NOTE] and not any("pdf_url" in h for h in older)
    assert not any("pdf_url" in h for h in country["history"])      # the country's own log stays as GOV.UK gives it


def test_the_pdf_publication_is_marked_only_where_it_is_established():
    pdf = {"title": "T, September 2026", "month": "2026-09", "pdf_url": "u", "first_seen": SEEN, "current": True}
    history = [{"date": "2026-10-02T09:02:41Z", "note": V5_NOTE}, {"date": "2023-10-31T13:15:26Z", "note": REMOVED_NOTE}]

    def marked(history=history, pdf=pdf, last_html_month="2024-11", last_html_date="2024-11-13T00:00:00Z"):
        return [h.get("pdf_url") for h in
                with_pdf_publication(history, pdf, last_html_month=last_html_month, last_html_date=last_html_date)]
    assert marked() == ["u", None]
    assert "pdf_url" not in history[0]                                           # the entries given are not altered
    assert marked(pdf=None) == [None, None]
    assert marked(pdf={**pdf, "first_seen": None}) == [None, None]               # listed by GOV.UK but not mirrored
    assert marked(pdf={**pdf, "month": None}) == [None, None]                    # its title gives no month
    assert marked(pdf={**pdf, "month": "2026-11"}) == [None, None]               # the last update is older than the edition
    assert marked(last_html_month="2026-09") == [None, None]                     # that edition is held as HTML
    assert marked(last_html_date="2026-10-02T09:02:41Z") == [None, None]         # the update is the HTML edition's own
    # An update made after the mirror first saw the file did not publish it; the one before it did.
    assert marked(history=[{"date": "2026-11-05T10:00:00Z", "note": V5_NOTE}, *history]) == [None, "u", None]


def test_change_notes_about_another_report_are_left_out(store, tmp_path):
    _, series = palestine(store, tmp_path)
    assert {key: [h["note"] for h in s["history"]] for key, s in series.items()} == {
        "note:gaza-humanitarian-situation": [V5_NOTE, REMOVED_NOTE, BOTH_NOTE],
        "note:gaza-security-situation": [BULLETIN_NOTE, BOTH_NOTE],       # it names the bulletin and the CPIN it replaces
        "bulletin:gaza-security-situation": [BULLETIN_NOTE, BOTH_NOTE]}
    # Nor is the v5.0 note attached to the bulletin's edition, though GOV.UK gives both the page's date, 2 October
    # 2026. The bulletin is dated by its own title (June 2026), and the note that published it that month is its own.
    (bulletin,) = series["bulletin:gaza-security-situation"]["versions"]
    assert (bulletin["published"], bulletin["published_from"], bulletin["page_updated"]) == ("2026-06-01T00:00:00Z", "title", "2026-10-02T09:02:41Z")
    assert bulletin["govuk_change_notes"] == [{"date": "2026-06-22T15:03:22Z", "note": BULLETIN_NOTE}]


def test_a_note_belongs_to_the_report_that_accounts_for_its_words():
    gaza = ["note:gaza-humanitarian-situation", "note:gaza-security-situation", "bulletin:gaza-security-situation"]
    assert about_another_report(BULLETIN_NOTE, "note:gaza-humanitarian-situation", gaza)
    assert about_another_report(V5_NOTE, "note:gaza-security-situation", gaza)
    assert not any(about_another_report(BOTH_NOTE, key, gaza) for key in gaza)            # names both topics in full
    # Words borrowed from two other reports: 'gender' identity and domestic 'violence' are not gender-based violence.
    albania = ["note:based-gender-violence", "note:abuse-against-domestic-violence-women",
               "note:gender-identity-orientation-sexual"]
    listed = ("Accessible versions added of documents covering: sexual orientation and gender identity, and "
              "domestic abuse and violence against women.")
    assert [about_another_report(listed, key, albania) for key in albania] == [True, False, False]
    # A report named loosely keeps its note when no other report accounts for the words.
    assert not about_another_report("Updated note on women fearing domestic abuse.", albania[1], albania)
    assert topic_history([{"date": None, "note": listed}], albania[0], albania) == []
    assert topic_history([{"date": None, "note": listed}], albania[0]) != []               # as it was matched before


def test_a_note_naming_another_kind_of_document_on_the_topic_is_about_that_one():
    trafficking = ["note:trafficking", "bulletin:human-trafficking"]
    bulletin = "Published the country bulletin: human trafficking, Albania, August 2026."
    assert [about_another_report(bulletin, key, trafficking) for key in trafficking] == [True, False]
    for cpin in ("Updated the country policy and information note on human trafficking.",
                 "Replaced human trafficking CPIN with a new version.",
                 "Updated sections 1.4 and 6 in the note on human trafficking."):
        assert [about_another_report(cpin, key, trafficking) for key in trafficking] == [False, True]
    # With no kind named it could be either report, so both keep it.
    either = "Updated information on human trafficking published."
    assert not any(about_another_report(either, key, trafficking) for key in trafficking)
    feuds = ["note:blood-feuds", "fact-finding:blood-feuds"]
    mission = "Added Report on fact-finding mission: Blood feuds, Albania"
    assert [about_another_report(mission, key, feuds) for key in feuds] == [True, False]
    # A kind named in passing counts only where the country has a report of that kind on the topic.
    assert not about_another_report("Updated guidance on 'Tamil separatism' and new guidance added on 'Report of a Home Office "
                                    "Fact finding mission, July 2016'.", "note:separatism-tamil", ["note:separatism-tamil"])


def test_a_pdf_only_country_lists_one_report_per_pdf(store, tmp_path):
    # Gambia's shape: nothing but a PDF, and no HTML edition ever held, so the PDF is a report of its own.
    gambia = {"attachment_type": "file", "content_type": "application/pdf", "url": f"{ASSETS}/6405/GMB_CPIN.pdf",
              "title": "Country information and guidance: sexual orientation and gender identity, Gambia, February 2023"}
    page(store, "gambia", "Gambia", [gambia], [("2019-08-14T12:12:10Z", "Updated country information and guidance on sexual "
                                                                         "orientation and gender identity.")])
    # France's shape: the page lists only a PDF, but an earlier HTML edition of the same report is held.
    france = {"attachment_type": "file", "content_type": "application/pdf", "url": f"{ASSETS}/699f/France_CIN.pdf",
              "title": "Country policy and information note: safe third country, France, February 2026"}
    edition(store, "france", "Country policy and information note: safe third country, France, August 2025 (accessible)",
            "Version control: version 1.0, valid from 11 August 2025. France is a safe third country.")
    page(store, "france", "France", [france], [("2026-02-26T08:25:32Z", "The guidance has been updated.")])
    fr, gm = build_dashboard(store, CONFIG, series_out=tmp_path)["countries"]
    (report,) = gm["reports"]
    assert (report["key"], report["status"], report["pdf_only"], report["read_url"]) == ("pdf:GMB_CPIN.pdf", "live", True, None)
    assert report["latest"]["pdf_url"] == gambia["url"] and "current_pdf_only" not in report
    assert [(n["id"], n["pdf_only"]) for n in gm["notes"]] == [("GMB_CPIN.pdf", True)]
    (report,) = fr["reports"]                                       # one report, not a PDF beside an archived note
    assert (report["key"], report["status"], report["current_pdf_only"]) == ("note:country-safe-third", "live", True)
    assert (report["current_pdf"]["pdf_url"], report["current_pdf"]["month"]) == (france["url"], "2026-02")
    assert report["latest"]["version"] == "1.0" and "pdf_only" not in report
    assert [(n["status"], n.get("pdf_only", False)) for n in fr["notes"]] == [("live", True), ("archived", False)]
    series = json.loads((tmp_path / "france" / "note--country-safe-third.json").read_text("utf-8"))
    assert series["history"] == []                                  # 'The guidance has been updated.' names no report


def test_a_stray_pdf_beside_a_live_html_edition_is_not_the_current_edition(store, tmp_path):
    live = edition(store, "kenya", "Country policy and information note: actors of protection, Kenya, July 2026 (accessible)",
                   "Version control: version 2.0, valid from 20 July 2026. Protection.", live=True)
    pdfs = [{"attachment_type": "file", "content_type": "application/pdf", "url": f"{ASSETS}/{month}.pdf",
             "title": f"Country policy and information note: actors of protection, Kenya, {month}"}
            for month in ("July 2026", "May 2022")]
    page(store, "kenya", "Kenya", [live, *pdfs])
    (kenya,) = build_dashboard(store, CONFIG, series_out=tmp_path)["countries"]
    (report,) = kenya["reports"]
    assert report["status"] == "live" and "current_pdf_only" not in report and report["latest"]["pdf_url"] == pdfs[0]["url"]
    series = json.loads((tmp_path / "kenya" / "note--actors-protection.json").read_text("utf-8"))
    assert series["current_pdf_only"] is False
    assert [(p["month"], p["pdf_url"], p["current"]) for p in series["pdf_editions"]] == [("2022-05", pdfs[1]["url"], False)]


def test_pictures_only_the_pdf_has_go_to_the_web_edition_they_were_placed_in(site, client, store, tmp_path):
    from cpin import pdftext
    govuk(site)
    sync(client, store)
    note = NOTE_PATH.rsplit("/", 1)[-1]
    pdf_sha, body_sha = store.load_pdf_manifest()[PDF_URL]["sha256"], store.load_note("kenya", note)["current_sha256"]
    image = "ab" * 32 + ".png"
    held = {"extractor": pdftext.EXTRACTOR, "pdf_sha256": pdf_sha, "body_sha256": body_sha, "unplaced": 0,
            "figures": [{"image": image, "tag": "p", "index": 1, "key": "seethesourcereport", "page": 12}]}
    path = pdftext.figures_path(store, pdf_sha)
    path.parent.mkdir(parents=True)
    path.write_text(json.dumps(held), "utf-8")

    def current():
        build_dashboard(store, CONFIG, series_out=tmp_path / "series")
        series = json.loads((tmp_path / "series" / "kenya" / "note--actors-protection.json").read_text("utf-8"))
        return series, series["versions"][-1]

    series, edition = current()
    assert edition["pdf_figures"] == {"pdf_url": PDF_URL, "figures": [{"src": f"pdf-image:{image}", "tag": "p", "index": 1, "key": "seethesourcereport", "page": 12}]}
    assert series["images"][f"pdf-image:{image}"] == f"../../data/pdfs/text/images/{image}"
    assert edition["body"] == BODY, "the verbatim body is not touched"

    # Worked out for a body GOV.UK has since changed: the places no longer hold, so nothing is shown.
    path.write_text(json.dumps({**held, "body_sha256": "0" * 64}), "utf-8")
    series, edition = current()
    assert "pdf_figures" not in edition and not series["images"]


def test_an_edition_replaced_or_withdrawn_on_our_watch_says_when(site, client, store, tmp_path):
    def series():
        data = build_dashboard(store, CONFIG, series_out=tmp_path / "series")
        return data, json.loads((tmp_path / "series" / "kenya" / "note--actors-protection.json").read_text("utf-8"))

    govuk(site)
    sync(client, store)
    data, s = series()
    assert s["versions"][-1]["left_govuk"] is None and s["left_govuk"] is None, "the edition on GOV.UK now"

    govuk(site, body=BODY.replace("able to offer", "able to provide"))        # edited in place: a newer text, same address
    second = sync(client, store, full=True)
    data, s = series()
    old, new = s["versions"]
    assert old["left_govuk"]["how"] == "replaced" and old["left_govuk"]["at"] == new["first_seen"] == second.started
    assert old["left_govuk"]["last_seen"] <= old["left_govuk"]["at"] and new["left_govuk"] is None

    govuk(site, with_note=False, with_pdf=False, pub_updated="2026-09-01T10:00:00+01:00", collection_etag='W/"c2"')   # then it goes
    third = sync(client, store)
    data, s = series()
    assert s["status"] == "removed" and s["versions"][-1]["left_govuk"]["how"] == "withdrawn"
    assert s["left_govuk"]["at"] == s["versions"][-1]["left_govuk"]["at"] == third.started
    assert store.load_note("kenya", NOTE_PATH.rsplit("/", 1)[-1])["status_log"][-1] == {
        "status": "removed", "at": third.started, "last_listed": second.started}, "still listed at the check before"
    assert s["left_govuk"]["last_seen"] == second.started
    report = next(r for r in data["countries"][0]["reports"] if r["key"] == "note:actors-protection")
    assert report["left_govuk"]["at"] == third.started
    assert s["versions"][0]["left_govuk"]["how"] == "replaced", "the earlier edition keeps the day it was replaced"


def test_where_the_web_and_pdf_differ_goes_to_the_web_edition_it_was_worked_out_for(site, client, store, tmp_path):
    from cpin import webpdf
    govuk(site)
    sync(client, store)
    note = NOTE_PATH.rsplit("/", 1)[-1]
    pdf_sha, body_sha = store.load_pdf_manifest()[PDF_URL]["sha256"], store.load_note("kenya", note)["current_sha256"]
    where = {"heading": "assessment", "paragraph": None, "section": "Assessment", "page": 5}
    record = {      # as webpdf.compare_into_store keeps it: one difference of wording, one of numbering
        "method": webpdf.METHOD, "extractor": "x", "note": f"kenya/{note}", "pdf_sha256": pdf_sha, "body_sha256": body_sha,
        "words": {"web": 30, "pdf": 34}, "not_listed": 0,
        "summary": {"wording": {"differences": 1, "web_words": 0, "pdf_words": 4, "share": 0.0625, "passages": 1, "sizes": {"passage": 1}},
                    "opening": {"differences": 1, "passages": 1, "words": 4}, "drafts": ["footnote count differs: web 1, PDF 2"]},
        "differences": [
            {"kind": "text", "group": "wording", "verdict": "real", "web": "", "pdf": "willing in most areas", "web_words": 0, "pdf_words": 4, "where": where, "size": "passage",
             "before": "the state is", "after": "and able", "second": "agrees"},
            {"kind": "numbering", "group": "numbering", "verdict": "real", "web": "2", "pdf": "1", "web_words": 1, "pdf_words": 1, "where": where}],
        "paragraphs": {"same": 4, "different": {"3.1.2": "3.1.1"}, "pdf_unnumbered": []},
    }
    path = webpdf.compare_path(store, pdf_sha)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(record), "utf-8")
    data = build_dashboard(store, CONFIG, series_out=tmp_path / "series")
    edition = json.loads((tmp_path / "series" / "kenya" / "note--actors-protection.json").read_text("utf-8"))["versions"][-1]
    held = edition["pdf_compare"]
    assert held["pdf_url"] == PDF_URL and held["wording"] == {"differences": 1, "web_words": 0, "pdf_words": 4, "share": 0.0625, "passages": 1}
    (d,) = held["differences"]                                  # the difference of wording; the numbering is in the map instead
    assert d == {"kind": "text", "web": "", "pdf": "willing in most areas", "web_words": 0, "pdf_words": 4, "where": where, "size": "passage",
                 "before": "the state is", "after": "and able", "second": "agrees"}
    assert held["numbering"]["different"] == {"3.1.2": "3.1.1"} and held["flagged"] is True and held["not_listed"] == 0
    assert held["numbering"]["repeated"] == held["numbering"]["unconfirmed"] == [], "a record made before these were kept"
    assert held["drafts"] == ["footnote count differs: web 1, PDF 2"]
    assert edition["body"] == BODY
    report = next(r for r in data["countries"][0]["reports"] if r["key"] == "note:actors-protection")
    assert report["pdf_differs"] == {"words": held["wording"]["web_words"] + held["wording"]["pdf_words"], "flagged": True}

    path.write_text(json.dumps({**record, "body_sha256": "0" * 64}), "utf-8")           # made for a body GOV.UK has since changed
    build_dashboard(store, CONFIG, series_out=tmp_path / "series")
    assert "pdf_compare" not in json.loads((tmp_path / "series" / "kenya" / "note--actors-protection.json").read_text("utf-8"))["versions"][-1]


def test_a_change_of_markup_only_leaves_the_report_live_with_the_copy_on_govuk_now(site, client, store, tmp_path):
    govuk(site)
    sync(client, store)
    relinked = BODY.replace("https://example.org/report", "https://example.org/report-2026")      # a corrected link: same words
    govuk(site, body=relinked)
    sync(client, store, full=True)
    data = build_dashboard(store, CONFIG, series_out=tmp_path / "series")
    series = json.loads((tmp_path / "series" / "kenya" / "note--actors-protection.json").read_text("utf-8"))
    (edition,) = series["versions"]                                  # one text, so one edition
    assert edition["body"] == relinked and edition["current"] and edition["left_govuk"] is None
    assert edition["govuk_url"].endswith(NOTE_PATH)
    assert [(other["source"], other["id"]) for other in edition["also_held_as"]] == [("live", store.load_note("kenya", NOTE_PATH.rsplit("/", 1)[-1])["versions"][0]["sha256"][:16])]
    assert series["status"] == "live" and series["left_govuk"] is None
    (report,) = data["countries"][0]["reports"]
    assert report["status"] == "live" and report["latest"]["govuk_url"].endswith(NOTE_PATH)


def test_a_country_the_collection_no_longer_lists_shows_nothing_as_current(site, client, store, tmp_path):
    from conftest import COLLECTION_URL
    govuk(site)
    sync(client, store)
    # Its PDF-only edition, readable or not, was current only while the collection listed the page.
    france = {"attachment_type": "file", "content_type": "application/pdf", "url": f"{ASSETS}/699f/France_CIN.pdf",
              "title": "Country policy and information note: safe third country, France, February 2026"}
    edition(store, "france", "Country policy and information note: safe third country, France, August 2025 (accessible)",
            "Version control: version 1.0, valid from 11 August 2025. France is a safe third country.")
    page(store, "france", "France", [france])
    gone = [{"title": "Other: country policy and information notes", "public_updated_at": "2026-09-01T10:00:00+01:00",
             "base_path": "/government/publications/other-country-policy-and-information-notes"}]
    site.json(COLLECTION_URL, {"links": {"documents": gone}}, etag='W/"c2"')
    report = sync(client, store)
    data = build_dashboard(store, CONFIG, series_out=tmp_path / "series")
    fr, kenya = data["countries"]
    assert kenya["dropped_from_collection"] == fr["dropped_from_collection"] == report.started
    (report_,) = kenya["reports"]
    assert report_["status"] == "removed" and report_["left_govuk"]["by"] == "country page no longer in the collection"
    assert [n["status"] for n in kenya["notes"]] == ["removed"]
    assert [(n["status"], n.get("pdf_only", False)) for n in fr["notes"]] == [("removed", True), ("archived", False)]
    (report_,) = fr["reports"]
    assert report_["status"] == "archived" and "current_pdf_only" not in report_
    series = json.loads((tmp_path / "series" / "france" / "note--country-safe-third.json").read_text("utf-8"))
    assert [p["current"] for p in series["pdf_editions"]] == [False] and series["current_pdf_only"] is False
    assert data["totals"]["notes"] == 0


# --- An edition's date is the note's own, never the country page's ---------------------------------
def dated(version_control: str) -> str:
    return BODY.replace("Version control and feedback. This is Version 2.0 of the note.", version_control)


def exported(store, tmp_path):
    data = build_dashboard(store, CONFIG, series_out=tmp_path / "series")
    series = json.loads((tmp_path / "series" / "kenya" / "note--actors-protection.json").read_text("utf-8"))
    return data["countries"][0]["reports"][0], series


def test_an_edition_is_dated_by_its_own_valid_from_date_not_the_pages(site, client, store, tmp_path):
    # China, medical treatment: valid from 5 July 2022, on a page GOV.UK last updated on 1 September 2026.
    govuk(site, body=dated("Version control: version 2.0, valid from 5 July 2022."), pub_updated="2026-09-01T15:41:42+01:00")
    site.json(config.CONTENT_API + NOTE_PATH, {**json.loads(site.routes[config.CONTENT_API + NOTE_PATH][0]),
                                               "public_updated_at": "2026-09-01T15:41:42+01:00"})
    sync(client, store)
    report, series = exported(store, tmp_path)
    (edition,) = series["versions"]
    assert (edition["published"], edition["published_precision"], edition["published_from"]) == ("2022-07-05T00:00:00Z", "day", "valid from")
    assert edition["page_updated"] == "2026-09-01T14:41:42Z" and edition["date"] == "2022-07-05T00:00:00Z"
    latest = report["latest"]
    assert (latest["published"], latest["published_precision"], latest["published_from"], latest["page_updated"]) == (
        "2022-07-05T00:00:00Z", "day", "valid from", "2026-09-01T14:41:42Z")


def test_an_edition_with_no_valid_from_date_takes_the_month_in_its_title_and_one_with_neither_has_none(site, client, store, tmp_path):
    govuk(site)                                                # titled July 2026, with no "valid from" in its text
    sync(client, store)
    _, series = exported(store, tmp_path)
    (edition,) = series["versions"]
    assert (edition["published"], edition["published_precision"], edition["published_from"]) == ("2026-07-01T00:00:00Z", "month", "title")
    assert edition["page_updated"] == "2026-07-27T14:09:18Z"

    index = store.load_note("kenya", NOTE_PATH.rsplit("/", 1)[-1])     # as Brazil's fact-finding report: no month in the title either
    index["title"] = index["versions"][0]["title"] = "Country policy and information note: actors of protection, Kenya (accessible)"
    store.save_note("kenya", NOTE_PATH.rsplit("/", 1)[-1], index)
    report, series = exported(store, tmp_path)
    (edition,) = series["versions"]
    assert (edition["published"], edition["published_precision"], edition["published_from"]) == (None, None, None)
    assert edition["date"] == edition["page_updated"] == "2026-07-27T14:09:18Z", "placed by the page's date, but not said to be published then"
    assert report["latest"]["published"] is None and report["latest"]["page_updated"] == "2026-07-27T14:09:18Z"


def test_the_edition_on_govuk_now_comes_after_an_earlier_state_of_it_recovered_from_the_archive(site, client, store, tmp_path):
    # Both say "valid from 5 July 2022": GOV.UK edited the note in place. The archive copy was captured in 2023,
    # though this site read it from the Archive after it had read the live note.
    live = dated("Version control: version 2.0, valid from 5 July 2022.")
    govuk(site, body=live)
    sync(client, store)
    store.record_version("kenya", NOTE_PATH.rsplit("/", 1)[-1], body=live.replace("able to offer", "unable to offer"), meta={},
                         seen_at="2026-10-03T00:00:00Z", source="wayback", title="t", base_path=NOTE_PATH,
                         capture={"captured_at": "2023-01-10T00:00:00Z", "archive_url": "https://web.archive.org/x", "digest": "D"})
    report, series = exported(store, tmp_path)
    assert [(e["source"], e["current"]) for e in series["versions"]] == [("wayback", False), ("live", True)]
    assert report["status"] == "live" and report["latest"]["govuk_url"].endswith(NOTE_PATH)


def test_a_change_note_is_matched_to_an_edition_dated_only_to_a_month():
    from cpin.changes import matching_change_notes
    history = [{"date": "2026-06-22T15:03:22Z", "note": "Published the country bulletin: security situation in Gaza."},
               {"date": "2026-08-02T10:00:00Z", "note": "Security situation in Gaza: a later change."}]
    words = {"gaza", "security", "situation"}
    assert matching_change_notes(history, "2026-06-01T00:00:00Z", words) == []                   # the 22nd is over 21 days from the 1st
    assert matching_change_notes(history, "2026-06-01T00:00:00Z", words, month=True) == history[:1]      # but it is in that month
    assert matching_change_notes(history, "2026-07-01T00:00:00Z", words, month=True) == history         # 21 days either side of July


def test_archive_copies_of_one_text_are_one_archived_edition(site, client, store, tmp_path):
    govuk(site)
    sync(client, store)
    old = BODY.replace("able to offer", "unable to offer")
    note = "country-policy-and-information-note-actors-of-protection-kenya-may-2022-accessible"
    for when, body in (("2022-06-01", old), ("2022-09-01", old.replace("</p>  \n<p>", "</p>\n<p>")),      # the same words twice
                       ("2026-08-01", BODY.replace("</p>  \n<p>", "</p><p>"))):                          # and a copy of the live text
        store.record_version("kenya", note, body=body, meta={}, seen_at="2026-10-02T00:00:00Z", source="wayback",
                             title="Country policy and information note: actors of protection, Kenya, May 2022",
                             base_path="/government/publications/kenya/old",
                             capture={"captured_at": f"{when}T00:00:00Z", "archive_url": f"https://web.archive.org/{when}", "digest": when})
    assert len(store.load_note("kenya", note)["versions"]) == 2, "the second copy of the old text is a capture of the first"
    data = build_dashboard(store, CONFIG, series_out=tmp_path / "series")
    series = json.loads((tmp_path / "series" / "kenya" / "note--actors-protection.json").read_text("utf-8"))
    assert [(e["source"], len(e.get("also_held_as", []))) for e in series["versions"]] == [("wayback", 0), ("live", 1)]
    archived = next(n for n in data["countries"][0]["notes"] if n["id"] == note)
    assert (archived["archived_editions"], archived["archive_copies"]) == (1, 2)
    assert (data["totals"]["archived_editions"], data["totals"]["archive_copies"]) == (1, 2)


# --- Editions recovered as PDFs from the Internet Archive (recover.py) ------------------------------
def recovered(store, slug, title, text, *, sha, captured="2019-07-26T16:10:37Z", extract=True):
    """Put a recovered PDF in the manifest as `recover` leaves it and, with extract, its text as `pdftext` does."""
    from cpin import pdftext
    url = f"https://assets.publishing.service.gov.uk/government/uploads/system/uploads/attachment_data/file/{sha[:6]}/{sha[:6]}.pdf"
    stamp = re.sub(r"\D", "", captured)
    entry = {"sha256": sha, "bytes": 1000, "etag": None, "country": slug, "title": title, "first_seen": "2026-10-04T09:00:00Z",
             "last_seen": None, "source": "wayback", "archive_url": f"https://web.archive.org/web/{stamp}/{url}",
             "captured_at": captured, "original_url": url, "first_listed": "2019-07-24T07:30:03Z",
             "last_listed": "2022-06-12T02:07:41Z"}
    store.save_pdf_manifest({**store.load_pdf_manifest(), url: entry})
    if extract:
        pdftext.text_dir(store).mkdir(parents=True, exist_ok=True)
        (pdftext.text_dir(store) / f"{sha}.html").write_text(f'<div class="govspeak"><p>{text}</p></div>', "utf-8")
        (pdftext.text_dir(store) / f"{sha}.json").write_text(json.dumps(
            {"extractor": pdftext.EXTRACTOR, "pages": 67, "warnings": [], "pdf_sha256": sha}), "utf-8")
    return url, entry


@pytest.mark.parametrize("source,provider", [("wayback", "Internet Archive"),
                                               ("national-archives", "National Archives"),
                                               ("repository", "ecoi.net")])
def test_an_edition_recovered_as_a_pdf_takes_its_place_in_its_reports_history(store, tmp_path, source, provider):
    live = edition(store, "kenya", "Country policy and information note: actors of protection, Kenya, July 2026 (accessible)",
                   "Version control: version 3.0, valid from 20 July 2026. Protection now.", live=True)
    page(store, "kenya", "Kenya", [live], [("2019-03-08T16:17:35+00:00", "Actors of protection version 2.0 added.")])
    url, entry = recovered(store, "kenya", "Country policy and information note: actors of protection, Kenya, March 2019",
                           "Version control: version 2.0, valid from 8 March 2019. Protection then.", sha="a" * 64)
    entry.update(source=source, archive_provider=provider)
    store.save_pdf_manifest({url: entry})
    (kenya,) = build_dashboard(store, CONFIG, series_out=tmp_path)["countries"]
    series = json.loads((tmp_path / "kenya" / "note--actors-protection.json").read_text("utf-8"))
    old, now = series["versions"]                                    # by its own date: before the edition on GOV.UK now
    assert (old["source"], old["version"], old["published"], old["published_from"]) == ("pdf", "2.0", "2019-03-08T00:00:00Z", "valid from")
    # An archived copy of a PDF: both. Its source is the Archive's address, never GOV.UK's (which now leads elsewhere).
    assert (old["archive_url"], old["pdf_url"], old["captured_at"]) == (entry["archive_url"], entry["archive_url"], entry["captured_at"])
    assert old["archive_provider"] == provider
    assert (old["listed"], old["current"], old["govuk_url"], old["note"]) == (False, False, None, None)
    assert (old["listed_from"], old["listed_until"]) == ("2019-07-24T07:30:03Z", "2022-06-12T02:07:41Z")
    assert old["extracted"]["pdf_sha256"] == "a" * 64 and "Protection then." in old["body"]
    assert [h["note"] for h in old["govuk_change_notes"]] == ["Actors of protection version 2.0 added."]
    assert (now["source"], now["current"]) == ("live", True)
    assert (series["status"], series["current_pdf_only"], series["pdf_editions"]) == ("live", False, [])
    (report,) = kenya["reports"]
    assert (report["status"], report["editions"]) == ("live", 2) and "text_from_pdf" not in report["latest"]


def test_an_older_country_wide_guidance_note_has_a_readable_report_name(store, tmp_path):
    page(store, "kenya", "Kenya", [])
    recovered(store, "kenya", "Operational guidance note: Kenya, December 2013",
              "Version 8.0, December 2013. Guidance.", sha="e" * 64)
    data = build_dashboard(store, CONFIG, series_out=tmp_path / "series")
    (report,) = data["countries"][0]["reports"]
    assert report["topic"] == "Operational guidance note"
    assert report["key"] == "note:untitled", "Keep existing history and saved-highlight addresses"
    assert report["status"] == "archived"


def test_a_report_with_only_recovered_editions_is_a_report_no_longer_on_govuk(store, tmp_path):
    page(store, "kenya", "Kenya", [])
    first, _ = recovered(store, "kenya", "Country policy and information note: prison conditions, Kenya, March 2019",
                         "Version control: version 1.0, valid from 8 March 2019. Prisons.", sha="b" * 64)
    _, last = recovered(store, "kenya", "Country policy and information note: prison conditions, Kenya, May 2021",
                        "Version control: version 2.0, valid from 3 May 2021. Prisons, again.", sha="c" * 64, captured="2021-06-01T00:00:00Z")
    recovered(store, "kenya", "Country policy and information note: Hazaras, Kenya, June 2020", "Not read yet.", sha="d" * 64, extract=False)
    data = build_dashboard(store, CONFIG, series_out=tmp_path / "series")
    (kenya,) = data["countries"]
    (report,) = kenya["reports"]                                     # the one with no text extracted is not shown
    assert (report["key"], report["status"], report["editions"], report["topic"]) == ("note:conditions-prison", "archived", 2, "prison conditions")
    assert report["latest"] == {"version": "2.0", "published": "2021-05-03T00:00:00Z", "published_precision": "day",
                                "published_from": "valid from", "page_updated": None, "note": None, "govuk_url": None,
                                "archive_url": last["archive_url"], "pdf_url": last["archive_url"], "text_from_pdf": True}
    assert report["read_url"] == "../reader/index.html?country=kenya&series=note:conditions-prison"
    series = json.loads((tmp_path / "series" / "kenya" / "note--conditions-prison.json").read_text("utf-8"))
    assert (series["status"], series["current_pdf_only"], series["left_govuk"]) == ("archived", False, None)
    assert [(e["version"], e["current"], e["listed"]) for e in series["versions"]] == [("1.0", False, False), ("2.0", False, False)]
    assert kenya["notes"] == []                                      # it has no page of its own to list
    assert kenya["archived_pdf_editions"] == 2                       # but its editions are archived editions all the same
    assert (data["totals"]["archived_editions"], data["totals"]["archived_pdf_editions"]) == (2, 2)


def test_a_recovered_pdf_beside_a_web_version_of_the_same_month_is_left_out(store, tmp_path):
    from cpin.export import recovered_pdf_files
    edition(store, "kenya", "Country policy and information note: actors of protection, Kenya, May 2022 (accessible)",
            "Version control: version 3.0, valid from 12 May 2022. The web version.")
    page(store, "kenya", "Kenya", [])
    recovered(store, "kenya", "Country policy and information note: actors of protection, Kenya, May 2022",
              "Version control: version 3.0, valid from 12 May 2022. The PDF.", sha="e" * 64, captured="2022-06-01T00:00:00Z")
    wanted, _ = recovered(store, "kenya", "Country policy and information note Kenya: actors of protection", "No month in its title.",
                          sha="f" * 64, captured="2021-10-06T00:00:00Z")
    assert [url for _, _, url in recovered_pdf_files(store)] == [wanted]      # only the one with no web version is read
    build_dashboard(store, CONFIG, series_out=tmp_path)
    series = json.loads((tmp_path / "kenya" / "note--actors-protection.json").read_text("utf-8"))
    assert [(e["source"], e["date"]) for e in series["versions"]] == [("pdf", "2021-10-06T00:00:00Z"), ("wayback", "2022-05-12T00:00:00Z")]


def test_two_recovered_copies_of_one_text_are_one_edition(store, tmp_path):
    """GOV.UK replaced the file and the words did not change: the white-space-blind fingerprint says so."""
    page(store, "kenya", "Kenya", [])
    title = "Country policy and information note: prison conditions, Kenya, March 2019"
    recovered(store, "kenya", title, "Version control: version 1.0, valid from 8 March 2019. Prisons.", sha="b" * 64)
    _, again = recovered(store, "kenya", title, "Version control:  version 1.0, valid from 8 March 2019.\nPrisons.", sha="c" * 64,
                         captured="2020-01-01T00:00:00Z")
    build_dashboard(store, CONFIG, series_out=tmp_path)
    series = json.loads((tmp_path / "kenya" / "note--conditions-prison.json").read_text("utf-8"))
    (only,) = series["versions"]
    assert only["id"] == "b" * 16 and only["also_held_as"] == [
        {"id": "c" * 16, "note": None, "source": "pdf", "captured_at": "2020-01-01T00:00:00Z", "archive_url": again["archive_url"]}]


def test_two_files_recovered_at_one_address_keep_both_editions_and_extraction_jobs(store, tmp_path):
    from cpin.export import recovered_pdf_jobs
    page(store, 'kenya', 'Kenya', [])
    old_url, old = recovered(store, 'kenya', 'Country policy and information note: prison conditions, Kenya, March 2019',
                             'Version control: version 1.0, valid from 8 March 2019. Old prisons.', sha='b' * 64)
    url, latest = recovered(store, 'kenya', 'Country policy and information note: prison conditions, Kenya, May 2021',
                             'Version control: version 2.0, valid from 3 May 2021. New prisons.', sha='c' * 64, captured='2021-06-01T00:00:00Z')
    manifest = store.load_pdf_manifest()
    del manifest[old_url]
    manifest[url] = {**latest, 'previous': [old]}
    store.save_pdf_manifest(manifest)
    jobs = list(recovered_pdf_jobs(store))
    assert [job[3]['sha256'] for job in jobs] == ['b' * 64, 'c' * 64]
    assert [job[2] for job in jobs] == [url, url]
    build_dashboard(store, CONFIG, series_out=tmp_path)
    series = json.loads((tmp_path / 'kenya' / 'note--conditions-prison.json').read_text())
    assert [(v['version'], v['id'], v['archive_url']) for v in series['versions']] == [
        ('1.0', 'b' * 16, old['archive_url']), ('2.0', 'c' * 16, latest['archive_url'])]


def test_fresh_export_includes_retained_archive_links_without_rechecking(site, client, store, tmp_path, monkeypatch):
    from cpin import linkcheck
    from cpin.export import export_dashboard
    from cpin.store import write_json

    govuk(site)
    sync(client, store)
    entry = {"status": "broken", "code": 404, "used_by": ["kenya/report"],
             "archived_url": "https://web.archive.org/web/20260101/https://source.example/report",
             "archived_at": "2026-01-01T00:00:00Z"}
    manifest = store.root / "links" / "manifest.json"
    write_json(manifest, {"https://source.example/report": entry})
    original = manifest.read_bytes()
    monkeypatch.setattr(linkcheck, "check_links", lambda *a, **kw: pytest.fail("export must be offline"))
    countries_config = tmp_path / "countries.json"
    write_json(countries_config, CONFIG)
    destination = tmp_path / "fresh-site" / "data"
    export_dashboard(store, destination / "dashboard.json", countries_config, series_out=destination / "series")
    links = json.loads((destination / "links" / "kenya.json").read_text())
    assert links["https://source.example/report"]["archived_url"] == entry["archived_url"]
    assert links["https://source.example/report"]["status"] == "broken"
    assert manifest.read_bytes() == original
