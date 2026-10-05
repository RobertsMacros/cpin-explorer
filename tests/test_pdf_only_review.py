"""A generated PDF verifies the offline source audit, including its independent reader."""
import hashlib
import json
from pathlib import Path
import runpy
import shutil

import pymupdf
import pytest

from cpin import pdftext


@pytest.fixture
def audit_pdf(tmp_path):
    folder = tmp_path / "pdfs"
    (folder / "files").mkdir(parents=True)
    (folder / "text").mkdir()
    doc = pymupdf.open()
    page = doc.new_page()
    page.insert_text((72, 120), "1.1 The original source text is retained in the extracted reader.", fontsize=12)
    page.insert_text((72, 160), "1.2 A second complete paragraph provides independent source evidence.", fontsize=12)
    page.insert_text((420, 200), "Back to Contents", fontsize=10)
    page.insert_text((275, 715), "Page 1 of 1", fontsize=8)
    data = doc.tobytes()
    doc.close()
    sha = hashlib.sha256(data).hexdigest()
    path = folder / "files" / f"{sha}.pdf"
    path.write_bytes(data)
    result = pdftext.pdf_to_html(path)
    (folder / "text" / f"{sha}.html").write_text(result.html)
    (folder / "text" / f"{sha}.json").write_text(json.dumps(result.meta))
    return tmp_path, sha, data


def _auditor():
    return runpy.run_path(str(Path(__file__).resolve().parents[1] / "scripts/review_pdf_only.py"))["_audit"]


@pytest.mark.skipif(not shutil.which("pdftotext"), reason="independent reading requires Poppler")
def test_audit_confirms_omissions_with_both_readers_and_preserves_the_original(audit_pdf):
    root, sha, original = audit_pdf
    record = _auditor()((str(root), sha, [], None))
    assert record["after"]["source_phrase_coverage"] == 1
    assert record["omissions"] == {"navigation: both readings": 1, "page number: both readings": 1}
    assert record["unsettled_omissions"] == []
    assert (root / "pdfs/files" / f"{sha}.pdf").read_bytes() == original


def test_audit_refuses_a_corrupted_source_before_reading_it(audit_pdf):
    root, sha, _ = audit_pdf
    (root / "pdfs/files" / f"{sha}.pdf").write_bytes(b"corrupted")
    with pytest.raises(ValueError, match="PDF hash mismatch"):
        _auditor()((str(root), sha, [], None))


def test_token_loss_check_separates_rebuilt_footnotes_from_raised_source_wording():
    normalise = runpy.run_path(str(Path(__file__).resolve().parents[1] / "scripts/review_pdf_only.py"))["_unlinked_marks"]
    body = ('<p>propaganda<sup>18</sup>. A raised quotation <sup>not 18</sup> and exponent <sup>9</sup>.</p>'
            '<p><sup>(18)</sup> Source title.</p>'
            '<p><sup id="fnref:18"><a href="#fn:18">[footnote 18]</a></sup></p>')
    result, marks = normalise(body, {"18"})
    assert marks == {"18": 2}
    assert "propaganda." in result and "<sup>(18)</sup>" not in result
    assert "<sup>not 18</sup>" in result and "<sup>9</sup>" in result
    assert '<sup id="fnref:18">' in result
