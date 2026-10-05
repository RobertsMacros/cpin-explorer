import hashlib
import json

import httpx
import pytest

from cpin.http import PoliteClient
from cpin.source_collect import source_url, edition_index, build_inventory, Retriever, collect, extracted

BODY = '''<h2>1. Risk</h2><p>1.1.1 One claim<sup><a href="#fn:1">1</a></sup>.</p>
<h2>2. Evidence</h2><p>1.1.1 Another claim<sup><a href="#fn:1">1</a></sup><sup><a href="#fn:9">9</a></sup>.</p>
<p>Direct <a href="https://example.org/report.pdf#page=3">report</a>.</p>
<div class="footnotes"><ol><li id="fn:1" role="doc-endnote">Source <a href="https://example.org/a#here">A</a> and <a href="https://example.org/b">B</a><a href="#fnref:1">back</a></li></ol></div>'''
REPORT = {"country":"afghanistan", "key":"note:test"}
EDITION = {"id":"a"*16, "text_sha256":"b"*64,"body":BODY,"current":True,"source":"live"}


def test_footnotes_map_each_claim_and_link_without_losing_repeated_paragraph_context():
    index=edition_index(REPORT,EDITION)
    assert index['bodySha']==hashlib.sha256(BODY.encode()).hexdigest()
    f=index['footnotes'][0]
    assert f['claims']==[0,1]
    assert [l['url'] for l in f['links']]==['https://example.org/a','https://example.org/b']
    assert [(c['paragraph'],c['section']) for c in index['claims'][:2]]==[('1.1.1','1. Risk'),('1.1.1','2. Evidence')]
    assert index['diagnostics']['missing_footnotes']==['fn:9']
    assert len(index['links'])==3


def test_inventory_deduplicates_urls_but_preserves_edition_and_footnote_uses(tmp_path):
    root=tmp_path/'series'/'afghanistan';root.mkdir(parents=True)
    (root/'test.json').write_text(json.dumps({**REPORT,'versions':[EDITION,{**EDITION,'id':'c'*16,'current':False}]}))
    urls,summary=build_inventory(tmp_path/'series',tmp_path/'out',all_editions=True)
    assert summary['counts']['editions']==2
    assert len(urls)==3
    assert len(next(r for r in urls if r['url'].endswith('/a'))['cited_by'])==2
    assert urls[0]['current'] is True


def test_since_filters_by_publication_not_capture_time_and_reports_unknown_dates(tmp_path):
    root=tmp_path/'series'/'afghanistan';root.mkdir(parents=True)
    editions=[{**EDITION,'id':str(i)*16,'published':stamp,'captured_at':'2026-10-05T00:00:00Z'}
              for i,stamp in enumerate(['2022-12-31T00:00:00Z','2023-01-01T00:00:00Z',None])]
    (root/'test.json').write_text(json.dumps({**REPORT,'versions':editions}))
    urls,summary=build_inventory(tmp_path/'series',tmp_path/'out',all_editions=True,since='2023-01-01')
    assert summary['counts']['editions']==1
    assert summary['counts']['reports']==1
    assert summary['problems'][0]['edition']=='2'*16
    assert summary['since']=='2023-01-01'
    assert all('1'*16 in key for row in urls for key in row['cited_by'])


def test_narrowing_inventory_keeps_history_but_excludes_it_from_coverage_and_csv(tmp_path):
    from cpin.source_collect import footnote_coverage, export_lists
    root=tmp_path/'series'/'afghanistan';root.mkdir(parents=True)
    editions=[{**EDITION,'id':str(i)*16,'published':stamp}
              for i,stamp in enumerate(['2022-12-31','2023-01-01'])]
    (root/'test.json').write_text(json.dumps({**REPORT,'versions':editions}))
    out=tmp_path/'out'
    build_inventory(tmp_path/'series',out,all_editions=True)
    urls,summary=build_inventory(tmp_path/'series',out,all_editions=True,since='2023-01-01')
    assert len(list((out/'index').glob('*/*/*.json')))==2
    assert len(summary['index_paths'])==1
    assert footnote_coverage(out)['totals']['footnotes']==1
    export_lists(urls,out)
    assert '0'*16 not in (out/'footnotes.csv').read_text(encoding='utf-8-sig')
    assert '1'*16 in (out/'footnotes.csv').read_text(encoding='utf-8-sig')


@pytest.mark.parametrize('url',['javascript:alert(1)','https://example.org/broken line.pdf','http://localhost/test','https://user:pass@example.org/','https://example.org:8888/','https://example.org/\\x'])
def test_invalid_source_urls_are_not_guessed(url):
    assert source_url(url) is None


def test_fragments_deduplicate_but_queries_and_document_identity_remain():
    assert source_url('//example.org/a#page=1')=='https://example.org/a'
    assert source_url('https://example.org/?id=one#two')=='https://example.org/?id=one'


def test_stream_limit_stops_body_without_contacting_forbidden_redirect(tmp_path):
    requests=[]
    def handler(req):
        requests.append(str(req.url))
        if req.url.path=='/robots.txt':return httpx.Response(404)
        return httpx.Response(200,content=b'x'*200)
    with PoliteClient(transport=httpx.MockTransport(handler),sleep=lambda _:None,max_bytes=100) as client:
        assert client.get('https://example.org/large').status=='too-large'
    requests.clear()
    with PoliteClient(transport=httpx.MockTransport(handler),url_guard=lambda u:'example.org' in u) as client:
        assert client.get('https://127.0.0.1/private').status=='unsafe'
        assert not requests


def test_cross_host_redirect_checks_destination_robots_and_retains_provenance(tmp_path):
    requests=[]
    def handler(req):
        requests.append(str(req.url))
        if req.url.path=='/robots.txt':return httpx.Response(200,text='User-agent: *\nDisallow: /blocked' if req.url.host=='destination.org' else '')
        if req.url.host=='example.org':return httpx.Response(302,headers={'location':'https://destination.org/blocked'})
        raise AssertionError('destination page must not be requested')
    retriever=Retriever(client_factory=lambda:PoliteClient(transport=httpx.MockTransport(handler),sleep=lambda _:None),guard=lambda _:True)
    try:
        result,trail=retriever.get('https://example.org/cited')
        assert result.status=='robots'
        assert [p['status'] for p in trail]==[302,'robots']
        assert requests[-1]=='https://destination.org/robots.txt'
    finally:retriever.close()


def test_collector_resumes_and_records_host_refusals_without_calling_them_broken(tmp_path):
    requests=[]
    def handler(req):
        requests.append(str(req.url))
        if req.url.path=='/robots.txt':return httpx.Response(404)
        return httpx.Response(403)
    retriever=Retriever(client_factory=lambda:PoliteClient(transport=httpx.MockTransport(handler),sleep=lambda _:None),guard=lambda _:True)
    catalogue=[{'url':'https://example.org/a','current':True},{'url':'https://example.org/b','current':False}]
    try:
        summary=collect(catalogue,tmp_path,retriever=retriever)
        assert summary['counts']=={'blocked':1,'host-refused':1}
        assert len(requests)==2
        again=collect(catalogue,tmp_path,retriever=retriever)
        assert again['completed']==0 and len(requests)==2
    finally:retriever.close()


def test_pdf_evidence_preserves_page_locations_and_does_not_claim_verified_text():
    import pymupdf
    with pymupdf.open() as pdf:
        page=pdf.new_page();page.insert_text((40,40),'Text evidence. '*20)
        result=extracted(pdf.tobytes(),'application/pdf','https://example.org/source.pdf')
    assert result['kind']=='pdf' and result['status']=='extracted'
    assert result['pages'][0]['page']==1 and result['verified'] is False


def test_robots_redirect_guard_prevents_private_requests():
    asked=[]
    def handler(req):
        asked.append(str(req.url));return httpx.Response(302,headers={'location':'http://127.0.0.1/private'})
    with PoliteClient(transport=httpx.MockTransport(handler),url_guard=lambda u:'example.org' in u,max_retries=0,max_bytes=1024) as client:
        assert client.get('https://example.org/a').status=='robots'
        assert asked==['https://example.org/robots.txt']


def test_landing_page_pdf_follow_is_bounded_and_not_an_unrestricted_crawl(tmp_path):
    from cpin.source_collect import linked_documents, append_json
    from cpin.store import write_json
    digest='d'*64
    append_json(tmp_path/'attempts.jsonl',{'url':'https://example.org/report','status':'downloaded','sha256':digest})
    write_json(tmp_path/'text'/f'{digest}.json',{'kind':'html','text':'Landing page','document_links':[{'url':f'https://example.org/{i}.pdf','label':'Download PDF'} for i in range(10)]})
    linked=linked_documents(tmp_path,[])
    assert len(linked)==2
    assert linked[0]['linked_from'][0]['sha256']==digest
    write_json(tmp_path/'text'/f'{digest}.json',{'kind':'html','text':'Long article '*1000,'document_links':[{'url':'https://example.org/another.pdf','label':'Unrelated'}]})
    assert linked_documents(tmp_path,[])==[]


def test_source_audit_detects_missing_bytes_and_keeps_no_text_separate(tmp_path):
    from cpin.source_collect import audit_collection, append_json
    from cpin.store import write_json
    digest='e'*64;url='https://example.org/a'
    append_json(tmp_path/'attempts.jsonl',{'url':url,'status':'downloaded','sha256':digest})
    write_json(tmp_path/'text'/f'{digest}.json',{'status':'no-text'})
    audit=audit_collection([{'url':url},{'url':'https://example.org/not-run'}],tmp_path)
    assert audit['counts']=={'downloaded':1,'pending':1}
    assert audit['extractions']=={'no-text':1}
    assert audit['issues'][0]['error']=='missing source file'


def test_html_extraction_keeps_evidence_words_and_original_download_links():
    body='<html><head><title>Source report</title></head><body><article><h1>Findings</h1><p>'+'A detailed source passage with evidence and qualifications. '*25+'</p><a href="/report.pdf">Download full report</a></article></body></html>'
    result=extracted(body.encode(),'text/html','https://example.org/article')
    assert result['status']=='extracted' and result['verified'] is False
    assert 'evidence and qualifications' in result['text']
    assert result['document_links']==[{'url':'https://example.org/report.pdf','href':'/report.pdf','label':'Download full report','discovery':'anchor'}]


def test_interrupted_journal_tail_does_not_swallow_the_next_completed_attempt(tmp_path):
    from cpin.source_collect import append_json, cached_records
    path=tmp_path/'attempts.jsonl';path.write_text('{"url":"unfinished')
    append_json(path,{'url':'https://example.org/complete','status':'404'})
    assert cached_records(tmp_path)['https://example.org/complete']['status']=='404'
    assert 'unfinished' in path.read_text()


def test_printed_url_is_retained_without_guessing_away_its_punctuation():
    edition={**EDITION,'body':'<p>1.1.1 Claim<sup><a href="#fn:1">1</a></sup></p><ol><li id="fn:1">See https://example.org/source.pdf).</li></ol>'}
    index=edition_index(REPORT,edition)
    link=index['footnotes'][0]['links'][0]
    assert link['url']=='https://example.org/source.pdf).'
    assert link['boundary_uncertain'] is True
    assert link['discovery']=='plain-text candidate'
    assert index['links'][0]['url']==link['url']


def test_redirects_into_a_previously_refusing_host_are_not_requested_again():
    requests=[]
    def handler(req):
        requests.append(str(req.url))
        if req.url.path=='/robots.txt':return httpx.Response(404)
        return httpx.Response(302,headers={'location':'https://refusing.org/report.pdf'})
    retriever=Retriever(client_factory=lambda:PoliteClient(transport=httpx.MockTransport(handler),sleep=lambda _:None),guard=lambda _:True)
    retriever.refusals['refusing.org']='https://refusing.org/earlier'
    try:
        result,trail=retriever.get('https://example.org/report')
        assert result.status=='host-refused'
        assert not any('refusing.org' in r for r in requests)
    finally:retriever.close()


def test_coverage_counts_footnote_sources_separately_from_claim_verification(tmp_path):
    from cpin.source_collect import footnote_coverage, append_json
    from cpin.store import write_json
    index=edition_index(REPORT,EDITION)
    write_json(tmp_path/'index'/'afghanistan'/'note--test'/'edition.json',index)
    append_json(tmp_path/'attempts.jsonl',{'url':'https://example.org/a','status':'downloaded','extraction':'extracted'})
    append_json(tmp_path/'attempts.jsonl',{'url':'https://example.org/b','status':'robots'})
    result=footnote_coverage(tmp_path)
    assert result['totals']['some_linked_sources_have_text']==1
    assert result['by_scope']['current']['footnotes']==1
    assert 'not been verified' in result['basis']


def test_a_successful_http_response_can_still_be_an_access_page_or_wrong_source():
    from cpin.source_collect import source_quality
    record={'url':'https://example.org/report','final_url':'https://example.org/report'}
    assert source_quality(record,{'status':'extracted','title':'Just a moment...'})['readable_source'] is False
    assert source_quality({**record,'final_url':'https://example.org/'},{'status':'extracted','title':'Home'})['state']=='redirect_needs_check'
    assert source_quality(record,{'status':'extracted','title':'Research report'})['readable_source'] is True
    assert source_quality({**record,'challenge_header':'challenge'},{'status':'extracted','title':'Continue'})['readable_source'] is False


def test_identical_landing_page_bytes_keep_relative_pdf_links_in_each_url_context(tmp_path):
    from cpin.source_collect import append_json, linked_documents
    from cpin.store import write_json, atomic_write
    digest='f'*64
    atomic_write(tmp_path/'documents'/digest,b'<html><a href="download">Full report PDF</a></html>')
    write_json(tmp_path/'text'/f'{digest}.json',{'kind':'html','text':'Landing page','document_links':[]})
    for folder in ['one','two']:
        url=f'https://example.org/{folder}/landing'
        append_json(tmp_path/'attempts.jsonl',{'url':url,'final_url':url,'status':'downloaded','sha256':digest})
    assert [r['url'] for r in linked_documents(tmp_path,[])]==['https://example.org/one/download','https://example.org/two/download']


def test_explicit_embedded_un_pdf_is_discovered_but_tracking_iframe_is_not(tmp_path):
    from cpin.source_collect import append_json, linked_documents, document_links
    from cpin.store import write_json, atomic_write
    from lxml import html
    content=b'<html><iframe src="https://tracker.example/frame"></iframe><iframe src="https://documents.un.org/api/symbol/access?s=A/HRC/52/69&amp;l=en&amp;t=pdf"></iframe></html>'
    links=document_links(html.fromstring(content))
    assert len(links)==1 and links[0]['discovery']=='embedded-pdf'
    digest=hashlib.sha256(content).hexdigest()
    atomic_write(tmp_path/'documents'/digest,content)
    write_json(tmp_path/'text'/f'{digest}.json',{'kind':'html','text':'Document viewer'})
    append_json(tmp_path/'attempts.jsonl',{'url':'https://docs.un.org/en/A/HRC/52/69','status':'downloaded','sha256':digest})
    row=linked_documents(tmp_path,[])[0]
    assert row['url']=='https://documents.un.org/api/symbol/access?s=A/HRC/52/69&l=en&t=pdf'
    assert row['linked_from'][0]['discovery']=='embedded-pdf'


def test_empty_successful_response_is_not_a_readable_source():
    from cpin.source_collect import extracted
    result = extracted(b'', 'text/html', 'https://example.org/report')
    assert result['status'] == 'no-text'
    assert result['text'] == '' and result['verified'] is False


def test_long_host_queues_do_not_starve_small_hosts_or_overlap_requests(tmp_path):
    import threading
    import time
    from urllib.parse import urlsplit
    from cpin.source_collect import collect
    from cpin.http import FetchResult
    class FakeRetriever:
        refusals = {}
        def __init__(self):
            self.lock, self.active, self.calls = threading.Lock(), set(), []
        def get(self, url):
            host = urlsplit(url).netloc
            with self.lock:
                assert host not in self.active
                self.active.add(host)
                self.calls.append(host)
            time.sleep(.001)
            with self.lock:self.active.remove(host)
            return FetchResult(url,200,b'Evidence with enough readable words. '*8,headers={'content-type':'text/plain'}),[]
    getter = FakeRetriever()
    rows = [{"url":f'https://{host}/{i}',"current":True} for host,n in
            [('large-one.org',55),('large-two.org',55),('small.org',5)] for i in range(n)]
    summary = collect(rows,tmp_path,workers=4,retriever=getter,log=lambda *a,**kw:None)
    assert summary['counts'] == {'downloaded':115}
    assert 'small.org' in getter.calls[:20]
    assert not getter.active


def test_resume_retains_recent_host_spacing():
    from datetime import datetime, timezone
    sleeps = []
    def handler(req):
        if req.url.path == '/robots.txt':
            return httpx.Response(200,text='User-agent: *\nAllow: /\nCrawl-delay: 10')
        return httpx.Response(200,text='Source')
    with PoliteClient(transport=httpx.MockTransport(handler),sleep=sleeps.append) as client:
        client.remember_request('https://example.org/first',datetime.now(timezone.utc).isoformat())
        assert client.get('https://example.org/second').ok
    assert len(sleeps) == 1 and 9 < sleeps[0] <= 10


def test_a_cache_budget_stop_can_resume_without_retrying_refusals(tmp_path):
    from cpin.source_collect import append_json, collect
    from cpin.http import FetchResult
    url='https://example.org/report'
    append_json(tmp_path/'attempts.jsonl',{'url':url,'status':'budget'})
    class FakeRetriever:
        refusals={}
        def get(self, requested):
            assert requested == url
            return FetchResult(url,200,b'Enough source text to extract. '*8,headers={'content-type':'text/plain'}),[]
    summary=collect([{'url':url,'current':True}],tmp_path,retriever=FakeRetriever(),log=lambda *a,**kw:None)
    assert summary['selected']==1 and summary['counts']=={'downloaded':1}


def test_explicit_bot_challenge_header_stops_the_host_even_with_http_202():
    requests=[]
    def handler(req):
        if req.url.path=='/robots.txt':return httpx.Response(200,text='User-agent: *\nAllow: /')
        requests.append(str(req.url))
        return httpx.Response(202,headers={'x-amzn-waf-action':'challenge'})
    retriever=Retriever(client_factory=lambda:PoliteClient(transport=httpx.MockTransport(handler),sleep=lambda _:None),guard=lambda _:True)
    try:
        first,_=retriever.get('https://example.org/source')
        assert first.status==202 and 'bot challenge' in first.error
        assert retriever.get('https://example.org/other')[0].status=='host-refused'
        assert requests==['https://example.org/source']
    finally:retriever.close()
