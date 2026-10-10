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


def test_edge_ellipsis_quotation_still_exposes_changed_number_and_negation():
    source = 'Restricted areas in the territory now take up 65 per cent of the land; most of them are off limits for residents, while aid groups need permits.'
    faithful = 'Restricted areas in the territory now take up 65 per cent of the land; most of them are off limits for residents …'
    assert m.locate(m.normal(source), faithful)['state'] == 'pass'
    number = m.quotation_checks('‘' + faithful.replace('65', '95') + '’[footnote 16]', doc(source), 'https://example.org/source')
    assert any(c['rule'] == 'changed-number' and c['state'] == 'candidate' for c in number)
    assert not any(c['rule'] == 'changed-negation' for c in number)
    negation = m.quotation_checks('‘… ' + faithful.replace('are off', 'are not off') + '’', doc(source), 'https://example.org/source')
    assert any(c['rule'] == 'changed-negation' and c['state'] == 'candidate' for c in negation)
    assert not any(c['rule'] == 'changed-number' for c in negation)
    # near_quote itself never spans an omission; quotation_checks aligns each segment.
    inner = 'Restricted areas in the territory now take up 95 per cent of the land … most of them are off limits for residents'
    assert m.near_quote(m.normal(source), inner) is None


def rules(checks, state='candidate'):
    return {c['rule'] for c in checks if c['state'] == state}


def test_internal_ellipsis_aligns_each_unlocated_segment():
    source = ('The detailed country survey found that 281 people did not return to their original homes during the reporting period. '
              'Officials said the estimate was provisional. Aid agencies reported that most displaced families were still living in '
              'temporary shelters at the end of the year.')
    quote = ('The detailed country survey found that 281 people did not return to their original homes during the reporting period. … '
             'Aid agencies reported that most displaced families were still living in temporary shelters at the end of the year.')
    faithful = m.quotation_checks('‘' + quote + '’', doc(source), 'https://example.org/source')
    assert not {'changed-number', 'changed-negation', 'quotation-near-match'} & rules(faithful)
    number = m.quotation_checks('‘' + quote.replace('281', '218') + '’', doc(source), 'https://example.org/source')
    assert 'changed-number' in rules(number) and 'changed-negation' not in rules(number)
    changed = next(c for c in number if c['rule'] == 'changed-number')
    assert changed['quoted'] == quote.replace('281', '218') and changed['evidence']['segment'].startswith('The detailed country survey')
    negation = m.quotation_checks('‘' + quote.replace('were still living', 'were not still living') + '’', doc(source), 'https://example.org/source')
    assert 'changed-negation' in rules(negation) and 'changed-number' not in rules(negation)
    # A segment too short to align uniquely stays unassessed rather than guessed.
    short = 'The survey found 218 people … Aid agencies reported that most displaced families were still living in temporary shelters at the end of the year.'
    assert not {'changed-number', 'quotation-near-match'} & rules(m.quotation_checks('‘' + short + '’', doc(source), 'https://example.org/source'))


def test_bracket_insertions_and_a_changed_last_figure_are_still_aligned():
    source = ('The general index fell by 1.9 percent in June compared to May. Food prices also witnessed a decrease in the region by 2 percent '
              'in June compared to May, and an even larger decrease compared to the previous June by 84 percent. However, the index remained '
              'higher than pre-crisis levels by 102.2 percent. Flour prices remained stable during the first half of the month.')
    quote = ('Food prices … witnessed a decrease in the region by 2 percent in June compared to May [2026], and an even larger decrease '
             'compared to the previous June by 84 percent. However, the index remained higher than pre-crisis levels by 102.2 percent.')
    faithful = m.quotation_checks('‘' + quote + '’', doc(source), 'https://example.org/source')
    assert not {'changed-number', 'changed-negation', 'changed-unit', 'quotation-near-match'} & rules(faithful)
    # A percent sign for the word is formatting, not a changed unit or wording.
    signed = m.quotation_checks('‘' + quote.replace('102.2 percent', '102.2%') + '’', doc(source), 'https://example.org/source')
    assert not {'changed-number', 'changed-unit', 'quotation-near-match'} & rules(signed)
    altered = m.quotation_checks('‘' + quote.replace('102.2 percent', '202.2%') + '’', doc(source), 'https://example.org/source')
    assert 'changed-unit' not in rules(altered)
    assert 'changed-number' in rules(altered)
    evidence = next(c for c in altered if c['rule'] == 'changed-number')['evidence']
    assert {'quoted': '202.2%.', 'source': '102.2 percent.'} in evidence['differences'] and evidence['editorialInsertions'] == ['[2026]']
    # A replaced capital is typography; the bracket itself is never a wording candidate.
    capital = '[A]nd an even larger decrease compared to the previous June by 48 percent. However, the index remained higher than pre-crisis levels by 102.2 percent.'
    assert 'changed-number' in rules(m.quotation_checks('‘' + capital + '’', doc(source), 'https://example.org/source'))
    replaced = quote.replace('the index remained', '[it] remained')
    assert not {'changed-number', 'quotation-near-match'} & rules(m.quotation_checks('‘' + replaced + '’', doc(source), 'https://example.org/source'))


def test_a_change_in_the_first_words_is_aligned_from_the_other_end():
    source = 'Roads were closed for a week. Nearly 65 per cent of the land in the territory is now restricted, and most of it remains closed to ordinary residents. Schools reopened later.'
    quote = 'Nearly 95 per cent of the land in the territory is now restricted, and most of it remains closed to ordinary residents.'
    assert 'changed-number' in rules(m.quotation_checks('‘' + quote + '’', doc(source), 'https://example.org/source'))
    assert m.near_quote(m.normal('An unrelated article has different subject matter and a different timeframe altogether, closed to ordinary residents.'), quote) is None


def test_leading_source_marker_does_not_crash_or_hide_changed_number():
    quote = 'The detailed survey found that 218 people returned to their original homes during the reporting period.'
    source = quote.replace('218', '281')
    evidence = doc(source)
    evidence['furniture'] = [{'marker': '1', 'before': '', 'after': 'The detailed survey'}]
    checks = m.quotation_checks('‘' + quote + '’', evidence, 'https://example.org/source')
    assert any(c['rule'] == 'changed-number' and c['state'] == 'candidate' for c in checks)


def test_inline_glossary_restores_words_and_negation_only_with_unique_context():
    from lxml import html
    source = 'The detailed survey found that people did not return to their original homes during the reporting period.'
    extracted = source.replace('did not return', 'did return')
    tree = html.fromstring('<p>' + source.replace('not', '<button class="definition-term__link">not</button>') + '</p>')
    recovered, proof = m.recover_inline_glossary(tree, extracted)
    assert recovered == m.normal(source) and proof[0]['label'] == 'not'
    evidence = doc(extracted)
    evidence['comparisonNorm'], evidence['inlineRecoveries'] = recovered, proof
    checks = m.quotation_checks('‘' + extracted + '’', evidence, 'https://example.org/source')
    assert any(c['rule'] == 'changed-negation' and c['state'] == 'candidate' for c in checks)
    assert not any(c['rule'] == 'quotation-exact' and c['state'] == 'pass' for c in checks)
    assert m.recover_inline_glossary(tree, extracted + ' ' + extracted)[1] == []
    tree = html.fromstring('<p>' + source.replace('not', '<button>not</button>') + '</p>')
    assert m.recover_inline_glossary(tree, extracted)[1] == []


def test_case_identifier_zero_padding_does_not_hide_distinct_cases():
    for observed, conflict in [('[2016] UKUT 66', False), ('[2016] UKUT 67', True)]:
        evidence = doc(observed)
        evidence.update(headers=[observed], dates=[], anchors=[])
        checks = m.source_checks('AR and NH [2016] UKUT 00066', 'https://example.org/case', evidence)
        assert any(c['rule'] == 'identifier-conflict' for c in checks) == conflict


@pytest.mark.parametrize('text,state', [('7 out of 9 (78%)', 'pass'), ('7 out of 9 (77%)', 'observation'), ('Exactly 7 out of 9 (77%)', 'candidate'), ('700 out of 900 (77%)', 'candidate'), ('1 out of 3 (33.3%)', 'pass'), ('1 out of 0 (5%)', 'candidate')])
def test_arithmetic_has_explicit_denominators_and_rounding(text, state):
    result = m.arithmetic(text)
    assert result[0]['rule'] == 'percentage-arithmetic' and result[0]['state'] == state
    assert m.arithmetic('There were 7 people. Another survey reported 9 people and 77%.') == []


def test_percentage_ranges_and_url_escapes_preserve_real_invalid_shares():
    assert m.arithmetic('26%-50% received a visit. https://example.org/2019%2011%20report.pdf') == []
    assert m.arithmetic('1%-2% had access.') == []
    assert any(c['state'] == 'candidate' for c in m.arithmetic('The share was -50%.'))
    assert any(c['state'] == 'candidate' for c in m.arithmetic('The share ranged from 26%-150%.'))


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


def test_grouped_numbers_are_not_truncated_and_growth_is_not_a_share():
    assert m.arithmetic('Pay raises range from 800 to 5,000 per month.') == []
    assert m.arithmetic('Payments range from 5,000 to 800 per month.')[0]['state'] == 'candidate'
    assert m.arithmetic('Payments range from 800 to 5,00 per month.') == []
    assert m.arithmetic('Reported cases increased by 200%.')[0]['state'] == 'observation'
    assert m.arithmetic('The surveyed population was 200% of the respondents.')[0]['state'] == 'candidate'
    assert m.arithmetic('4 out of 5 (81%)')[0]['state'] == 'observation'
    assert m.arithmetic('4 out of 5 (30%)')[0]['state'] == 'candidate'


def test_population_word_without_a_number_is_not_a_numerical_unit():
    quote = 'We work with partners around the globe to strengthen the capacity of the LGBTIQ human rights movement, document and amplify human rights violations, and advocate for inclusion and equality.'
    source = quote.replace('violations,', 'violations against LGBTIQ people,')
    assert not m.near_quote(m.normal(source), quote)['changed']['unit']
    q = 'The detailed country survey found that 218 people returned to their original homes during the reporting period.'
    assert m.near_quote(m.normal(q.replace('people', 'families')), q)['changed']['unit']


def test_only_structural_headings_are_excluded_and_raw_heading_quotes_survive():
    from lxml import html
    q = 'Upon signing a contract a recruit receives no payment. The companies are private industrial firms with contracts for recruitment.'
    heading = "'No Long-Term Planning'"
    body = q.replace('payment. The', 'payment. '+heading+' The')
    tree = html.fromstring('<article><p>Upon signing a contract a recruit receives no payment.</p><big><strong>'+heading+'</strong></big><p>The companies are private industrial firms with contracts for recruitment.</p><p><strong>Without payment people cannot return safely.</strong></p></article>')
    assert m.html_headings(tree) == [m.normal(heading)]
    d = doc(body); d['comparisonNorm'], d['furniture'] = m.comparison_text(d['norm'], m.html_headings(tree))
    checks = m.quotation_checks('‘'+q+'’', d, 'https://example.org/report')
    assert any(c['rule']=='source-furniture' for c in checks)
    assert not any(c['state']=='candidate' for c in checks)


def test_anchored_pdf_markers_preserve_real_numbers():
    marker = {'marker':'150','before':'their lives.','after':'there have been no reports'}
    cleaned, removed = m.remove_notes('Afghans returned at some point in their lives.150 There have been no reports of tension. 150 people returned.', [marker])
    assert removed and 'lives. there' in cleaned and '150 people' in cleaned
    assert m.remove_notes('There were 150 deaths and 150 people returned.', [marker])[1] == []


def test_uncovered_pdf_labels_do_not_raise_or_invent_a_mapping():
    class Page:
        def __init__(self, i): self.i=i
        def get_label(self):
            if self.i < 2: raise IndexError('no applicable label rule')
            return str(self.i+8)
    class PDF:
        def get_page_labels(self): return [{'startpage':2,'style':'D','firstpagenum':10}]
        def __iter__(self): return iter([Page(i) for i in range(4)])
    labels, gaps = m.declared_labels(PDF())
    assert labels == {'3':'10','4':'11'} and gaps == [1,2]


def test_access_date_syntax_does_not_become_publication_conflict():
    assert m.citation('Publisher, Long country report title, 1 March 2024. Accessed: 2 April 2025')['publicationDates'] == ['2024-03-01']
    assert m.citation('Publisher, Long country report title, 1 March 2024. Accessed: 2 April 2025')['accessDates'] == ['2025-04-02']


def test_receipt_snapshot_stays_frozen_even_when_collector_changes(tmp_path):
    inventory, output, sha, edition = fixture(tmp_path)
    frozen=tmp_path/'frozen.json'
    url=edition['footnotes'][0]['links'][0]['url']
    write_json(frozen,{url:{'cache':str(inventory),'record':{'url':url,'status':'downloaded','sha256':sha}}})
    (inventory/'attempts.jsonl').write_text(json.dumps({'url':url,'status':'robots'})+'\n')
    result=runner.run(inventory,output,receipt_snapshot=frozen)
    assert result['checkStates']['quotation-exact:pass']==1


def test_review_grouping_retains_source_versions_and_context_for_wording():
    p={'sources':[{'url':'https://example.org/report','record':{'sha256':'a'*64}}]}
    c={'rule':'publication-date','state':'candidate','url':'https://example.org/report','cited':['2024-01-01'],'metadata':['2024-01-02']}
    assert runner.review_group(c,p,'context1')==runner.review_group(c,p,'context2')
    other=json.loads(json.dumps(p));other['sources'][0]['record']['sha256']='b'*64
    assert runner.review_group(c,p,'context1')!=runner.review_group(c,other,'context1')
    c['rule']='changed-number'
    assert runner.review_group(c,p,'context1')!=runner.review_group(c,p,'context2')
    assert runner.review_priority(c)==1
    c['rule']='publication-date'
    assert runner.review_priority(c)==3


def test_html_footnotes_need_explicit_targets_and_keep_bare_numbers():
    from lxml import html
    tree=html.fromstring('<article><p>The source reports 52 deaths among surveyed people.[52]</p><a href="#fn52">[52]</a><p id="fn52">52 First source.</p></article>')
    assert m.html_note_markers(tree)==[]
    tree=html.fromstring('<article><p>The source reports 52 deaths among surveyed people.<a href="#fn52">[52]</a></p><p id="fn52">52 First source.</p></article>')
    markers=m.html_note_markers(tree)
    text, removed=m.remove_notes(m.normal(tree.text_content()),markers)
    assert removed and '52 deaths' in text and 'people.[52]' not in text
    tree=html.fromstring('<article><p>The source reports 52 deaths among surveyed people.<a href="#missing">[52]</a></p></article>')
    assert m.html_note_markers(tree)==[]


def test_unproven_marker_shapes_are_gaps_but_real_number_changes_survive():
    q='The country survey found that 218 people did return to their original homes during the reporting period.'
    d=doc(q.replace('homes','homes[52]'))
    checks=m.quotation_checks('‘'+q+'’',d,'https://example.org/report')
    assert any(c['rule']=='source-furniture' and c['state']=='unable' for c in checks)
    assert not any(c['state']=='candidate' for c in checks)
    checks=m.quotation_checks('‘'+q+'’',doc(q.replace('218','281')),'https://example.org/report')
    assert any(c['rule']=='changed-number' and c['state']=='candidate' for c in checks)
    assert not m.marker_shaped_difference({'differences':[{'quoted':'218','source':'2180'}]})


def test_doi_citation_punctuation_does_not_become_identifier_conflict():
    d=doc('source');d['headers']=['Article doi:10.1371/journal.pone.0219125']
    checks=m.source_checks('Publisher, Long article report title, 1 March 2024, https://example.org?id=10.1371/journal.pone.0219125.','https://example.org/report',d)
    assert not any(c['rule']=='identifier-conflict' for c in checks)
    assert m.doi_values('10.1000/abc(def).')==['10.1000/abc(def)']


def test_pdf_marker_proof_requires_raised_span_and_matching_note():
    class Rect: height=100
    def span(text,y,flags=0): return {'text':text,'bbox':(0,y,10,y+5),'flags':flags}
    class Page:
        rect=Rect()
        def __init__(self, raised=True, note=True): self.raised=raised;self.note=note
        def get_text(self, kind):
            lines=[{'spans':[span('The survey found injuries.',20),span('25',19,1 if self.raised else 0),span(' More detail followed.',20)]}]
            if self.note: lines.append({'spans':[span('25',80),span(' Survey report reference.',80)]})
            return {'blocks':[{'lines':lines}]}
    assert len(m.pdf_note_markers(Page()))==1
    assert m.pdf_note_markers(Page(raised=False))==[]
    assert m.pdf_note_markers(Page(note=False))==[]


@pytest.mark.parametrize('quoted,source', [('40 names and over 80 people', 'forty names and over eighty people'), ('8 urban and 7 rural', 'eight urban and seven rural'), ('8,680 days and 5,326 days', '8 680 days and 5 326 days'), ('7.4% and 4.1%', '7,4% and 4,1%')])
def test_aligned_equivalent_numerals_are_observations_not_literal_passes(quoted, source):
    q = 'The detailed country survey reported ' + quoted + ' during the full reporting period for the country.'
    s = q.replace(quoted, source)
    checks = m.quotation_checks('‘'+q+'’', doc(s, 'pdf', s), 'https://example.org/source.pdf')
    assert not any(c['state'] == 'candidate' for c in checks)
    assert any(c['rule'] == 'quotation-number-format' and c['state'] == 'observation' for c in checks)
    assert not any(c['rule'] == 'quotation-exact' and c['state'] == 'pass' for c in checks)


@pytest.mark.parametrize('a,b,rule', [('40 names and 80 people', 'eighty names and forty people', 'changed-number'), ('40 names', 'forty thousand names', 'changed-unit'), ('−7.4%', '7,4%', 'changed-number'), ('40 million people', '40 billion people', 'changed-unit'), ('1979', '1967', 'changed-number'), ('40 people did return', 'forty people did not return', 'changed-negation')])
def test_format_cleanup_preserves_real_swaps_signs_scales_years_and_negation(a,b,rule):
    q = 'The detailed country survey reported that ' + a + ' were recorded during the full reporting period in this country.'
    checks=m.quotation_checks('‘'+q+'’',doc(q.replace(a,b)),'https://example.org/source')
    assert any(c['rule']==rule and c['state']=='candidate' for c in checks)


def test_ambiguous_grouping_is_not_approved_and_unit_typo_stays_wording_candidate():
    q='The detailed country survey reported that 1.234 people were recorded during the full reporting period in this country.'
    checks=m.quotation_checks('‘'+q+'’',doc(q.replace('1.234','1,234')),'https://example.org/source')
    assert any(c['rule']=='changed-number' and c['state']=='candidate' for c in checks)
    q=q.replace('1.234 people','20 milliion people')
    checks=m.quotation_checks('‘'+q+'’',doc(q.replace('milliion','million')),'https://example.org/source')
    assert any(c['rule']=='quotation-near-match' and c['state']=='candidate' for c in checks)
    assert not any(c['rule'] in {'changed-unit','changed-number'} and c['state']=='candidate' for c in checks)


def test_structural_html_accessible_labels_and_bracket_endnotes_keep_real_digits():
    from lxml import html
    for markup in ['<p>The survey found 980 registered organisations.<sup><a href="#fn24"><span>Footnote </span>24</a></sup> Most had closed.</p><dd id="fn24">Original survey report.</dd>', '<p>The survey found 980 registered organisations.<sup>108</sup> Most had closed.</p><p>[108] Original survey report.</p>']:
        tree=html.fromstring(markup)
        value,changes=m.remove_notes(tree.text_content(),m.html_note_markers(tree))
        assert changes and '980' in value
        assert 'organisations. most' in value
    assert m.html_note_markers(html.fromstring('<p>The area is 980 km<sup>2</sup> and the temperature changed.</p>'))==[]


def test_editorial_conversion_requires_a_separate_retained_footnote():
    q='The detailed country survey reported that the fee was 6,000 Iraqi dinars (3.39 GBP) during the full reporting period for all residents.'
    source=q.replace(' (3.39 GBP)','')
    raw=q.replace('GBP)','GBP[footnote 4])')
    f={'id':'fn:4','links':[{'url':'https://example.org/conversion'}]}
    checks=m.quotation_checks('‘'+q+'’',doc(source),'https://example.org/source',raw,[f])
    assert not any(c['rule']=='changed-number' and c['state']=='candidate' for c in checks)
    assert any(c['rule']=='editorial-insertion' and c['state']=='unable' for c in checks)
    checks=m.quotation_checks('‘'+q+'’',doc(source),'https://example.org/source')
    assert any(c['rule']=='changed-number' and c['state']=='candidate' for c in checks)
    # Editing the underlying fee must still survive the insertion routing.
    checks=m.quotation_checks('‘'+q+'’',doc(source.replace('6,000','7,000')),'https://example.org/source',raw,[f])
    assert any(c['rule']=='changed-number' and c['state']=='candidate' for c in checks)


def test_omitted_attribution_date_is_not_a_changed_quantity_but_stays_unassessed():
    q='The detailed country survey reported that a father can apply without the consent of the mother under the existing rules.'
    source=q.replace('mother under','mother (email, December 2014) under')
    checks=m.quotation_checks('‘'+q+'’',doc(source),'https://example.org/source')
    assert not any(c['rule']=='changed-number' and c['state']=='candidate' for c in checks)
    assert any(c['rule']=='quotation-attribution' and c['state']=='unable' for c in checks)
    assert any(c['rule']=='quotation-near-match' and c['state']=='candidate' for c in checks)


def test_same_stat_content_mutation_invalidates_resume(tmp_path):
    import os
    inventory,output,sha,edition=fixture(tmp_path)
    first=runner.run(inventory,output)
    path=inventory/'documents'/sha
    st=path.stat();content=path.read_bytes()
    path.write_bytes(bytes([content[0]^1])+content[1:]);os.utime(path,ns=(st.st_atime_ns,st.st_mtime_ns))
    assert m.stat_key(path)==[st.st_size,st.st_mtime_ns]
    changed=runner.run(inventory,output)
    assert changed['checkStates']['source-integrity:unable']==1
    assert 'quotation-exact:pass' not in changed['checkStates']


def test_derived_reading_tampering_is_rebuilt(tmp_path):
    import gzip
    inventory,output,sha,edition=fixture(tmp_path)
    args=(str(inventory),sha,tuple(m.stat_key(inventory/'documents'/sha)),tuple(m.stat_key(inventory/'text'/f'{sha}.json')))
    first=m.SourceReader(output).read(*args)
    path=next((output/'readings').glob('*.gz'))
    reading=json.loads(gzip.decompress(path.read_bytes()));reading['norm']='fabricated retained reading'
    path.write_bytes(gzip.compress(json.dumps(reading).encode()))
    assert m.SourceReader(output).read(*args)['norm']==first['norm']


@pytest.mark.parametrize('hours,gb', [(float('nan'),4),(float('inf'),4),(1,float('nan')),(0,4)])
def test_non_finite_or_non_positive_budgets_cannot_start(tmp_path,hours,gb):
    with pytest.raises(ValueError): runner.run(tmp_path/'inventory',tmp_path/'out',max_hours=hours,max_gb=gb)
    assert not (tmp_path/'out').exists()


def test_database_failure_releases_run_lock_and_reports_failure(tmp_path,monkeypatch):
    inventory,output,sha,edition=fixture(tmp_path)
    original=runner.connect
    monkeypatch.setattr(runner,'connect',lambda *a: (_ for _ in ()).throw(RuntimeError('database unavailable')))
    with pytest.raises(RuntimeError): runner.run(inventory,output)
    assert json.loads((output/'job.json').read_text())['state']=='failed'
    monkeypatch.setattr(runner,'connect',original)
    assert runner.run(inventory,output)['remaining']==0


@pytest.mark.parametrize('a,b', [('121 people','one hundred and twenty-one people'), ('8,680.','8 680.'), ('21 days','twenty-one days')])
def test_bounded_number_phrases_and_sentence_final_groups(a,b):
    q='The detailed country survey reported that '+a+' This continued during the full reporting period for the country.'
    checks=m.quotation_checks('‘'+q+'’',doc(q.replace(a,b)),'https://example.org/source')
    assert not any(c['state']=='candidate' for c in checks)
    assert any(c['rule']=='quotation-number-format' for c in checks)


def test_missing_percentage_notation_stays_unresolved_not_a_changed_digit():
    q='The detailed country survey reported that prevalence was 7.4% and 4.1% of respondents during the full reporting period.'
    checks=m.quotation_checks('‘'+q+'’',doc(q.replace('7.4%','7,4%').replace('4.1% of','4,1')),'https://example.org/source')
    assert not any(c['rule'] in {'changed-number','changed-unit'} and c['state']=='candidate' for c in checks)
    assert any(c['rule']=='quotation-unit-scope' and c['state']=='unable' for c in checks)
    assert any(c['rule']=='quotation-near-match' and c['state']=='candidate' for c in checks)


def test_resume_detects_same_stat_extraction_change(tmp_path):
    import os
    inventory,output,sha,edition=fixture(tmp_path)
    runner.run(inventory,output)
    path=inventory/'text'/f'{sha}.json';st=path.stat();raw=path.read_bytes()
    assert b'218' in raw
    path.write_bytes(raw.replace(b'218',b'281'));os.utime(path,ns=(st.st_atime_ns,st.st_mtime_ns))
    result=runner.run(inventory,output)
    assert result['checkStates']['changed-number:candidate']==1
    assert 'quotation-exact:pass' not in result['checkStates']


def test_empty_scope_reports_failure_instead_of_false_completion(tmp_path):
    inventory,output,sha,edition=fixture(tmp_path)
    with pytest.raises(ValueError,match='No eligible linked blocks'): runner.run(inventory,output,country='absent')
    assert json.loads((output/'job.json').read_text())['state']=='failed'


def test_lock_collision_keeps_existing_job_untouched(tmp_path):
    import fcntl
    inventory,output,sha,edition=fixture(tmp_path)
    write_json(output/'job.json',{'state':'running','pid':12345})
    with (output/'run.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        with pytest.raises(BlockingIOError): runner.run(inventory,output)
        assert json.loads((output/'job.json').read_text())=={'state':'running','pid':12345}
    assert runner.run(inventory,output)['remaining']==0


def test_editorial_proof_is_part_of_reuse_key_but_renumbering_can_reuse(tmp_path):
    inventory,output,sha,edition=fixture(tmp_path)
    c=edition['claims'][0];c['text']=c['text'].replace('218 people','218 people (3.39 GBP[footnote 4])');c['footnotes']+=['fn:4']
    edition['footnotes'].append({'id':'fn:4','number':4,'text':'Conversion source','links':[{'url':'https://example.org/conversion'}]})
    second=json.loads(json.dumps(edition));second['editionId']='c'*16;second['textSha']='d'*64
    second['claims'][0]['text']=second['claims'][0]['text'].replace('footnote 4','footnote 9')
    second['claims'][0]['footnotes'][-1]='fn:9';second['footnotes'][-1]['id']='fn:9';second['footnotes'][-1]['number']=9
    write_json(inventory/'index/test.json',edition);write_json(inventory/'index/second.json',second)
    write_json(inventory/'inventory.json',{'index_paths':['index/test.json','index/second.json']})
    assert runner.run(inventory,output)['distinctComputations']==1
    second['claims'][0]['text']=second['claims'][0]['text'].replace('(3.39 GBP[footnote 9])','(3.39 GBP)[footnote 9]')
    write_json(inventory/'index/second.json',second)
    assert runner.run(inventory,output)['distinctComputations']==2


def test_pdf_notes_are_separate_from_body_and_legal_superscripts(tmp_path):
    import pymupdf
    from cpin.source_collect import extracted
    pdf=pymupdf.open();page=pdf.new_page(width=400,height=400)
    page.insert_text((30,60),'The detailed country survey found injuries.',fontsize=12)
    page.insert_text((261,56),'1',fontsize=7)
    page.insert_text((270,60),' Further detail.',fontsize=12)
    page.insert_text((30,90),'The legal provision is Article 239',fontsize=12)
    page.insert_text((202,86),'1',fontsize=7)
    page.insert_text((212,90),' in the law.',fontsize=12)
    page.insert_text((30,350),'1 This report was finalised on 17 June.',fontsize=8)
    data=pdf.tobytes();pdf.close();sha=hashlib.sha256(data).hexdigest()
    cache=tmp_path/'cache';(cache/'documents').mkdir(parents=True)
    (cache/'documents'/sha).write_bytes(data)
    write_json(cache/'text'/f'{sha}.json',extracted(data,'application/pdf','https://example.org/source.pdf'))
    def read(): return m.SourceReader(tmp_path/'out').read(str(cache),sha,tuple(m.stat_key(cache/'documents'/sha)),tuple(m.stat_key(cache/'text'/f'{sha}.json')))
    result=read()
    assert 'this report was finalised' in result['norm']
    assert 'this report was finalised' not in result['comparisonNorm']
    assert '2391' in result['comparisonNorm'].replace(' ','')
    assert any('bottomNote' in f for f in result['furniture'])
    extraction=json.loads((cache/'text'/f'{sha}.json').read_text());extraction['pages']+=extraction['pages']
    write_json(cache/'text'/f'{sha}.json',extraction)
    assert read()['problem']=='invalid-or-duplicate-extracted-page'


@pytest.mark.parametrize('a,b', [('10 million and 20 billion','10 billion and 20 million'), ('10% and 20','10 and 20%')])
def test_unit_assignments_cannot_hide_in_matching_totals(a,b):
    q='The detailed country survey reported that '+a+' were recorded during the full reporting period in this country.'
    checks=m.quotation_checks('‘'+q+'’',doc(q.replace(a,b)),'https://example.org/source')
    assert any(c['rule']=='changed-unit' and c['state']=='candidate' for c in checks)


def test_retained_attribution_is_not_removed_from_one_side():
    q='The detailed country survey reported that a father can apply (email, December 2014) without consent under the existing rules.'
    checks=m.quotation_checks('‘'+q+'’',doc(q.replace('can apply','can usually apply')),'https://example.org/source')
    assert not any(c['rule']=='changed-number' and c['state']=='candidate' for c in checks)
    assert not any(c['rule']=='quotation-attribution' for c in checks)


def test_mid_batch_time_stop_commits_progress_and_can_resume(tmp_path,monkeypatch):
    inventory,output,sha,edition=fixture(tmp_path)
    second=json.loads(json.dumps(edition));second['editionId']='c'*16;second['textSha']='d'*64
    write_json(inventory/'index/second.json',second)
    write_json(inventory/'inventory.json',{'index_paths':['index/test.json','index/second.json']})
    clock={'value':0};original=m.screen
    monkeypatch.setattr(runner.time,'monotonic',lambda:clock['value'])
    def slow(*a):
        result=original(*a);clock['value']=4000;return result
    monkeypatch.setattr(m,'screen',slow)
    result=runner.run(inventory,output,max_hours=1)
    assert result['screened']==result['remaining']==1
    assert json.loads((output/'job.json').read_text())['state']=='time-budget-stopped'
    monkeypatch.setattr(m,'screen',original)
    assert runner.run(inventory,output,max_hours=1)['remaining']==0


def test_unlinked_html_superscript_exponent_is_preserved_even_with_matching_endnote():
    from lxml import html
    tree=html.fromstring('<p>The affected area was 980 km<sup>2</sup> during the period.</p><p>[2] A separate cited source.</p>')
    assert m.html_note_markers(tree)==[]
