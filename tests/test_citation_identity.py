import hashlib
import importlib.util
import json
from pathlib import Path

from cpin.store import write_json

spec = importlib.util.spec_from_file_location('check_citation_identity', Path(__file__).parents[1] / 'scripts/check_citation_identity.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def test_citation_date_excludes_access_date_and_retains_source_pinpoint():
    citation = 'Publisher, ‘Country conditions and human rights’, 12 March 2024 (paragraph 31). Last accessed: 15 April 2026'
    result = module.expected(citation)
    assert result['title'] == 'Country conditions and human rights'
    assert result['publicationDate'] == '2024-03-12'
    assert module.expected('Publisher, Report, 31 February 2024')['publicationDate'] is None
    assert module.expected('Publisher, Report, 1 January 2023 and 2 January 2024')['publicationDate'] is None


def test_unquoted_title_and_ambiguous_titles_are_kept_separate():
    assert module.expected('Publisher, Country conditions and human rights, 12 March 2024')['title'] == 'Country conditions and human rights'
    assert module.expected('Publisher, ‘First detailed country report’ and ‘Second detailed country report’, 12 March 2024')['title'] is None
    assert module.expected('Ibid., page 12')['title'] is None


def test_title_signal_is_narrow_and_truncation_does_not_pass():
    assert module.title_signal('Country conditions and human rights', ['COUNTRY CONDITIONS\nand human rights']) == 'located-in-front-matter'
    assert module.title_signal('Country conditions and human rights', ['Access denied']) == 'not-located-needs-review'
    assert module.title_signal('Country conditions…', ['Country conditions and human rights']) == 'truncated-title-needs-review'
    assert module.date_signal('2024-03-12', ['2025-03-12']) == 'metadata-conflict-needs-review'
    assert module.date_signal('2024-03-12', []) == 'publication-metadata-unavailable'


def test_audit_never_turns_metadata_signals_or_missing_bytes_into_findings(tmp_path):
    out = tmp_path / 'out'
    url = 'https://example.org/report'
    content = b'<html><head><title>Country conditions and human rights</title><meta property="article:published_time" content="2025-03-12T00:00:00Z"></head><body>Evidence</body></html>'
    digest = hashlib.sha256(content).hexdigest()
    (out / 'documents').mkdir(parents=True)
    (out / 'documents' / digest).write_bytes(content)
    write_json(out / 'text' / f'{digest}.json', {'kind': 'html', 'title': 'Country conditions and human rights', 'text': 'Evidence'})
    (out / 'attempts.jsonl').write_text(json.dumps({'url': url, 'status': 'downloaded', 'sha256': digest}) + '\n')
    write_json(out / 'source-quality.json', {'sources': {url: {'readable_source': True}}})
    write_json(out / 'inventory.json', {'index_paths': ['index/test.json']})
    citation = 'Publisher, Country conditions and human rights, 12 March 2024 (paragraph 31)'
    edition = {'country': 'test', 'series': 'test', 'editionId': 'a'*16, 'textSha': 'b'*64,
               'footnotes': [{'number': 1, 'text': citation, 'links': [{'url': url}]}]}
    write_json(out / 'index/test.json', edition)
    result = module.audit(out)
    row = json.loads((out / 'citation-identity-triage.jsonl').read_text())
    assert row['sources'][0]['titleSignal'] == 'located-in-front-matter'
    assert row['sources'][0]['dateSignal'] == 'metadata-conflict-needs-review'
    assert row['assessment'] is None and row['contextChecked'] is False
    assert row['citation'] == citation and row['target']['textSha'] == 'b'*64
    assert result['networkRequests'] == result['modelCalls'] == result['publishedFindings'] == 0
    (out / 'documents' / digest).write_bytes(b'corrupted')
    assert module.audit(out)['integrityIssues'][0]['problem'] == 'source-hash-mismatch'
