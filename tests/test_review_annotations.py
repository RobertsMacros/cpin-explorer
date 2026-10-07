"""Public annotations retain exact held-edition identity and concrete locators."""
import json
import re
import hashlib
from pathlib import Path
from lxml import html
from cpin.fingerprint import text_sha256
from cpin.export import build_dashboard
from cpin.store import Store

ROOT = Path(__file__).resolve().parents[1]


def test_published_reviews_are_preserved_and_ai_followups_are_separate():
    records = json.loads((ROOT / 'prototypes/reviews/annotations.json').read_text())['records']
    by_id = {r['id']: r for r in records}
    baseline = json.loads((ROOT / 'config/published-review-preservation.json').read_text())['records']
    assert set(baseline) == {r['id'] for r in records if r['kind'] == 'external'}, \
        'Every published reviewer entry must have a preservation hash'
    for record_id, digest in baseline.items():
        record = by_id[record_id]
        assert record['kind'] == 'external'
        actual = hashlib.sha256(json.dumps(record, sort_keys=True, separators=(',', ':'),
                                          ensure_ascii=False).encode()).hexdigest()
        assert actual == digest, f'Published reviewer entry changed: {record_id}'
    for record in records:
        for record_id in record.get('reviewOf', []):
            assert record['kind'] == 'ai'
            original = by_id[record_id]
            assert original['kind'] == 'external'
            for target in record['targets']:
                assert any(all(target[k] == t[k] for k in ('country', 'series', 'editionId', 'textSha'))
                           for t in original['targets'])


def normalise(value):
    return ' '.join(value.split())


def footnote_contexts(root, anchor):
    """Include unnumbered quoted paragraphs after the numbered introduction."""
    ps = root.xpath('//p')
    contexts = []
    for ref in root.xpath('//a[@href="#fn:' + str(anchor['footnote']) + '"]'):
        parents = ref.xpath('ancestor::p[1]')
        if not parents:
            continue
        end = ps.index(parents[0])
        starts = [i for i, p in enumerate(ps[:end + 1]) if re.match(
            re.escape(anchor['paragraph']) + r'(?:\s|\.)', normalise(p.text_content()))]
        if starts:
            run = ps[starts[-1]:end + 1]
            if any(re.match(r'^\d+(?:\.\d+){2,}(?:\s|\.)', normalise(p.text_content()))
                   for p in run[1:]):
                continue
            contexts.append(normalise(' '.join(p.text_content() for p in run)))
    return contexts


def test_footnote_context_includes_only_its_numbered_quote_run():
    root = html.fromstring('''<div><p>4.7.1 Earlier introduction</p>
      <p>Repeated wording</p><p>4.7.2 Current introduction</p>
      <p>Repeated wording <a rel="footnote" href="#fn:67">67</a></p>
      <p>4.7.3 Later wording</p></div>''')
    anchor = {'paragraph': '4.7.2', 'footnote': 67}
    assert footnote_contexts(root, anchor) == ['4.7.2 Current introduction Repeated wording 67']
    assert footnote_contexts(root, {**anchor, 'paragraph': '4.7.1'}) == []
    assert footnote_contexts(root, {**anchor, 'paragraph': '4.7.3'}) == []


def test_public_annotations_match_the_held_body_and_unique_original_passage(tmp_path):
    records = json.loads((ROOT / 'prototypes/reviews/annotations.json').read_text())['records']
    # A fresh checkout has no ignored prototypes/data export. Build this test's
    # own derived view from retained Git data, without network or source changes.
    series_root = tmp_path / 'series'
    build_dashboard(Store(ROOT / 'data'), json.loads((ROOT / 'config/countries.json').read_text()),
                    series_out=series_root)
    series_cache = {}
    for record in records:
        for target in record['targets']:
            key = (target['country'], target['series'])
            if key not in series_cache:
                path = series_root / key[0] / (key[1].replace(':', '--') + '.json')
                series_cache[key] = json.loads(path.read_text())
            versions = [v for v in series_cache[key]['versions'] if v['id'] == target['editionId']]
            assert len(versions) == 1, record['id']
            version = versions[0]
            assert version['text_sha256'] == target['textSha'], record['id']
            assert text_sha256(version['body']) == target['textSha'], record['id']
            root = html.fromstring(version['body'])
            for anchor in target.get('anchors', []):
                if anchor['type'] == 'link':
                    candidates = root.xpath('//a[@href]')
                    candidates = [a for a in candidates if a.get('href').split('#')[0] == anchor['sourceUrl'].split('#')[0]]
                    if anchor.get('footnote'):
                        candidates = [a for a in candidates if a.xpath('ancestor::*[@id="fn:' + str(anchor['footnote']) + '"]')]
                    texts = [normalise(a.xpath('ancestor::p[1]')[0].text_content()) for a in candidates]
                elif anchor['type'] == 'sentence':
                    texts = [normalise(p.text_content()) for p in root.xpath('//p')]
                elif anchor['type'] == 'footnote':
                    texts = footnote_contexts(root, anchor)
                else:
                    candidates = [p for p in root.xpath('//p') if re.match(re.escape(anchor['paragraph']) + r'(?:\s|\.)', normalise(p.text_content()))]
                    texts = [normalise(p.text_content()) for p in candidates]
                assert sum(normalise(anchor['quote']) in text for text in texts) == 1, (record['id'], anchor)


def test_directory_uses_corrected_scopes_and_retains_the_new_mirror():
    reviews = {r['id']: r for r in json.loads((ROOT / 'config/review-sources.json').read_text())['reviews']}
    thematic = reviews['arc-uwe-quantitative-risk-2021']
    assert set(thematic['countries']) == {'ghana', 'iraq', 'bangladesh', 'namibia', 'eritrea', 'china', 'pakistan'}
    assert len(thematic['targets']) == 9  # Eight reports, including Namibia PDF and web bodies.
    assert thematic['verifiedSnapshotSha'] == '7b9b1bd16a91a76255a6ab76be7762878d76747060ae465cb62b24d61f56009d'
    assert all(t['mapping'] == 'edition-declaration-checked' for t in thematic['targets'])
    assert any('ecoi.net' in url for url in reviews['arc-sri-lanka-ffm-2020']['relatedUrls'])
    assert reviews['arc-sri-lanka-ffm-2020']['targets'][0]['editionId'] == '1ad495cdba0a2605'
    assert all(t['country'] in {'albania', 'pakistan'} for t in reviews['iagci-albania-pakistan-2024']['targets'])
