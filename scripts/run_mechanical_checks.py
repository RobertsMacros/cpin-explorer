#!/usr/bin/env python3
"""Resumable, private deterministic screen of all linked CPIN text blocks.

No network, archive recovery, model calls or publication. SQLite checkpoints
retain occurrences independently of shared computations and permit restarts.
"""
import argparse
import csv
import fcntl
import hashlib
import json
import os
import signal
import shutil
import sqlite3
import sys
import time
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'src'))
from cpin import mechanical as mc
from cpin.source_collect import cached_records, inventory_paths
from cpin.store import now_iso, read_json, write_json


def links(obj):
    return [l for l in obj.get('links', []) if (l.get('url') or '').startswith(('http://', 'https://'))]


def connect(path):
    con = sqlite3.connect(path, timeout=30)
    con.execute('PRAGMA journal_mode=WAL')
    con.execute('PRAGMA synchronous=FULL')
    con.executescript('''
        CREATE TABLE IF NOT EXISTS occurrences (
          id TEXT PRIMARY KEY, scope TEXT NOT NULL, input_sha TEXT NOT NULL,
          group_key TEXT NOT NULL, payload TEXT NOT NULL, result TEXT);
        CREATE INDEX IF NOT EXISTS scope_pending ON occurrences(scope) WHERE result IS NULL;
        CREATE INDEX IF NOT EXISTS scope_all ON occurrences(scope);
        CREATE TABLE IF NOT EXISTS computations (key TEXT PRIMARY KEY, result TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS history (input_sha TEXT PRIMARY KEY, result TEXT NOT NULL);
    ''')
    return con


def prepare(con, inventory, output, caches, country=None, limit=None):
    code_sha = mc.digest_json([hashlib.sha256(Path(mc.__file__).read_bytes()).hexdigest(),
                              hashlib.sha256(Path(__file__).read_bytes()).hexdigest(), sys.version,
                              mc.stat_key(shutil.which('pdftotext') or '/not-installed')])
    scope = mc.digest_json([code_sha, read_json(inventory / 'inventory.json'), country, limit])
    snapshot_file = output / f'sources-{scope}.json'
    if snapshot_file.exists():
        captured = read_json(snapshot_file)
    else:
        captured = {}
        for cache in [inventory, *caches]:
            for url, record in cached_records(cache).items():
                previous = captured.get(url)
                if previous is None or (previous['record'].get('status') != 'downloaded' and record.get('status') == 'downloaded'):
                    captured[url] = {'cache': str(cache.resolve()), 'record': record}
        write_json(snapshot_file, captured)
    signatures = {}
    for url, value in captured.items():
        value = dict(value)
        digest = value['record'].get('sha256')
        cache = Path(value['cache'])
        valid = bool(digest and __import__('re').fullmatch(r'[a-f0-9]{64}', digest))
        value['rawStat'] = mc.stat_key(cache / 'documents' / digest) if valid else None
        value['textStat'] = mc.stat_key(cache / 'text' / f'{digest}.json') if valid else None
        signatures[url] = value
    total = 0
    for path in inventory_paths(inventory):
        edition = read_json(path)
        if country and edition['country'] != country:
            continue
        fs = defaultdict(list)
        for f in edition['footnotes']:
            fs[f['id']].append(f)
        bibliography = defaultdict(list)
        per_url_dates = defaultdict(set)
        for c in edition['claims']:
            if c['section'] in mc.BIB_SECTIONS:
                for link in links(c):
                    bibliography[link['url']].append(c['text'])
        for f in edition['footnotes']:
            for link in links(f):
                per_url_dates[link['url']].update(mc.citation(f['text'])['publicationDates'])
        conflicts = {url: sorted(ds) for url, ds in per_url_dates.items() if len(ds) > 1}
        claims = edition['claims']
        for i, c in enumerate(claims):
            footnotes = [f for ref in dict.fromkeys(c['footnotes']) for f in fs.get(ref, [])]
            all_links = links(c) + [link for f in footnotes for link in links(f)]
            urls = sorted({l['url'] for l in all_links})
            if not urls:
                continue
            if limit is not None and total >= limit:
                con.commit()
                return scope, total
            sources = [{'url': url, **signatures.get(url, {'cache': str(inventory.resolve()), 'record': {}, 'rawStat': None, 'textStat': None})} for url in urls]
            payload = {'target': {k: edition[k] for k in ('country', 'series', 'editionId', 'textSha')},
                       'editionIndex': str(path.relative_to(inventory)), 'claim': c,
                       'context': {'previous': claims[i-1]['text'] if i else '',
                                   'following': claims[i+1]['text'] if i+1 < len(claims) else ''},
                       'footnotes': footnotes, 'sources': sources, 'links': all_links,
                       'referenceCounts': {ref: len(fs.get(ref, [])) for ref in c['footnotes']},
                       'published': edition.get('published'), 'provenance': edition.get('source'),
                       'bibliography': {u: bibliography[u] for u in urls},
                       'bibliographyEntry': c['section'] in mc.BIB_SECTIONS,
                       'citationDateConflicts': {u: conflicts[u] for u in urls if u in conflicts},
                       'tableLike': '\t' in c['text'] or c['text'].count('|') >= 2}
            # Occurrences retain their full edition identity. Only comparisons with
            # the same source pinpoint and relevant context share computation.
            shared = {k: payload[k] for k in ('sources', 'bibliography', 'bibliographyEntry', 'tableLike')}
            shared.update({'code': code_sha, 'claim': mc.claim_text(c),
                           'country': edition['country'], 'section': __import__('re').sub(r'^\d+(?:\.\d+)*\.?\s+', '', c['section']),
                           'context': {'previous': mc.claim_text(claims[i-1]) if i else '',
                                       'following': mc.claim_text(claims[i+1]) if i+1 < len(claims) else ''},
                           'citations': sorted([(f['text'], sorted(l['url'] for l in links(f))) for f in footnotes])})
            shared['originalLinks'] = sorted((l['url'], l.get('href', ''), l.get('boundary_uncertain', False)) for l in all_links)
            # Marker mappings and edition dates are evaluated per occurrence;
            # they do not prevent reusing equivalent source comparisons.
            group_key = mc.digest_json(shared)
            input_sha = mc.digest_json([code_sha, payload])
            occurrence = mc.digest_json([scope, payload['target'], c['id']])
            con.execute('''INSERT INTO occurrences VALUES (?,?,?,?,?,NULL)
                ON CONFLICT(id) DO UPDATE SET scope=excluded.scope,input_sha=excluded.input_sha,
                group_key=excluded.group_key,payload=excluded.payload,
                result=CASE WHEN occurrences.input_sha=excluded.input_sha THEN occurrences.result ELSE NULL END''',
                (occurrence, scope, input_sha, group_key, json.dumps(payload, ensure_ascii=False)))
            total += 1
        con.commit()
    return scope, total


def status(con, scope):
    total = con.execute('SELECT COUNT(*) FROM occurrences WHERE scope=?', (scope,)).fetchone()[0]
    remaining = con.execute('SELECT COUNT(*) FROM occurrences WHERE scope=? AND result IS NULL', (scope,)).fetchone()[0]
    return {'total': total, 'screened': total - remaining, 'remaining': remaining}


def export(con, scope, output):
    checks = Counter()
    states = Counter()
    rows = Counter()
    candidates = Counter()
    samples = []
    with (output / 'candidates.csv').open('w', encoding='utf-8', newline='') as stream:
        writer = csv.writer(stream)
        writer.writerow(['Country', 'Report', 'Edition', 'CPIN text hash', 'Claim', 'Paragraph', 'Section', 'Rule', 'Source URL', 'Source hash', 'Reason'])
        for encoded, result in con.execute('SELECT payload,result FROM occurrences WHERE scope=? AND result IS NOT NULL', (scope,)):
            payload = json.loads(encoded)
            result = json.loads(result)
            rows[result['state']] += 1
            target = payload['target']
            for check in result['checks']:
                rule, state = check['rule'], check['state']
                checks[rule] += 1
                states[f'{rule}:{state}'] += 1
                if state != 'candidate':
                    continue
                candidates[rule] += 1
                values = [target['country'], target['series'], target['editionId'], target['textSha'], payload['claim']['id'],
                          payload['claim']['paragraph'], payload['claim']['section'], rule, check.get('url', ''), check.get('sha256', ''), check.get('reason', '')]
                writer.writerow(["'"+v if isinstance(v, str) and v[:1] in '=+-@\t\r' else v for v in values])
                if len(samples) < 120:
                    samples.append({'target': target, 'claim': payload['claim'], 'check': check})
    totals = status(con, scope)
    summary = {'method': mc.METHOD, 'checkedAt': now_iso(), 'scope': scope, **totals,
               'rowStates': dict(rows), 'checkCounts': dict(checks), 'checkStates': dict(states), 'candidateCounts': dict(candidates),
               'distinctComputations': con.execute('SELECT COUNT(DISTINCT group_key) FROM occurrences WHERE scope=?', (scope,)).fetchone()[0],
               'networkRequests': 0, 'modelCalls': 0, 'publishedFlags': 0, 'contextualAssessments': 0,
               'basis': 'Specific mechanical observations and candidates only, including explicit missing evidence. No overall correctness or coverage of all published editions.'}
    write_json(output / 'summary.json', summary)
    write_json(output / 'candidate-sample.json', samples)
    text = ['# Mechanical source screening', '', f"Screened {totals['screened']:,} of {totals['total']:,} linked text blocks; {totals['remaining']:,} remain.",
            '', 'All results are private. Candidate discrepancies require inspection; a pass applies only to its stated comparison.',
            '', '| Candidate check | Occurrences |', '| --- | ---: |']
    text += [f'| {rule} | {n:,} |' for rule, n in candidates.most_common()]
    text += ['', 'Missing evidence and unsupported inputs remain explicit in summary.json and results.sqlite3.',
             'No archive lookup, new download, model call, contextual assessment or public flag was made.', '']
    (output / 'REPORT.md').write_text('\n'.join(text))
    return summary


def run(inventory, output, caches=(), country=None, limit=None, max_hours=10, max_gb=4):
    inventory, output = Path(inventory), Path(output)
    output.mkdir(parents=True, exist_ok=True)
    lock = (output / 'run.lock').open('a')
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    con = connect(output / 'results.sqlite3')
    start = time.monotonic()
    meta = {'method': mc.METHOD, 'pid': os.getpid(), 'startedAt': now_iso(), 'state': 'preparing',
            'inventory': str(inventory.resolve()), 'output': str(output.resolve()), 'networkRequests': 0, 'modelCalls': 0}
    write_json(output / 'job.json', meta)
    print('Preparing frozen source receipts and resumable occurrence queue.', flush=True)
    try:
        scope, total = prepare(con, inventory, output, [Path(c) for c in caches], country, limit)
        meta.update({'scope': scope, 'total': total, 'state': 'running'})
        reader = mc.SourceReader(output)
        last_progress = 0
        reused = 0
        while True:
            batch = con.execute('SELECT id,input_sha,group_key,payload FROM occurrences WHERE scope=? AND result IS NULL LIMIT 50', (scope,)).fetchall()
            if not batch:
                break
            if time.monotonic() - start > max_hours * 3600:
                meta['state'] = 'time-budget-stopped'
                break
            size = sum(p.stat().st_size for p in output.glob('results.sqlite3*')) + sum(p.stat().st_size for p in (output / 'readings').glob('*'))
            if shutil.disk_usage(output).free < 2 * 1024**3 or size > max_gb * 1024**3:
                meta['state'] = 'disk-budget-stopped'
                break
            for occurrence, input_sha, key, encoded in batch:
                payload = json.loads(encoded)
                try:
                    old = con.execute('SELECT result FROM computations WHERE key=?', (key,)).fetchone()
                    if old:
                        result = json.loads(old[0])
                        reused += 1
                    else:
                        result = mc.screen(payload, reader)
                        con.execute('INSERT OR IGNORE INTO computations VALUES (?,?)', (key, json.dumps(result, ensure_ascii=False)))
                    result = {**result, 'checks': [*result['checks'], *mc.occurrence_checks(payload)], 'method': mc.METHOD, 'inputSha256': input_sha}
                    if any(c['state'] == 'candidate' for c in result['checks']):
                        result['state'] = 'candidates-for-inspection'
                except Exception as error:
                    result = {'method': mc.METHOD, 'state': 'processing-error', 'assessment': None, 'publicFlag': None,
                              'checks': [{'rule': 'pipeline-error', 'state': 'unable', 'reason': type(error).__name__ + ': ' + str(error)[:300]}]}
                result_json = json.dumps(result, ensure_ascii=False)
                con.execute('UPDATE occurrences SET result=? WHERE id=?', (result_json, occurrence))
                con.execute('INSERT OR IGNORE INTO history VALUES (?,?)', (input_sha, result_json))
                if time.monotonic() - last_progress > 20:
                    con.commit()
                    current = status(con, scope)
                    meta.update(current)
                    meta.update({'updatedAt': now_iso(), 'reusedComputationsThisProcess': reused})
                    write_json(output / 'job.json', meta)
                    print(json.dumps(current), flush=True)
                    last_progress = time.monotonic()
            con.commit()
        meta.update(status(con, scope))
        meta['state'] = 'complete' if meta['remaining'] == 0 else meta['state']
        meta.update({'updatedAt': now_iso(), 'reusedComputationsThisProcess': reused})
        summary = export(con, scope, output)
        if summary['rowStates'].get('processing-error'):
            meta['state'] = 'completed-with-processing-errors' if meta['remaining'] == 0 else meta['state']
        write_json(output / 'job.json', meta)
        print(json.dumps(meta, indent=2), flush=True)
        return summary
    except BaseException as error:
        con.commit()
        write_json(output / 'job.json', {**meta, 'state': 'interrupted' if isinstance(error, KeyboardInterrupt) else 'failed', 'error': type(error).__name__, 'updatedAt': now_iso()})
        raise
    finally:
        con.close()
        lock.close()


if __name__ == '__main__':
    def interrupted(signum, frame):
        raise KeyboardInterrupt
    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGINT, interrupted)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--inventory', type=Path, default=ROOT / 'data/source-evidence/since-2020')
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--cache', type=Path, action='append', default=[])
    parser.add_argument('--country')
    parser.add_argument('--limit', type=int)
    parser.add_argument('--max-hours', type=float, default=10)
    parser.add_argument('--max-gb', type=float, default=4)
    args = parser.parse_args()
    base = (ROOT / 'data/source-evidence').resolve()
    if not args.out.resolve().is_relative_to(base) or not args.inventory.resolve().is_relative_to(base):
        parser.error('Use private data/source-evidence paths')
    if args.out.resolve() == args.inventory.resolve():
        parser.error('Keep result directory separate from source inventory')
    if (args.limit is not None and args.limit < 1) or args.max_hours <= 0 or not 1 <= args.max_gb <= 8:
        parser.error('Use positive limits and a 1–8 GiB result budget')
    result = run(args.inventory, args.out, args.cache, args.country, args.limit, args.max_hours, args.max_gb)
    sys.exit(bool(result['remaining'] or result['rowStates'].get('processing-error')))
