"""Prepare attributed OGL review excerpts from held original PDFs, without network.

The explicit manifest supplies edition declarations and licensed works. This is
an evidence preparation tool, not an error detector or a reviewer-merits check.
Ambiguous cells/roles are retained as private gaps, never guessed into flags.
"""
import argparse
import collections
import hashlib
import json
import math
import re
import subprocess
import sys
import tempfile
from pathlib import Path

import pymupdf
from lxml import html

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from cpin.fingerprint import text_sha256

FIELDS = ("country", "series", "editionId", "textSha")
PREFIX = "published-comment-"


def normalise(text):
    return " ".join(text.replace("\x07", "").replace("\x08", "").split())


def compact(text):
    return "".join(normalise(text).split()).replace("\u00ad", "")


def cropped_poppler(pdf, page, rect):
    x, y = math.floor(rect.x0), math.floor(rect.y0)
    command = ["pdftotext", "-f", str(page), "-l", str(page), "-r", "72",
               "-x", str(x), "-y", str(y), "-W", str(math.ceil(rect.x1) - x),
               "-H", str(math.ceil(rect.y1) - y), "-layout", str(pdf), "-"]
    result = subprocess.run(command, capture_output=True, text=True, timeout=20, check=True)
    return normalise(result.stdout)


def excerpt(text, limit=55):
    # Nested source quotations are outside the Crown licence unless separately
    # cleared. Stop before an opening quotation or a source-introducing colon.
    text = normalise(text)
    cut = re.search(r'[“"‘]|:(?:\s|$)', text)
    if cut:
        text = text[:cut.start()].rstrip()
    words = text.split()
    if len(words) < 8:
        return ""
    result = " ".join(words[:limit])
    return result + (" …" if result != normalise(text) else "")


def inline_anchors(argument, root):
    # Three-part numbers at the start of a comment identify CPIN paragraphs;
    # two-part reviewer numbering and loose references elsewhere do not.
    opening = re.match(r"^(?:Paragraphs?\s+)?(\d{1,2}\.\d{1,2}\.\d{1,2})(?!\d)", argument, re.I)
    if not opening:
        return []
    refs = [opening[1]]
    following = argument[opening.end():]
    pair = re.match(r"\s*(?:and|&)\s+(\d{1,2}\.\d{1,2}\.\d{1,2})(?!\d)", following)
    if pair:
        refs.append(pair[1])
    anchors = []
    for ref in refs:
        ps = [p for p in root.xpath("//p") if re.match(re.escape(ref) + r"(?:\s|\.)", normalise(p.text_content()))]
        if len(ps) == 1:
            anchors.append({"type": "paragraph", "paragraph": ref,
                            "quote": normalise(ps[0].text_content())[:220]})
    return anchors


def prepare(manifest, cache, journal):
    journal.mkdir(parents=True, exist_ok=True)
    # qpdf changes display rotation only. Retain the original hash and verify
    # original text before any excerpt; Poppler reads the coordinate-normalised
    # copy independently. Otherwise landscape pages become transposed tables.
    with tempfile.TemporaryDirectory(prefix=".review-reading-", dir=journal) as scratch:
        return prepare_with_readings(manifest, cache, journal, Path(scratch))


def prepare_with_readings(manifest, cache, journal, scratch):
    records, receipts, gaps = [], [], []
    for work in manifest["works"]:
        pdf = cache / work["sha256"]
        assert hashlib.sha256(pdf.read_bytes()).hexdigest() == work["sha256"], work["workId"]
        reading_pdf = scratch / (work["sha256"] + ".pdf")
        subprocess.run(["qpdf", str(pdf), "--rotate=0", str(reading_pdf)], capture_output=True, check=True, timeout=60)
        reading_sha = hashlib.sha256(reading_pdf.read_bytes()).hexdigest()
        original = pymupdf.open(pdf)
        doc = pymupdf.open(reading_pdf)
        licence = doc[work["licencePage"] - 1].get_text()
        second = cropped_poppler(reading_pdf, work["licencePage"], doc[work["licencePage"] - 1].rect)
        assert "Open Government Licence v3.0" in normalise(licence), work["workId"]
        assert "Open Government Licence v3.0" in second, work["workId"]
        for group in work["groups"]:
            bodies = {}
            for target in group["targets"]:
                raw = (ROOT / target["path"]).read_bytes()
                assert hashlib.sha256(raw).hexdigest() == target["bodySha"], target["editionId"]
                assert text_sha256(raw.decode()) == target["textSha"], target["editionId"]
                bodies[target["editionId"]] = html.fromstring(raw.decode())
            covered, skipped = [], []
            roles = [(tuple(r["signature"]), r["physicalPage"]) for r in work.get("columnRoles", [])]
            # A continuation page need not repeat its table heading. Bind it
            # to the same column boundaries as an explicit response header in
            # this exact review section; never infer roles from prose alone.
            for pn in range(group["firstPage"], group["lastPage"] + 1):
                pg = doc[pn - 1]
                for tb in pg.find_tables().tables:
                    if tb.col_count != 2:
                        continue
                    rows = tb.extract()
                    for rn, rw in enumerate(rows[:2]):
                        if re.fullmatch(r"Home Office responses?\s*", normalise(rw[1] or ""), re.I):
                            cs = tb.rows[rn].cells
                            if cs[0] and cs[1]:
                                roles.append((tuple(cs[0][i] for i in (0, 2)) + (cs[1][2],), pn))
            for page_number in range(group["firstPage"], group["lastPage"] + 1):
                page = doc[page_number - 1]
                count = 0
                for table_number, table in enumerate(page.find_tables().tables):
                    # Three-column layouts need their own role decision. Never
                    # combine a reviewer column with an adjacent reply column.
                    if table.col_count != 2:
                        continue
                    cells = table.extract()
                    header = normalise(" ".join(str(c or "") for row in cells[:2] for c in row)).casefold()
                    # Continuation pages may repeat no header; the page's right
                    # response heading still establishes the column role.
                    right_headers = [r for r in page.search_for("Home Office response") if r.x0 > page.rect.width * .5]
                    bounds = next((rw.cells for rw in table.rows if rw.cells[0] and rw.cells[1]), None)
                    pattern = (bounds[0][0], bounds[0][2], bounds[1][2]) if bounds else None
                    role_page = next((pn for signature, pn in roles if pattern and all(abs(a-b) < 2 for a, b in zip(signature, pattern))), None)
                    if "home office response" not in header and not right_headers and role_page is None:
                        continue
                    for row_number, row in enumerate(cells):
                        left = normalise(row[0] or "")
                        if len(left.split()) < 8 or re.search(r"COI requests?|COIRs?", left, re.I):
                            continue
                        if re.match(r"(?:Comments and recommendations|Reviewer.?s? comments|Main\s+(?:suggestions|recommendations))", left, re.I):
                            continue
                        rects = table.rows[row_number].cells
                        if not rects[0]:
                            continue
                        rect = pymupdf.Rect(rects[0])
                        raw = original[page_number - 1].get_textbox(rect)
                        independent = cropped_poppler(reading_pdf, page_number, rect)
                        quote = excerpt(independent)
                        reason = ""
                        if compact(left) != compact(raw) or compact(left) != compact(independent):
                            reason = "Cell readers disagree; no excerpt or reply published"
                        elif not quote:
                            reason = "No sufficiently long reviewer-owned prefix before a nested quotation"
                        if reason:
                            gaps.append({"workId": work["workId"], "page": page_number,
                                         "table": table_number, "row": row_number, "reason": reason})
                            continue
                        # Keep replies only when a non-merged right cell agrees
                        # between the original PDF and independent reader.
                        response, response_proof = "", None
                        right = normalise(row[1] or "")
                        if right and rects[1] and not re.search(r"Reviewer.?s? response|Reviewer response", right, re.I):
                            rr = pymupdf.Rect(rects[1])
                            same_row = abs(rr.y0 - rect.y0) < 1 and abs(rr.y1 - rect.y1) < 1
                            right_raw = normalise(original[page_number - 1].get_textbox(rr))
                            right_second = cropped_poppler(reading_pdf, page_number, rr)
                            if same_row and compact(right) == compact(right_raw) == compact(right_second):
                                response = excerpt(right_second, 80)
                                if response:
                                    response_proof = {"bbox": list(rr), "original": right_raw, "poppler": right_second}
                        targets = []
                        for target in group["targets"]:
                            anchors = inline_anchors(independent, bodies[target["editionId"]])
                            targets.append({**{k: target[k] for k in FIELDS}, **({"anchors": anchors} if anchors else {})})
                        key = hashlib.sha256(json.dumps([work["workId"], work["sha256"], page_number, table_number, row_number]).encode()).hexdigest()[:24]
                        url = work["url"] + "#page=" + str(page_number)
                        record = {"id": PREFIX + key, "kind": "external", "status": "context", "collapsible": True,
                                  "summary": "PDF page " + str(page_number) + " · " + " ".join(quote.split()[:12]) + ("…" if len(quote.split()) > 12 else ""),
                                  "author": group["author"], "organisation": "IAGCI / Independent Chief Inspector of Borders and Immigration",
                                  "publishedAt": work["publishedAt"],
                                  "publication": {"title": work["title"], "url": url, "location": "Physical PDF page " + str(page_number)},
                                  "evidence": {"quote": quote, "url": url, "title": "Reviewer’s words · extract",
                                               "publicDisplayApproved": True,
                                               "rightsBasis": "Crown copyright, Open Government Licence v3.0; original licence on physical PDF page " + str(work["licencePage"]) + "; nested third-party quotations excluded."},
                                  "targets": targets, "scope": "Attributed recommendation; not independently verified and no severity assigned."}
                        if response:
                            record.update(response=response, responseIsExcerpt=True)
                        records.append(record)
                        receipts.append({"id": record["id"], "workId": work["workId"], "reviewSha256": work["sha256"],
                                         "readingSha256": reading_sha, "readingTransform": "qpdf --rotate=0 (display metadata only); original text also checked",
                                         "columnRoleHeaderPage": role_page or page_number,
                                         "page": page_number, "table": table_number, "row": row_number,
                                         "bbox": list(rect), "original": normalise(raw), "poppler": independent,
                                         "responseProof": response_proof, "targets": targets})
                        count += 1
                if count:
                    covered.append(page_number)
                else:
                    skipped.append(page_number)
            # A complete section page index makes skipped/interleaved material
            # reachable without republishing uncertain text or assigning flags.
            key = hashlib.sha256(json.dumps([work["workId"], group["firstPage"], group["lastPage"]]).encode()).hexdigest()[:24]
            records.append({"id": PREFIX + "section-" + key, "kind": "external", "status": "context", "collapsible": True,
                            "summary": "Read the full review section · pages " + str(group["firstPage"]) + "–" + str(group["lastPage"]),
                            "author": group["author"], "organisation": "IAGCI / ICIBI", "publishedAt": work["publishedAt"],
                            "publication": {"title": work["title"], "url": work["url"] + "#page=" + str(group["firstPage"])},
                            "reviewPages": [{"page": n, "url": work["url"] + "#page=" + str(n)} for n in range(group["firstPage"], group["lastPage"] + 1)],
                            "summaryDetail": "This includes the original recommendations, context and responses. Excerpts are selective; pages without a safely separated comment remain available here. A recommendation or an accepted reply is not proof of an error.",
                            "targets": [{k: t[k] for k in FIELDS} for t in group["targets"]]})
        doc.close()
        original.close()
        reading_pdf.unlink()
        print(work["workId"], len(records), flush=True)
    journal.mkdir(parents=True, exist_ok=True)
    (journal / "comment-receipts.json").write_text(json.dumps(receipts, ensure_ascii=False, indent=2) + "\n")
    (journal / "comment-gaps.json").write_text(json.dumps(gaps, ensure_ascii=False, indent=2) + "\n")
    summary = {"records": len(records), "originalExcerpts": len(receipts),
               "replies": sum(bool(x.get("responseProof")) for x in receipts),
               "inlineApplications": sum(len(t.get("anchors", [])) for r in records for t in r["targets"]),
               "works": len(manifest["works"]), "gapReasons": dict(collections.Counter(x["reason"] for x in gaps)),
               "networkRequests": 0, "modelCalls": 0, "meritsVerified": False}
    (journal / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    print(summary)
    return records


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=ROOT / "config/review-comment-scopes.json")
    parser.add_argument("--cache", type=Path, default=ROOT / "data/review-evidence/documents")
    parser.add_argument("--journal", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True, help="Prepared records only; does not mutate the live whitelist")
    args = parser.parse_args()
    records = prepare(json.loads(args.manifest.read_text()), args.cache, args.journal)
    args.out.write_text(json.dumps(records, ensure_ascii=False, indent=2) + "\n")


if __name__ == "__main__":
    main()
