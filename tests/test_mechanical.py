import hashlib
import importlib.util
import json
from pathlib import Path

import pytest
from cpin import mechanical as m
from cpin.store import write_json

spec = importlib.util.spec_from_file_location('run_mechanical_checks', Path(__file__).parents[1] / 'scripts/run_mechanical_checks.py')
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


def test_normalisation_preserves_meaning_changing_tokens():
    assert m.normal('Did NOT cost −5% or £20.') == 'did not cost −5% or £20.'
    assert m.normal('5%') != m.normal('50%')
    assert m.normal('−5%') != m.normal('5%')
    assert m.normal('did not return') != m.normal('did return')


def test_outer_quote_retains_nested_quotation_and_source_markers_are_separate():
    text = '‘The source described “voluntary returns” as unreliable and stated that the numbers were estimates.’[footnote 8]'
    assert m.quotations(text) == ['The source described “voluntary returns” as unreliable and stated that the numbers were estimates.']
    assert m.claim_text({'paragraph': '3.1.2', 'text': '3.1.2 There were 312 cases [footnote 4].'}) == 'There were 312 cases .'
    assert m.citation('Publisher, Long country report title, 1 March 2025 (paragraph 3.1.2)')['paragraphs'] == ['3.1.2']


def test_ellipsis_preserves_omitted_qualification_and_order():
    source = m.normal('The first passage has enough words. At least 20 cases were unverified. The last passage also has enough words.')
    q = 'The first passage has enough words.…The last passage also has enough words.'
    match = m.locate(source, q)
    assert match['state'] == 'pass' and 'at least' in match['gaps'][0]
    assert m.locate(source, 'The last passage also has enough words.…The first passage has enough words.')['state'] == 'unable'
    assert m.locate(source, 'Words absent from this document entirely.')['state'] == 'unable'


def test_near_match_exposes_number_and_negation_but_not_ambiguous_alignment():
    quote = 'The detailed country survey found that 218 people did return to their original homes during the reporting period.'
    source = 'The detailed country survey found that 281 people did not return to their original homes during the reporting period.'
    match = m.near_quote(m.normal(source), quote)
    assert match and match['changed']['number'] and match['changed']['negation']
    other = source.replace('281', '219')
    assert m.near_quote(m.normal(source + ' ' + other), quote) is None
    # A number appearing elsewhere does not generate an aligned comparison.
    assert m.near_quote('218 ' + m.normal('An unrelated article has different subject matter and timeframe.'), quote) is None


@pytest.mark.parametrize('text,state', [('7 out of 9 (78%)', 'pass'), ('7 out of 9 (77%)', 'candidate'), ('1 out of 3 (33.3%)', 'pass'), ('1 out of 0 (5%)', 'candidate')])
def test_arithmetic_has_explicit_denominators_and_rounding(text, state):
    result = m.arithmetic(text)
    assert result[0]['rule'] == 'percentage-arithmetic' and result[0]['state'] == state
    assert m.arithmetic('There were 7 people. Another survey reported 9 people and 77%.') == []


def doc(text, kind='html', second=None):
    return {'sha256': 'a'*64, 'extractionSha256': 'b'*64, 'norm': m.normal(text), 'kind': kind,
            'second': m.normal(second) if second is not None else None, 'headers': ['Long country report title'],
            'dates': [], 'anchors': [], 'pageLabels': {}, 'physicalPages': 10}


def test_pdf_independent_reader_prevents_false_error_candidate():
    q = 'The detailed country survey found that 218 people did return to their original homes during the reporting period.'
    primary = q.replace('218', '281')
    result = m.quotation_checks('‘'+q+'’', doc(primary, 'pdf', q), 'https://example.org/report.pdf')
    assert not any(c['state'] == 'candidate' for c in result)
    assert any(c['rule'] == 'quotation-near-match' and c['state'] == 'unable' for c in result)
    agree = m.quotation_checks('‘'+q+'’', doc(q, 'pdf', q), 'https://example.org/report.pdf')
    assert any(c['rule'] == 'quotation-independent-reader' and c['state'] == 'pass' for c in agree)


def test_typographical_dash_difference_is_not_a_citation_error_candidate():
    q = 'The detailed country survey found that these people returned home – and had access to healthcare during the reporting period.'
    result = m.quotation_checks('‘'+q+'’', doc(q.replace('–', '--')), 'https://example.org/report')
    assert any(c['rule'] == 'quotation-near-match' and c['state'] == 'observation' for c in result)
    assert not any(c['state'] == 'candidate' for c in result)


def test_positive_year_conflict_requires_matching_title_words():
    d = doc('text');d['headers'] = ['A detailed country conditions report 2025']
    result = m.source_checks('Publisher, ‘A detailed country conditions report 2024’, 1 March 2024', 'https://example.org/report', d)
    assert any(c['rule'] == 'document-edition-year' and c['state'] == 'candidate' for c in result)
    d['headers'] = ['An unrelated economic report 2025']
    assert not any(c['rule'] == 'document-edition-year' for c in m.source_checks('Publisher, ‘A detailed country conditions report 2024’, 1 March 2024', 'https://example.org/report', d))


def test_printed_pages_are_not_inferred_from_physical_count():
    checks = m.source_checks('Publisher, Long country report title, 1 March 2024 (page 30)', 'https://example.org/report.pdf', doc('text', 'pdf'))
    assert next(c for c in checks if c['rule'] == 'source-printed-page')['state'] == 'unable'
    checks = m.source_checks('Publisher, Long country report title, 1 March 2024', 'https://example.org/report.pdf#page=30', doc('text', 'pdf'))
    assert next(c for c in checks if c['rule'] == 'source-physical-page')['state'] == 'candidate'


def test_publication_metadata_ambiguity_and_checksum():
    d = doc('source');d['dates'] = ['2024-01-01', '2025-01-01']
    checks = m.source_checks('Publisher, Long country report title, 1 January 2024. ISBN 978-0-306-40615-7', 'https://example.org/report', d)
    assert next(c for c in checks if c['rule'] == 'publication-date')['state'] == 'unable'
    assert next(c for c in checks if c['rule'] == 'isbn-checksum')['state'] == 'pass'
    bad = m.source_checks('Publisher, Long country report title, 31 February 2024. ISBN 978-0-306-40615-8', 'https://example.org/report', d)
    assert any(c['rule'] == 'isbn-checksum' and c['state'] == 'candidate' for c in bad)
    assert any(c['rule'] == 'invalid-calendar-date' and c['state'] == 'candidate' for c in bad)


def payload():
    return {'claim': {'footnotes': ['fn:1', 'fn:1']}, 'referenceCounts': {'fn:1': 1},
            'footnotes': [{'id': 'fn:1', 'text': 'Publisher, Long country report title, 3 October 2024'}],
            'published': '2024-10-01', 'sources': [], 'citationDateConflicts': {}}


def test_month_precision_and_repeated_marker_do_not_become_errors():
    p = payload();checks = m.occurrence_checks(p)
    assert not any(c['state'] == 'candidate' for c in checks)
    p['footnotes'][0]['text'] = 'Publisher, Long country report title, 3 November 2024'
    assert any(c['rule'] == 'source-future-date' and c['state'] == 'candidate' for c in m.occurrence_checks(p))
    p['referenceCounts']['fn:1'] = 2
    assert any(c['rule'] == 'duplicate-reference' and c['state'] == 'candidate' for c in m.occurrence_checks(p))


def fixture(tmp_path):
    root = tmp_path / 'inventory';out = tmp_path / 'results';root.mkdir();out.mkdir()
    url = 'https://example.org/report'
    quote = 'The detailed country survey found that 218 people did return to their original homes during the reporting period.'
    content = f'<html><head><title>Long country report title</title></head><body><p>{quote}</p></body></html>'.encode()
    sha = hashlib.sha256(content).hexdigest()
    (root / 'documents').mkdir();(root / 'documents' / sha).write_bytes(content)
    write_json(root / 'text' / f'{sha}.json', {'kind': 'html', 'status': 'extracted', 'title': 'Long country report title', 'text': quote})
    (root / 'attempts.jsonl').write_text(json.dumps({'url': url, 'final_url': url, 'status': 'downloaded', 'sha256': sha})+'\n')
    claim = {'id': 1, 'paragraph': '1.1.1', 'section': 'Evidence', 'text': '1.1.1 ‘'+quote+'’', 'footnotes': ['fn:1'], 'links': []}
    f = {'id': 'fn:1', 'number': 1, 'text': 'Publisher, Long country report title, 1 March 2024 (paragraph 12)', 'links': [{'url': url, 'href': url}]}
    edition = {'country': 'test', 'series': 'test', 'editionId': 'a'*16, 'textSha': 'b'*64, 'source': 'live', 'published': '2024-04-01', 'claims': [claim], 'footnotes': [f]}
    write_json(root / 'index/test.json', edition)
    write_json(root / 'inventory.json', {'index_paths': ['index/test.json']})
    return root, out, sha, edition


def test_resume_preserves_results_and_changed_bytes_invalidate_them(tmp_path, monkeypatch):
    inventory, output, sha, edition = fixture(tmp_path)
    first = runner.run(inventory, output)
    assert first['screened'] == first['total'] == 1 and first['remaining'] == 0
    assert first['checkStates']['quotation-exact:pass'] == 1
    original = m.SourceReader._read
    monkeypatch.setattr(m.SourceReader, '_read', lambda *args: (_ for _ in ()).throw(AssertionError('should not reread')))
    assert runner.run(inventory, output)['rowStates'] == first['rowStates']
    monkeypatch.setattr(m.SourceReader, '_read', original)
    (inventory / 'documents' / sha).write_bytes(b'corrupt changed source')
    changed = runner.run(inventory, output)
    assert changed['checkStates']['source-integrity:unable'] == 1
    assert 'quotation-exact:pass' not in changed['checkStates']


def test_cp_number_renumbering_can_reuse_but_source_pinpoints_cannot(tmp_path):
    inventory, output, sha, edition = fixture(tmp_path)
    second = json.loads(json.dumps(edition));second['editionId'] = 'c'*16;second['textSha'] = 'd'*64
    second['claims'][0]['paragraph'] = '2.1.3';second['claims'][0]['text'] = second['claims'][0]['text'].replace('1.1.1', '2.1.3')
    second['claims'][0]['footnotes'] = ['fn:9'];second['footnotes'][0]['id'] = 'fn:9';second['footnotes'][0]['number'] = 9
    write_json(inventory / 'index/second.json', second)
    write_json(inventory / 'inventory.json', {'index_paths': ['index/test.json', 'index/second.json']})
    result = runner.run(inventory, output)
    assert result['total'] == 2 and result['distinctComputations'] == 1
    second['footnotes'][0]['text'] = second['footnotes'][0]['text'].replace('paragraph 12', 'paragraph 13')
    write_json(inventory / 'index/second.json', second)
    assert runner.run(inventory, output)['distinctComputations'] == 2


def test_original_fragments_survive_fetch_url_normalisation_and_prevent_reuse(tmp_path):
    inventory, output, sha, edition = fixture(tmp_path)
    second = json.loads(json.dumps(edition));second['editionId'] = 'c'*16;second['textSha'] = 'd'*64
    edition['footnotes'][0]['links'][0]['href'] += '#one'
    second['footnotes'][0]['links'][0]['href'] += '#two'
    write_json(inventory / 'index/test.json', edition)
    write_json(inventory / 'index/second.json', second)
    write_json(inventory / 'inventory.json', {'index_paths': ['index/test.json', 'index/second.json']})
    result = runner.run(inventory, output)
    assert result['distinctComputations'] == 2
    assert result['checkStates']['source-html-fragment:unable'] == 2
