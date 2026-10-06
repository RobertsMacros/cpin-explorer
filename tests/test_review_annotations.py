"""Public annotations retain exact held-edition identity and concrete locators."""
import json
import re
from pathlib import Path
from lxml import html
from cpin.fingerprint import text_sha256
from cpin.export import build_dashboard
from cpin.store import Store

ROOT = Path(__file__).resolve().parents[1]


def normalise(value):
    return ' '.join(value.split())


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
                else:
                    candidates = [p for p in root.xpath('//p') if re.match(re.escape(anchor['paragraph']) + r'(?:\s|\.)', normalise(p.text_content()))]
                    if anchor['type'] == 'footnote':
                        # References can occur in an unnumbered quotation after
                        # the numbered introduction, while retaining its pinpoint.
                        candidates = [p for p in candidates if any(
                            ref is not None and (p in ref.iterancestors() or p in ref.xpath('preceding::p'))
                            for ref in root.xpath('//a[@href="#fn:' + str(anchor['footnote']) + '"]'))]
                    texts = [normalise(p.text_content()) for p in candidates]
                assert sum(normalise(anchor['quote']) in text for text in texts) == 1, (record['id'], anchor)


def test_directory_uses_corrected_scopes_and_retains_the_new_mirror():
    reviews = {r['id']: r for r in json.loads((ROOT / 'config/review-sources.json').read_text())['reviews']}
    thematic = reviews['arc-uwe-quantitative-risk-2021']
    assert thematic['countries'] == ['ghana', 'iraq', 'bangladesh', 'namibia']
    assert thematic['targets'] == []
    assert any('ecoi.net' in url for url in reviews['arc-sri-lanka-ffm-2020']['relatedUrls'])
    assert reviews['arc-sri-lanka-ffm-2020']['targets'][0]['editionId'] == '1ad495cdba0a2605'
    assert all(t['country'] in {'albania', 'pakistan'} for t in reviews['iagci-albania-pakistan-2024']['targets'])
