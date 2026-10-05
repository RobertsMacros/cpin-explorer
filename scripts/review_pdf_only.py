"""Offline audit of PDF-only reader text against raw PyMuPDF and independent Poppler readings.

This is extraction evidence, not a claim that either publication differs in wording. Furniture
omissions retain their page, text and coordinates in each extraction's metadata. Source errors,
tables, footnote ordering and text-layer faults can still need manual inspection.
"""
import argparse
from collections import Counter
from concurrent.futures import ProcessPoolExecutor
import hashlib
import html
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from cpin import pdftext, webpdf
from cpin.export import pdf_only_files, recovered_pdf_jobs
from cpin.store import Store, now_iso, write_json


def _grams(tokens):
    return {tuple(tokens[i:i + 5]) for i in range(max(0, len(tokens) - 4))}


def _text_words(body):
    blocks, _ = webpdf.blocks(body)
    return [word for block in blocks for word in webpdf.words(block["text"])]


def _unlinked_marks(body, linked_numbers):
    """For the token-loss check only, treat a plain numeric superscript like its rebuilt footnote.
    Keep other raised wording and numbers without a corresponding reconstructed source note.
    """
    found = Counter()
    def mark(match):
        attrs, inner = match.groups()
        if re.search(r'\bid=["\']fnref:', attrs):
            return match.group()
        text = html.unescape(re.sub(r"<[^>]+>", "", inner)).strip()
        number = re.fullmatch(r"\(?\s*(\d{1,4})\s*\)?", text)
        if number and number[1] in linked_numbers:
            found[number[1]] += 1
            return ""
        return match.group()
    return re.sub(r"<sup\b([^>]*)>(.*?)</sup>", mark, body, flags=re.S), found


def _audit(job):
    root, sha, labels, before = job
    store = Store(root)
    path = store.pdf_path(sha)
    if hashlib.sha256(path.read_bytes()).hexdigest() != sha:
        raise ValueError(f"PDF hash mismatch: {sha}")
    folder = Path(root) / "pdfs" / "text"
    meta = json.loads((folder / f"{sha}.json").read_text())
    if meta.get("extractor") != pdftext.EXTRACTOR or meta.get("no_text_layer"):
        raise ValueError(f"Extraction missing or stale: {sha}")
    after_body = (folder / f"{sha}.html").read_text()
    after_words = _text_words(after_body)
    if not after_words:
        raise ValueError(f"Empty extraction: {sha}")
    raw = webpdf.read_pdf(path)
    # Older notes enclose a raised footnote mark in parentheses. Normalise those marks in the
    # no-mark/flow readings too; keep the untouched page text for omission verification below.
    for page in raw["pages"]:
        for line in page["lines"]:
            line["runs"] = [(" " if raised and re.fullmatch(r"\s*\(\d{1,4}\)\s*", text) else text, size, raised)
                            for text, size, raised in line["runs"]]
    readings = webpdf._readings(raw)
    # Unlike the publication comparison, retain page furniture in the independent reading.
    second = subprocess.run(["pdftotext", "-layout", "-enc", "UTF-8", str(path), "-"],
                            capture_output=True, timeout=300, check=True)
    second_pages = [webpdf.words(p) for p in second.stdout.decode("utf-8", "replace").split("\f")]
    source_grams = set().union(*(_grams(readings[name].split()) for name in ("plain", "nomark", "flow")),
                               *(_grams(p) for p in second_pages))
    def coverage(tokens):
        grams = _grams(tokens)
        return {"words": len(tokens), "five_word_phrases": len(grams),
                "phrases_found_in_source": len(grams & source_grams),
                "source_phrase_coverage": round(len(grams & source_grams) / max(1, len(grams)), 6)}
    omissions, unsettled = Counter(), []
    raw_pages = [webpdf.words(p["text"]) for p in raw["pages"]]
    raw_counts, second_counts = [Counter(p) for p in raw_pages], [Counter(p) for p in second_pages]
    for omission in meta.get("omitted_furniture", []):
        pno, want = omission["page"] - 1, webpdf.words(omission["text"])
        count = Counter(want)
        first = webpdf._has(want, raw_pages[pno])
        independent = webpdf._has(want, second_pages[pno])
        # Contents tables may be read down their columns. Verify their words on the same page,
        # but keep this separate from a confirmation of phrase order or publication wording.
        first_ordered = first
        second_ordered = independent
        if omission["kind"] == "contents":
            first = first or not (count - raw_counts[pno])
            independent = independent or not (count - second_counts[pno])
        verdict = "both readings" if first and independent else "unsettled"
        omissions[f'{omission["kind"]}: {verdict}'] += 1
        if verdict == "unsettled":
            unsettled.append({**omission, "raw": first, "second": independent})
        elif not (first_ordered and second_ordered):
            omissions["contents: words confirmed, order differs"] += 1
    result = {"sha256": sha, "editions": labels, "pages": len(raw_pages), "extractor": meta["extractor"],
              "after": coverage(after_words), "omissions": dict(omissions), "unsettled_omissions": unsettled,
              "warnings": meta.get("warnings", []),
              "layout_after": {k: meta.get(k) for k in ("headings", "paragraphs", "tables", "figures", "footnotes")}}
    snapshot = Path(before) / f"{sha}.html" if before else None
    if snapshot and snapshot.exists():
        old_body = snapshot.read_text()
        old = _text_words(old_body)
        result["before"] = coverage(old)
        result["word_delta"] = len(after_words) - len(old)
        result["changed"] = old != after_words
        old_meta = snapshot.with_suffix(".json")
        if old_meta.exists():
            old_meta = json.loads(old_meta.read_text())
            result["layout_before"] = {k: old_meta.get(k) for k in result["layout_after"]}
        allowance = Counter(word for o in meta.get("omitted_furniture", []) for word in webpdf.words(o["text"]))
        linked_numbers = set(re.findall(r'\bid=["\']fn:(\d+)["\']', after_body))
        old_normal, old_marks = _unlinked_marks(old_body, linked_numbers)
        new_normal, new_marks = _unlinked_marks(after_body, linked_numbers)
        result["footnote_marks_rebuilt"] = dict(old_marks - new_marks)
        unexplained = (Counter(_text_words(old_normal)) - Counter(_text_words(new_normal))) - allowance
        result["removed_words_outside_furniture"] = dict(unexplained)
    elif before:
        result["before_unavailable"] = True
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, default=Path("data"))
    parser.add_argument("--before", type=Path, help="directory of untouched pre-change HTML snapshots")
    parser.add_argument("--output", type=Path, default=Path("data/pdf-only-review.json"))
    parser.add_argument("--workers", type=int, default=3)
    args = parser.parse_args()
    if not shutil.which("pdftotext"):
        parser.error("Poppler's pdftotext must be installed for the independent reading")
    store = Store(args.data)
    manifest, editions = store.load_pdf_manifest(), {}
    jobs = [(country, title, url, manifest.get(url)) for country, title, url in pdf_only_files(store)]
    jobs += list(recovered_pdf_jobs(store))
    for country, title, url, entry in jobs:
        if not entry:
            raise ValueError(f"Missing PDF manifest entry: {country}: {title}")
        editions.setdefault(entry["sha256"], []).append({"country": country, "title": title, "url": url})
    tasks = [(str(args.data), sha, labels, str(args.before) if args.before else None)
             for sha, labels in sorted(editions.items())]
    with ProcessPoolExecutor(max_workers=args.workers) as pool:
        records = []
        for record in pool.map(_audit, tasks):
            records.append(record)
            if len(records) % 50 == 0:
                print(f"audited {len(records)}/{len(tasks)} PDFs", flush=True)
    totals = Counter()
    for record in records:
        totals.update(record["omissions"])
    report = {"checked_at": now_iso(), "extractor": pdftext.EXTRACTOR, "method": "pdf-only-source-audit-3",
              "scope": "All current, withdrawn and recovered PDF-only editions; source PDFs unchanged",
              "limits": "Phrase coverage is an extraction diagnostic, not a measure of real wording differences. "
                        "Both readers can share faults in the PDF's own text layer. Unsettled omissions and "
                        "extractor warnings need manual review; forms, source errors and quotations remain source content.",
              "edition_jobs": len(jobs), "distinct_pdfs": len(records), "omissions": dict(totals),
              "before_snapshots": sum("before" in r for r in records),
              "changed_pdfs": sum(r.get("changed", False) for r in records), "records": records}
    write_json(args.output, report)
    print(json.dumps({k: v for k, v in report.items() if k != "records"}, indent=2))


if __name__ == "__main__":
    main()
