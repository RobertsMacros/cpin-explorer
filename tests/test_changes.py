from cpin.changes import change_statement, change_statement_html, matching_change_notes, valid_from

VERSION_CONTROL = """<div class="govspeak"><h2 id="version-control">Version control and feedback</h2>
<p>Clearance: Below is information on when this note was cleared:</p>
<ul><li><p>version 5.0</p></li><li><p>valid from 26 August 2025</p></li></ul>
<h3 id="changes-from-last-version-of-this-note">Changes from last version of this note</h3>
<p>Additional country information relating to non-practising Muslims and ‘Westernisation’ (sections 13.4, and 16.3 to 16.5).<sup><a href="#fn:9" role="doc-noteref">[footnote 9]</a></sup></p>
<p>Minor changes to the assessment in line with COI updates.</p>
<h3 id="feedback-to-the-home-office">Feedback to the Home Office</h3><p>Our goal is to provide accurate…</p>
<div class="footnotes" role="doc-endnotes"><ol><li id="fn:9"><p>A source.</p></li></ol></div></div>"""


def test_statement_is_verbatim_and_stops_at_the_next_heading():
    assert change_statement(VERSION_CONTROL) == (
        "Additional country information relating to non-practising Muslims and ‘Westernisation’ "
        "(sections 13.4, and 16.3 to 16.5). Minor changes to the assessment in line with COI updates.")


def test_statement_stops_at_the_footnotes():
    body = ('<h3>Changes from last version of this note</h3><p>Updated COI as per the Terms of Reference.</p>'
            '<div class="footnotes"><ol><li><p>Ashley Jackson, Negotiating Survival</p></li></ol></div>')
    assert change_statement(body) == "Updated COI as per the Terms of Reference."


SUDAN_LIKE = """<h3 id="changes-from-last-version-of-this-note">Changes from last version of this note</h3>
<p>Updated COI, changed assessment on areas that are now relatively secure.</p><p>“15c” generally met in …</p>
<table><thead><tr><th scope="col">State</th><th scope="col">previous CPIN</th><th scope="col">current CPIN</th></tr></thead>
<tbody><tr><th scope="row">Al Jazirah</th><td>Yes</td><td>No</td></tr></tbody></table>
<h3 id="feedback-to-the-home-office">Feedback to the Home Office</h3>"""


def test_tables_stay_out_of_the_caption_but_in_the_html():
    assert change_statement(SUDAN_LIKE) == ("Updated COI, changed assessment on areas that are now relatively secure. "
                                            "“15c” generally met in …")
    html = change_statement_html(SUDAN_LIKE)
    assert "<table>" in html and '<th scope="row">Al Jazirah</th>' in html and "Feedback" not in html


def test_bold_paragraph_heading_and_missing_statement():
    assert change_statement("<p><strong>Changes from last version of this note</strong></p><p>First version.</p>") == "First version."
    assert change_statement("<p>No version control here.</p>") is None


def test_valid_from_date():
    assert valid_from(VERSION_CONTROL) == "2025-08-26T00:00:00Z"
    assert valid_from("<p>valid from sometime</p>") is None


def test_govuk_change_notes_match_by_date_and_topic():
    history = [{"date": "2025-09-02T10:00:00Z", "note": "Published an updated note on fear of the Taliban."},
               {"date": "2025-09-01T10:00:00Z", "note": "Published a note on humanitarian situation."},
               {"date": "2024-01-01T10:00:00Z", "note": "Updated the note on the Taliban."}]
    hits = matching_change_notes(history, "2025-08-26T00:00:00Z", {"taliban"})
    assert [h["note"] for h in hits] == ["Published an updated note on fear of the Taliban."]
