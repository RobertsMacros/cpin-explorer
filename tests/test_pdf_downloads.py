from hashlib import sha256

import pymupdf
import pytest

from cpin.pdf_downloads import download_links, read_links


def pdf():
    with pymupdf.open() as document:
        document.new_page().insert_text((72, 72), 'Synthetic CPIN download fixture')
        return document.tobytes()


def test_list_is_deduplicated_and_timeline_pages_are_rejected(tmp_path):
    links = tmp_path / 'links.txt'
    links.write_text('# Exact captures only\nhttps://example.org/a.pdf\nhttps://example.org/a.pdf\n')
    assert read_links(links) == ['https://example.org/a.pdf']
    links.write_text('https://webarchive.nationalarchives.gov.uk/ukgwa/timeline/https://example.org/a.pdf')
    with pytest.raises(ValueError, match='choose a dated PDF capture'):
        read_links(links)


def test_original_bytes_saved_and_repeat_keeps_existing_file(site, client, tmp_path):
    content = pdf()
    site.raw('https://example.org/a.pdf', content)
    first = download_links(['https://example.org/a.pdf'], tmp_path, client)[0]
    assert first['status'] == 'saved'
    assert (tmp_path / first['file']).read_bytes() == content
    assert first['sha256'] == sha256(content).hexdigest()
    assert download_links(['https://example.org/a.pdf'], tmp_path, client)[0]['status'] == 'already saved'


def test_html_error_page_and_truncated_pdf_are_not_saved(site, client, tmp_path):
    site.raw('https://example.org/error.pdf', b'<html>Access denied</html>')
    site.raw('https://example.org/short.pdf', pdf().split(b'%%EOF')[0])
    site.raw('https://example.org/invalid.pdf', b'%PDF-1.4 fake\n%%EOF')
    rows = download_links(['https://example.org/error.pdf', 'https://example.org/short.pdf',
                           'https://example.org/invalid.pdf'], tmp_path, client)
    assert all(r['status'] == 'failed' for r in rows)
    assert not list(tmp_path.glob('*.pdf'))


def test_national_archive_capture_never_reaches_transport(site, client, tmp_path):
    url = 'https://webarchive.nationalarchives.gov.uk/ukgwa/20200101000000/https://example.org/a.pdf'
    row = download_links([url], tmp_path, client)[0]
    assert row['status'] == 'failed' and 'manual checking only' in row['error']
    assert site.requests == []


def test_existing_corrupt_file_is_not_overwritten(site, client, tmp_path):
    content = pdf()
    site.raw('https://example.org/a.pdf', content)
    path = tmp_path / f'{sha256(content).hexdigest()}.pdf'
    path.write_bytes(b'Existing file: preserve for investigation')
    assert download_links(['https://example.org/a.pdf'], tmp_path, client)[0]['status'] == 'failed'
    assert path.read_bytes() == b'Existing file: preserve for investigation'
