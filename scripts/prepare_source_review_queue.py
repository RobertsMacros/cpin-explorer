#!/usr/bin/env python3
"""Prepare private, resumable review work from the held citation inventory.

No model service, paid call or finding. Source text stays in its private cache.
Every claim retains edition and source identities; context/review pointers are
inputs to analysis, never evidence that a claim has already been checked.
"""
import argparse
import hashlib
import json
import sys
from collections import Counter
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'src'))
from cpin.source_collect import cached_records, checked_source_copies, inventory_paths
from cpin.store import read_json, write_json, now_iso


def prepare(out, directory, copies, caches=()):
    out=Path(out);records=cached_records(out)
    valid_copies, copy_issues=checked_source_copies(copies,[out,*caches])
    quality=read_json(out/'source-quality.json',{}).get('sources',{})
    counts=Counter();groups=set()
    fields=('country','series','editionId','textSha')
    with (out/'analysis-queue.jsonl').open('w',encoding='utf-8') as stream:
        for path in inventory_paths(out):
            edition=read_json(path);base={k:edition[k] for k in fields}
            exact=[r['id'] for r in directory.get('reviews',[]) if r.get('kind')=='direct-review' and r.get('reviewedProduct')=='uk-cpin'
                   and any(t.get('mapping')=='edition-declaration-checked' and t.get('scope')=='whole-report'
                           and all(t.get(k)==base[k] for k in fields) for t in r.get('targets',[]))]
            background=[r['id'] for r in directory.get('reviews',[]) if edition['country'] in r.get('countries',[]) and r['id'] not in exact]
            for claim in edition['claims']:
                footnotes=[f for f in edition['footnotes'] if f['id'] in claim['footnotes']]
                urls={l['url'] for f in footnotes for l in f['links'] if l['url']}|{l['url'] for l in claim['links'] if l['url']}
                sources=[]
                for url in sorted(urls):
                    record=records.get(url,{})
                    alternatives=[{'url':c['url'],'sha256':c['sha256'],'publishedMonth':c['publishedMonth']}
                                  for c in valid_copies if any(all(t.get(k)==base[k] for k in fields)
                                  and t['sourceUrl']==url and any(int(f['number'])==t['footnote'] for f in footnotes) for t in c['targets'])]
                    sources.append({'url':url,'status':record.get('status','pending'),'sha256':record.get('sha256'),
                                    'readable':quality.get(url,{}).get('readable_source',False),'retrievedAt':record.get('fetched_at'),
                                    'finalUrl':record.get('final_url'),'matchingReportCopies':alternatives,'historicalApplicability':'not verified'})
                ambiguous=any(f['id'] in edition['diagnostics']['duplicate_footnotes'] for f in footnotes)
                state='needs-citation-anchor' if ambiguous or not claim['paragraph'] or not claim['section'] else 'awaiting-review' if sources and all(s['readable'] or s['matchingReportCopies'] for s in sources) else 'needs-source-evidence'
                # Hash includes the full CPIN text identity, location, footnotes and
                # source captures. Identical wording in changed reports is not an
                # automatically reusable review.
                identity=[base['textSha'],claim,footnotes,sources]
                key=hashlib.sha256(json.dumps(identity,sort_keys=True).encode()).hexdigest()
                groups.add(key);counts['claims']+=1;counts[state]+=1
                row={'target':base,'editionIndex':str(path.relative_to(out)),'claimId':claim['id'],
                     'paragraph':claim['paragraph'],'section':claim['section'],'claim':claim['text'],
                     'footnotes':footnotes,'sources':sources,'exactEditionReviews':exact,'countryBackgroundReviews':background,
                     'dedupKey':key,'status':state,'modelInputApproved':False,'assessment':None}
                stream.write(json.dumps(row,ensure_ascii=False)+'\n')
    counts['distinct_identity_groups']=len(groups)
    inventory=read_json(out/'inventory.json')
    result={'preparedAt':now_iso(),'scope':inventory.get('since'),'counts':dict(counts),
            'unreferencedFootnotes':inventory['counts'].get('unreferenced_footnotes',0),
            'networkRequests':0,'paidModelCalls':0,'completedChecksAdded':0,
            'copyIntegrityIssues':copy_issues,
            'rules':'Read surrounding CPIN context and source pages, verify raw evidence and dates, consider published reviews and responses as fallible evidence. Retrieval is not checking. Missing or ambiguous evidence stays unable to check. No automatic flags or cross-edition carry-forward. Private source text has no blanket model-use or publication approval.'}
    write_json(out/'analysis-manifest.json',result)
    return result


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out',type=Path,required=True)
    parser.add_argument('--cache',type=Path,action='append',default=[])
    args=parser.parse_args()
    if not args.out.resolve().is_relative_to((ROOT/'data/source-evidence').resolve()):
        parser.error('Use a private data/source-evidence inventory')
    result=prepare(args.out,read_json(ROOT/'prototypes/reviews/directory.json'),read_json(ROOT/'prototypes/reviews/source-copies.json'),args.cache)
    print(json.dumps(result,indent=2))
    sys.exit(bool(result['copyIntegrityIssues']))
