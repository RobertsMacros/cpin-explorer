#!/usr/bin/env python3
"""Private mechanical citation triage using held sources; no fetches or findings.

Title/date signals are observations, not proof of document identity or support
for the CPIN claim. Missing matches, changed titles and date conflicts need review.
"""
import argparse
import hashlib
import json
import re
import sys
import unicodedata
from collections import Counter
from functools import lru_cache
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'src'))
from cpin.source_collect import cached_records, inventory_paths
from cpin.store import now_iso, read_json, write_json

METHOD = 'citation-identity-triage-v1'
MONTHS = ('January February March April May June July August September October November December').split()
DATE = re.compile(r'\b(\d{1,2})\s+(' + '|'.join(MONTHS) + r')\s+(\d{4})\b', re.I)


def normalise(text):
    text = unicodedata.normalize('NFKC', text).casefold()
    return ' '.join(re.sub(r'[^\w]+', ' ', text).split())


def expected(citation):
    # Access dates describe retrieval, not the publication date.
    text = re.split(r'\blast accessed\b|\baccessed on\b', citation, flags=re.I)[0].rstrip(' ,.;↩')
    dates = list(DATE.finditer(text))
    date = None
    if len(dates) == 1:
        d, m, y = dates[0].groups()
        month = next(i for i, name in enumerate(MONTHS, 1) if name.casefold() == m.casefold())
        try:
            from datetime import date as calendar_date
            date = calendar_date(int(y), month, int(d)).isoformat()
        except ValueError:
            pass
    quoted = re.findall(r'‘([^’]+)’|“([^”]+)”|"([^\"]+)"', text)
    titles = [next(s for s in match if s) for match in quoted]
    titles = [t for t in titles if len(normalise(t).split()) >= 3 and len(normalise(t)) >= 15]
    title = titles[0] if len(titles) == 1 else None
    if not titles and len(dates) == 1 and ',' in text[:dates[0].start()]:
        # Common unquoted format: publisher, title, publication date.
        title = text[:dates[0].start()].split(',', 1)[1].strip(' ,.;')
        if len(normalise(title).split()) < 3 or len(normalise(title)) < 15:
            title = None
    return {'title': title, 'publicationDate': date,
            'parsing': 'candidate-title' if title else 'ambiguous-or-unparsed'}


def title_signal(title, headers):
    if not title:
        return 'unparsed'
    needle = normalise(title)
    # Truncated titles are not treated as full document-title matches.
    if '…' in title or '...' in title:
        return 'truncated-title-needs-review'
    return 'located-in-front-matter' if any(needle in normalise(h) for h in headers) else 'not-located-needs-review'


def date_signal(date, published_dates):
    if not date:
        return 'unparsed-or-ambiguous'
    if not published_dates:
        return 'publication-metadata-unavailable'
    if len(set(published_dates)) != 1:
        return 'ambiguous-publication-metadata'
    return 'matches-publication-metadata' if date == published_dates[0] else 'metadata-conflict-needs-review'


def audit(out):
    out = Path(out)
    records = cached_records(out)
    quality = read_json(out / 'source-quality.json', {}).get('sources', {})
    counts = Counter()
    title_counts = Counter()
    date_counts = Counter()
    seen = set()
    integrity = []

    @lru_cache(maxsize=None)
    def document(digest):
        if not re.fullmatch(r'[0-9a-f]{64}', digest or ''):
            return {'problem': 'invalid-source-hash'}
        obj = out / 'documents' / digest
        if not obj.exists():
            return {'problem': 'held-source-missing'}
        with obj.open('rb') as stream:
            actual = hashlib.file_digest(stream, 'sha256').hexdigest()
        if actual != digest:
            integrity.append({'sha256': digest, 'problem': 'source-hash-mismatch'})
            return {'problem': 'source-hash-mismatch'}
        text = read_json(out / 'text' / f'{digest}.json', {})
        headers = [text.get('title', '')]
        dates = []
        if text.get('kind') == 'pdf':
            headers += [p.get('text', '') for p in text.get('pages', [])[:3]]
        else:
            headers.append(text.get('text', '')[:2500])
        if text.get('kind') == 'html':
            from lxml import html
            try:
                tree = html.fromstring(obj.read_bytes())
                for meta in tree.xpath('//meta[@content]'):
                    name = (meta.get('property') or meta.get('name') or '').casefold()
                    value = meta.get('content', '')
                    if name in {'og:title', 'twitter:title'}:
                        headers.append(value)
                    if name in {'article:published_time', 'datepublished', 'pubdate', 'dc.date.issued', 'dcterms.issued'}:
                        match = re.match(r'^(\d{4}-\d{2}-\d{2})(?:$|[T ])', value)
                        if match:
                            dates.append(match[1])
            except (ValueError, html.etree.ParserError):
                return {'problem': 'html-metadata-unreadable'}
        return {'headers': headers, 'dates': sorted(set(dates)), 'kind': text.get('kind')}

    target_path = out / 'citation-identity-triage.jsonl'
    with target_path.open('w', encoding='utf-8') as stream:
        for path in inventory_paths(out):
            edition = read_json(path)
            for footnote in edition['footnotes']:
                counts['footnotes'] += 1
                urls = sorted({l['url'] for l in footnote['links'] if l.get('url')})
                exp = expected(footnote['text'])
                row = {'method': METHOD, 'target': {k: edition[k] for k in ('country', 'series', 'editionId', 'textSha')},
                       'editionIndex': str(path.relative_to(out)), 'footnote': footnote['number'],
                       'citation': footnote['text'], 'expected': exp, 'sources': [], 'assessment': None,
                       'contextChecked': False, 'historicalApplicability': 'not verified'}
                if len(urls) != 1:
                    row['state'] = 'no-source-url' if not urls else 'multiple-sources-need-attribution'
                else:
                    url = urls[0]
                    record = records.get(url, {})
                    digest = record.get('sha256')
                    source = {'url': url, 'finalUrl': record.get('final_url'), 'sha256': digest,
                              'retrievedAt': record.get('fetched_at')}
                    row['sources'].append(source)
                    seen.add((footnote['text'], url, digest))
                    if not exp['title']:
                        row['state'] = 'needs-citation-parsing'
                    elif record.get('status') != 'downloaded' or not digest:
                        row['state'] = 'needs-source-evidence'
                    elif not quality.get(url, {}).get('readable_source'):
                        row['state'] = 'source-not-readable'
                    else:
                        doc = document(digest)
                        if doc.get('problem'):
                            row['state'] = doc['problem']
                        else:
                            source['kind'] = doc['kind']
                            source['titleSignal'] = title_signal(exp['title'], doc['headers'])
                            source['dateSignal'] = date_signal(exp['publicationDate'], doc['dates'])
                            source['publicationMetadataDates'] = doc['dates']
                            title_counts[source['titleSignal']] += 1
                            date_counts[source['dateSignal']] += 1
                            row['state'] = 'mechanically-screened-needs-identity-review'
                counts[row['state']] += 1
                stream.write(json.dumps(row, ensure_ascii=False) + '\n')
    result = {'method': METHOD, 'checkedAt': now_iso(), 'counts': dict(counts),
              'titleSignals': dict(title_counts), 'dateSignals': dict(date_counts),
              'distinctSingleSourceCitationCapturePairs': len(seen), 'hashedDocuments': document.cache_info().currsize,
              'integrityIssues': integrity, 'networkRequests': 0, 'modelCalls': 0, 'publishedFindings': 0,
              'basis': 'Candidate title in metadata/front matter and explicit HTML publication metadata only. No publisher, source pinpoint, historical applicability or contextual verification; no automatic errors or passes.'}
    write_json(out / 'citation-identity-triage-summary.json', result)
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    if not args.out.resolve().is_relative_to((ROOT / 'data/source-evidence').resolve()):
        parser.error('Use a private data/source-evidence inventory')
    result = audit(args.out)
    print(json.dumps(result, indent=2))
    sys.exit(bool(result['integrityIssues']))
