import hashlib
import importlib.util
import json
from pathlib import Path

from cpin.source_collect import append_json, build_inventory, cached_records
from cpin.store import atomic_write, write_json

spec = importlib.util.spec_from_file_location('reuse_source_evidence', Path(__file__).parents[1]/'scripts/reuse_source_evidence.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def load_script(name):
    spec=importlib.util.spec_from_file_location(name,Path(__file__).parents[1]/'scripts'/f'{name}.py')
    loaded=importlib.util.module_from_spec(spec);spec.loader.exec_module(loaded)
    return loaded


def test_reuse_keeps_success_after_refusal_but_does_not_substitute_similar_addresses(tmp_path):
    cache, out = tmp_path/'cache', tmp_path/'out'
    data = b'A readable source with enough evidence words.'
    digest = hashlib.sha256(data).hexdigest()
    atomic_write(cache/'documents'/digest, data)
    write_json(cache/'text'/f'{digest}.json', {'kind':'text','status':'extracted','text':data.decode()})
    url = 'https://example.org/report.pdf'
    append_json(cache/'attempts.jsonl', {'url':url,'status':'downloaded','sha256':digest,'fetched_at':'2026-01-01','extraction':'extracted'})
    append_json(cache/'attempts.jsonl', {'url':url,'status':'blocked','fetched_at':'2026-02-01'})
    root = tmp_path/'series'/'test';root.mkdir(parents=True)
    body = f'<p>1.1.1 Claim<sup><a href="#fn:1">1</a></sup></p><ol><li id="fn:1"><a href="{url}">Source</a><a href="{url}?edition=2">Other version</a></li></ol>'
    write_json(root/'test.json', {'country':'test','key':'note:test','versions':[{'id':'a'*16,'text_sha256':'b'*64,'body':body,'current':True}]})
    build_inventory(tmp_path/'series',out)
    result = module.reuse(out,[cache])
    assert cached_records(out)[url]['status']=='downloaded'
    assert url+'?edition=2' not in cached_records(out)
    assert (out/'documents'/digest).stat().st_ino == (cache/'documents'/digest).stat().st_ino
    assert result['audit']['counts']['pending']==1
    assert result['network_requests']==result['ai_checks']==0
    assert not result['audit']['issues']
    # A corrupt cached object is retained as an explicit integrity failure, never
    # silently promoted to a successful verified source.
    (out/'documents'/digest).write_bytes(b'corrupt')
    assert module.reuse(out,[cache])['audit']['issues']


def test_checked_copies_and_queue_remain_scoped_evidence_without_findings(tmp_path):
    out=tmp_path/'out';root=tmp_path/'series'/'test';root.mkdir(parents=True)
    url='https://example.org/source'
    body=f'<h2>1. Evidence</h2><p>1.1.1 Scoped claim<sup><a href="#fn:1">1</a></sup></p><ol><li id="fn:1"><a href="{url}">Source, March 2025</a></li></ol>'
    write_json(root/'test.json',{'country':'test','key':'note:test','versions':[{'id':'a'*16,'text_sha256':'b'*64,'body':body,'current':True}]})
    build_inventory(tmp_path/'series',out)
    data=b'held matching PDF';digest=hashlib.sha256(data).hexdigest()
    atomic_write(out/'documents'/digest,data)
    target={'country':'test','series':'note:test','editionId':'a'*16,'textSha':'b'*64,'footnote':1,'sourceUrl':url}
    registry={'copies':[{'sha256':digest,'url':'https://example.org/copy.pdf','publishedMonth':'March 2025','targets':[target]}]}
    measure=load_script('source_copy_coverage').coverage
    result=measure(out,registry,[out])
    assert result['counts']['all_original_sources_readable']==0
    assert result['counts']['recovered_by_checked_copy']==1
    stale={'copies':[{**registry['copies'][0],'targets':[{**target,'textSha':'c'*64}]}]}
    assert measure(out,stale,[out])['counts']['recovered_by_checked_copy']==0
    directory={'reviews':[{'id':'review','kind':'direct-review','reviewedProduct':'uk-cpin','countries':['test'],
                          'targets':[{**target,'scope':'whole-report','mapping':'edition-declaration-checked'}]}]}
    result=load_script('prepare_source_review_queue').prepare(out,directory,registry)
    row=json.loads((out/'analysis-queue.jsonl').read_text().splitlines()[0])
    assert row['exactEditionReviews']==['review']
    assert row['sources'][0]['matchingReportCopies'][0]['sha256']==digest
    assert row['assessment'] is None and row['modelInputApproved'] is False
    assert result['paidModelCalls']==result['completedChecksAdded']==0
    (out/'documents'/digest).write_bytes(b'changed')
    assert measure(out,registry,[out])['counts']['recovered_by_checked_copy']==0
    assert measure(out,registry,[out])['issues']
    result=load_script('prepare_source_review_queue').prepare(out,directory,registry)
    row=json.loads((out/'analysis-queue.jsonl').read_text().splitlines()[0])
    assert row['status']=='needs-source-evidence'
    assert result['copyIntegrityIssues']
