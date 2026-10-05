"""Pipeline failures must reach GitHub's final failure gate, after retained data is committed."""
from types import SimpleNamespace

from cpin import cli, export, pdftext, webpdf


def args(tmp_path, **changes):
    return SimpleNamespace(**(dict(sheets=None, figures=False, check=False, country=[], limit=None,
                                  force=False, report=str(tmp_path / 'report.json'), page=None, workers=2) | changes))


def test_missing_pdf_text_fails_without_discarding_retained_data(store, tmp_path, monkeypatch):
    monkeypatch.setattr(export, 'pdf_only_files', lambda _: [('kenya', 'An edition', 'https://example.org/note.pdf')])
    monkeypatch.setattr(export, 'recovered_pdf_jobs', lambda _: [])
    store.save_pdf_manifest({'https://example.org/note.pdf': {'sha256': 'missing'}})
    before = store.load_pdf_manifest()
    assert cli.cmd_pdftext(args(tmp_path), store) == 1
    assert store.load_pdf_manifest() == before


def test_an_extraction_check_failure_fails_the_command(store, tmp_path, monkeypatch):
    monkeypatch.setattr(pdftext, 'check_pairs', lambda _: {'kenya/report': {'error': 'Cannot read PDF'}})
    assert cli.cmd_pdftext(args(tmp_path, check=True), store) == 1


def test_a_figure_failure_fails_the_command(store, tmp_path, monkeypatch):
    monkeypatch.setattr(pdftext, 'missing_figures_into_store', lambda *a, **kw:
                        dict(pairs=1, figures=0, unplaced=0, errors=1))
    assert cli.cmd_pdftext(args(tmp_path, figures=True), store) == 1


def test_a_comparison_failure_fails_the_command(store, tmp_path, monkeypatch):
    monkeypatch.setattr(webpdf, 'compare_into_store', lambda *a, **kw:
                        dict(records=[], done=0, done_before=0, errors=['Cannot read PDF']))
    monkeypatch.setattr(webpdf, 'summarise', lambda _: {})
    monkeypatch.setattr(webpdf, 'table', lambda _: [])
    assert cli.cmd_compare(args(tmp_path), store) == 1
