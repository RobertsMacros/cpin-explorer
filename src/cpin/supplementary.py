"""Owner-approved material outside the current collection; never current guidance.

Uses the existing polite fetcher and store. The twelve country addresses were listed by the
collection (coverage audit, 3 October 2026). A withdrawn page must confirm its own withdrawal;
a redirect or failed response cannot replace a held page. About text is stored without rewriting.
"""
from dataclasses import asdict
from pathlib import Path
from html import escape

from . import config
from .govuk import api_url, html_attachments
from .pdfs import mirror_pdfs
from .store import now_iso, write_json
from .sync import RunReport, _item, _not_the_publication

WITHDRAWN = ('angola', 'cameroon', 'liberia', 'malawi', 'mali', 'north-korea', 'rwanda')
TAKEN_DOWN = ('botswana', 'mauritius', 'moldova', 'morocco', 'south-africa')
ABOUT_PATH = '/government/publications/about-country-policy-and-information-notes'


def collect(client, store):
    report = RunReport(kind='supplementary', mode='withdrawn-and-about', started=now_iso())
    state = store.load_state()
    fetched = {}
    for slug in WITHDRAWN:
        path = f'/government/publications/{slug}-country-policy-and-information-notes'
        r = client.get(api_url(path))
        item, problem = _item(r) if r.ok else (None, r.error or f'HTTP {r.status}')
        problem = problem or _not_the_publication(item, {'base_path': path})
        withdrawal = (item or {}).get('withdrawn_notice') or {}
        problem = problem or (None if withdrawal.get('withdrawn_at') else 'page does not confirm its withdrawal')
        if problem:
            report.errors.append({'country': slug, 'url': r.url, 'error': problem})
            continue
        store.save_publication(slug, item)
        state['countries'][slug] = {**state['countries'].get(slug, {}),
            'name': item['title'].split(':', 1)[0], 'base_path': path, 'content_id': item.get('content_id'),
            'public_updated_at': item.get('public_updated_at'), 'last_fetched': report.started,
            'withdrawn_at': withdrawal['withdrawn_at'],
            'dropped_from_collection': state['countries'].get(slug, {}).get('dropped_from_collection') or report.started}
        # Any already held web editions remain history, never current.
        for note, index in store.notes_for(slug):
            if index.get('status') == 'live':
                store.mark_removed(slug, note, at=report.started, why='withdrawn country page')
        fetched[slug] = item
        report.countries_checked.append(slug)
    for slug in TAKEN_DOWN:
        state['countries'].setdefault(slug, {'name': slug.replace('-', ' ').title(),
            'base_path': f'/government/publications/{slug}-country-policy-and-information-notes',
            'dropped_from_collection': report.started})
    store.save_state(state)
    report.pdfs = mirror_pdfs(client, store, fetched, seen_at=report.started, errors=report.errors)
    r = client.get(api_url(ABOUT_PATH))
    if r.ok:
        item, problem = _item(r)
        problem = problem or _not_the_publication(item, {'base_path': ABOUT_PATH})
        if not problem:
            write_json(store.root / 'about' / 'publication.json', item)
            for a in html_attachments(item):
                source = client.get(api_url(a['url']))
                text, problem = _item(source) if source.ok else (None, source.error or f'HTTP {source.status}')
                if not problem and isinstance((text or {}).get('details', {}).get('body'), str):
                    write_json(store.root / 'about' / 'text.json', text)
                else:
                    report.errors.append({'url': source.url, 'error': problem or 'no body'})
            mirror_pdfs(client, store, {'about-cpins': item}, seen_at=report.started, errors=report.errors)
        else:
            report.errors.append({'url': r.url, 'error': problem})
    else:
        report.errors.append({'url': r.url, 'error': r.error or f'HTTP {r.status}'})
    report.finished = now_iso()
    store.append_run(asdict(report))
    return report


def archive_hand_list(catalogue, out: Path):
    """A derived list for manual clicks only. Makes no request to the National Archives."""
    sections, count = [], 0
    for slug, country in sorted(catalogue.get('countries', {}).items(), key=lambda pair: pair[1]['name']):
        rows = []
        for e in country['editions']:
            if e['status'] != 'not-archived' or e.get('repeat_of'):
                continue
            urls = sorted({h['path'] if h['path'].startswith('http') else config.GOVUK + h['path'] for h in e.get('html', [])}
                          | {f['url'] for f in e.get('files', [])})
            links = '<br><br>'.join(f'<a href="https://webarchive.nationalarchives.gov.uk/ukgwa/timeline/{escape(url, quote=True)}">Open archived copies at the National Archives ↗</a><br><small>Original GOV.UK address (may be missing or changed):</small><br><a href="{escape(url, quote=True)}">{escape(url)}</a>' for url in urls)
            rows.append(f'<tr><td>{escape(e["title"])}</td><td>{links}</td></tr>')
            count += 1
        if rows:
            sections.append(f'<section><h2>{escape(country["name"])}</h2><table><thead><tr><th>Edition</th><th>Addresses</th></tr></thead><tbody>{"".join(rows)}</tbody></table></section>')
    out.parent.mkdir(parents=True, exist_ok=True)
    checked = catalogue.get('holdings_checked_at') or catalogue.get('generated', 'unknown date')
    out.write_text(f'''<!doctype html><html lang="en-GB"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>CPIN editions to look for at the National Archives</title><style>body{{font:16px system-ui;max-width:1100px;margin:40px auto;padding:0 20px}}td,th{{padding:12px;text-align:left;vertical-align:top;border-bottom:1px solid #ddd}}td{{overflow-wrap:anywhere}}table{{width:100%;table-layout:fixed}}a{{color:#1855dd}}</style><h1>CPIN editions to look for at the National Archives</h1><p>{count} editions still without a held copy. Catalogue holdings checked {escape(checked)}. Any links below are for manual checking at the National Archives; generating this list makes no network request.</p>{''.join(sections)}</html>''', 'utf-8')
    return count
