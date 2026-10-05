import json
from cpin import config, pdftext
from cpin.export import build_dashboard
from cpin.supplementary import ABOUT_PATH, WITHDRAWN, archive_hand_list, collect
from cpin.govuk import api_url
from cpin.store import write_json


def withdrawn_page(slug, date='2024-08-14T14:18:27Z'):
    path = f'/government/publications/{slug}-country-policy-and-information-notes'
    return {'title': f'{slug.title()}: country policy and information notes', 'base_path': path,
            'schema_name': 'publication', 'withdrawn_notice': {'withdrawn_at': date},
            'details': {'attachments': [{'attachment_type': 'file', 'content_type': 'application/pdf',
                'url': f'https://assets.publishing.service.gov.uk/{slug}.pdf',
                'title': f'[Archived] Country policy and information note: security situation, {slug.title()}, December 2020'}]}}


def test_withdrawn_pages_are_kept_but_no_pdf_is_current(site, client, store, tmp_path):
    for slug in WITHDRAWN:
        item = withdrawn_page(slug)
        site.json(api_url(item['base_path']), item)
        site.raw(f'https://assets.publishing.service.gov.uk/{slug}.pdf', b'%PDF fake')
    about_text_url = config.GOVUK + ABOUT_PATH + '/purpose-methodology-and-use-accessible'
    about_pdf_url = 'https://assets.publishing.service.gov.uk/about.pdf'
    site.json(api_url(ABOUT_PATH), {'schema_name': 'publication', 'base_path': ABOUT_PATH, 'details': {'attachments': [
        {'attachment_type': 'html', 'url': about_text_url},
        {'attachment_type': 'file', 'url': about_pdf_url, 'content_type': 'application/pdf', 'title': 'Purpose, methodology and use'},
    ]}})
    about_text = {'details': {'body': '<p>1.1.1  Purpose &amp; use.\nUnchanged.</p>'}}
    site.json(api_url(about_text_url), about_text)
    site.raw(about_pdf_url, b'%PDF about')
    report = collect(client, store)
    assert not report.errors
    assert len(report.countries_checked) == 7 and report.pdfs['checked'] == 7
    assert json.loads((store.root / 'about' / 'text.json').read_text()) == about_text
    # Every fake PDF has identical bytes: one extracted body can supply each listing.
    sha = store.load_pdf_manifest()['https://assets.publishing.service.gov.uk/angola.pdf']['sha256']
    directory = pdftext.text_dir(store); directory.mkdir(parents=True)
    (directory / f'{sha}.html').write_text('<p>Version control: version 1.0, valid from December 2020.</p>')
    write_json(directory / f'{sha}.json', {'extractor': pdftext.EXTRACTOR, 'pages': 1, 'warnings': []})
    data = build_dashboard(store, {'countries': {}}, series_out=tmp_path / 'series')
    assert data['totals']['countries'] == 0 and data['totals']['former_countries'] == 12
    assert data['totals']['notes'] == 0
    assert data['totals']['pdfs'] == 7, 'the separate About PDF is not a country edition'
    for c in data['countries']:
        for r in c['reports']:
            assert r['status'] == 'removed' and r['withdrawn_at']
            s = json.loads((tmp_path / 'series' / c['slug'] / 'note--security-situation.json').read_text())
            assert s['withdrawn_at'] == c['withdrawn_at'] and not any(v['current'] for v in s['versions'])


def test_a_redirect_or_unconfirmed_withdrawal_cannot_replace_a_held_page(site, client, store):
    held = withdrawn_page('angola'); store.save_publication('angola', held)
    not_withdrawn = {**held, 'withdrawn_notice': {}}
    site.json(api_url(held['base_path']), not_withdrawn)
    report = collect(client, store)
    assert report.errors and store.load_publication('angola') == held
    assert 'angola' not in store.load_state()['countries']


def test_hand_list_contains_each_missing_edition_once_and_escapes_source_text(tmp_path):
    e = {'title': 'A <title>', 'status': 'not-archived', 'html': [{'path': '/old?x=1&y=2'}], 'files': []}
    catalogue = {'generated': '2026-10-04', 'countries': {'c': {'name': 'Country', 'editions': [e, {**e, 'repeat_of': {'title': e['title']}}, {**e, 'status': 'held'}]}}}
    out = tmp_path / 'list.html'
    assert archive_hand_list(catalogue, out) == 1
    page = out.read_text()
    assert 'A &lt;title&gt;' in page and 'ukgwa/timeline/https://www.gov.uk/old?x=1&amp;y=2' in page
