from conftest import BODY, NOTE_PATH, govuk

from cpin import verify
from cpin.links import extract_links
from cpin.sync import sync
from cpin.wayback import extract_body

NOTE = NOTE_PATH.rsplit("/", 1)[-1]


def test_integrity_catches_a_tampered_body(site, client, store):
    govuk(site)
    sync(client, store)
    assert verify.check_integrity(store)["problems"] == []
    index = store.load_note("kenya", NOTE)
    store.body_path("kenya", NOTE, index["current_sha256"]).write_text("<p>edited</p>")
    assert verify.check_integrity(store)["problems"][0]["problem"] == "hash mismatch"


def test_completeness_counts_and_detects_missing_pdf(site, client, store):
    govuk(site)
    sync(client, store)
    result = verify.check_complete(store)
    assert result["problems"] == []
    assert result["counts"] == {"countries": 1, "notes_listed": 1, "notes_stored": 1,
                                "pdfs_listed": 1, "pdfs_mirrored": 1, "pdfs_on_this_disk": 1}
    entry = next(iter(store.load_pdf_manifest().values()))
    store.pdf_path(entry["sha256"]).unlink()          # e.g. a runner whose PDFs live in R2
    result = verify.check_complete(store)
    assert result["problems"] == [] and result["counts"]["pdfs_on_this_disk"] == 0
    store.save_pdf_manifest({})
    assert verify.check_complete(store)["problems"][0]["problem"] == "PDF not mirrored"


def test_containment_ignores_footnote_markers_and_page_furniture():
    html = ('<p>The authorities generally provide effective protection to people in this situation.'
            '<sup><a href="#fn:3" role="doc-noteref">[footnote 3]</a></sup> '
            'Each case must nevertheless be considered on its facts and merits.</p>')
    pdf = ("The authorities generally provide effective protection to people in this\n"
           "situation.3 Each case must nevertheless be considered on its facts\nPage 12 of 40\nand merits.")
    result = verify.containment(html, pdf)
    assert (result["sentences"], result["exact"], result["split_by_layout"]) == (2, 1, 1)
    assert result["ratio"] == 1.0
    assert verify.containment(html, pdf.replace("Page 12 of 40\n", ""))["exact"] == 2
    absent = verify.containment(html, "Something else entirely, with no overlap at all in its wording.")
    assert absent["found"] == 0 and len(absent["missing_examples"]) == 2


def test_blocks_keep_headings_and_line_breaks_apart():
    html = ('<h2>Executive summary</h2><p>There are an estimated many people in the country today.</p>'
            '<p>Advisory Group<br>5th Floor<br>London</p><ul><li><p>Nested item text.</p></li></ul>')
    assert verify.block_texts(html) == ["Executive summary", "There are an estimated many people in the country today.",
                                        "Advisory Group 5th Floor London", "Nested item text."]


def test_pdf_pairing_tolerates_typos_spacing_and_retitling():
    pub = {"details": {"attachments": [
        {"attachment_type": "html", "url": "/h1", "title": "CPIN: opposition, Vietnam, September 2025 (accesible)"},
        {"attachment_type": "html", "url": "/h2", "title": "CPIN: internal relocation, Pakistan, September 2026 (accessible)"},
        {"attachment_type": "html", "url": "/h3", "title": " CPIN: PKK, Turkey,  July 2025 (accessible)"},
        {"attachment_type": "file", "url": "a.pdf", "content_type": "application/pdf", "title": "CPIN: opposition, Vietnam, September 2025"},
        {"attachment_type": "file", "url": "b.pdf", "content_type": "application/pdf", "title": "CPIN: internal relocation,  Pakistan, September 2026"},
        {"attachment_type": "file", "url": "c.pdf", "content_type": "application/pdf", "title": "CPIN: Kurdistan Workers' Party (PKK), Turkey, July 2025"},
    ]}}
    assert verify.pair_pdfs(pub) == {"/h1": "a.pdf", "/h2": "b.pdf", "/h3": "c.pdf"}


def test_links_are_classified():
    kinds = {link["kind"] for link in extract_links(BODY)}
    assert kinds == {"footnote", "external"}


def test_archive_page_body_is_the_innermost_govspeak():
    page = ('<html><body><div class="govuk-wrapper"><h1>Country policy and information note: '
            'actors of protection</h1><div class="gem-c-govspeak govuk-govspeak">'
            '<div class="govspeak"><p>Text of the note.</p></div></div></div></body></html>')
    body, title = extract_body(page)
    assert body.startswith('<div class="govspeak">')
    assert title.startswith("Country policy and information note")


def test_archived_copy_with_same_text_becomes_a_capture_not_a_version(site, client, store):
    govuk(site)
    sync(client, store)
    rendered = BODY.replace('<div class="govspeak">', '<div class="govspeak" data-module="x">')
    capture = {"captured_at": "2026-08-01T00:00:00Z", "archive_url": "https://web.archive.org/x", "digest": "D"}
    _, is_new = store.record_version("kenya", NOTE, body=rendered, meta={}, seen_at="2026-10-02T00:00:00Z",
                                     source="wayback", title="t", base_path=NOTE_PATH, capture=capture)
    assert not is_new
    versions = store.load_note("kenya", NOTE)["versions"]
    assert len(versions) == 1 and versions[0]["captures"] == [capture]


def test_archive_page_body_is_the_innermost_govspeak_with_white_space_between_the_wrappers():
    # As GOV.UK's pages really are: each wrapper on a line of its own, so the outer one holds a little more
    # "text" (the line breaks and indents) than the inner one.
    page = ('<html><body><div class="govuk-wrapper">\n  <h1>Country policy and information note: actors of protection</h1>\n'
            '  <div class="gem-c-govspeak govuk-govspeak" data-module="govspeak">\n    \n'
            '    <div class="govspeak">\n<p>Text of the note.</p>\n</div>\n  \n  </div>\n</div></body></html>')
    body, title = extract_body(page)
    assert body.startswith('<div class="govspeak">') and "gem-c-govspeak" not in body
    assert "<p>Text of the note.</p>" in body and title.startswith("Country policy and information note")
    # A wrapper that holds words of its own beside the inner body is still the one taken: nothing is left out.
    more = page.replace('<div class="govspeak">', '<p>Words outside the inner body.</p><div class="govspeak">')
    assert "Words outside the inner body." in extract_body(more)[0]


def test_integrity_checks_previous_pdf_bytes_too(store):
    from cpin.fingerprint import sha256_bytes
    from cpin.verify import check_integrity
    first, second = b'first edition', b'new edition'
    old, new = sha256_bytes(first), sha256_bytes(second)
    store.write_pdf(old, first)
    store.write_pdf(new, second)
    store.save_pdf_manifest({'https://example.org/reused.pdf': {'sha256': new, 'previous': [{'sha256': old}]}})
    assert check_integrity(store)['pdfs_ok'] == 2
    store.pdf_path(old).write_bytes(b'corrupt')
    assert check_integrity(store)['problems'] == [{'url': 'https://example.org/reused.pdf', 'problem': 'PDF hash mismatch'}]
