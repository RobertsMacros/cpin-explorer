import hashlib
import json
from pathlib import Path

import httpx
import pytest

from cpin.http import PoliteClient
from cpin.review_collect import analysis_context, discovery_links, load_registry, public_directory, refresh
from cpin.source_collect import Retriever, cached_records

REGISTRY = {"schema": 1, "checkedAt": "2026-10-05", "publishers": [{"id": "org", "name": "Named organisation",
            "allowedHosts": ["example.org"], "discoveryUrls": ["https://example.org/reviews/"]}],
            "reviews": [{"id": "review", "publisherIds": ["org"], "url": "https://example.org/review.pdf",
            "countries": ["albania"], "assessment": "unassessed", "targets": [{"country": "albania",
            "series": "note:blood-feuds", "editionId": "a"*16, "textSha": "b"*64,
            "scope": "whole-report", "mapping": "edition-declaration-checked"}]}]}
TARGET = {k: REGISTRY['reviews'][0]['targets'][0][k] for k in ['country','series','editionId','textSha']}


def test_directory_keeps_exact_editions_separate_from_background_and_does_not_approve_findings():
    exact = analysis_context(REGISTRY, TARGET)
    assert len(exact['editionReviews']) == 1
    assert exact['editionReviews'][0]['citationApplicability'] == 'not assessed'
    assert exact['editionReviews'][0]['assessment'] == 'unassessed'
    for key in ['series','editionId','textSha']:
        result = analysis_context(REGISTRY, {**TARGET, key: 'other'})
        assert not result['editionReviews']
        assert len(result['backgroundReviews']) == 1
    assert not analysis_context(REGISTRY, {**TARGET, 'country': 'china'})['backgroundReviews']
    assert 'not independent corroboration' in exact['instructions']


def test_discovery_filters_navigation_and_external_hosts_but_accepts_international_reviews():
    links = discovery_links(b'''<html><a href="/about">About</a><a href="/cpin-review.pdf">CPIN review</a>
      <a href="https://evil.org/review.pdf">COI critique</a><a href="/easo-commentary.pdf">EASO commentary</a>
      <a href="/reviews/page/2/" rel="next">Next</a><a href="/ordinary.pdf">Download</a></html>''',
      'https://example.org/reviews/', {'example.org'})
    assert len(links) == 3
    assert {l['kind'] for l in links} == {'document','pagination'}
    assert all('evil.org' not in l['url'] for l in links)


def test_wordpress_and_drupal_next_links_are_not_silently_missed():
    links = discovery_links(b'''<a href="/reviews/page/2/">&laquo; Older Entries</a>
      <a href="/reviews/?page=1" aria-label="Go to next page">&gt;</a>''',
      'https://example.org/reviews/', {'example.org'})
    assert len(links) == 2 and all(l['kind'] == 'pagination' for l in links)


def test_index_traversal_reports_pagination_limits(tmp_path):
    def handler(req):
        if req.url.path == '/robots.txt': return httpx.Response(404)
        page = 3 if '/page/2/' in req.url.path else 2
        return httpx.Response(200, text='<html><main><p>' + 'COI evidence. '*30
            + f'</p><a href="/reviews/page/{page}/">&laquo; Older Entries</a></main></html>',
            headers={'content-type':'text/html'})
    retriever = make_retriever(handler)
    try:
        result = refresh(REGISTRY, tmp_path, index_pages=1, retriever=retriever)
        audit = result['indexTraversal']
        assert len(audit['visited']) == 2
        assert audit['paginationLimited'] == ['https://example.org/reviews/page/3/']
        assert not audit['complete']
    finally:
        retriever.close()


def test_search_tracking_is_removed_without_losing_document_query_identity():
    links = discovery_links(b'<html><a href="/cpin-review/?id=17&amp;_rt_nonce=abc&amp;_rt=1">CPIN review</a></html>',
                            'https://gardencourtchambers.co.uk/', {'gardencourtchambers.co.uk'})
    assert links[0]['url'] == 'https://gardencourtchambers.co.uk/cpin-review/?id=17'
    assert '_rt_nonce=abc' in links[0]['href']


def make_retriever(handler):
    return Retriever(client_factory=lambda: PoliteClient(transport=httpx.MockTransport(handler), sleep=lambda _: None), guard=lambda _: True)


def test_refresh_retains_hashes_changes_and_private_candidates_without_publishing_them(tmp_path):
    version = [1]
    requests = []
    def handler(req):
        requests.append(str(req.url))
        if req.url.path == '/robots.txt': return httpx.Response(404)
        return httpx.Response(200, text='<html><title>COI reviews</title><main><p>' + ('Reference evidence. '*30)
            + str(version[0]) + '</p><a href="/new-cpin-review.pdf">CPIN review</a></main></html>', headers={'content-type':'text/html'})
    retriever = make_retriever(handler)
    try:
        first = refresh(REGISTRY, tmp_path, retriever=retriever)
        assert first['candidateUrls'] == 1
        records = cached_records(tmp_path)
        assert all(not r['modelUseApproved'] and not r['publicDisplayApproved'] for r in records.values())
        sha = records['https://example.org/review.pdf']['sha256']
        assert hashlib.sha256((tmp_path/'documents'/sha).read_bytes()).hexdigest() == sha
        before = len(requests)
        second = refresh(REGISTRY, tmp_path, retriever=retriever)
        assert second['requests'] == 0 and len(requests) == before
        version[0] = 2
        third = refresh(REGISTRY, tmp_path, max_age=0, retriever=retriever)
        assert len(third['changed']) == 3
        assert (tmp_path/'documents'/sha).exists()
        public_directory(REGISTRY, tmp_path/'public.json')
        assert 'new-cpin-review' not in (tmp_path/'public.json').read_text()
    finally:
        retriever.close()


def test_request_limit_keeps_pending_and_returns_no_comprehensive_coverage_claim(tmp_path):
    retriever = make_retriever(lambda _: httpx.Response(404))
    try:
        result = refresh(REGISTRY, tmp_path, max_requests=1, retriever=retriever)
        assert result['requests'] == 1 and result['pending'] == 1
        assert result['stopped'] == 'request limit'
    finally:
        retriever.close()


def test_challenge_200_is_not_saved_as_review_evidence(tmp_path):
    def handler(req):
        if req.url.path == '/robots.txt': return httpx.Response(404)
        return httpx.Response(200, headers={'cf-mitigated':'challenge','content-type':'text/html'}, text='<html>Challenge</html>')
    retriever = make_retriever(handler)
    try:
        result = refresh(REGISTRY, tmp_path, retriever=retriever)
        assert result['outcomes'] == {'blocked':1,'host-refused':1}
        assert not list((tmp_path/'documents').glob('*'))
    finally:
        retriever.close()


def test_registry_rejects_unapproved_addresses_and_bad_edition_mappings(tmp_path):
    registry = json.loads(json.dumps(REGISTRY))
    p = tmp_path/'registry.json'
    p.write_text(json.dumps(registry))
    assert load_registry(p)['reviews']
    registry['reviews'][0]['relatedUrls'] = ['https://unknown.org/review.pdf']
    p.write_text(json.dumps(registry))
    with pytest.raises(ValueError, match='allowlist'): load_registry(p)


def test_curated_project_registry_is_valid():
    registry = load_registry(Path(__file__).resolve().parents[1]/'config/review-sources.json')
    assert any(r['reviewedProduct'] == 'easo-coi' for r in registry['reviews'])
    assert any(r['reviewedProduct'] == 'usdos-human-rights' for r in registry['reviews'])
    assert all(r['assessment'] == 'unassessed' for r in registry['reviews'])
