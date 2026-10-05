#!/usr/bin/env python3
"""Measure original-address retrieval separately from checked report copies.

No requests or claim judgements. Only exact edition/text/footnote/source targets
with a hash-checked held PDF can improve the second measure.
"""
import argparse
import json
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT/'src'))
from cpin.source_collect import cached_records, checked_source_copies, inventory_paths
from cpin.store import read_json, write_json, now_iso


def coverage(out, registry, caches):
    out = Path(out)
    keys = ('country','series','editionId','textSha','footnote','sourceUrl')
    copies = {}
    valid, issues = checked_source_copies(registry, caches)
    for copy in valid:
        for target in copy['targets']:
            copies[tuple(target[k] for k in keys)] = copy
    records = cached_records(out)
    quality = read_json(out/'source-quality.json', {}).get('sources', {})
    counts = Counter()
    for path in inventory_paths(out):
        edition = read_json(path)
        for f in edition['footnotes']:
            urls = {l['url'] for l in f['links'] if l['url']}
            def readable(u):
                return records.get(u,{}).get('status')=='downloaded' and quality.get(u,{}).get('readable_source',False)
            original = bool(urls) and all(readable(u) for u in urls)
            with_copy = bool(urls) and all(readable(u) or tuple([edition[k] for k in keys[:4]]+[int(f['number']),u]) in copies for u in urls)
            counts['footnotes'] += 1
            counts['all_original_sources_readable'] += original
            counts['all_sources_readable_including_checked_copies'] += with_copy
            counts['recovered_by_checked_copy'] += with_copy and not original
    return {'checkedAt':now_iso(),'basis':'Retrieval/extraction and checked document identity only; no claim correctness judgement',
            'counts':dict(counts),'issues':issues}


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out',type=Path,required=True)
    parser.add_argument('--copies',type=Path,default=ROOT/'prototypes/reviews/source-copies.json')
    parser.add_argument('--cache',type=Path,action='append',required=True)
    args=parser.parse_args()
    if not args.out.resolve().is_relative_to((ROOT/'data/source-evidence').resolve()):
        parser.error('Use a private data/source-evidence inventory')
    result=coverage(args.out,read_json(args.copies),args.cache)
    write_json(args.out/'source-copy-coverage.json',result)
    print(json.dumps(result,indent=2))
    sys.exit(bool(result['issues']))
