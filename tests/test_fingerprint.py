from cpin.fingerprint import text_sha256, version_banner


def test_version_comes_from_the_version_control_section():
    body = ("<h2>Assessment</h2><p>See the earlier note (version 2.0) for background.</p>"
            "<h2>Version control and feedback</h2><h3>Clearance</h3><p>Below is information on when this note was cleared:</p>"
            "<ul><li>version 5.0</li><li>valid from 3 March 2026</li></ul>")
    assert version_banner(body) == "5.0"


def test_version_comes_from_the_banner_when_there_is_no_section():
    assert version_banner("<p>Version 3.0, October 2024</p><h2>Executive summary</h2><p>Text.</p>") == "3.0"


def test_a_note_without_its_own_version_has_none():
    # Albania's 2026 bulletin on trafficking: a 'Version control' section with only a date, and a
    # sentence citing another document's version. That is not this document's version.
    body = ("<p>This bulletin updates the position.</p>" + "<p>Filler sentence about the situation.</p>" * 20
            + "<p>Country information as set out in the archived version of the Albania: Human trafficking CPIN "
              "(version 16.0) remains relevant.</p>"
            + "<h2>Version control and feedback</h2><h3>Clearance</h3><p>Below is information on when this note was cleared:</p>"
              "<ul><li>valid from 19 August 2026</li></ul>")
    assert version_banner(body) is None


# --- The text fingerprint: the words, whatever the white space ------------------------------------
LIVE = ('<div class="govspeak"><p>3.1.1 The state is willing and able to offer protection.'
        '<sup id="fnref:1"><a href="#fn:1" class="footnote" role="doc-noteref">[footnote 1]</a></sup></p>\n'
        '<p>Advisory Group<br>5th Floor<br>London</p>\n'
        '<div class="footnotes" role="doc-endnotes"><ol><li id="fn:1"><p>USSD, 2025 '
        '<a href="#fnref:1" class="reversefootnote" role="doc-backlink">↩</a></p></li></ol></div></div>')


def test_copies_that_differ_only_in_white_space_or_the_return_arrow_share_a_fingerprint():
    # As an archive page has them: a space after a line break, none before the footnote's return arrow, the
    # arrow with a variation selector or left out, a non-breaking space, and the blocks run together.
    for archived in (LIVE.replace("<br>", "<br> "), LIVE.replace("USSD, 2025 <a", "USSD, 2025<a"),
                     LIVE.replace("↩", "↩\ufe0e"), LIVE.replace("↩", ""), LIVE.replace("5th Floor", "5th\u00a0Floor"),
                     LIVE.replace("</p>\n<p>", "</p><p>"), LIVE.replace("</p>\n<p>", "</p>\n\n  <p>")):
        assert archived != LIVE and text_sha256(archived) == text_sha256(LIVE)


def test_a_difference_in_the_words_is_a_different_fingerprint():
    for edited in (LIVE.replace("willing and able", "willing but not able"), LIVE.replace("3.1.1", "3.1.2"),
                   LIVE.replace("protection.", "protection"), LIVE.replace("USSD, 2025", "USSD, 2026"),
                   LIVE.replace("The state", "the state"), LIVE.replace("[footnote 1]", "[footnote 2]"),
                   LIVE.replace("<p>Advisory Group<br>5th Floor<br>London</p>", "")):
        assert text_sha256(edited) != text_sha256(LIVE)


def test_an_archive_copy_differing_only_in_white_space_is_a_capture_of_the_edition_held(store):
    store.record_version("kenya", "a-note", body=LIVE, meta={}, seen_at="2026-10-02T00:00:00Z", source="live",
                         title="t", base_path="/x", public_updated_at="2026-07-27T10:00:00Z")
    capture = {"captured_at": "2026-08-01T00:00:00Z", "archive_url": "https://web.archive.org/x", "digest": "D"}
    record = lambda body: store.record_version("kenya", "a-note", body=body, meta={}, seen_at="2026-10-03T00:00:00Z",
                                               source="wayback", title="t", base_path="/x", capture=capture)[1]
    assert record(LIVE.replace("<br>", "<br> ").replace("USSD, 2025 <a", "USSD, 2025<a")) is False
    (version,) = store.load_note("kenya", "a-note")["versions"]
    assert version["captures"] == [capture] and store.read_body("kenya", "a-note", version["sha256"]) == LIVE
    assert record(LIVE.replace("willing and able", "unwilling or unable")) is True, "other words: another edition"


def test_rederive_recomputes_the_text_fingerprint_and_leaves_the_body_alone(store, capsys):
    from argparse import Namespace

    from cpin import cli
    from cpin.fingerprint import sha256_text, visible_text
    store.record_version("kenya", "a-note", body=LIVE, meta={}, seen_at="2026-10-02T00:00:00Z", source="live",
                         title="t", base_path="/x")
    index = store.load_note("kenya", "a-note")
    index["versions"][0]["text_sha256"] = sha256_text(visible_text(LIVE))      # as it was made before: white space counted
    store.save_note("kenya", "a-note", index)
    assert cli.cmd_rederive(Namespace(dry_run=True), store) == 0 and "1 text fingerprint(s) would change" in capsys.readouterr().out
    assert store.load_note("kenya", "a-note") == index, "a dry run writes nothing"
    assert cli.cmd_rederive(Namespace(dry_run=False), store) == 0 and "1 text fingerprint(s) changed" in capsys.readouterr().out
    (version,) = store.load_note("kenya", "a-note")["versions"]
    assert version["text_sha256"] == text_sha256(LIVE) and version["sha256"] == index["versions"][0]["sha256"]
    assert store.read_body("kenya", "a-note", version["sha256"]) == LIVE
    cli.cmd_rederive(Namespace(dry_run=False), store)
    assert "0 text fingerprint(s) changed" in capsys.readouterr().out
