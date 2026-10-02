"""Checks that the mirror is complete and verbatim.

  integrity  every stored body and PDF still hashes to the sha256 recorded for it
  complete   every country the collection lists, and every note and PDF its publication lists,
             is stored
  live       (optional) a fresh fetch of each current note is byte-identical to the stored body
  pdf        (optional) the sentences of each HTML note are found in its PDF edition
"""
import difflib
import re
import unicodedata
from collections import Counter

from lxml import html as lxml_html

from .fingerprint import sha256_bytes
from .govuk import api_url, collection_documents, file_attachments, html_attachments, note_slug, split_item
from .images import current_image_refs
from .links import extract_links
from .pdfs import is_pdf, pdf_text
from .store import Store, now_iso, write_json
from .titles import _ACCESSIBLE_RE

BLOCK_TAGS = {"p", "li", "h1", "h2", "h3", "h4", "h5", "h6", "td", "th", "dt", "dd", "blockquote", "figcaption", "caption"}

PDF_THRESHOLD = 0.95


def check_integrity(store: Store) -> dict:
    problems, bodies = [], 0
    for country, note, index in store.iter_notes():
        for v in index["versions"]:
            path = store.body_path(country, note, v["sha256"])
            if not path.exists():
                problems.append({"country": country, "note": note, "sha256": v["sha256"], "problem": "body file missing"})
            elif sha256_bytes(path.read_bytes()) != v["sha256"]:
                problems.append({"country": country, "note": note, "sha256": v["sha256"], "problem": "hash mismatch"})
            else:
                bodies += 1
    pdfs = 0
    for url, entry in store.load_pdf_manifest().items():
        path = store.pdf_path(entry["sha256"])
        if path.exists():
            if sha256_bytes(path.read_bytes()) != entry["sha256"]:
                problems.append({"url": url, "problem": "PDF hash mismatch"})
            else:
                pdfs += 1
    images = 0
    for url, entry in store.load_image_manifest().items():
        path = store.image_path(entry["sha256"], entry.get("ext", ""))
        if path.exists():
            if sha256_bytes(path.read_bytes()) != entry["sha256"]:
                problems.append({"url": url, "problem": "image hash mismatch"})
            else:
                images += 1
    return {"bodies_ok": bodies, "pdfs_ok": pdfs, "images_ok": images, "problems": problems}


def check_complete(store: Store) -> dict:
    collection = store.load_collection()
    if collection is None:
        return {"problems": [{"problem": "no collection stored; run sync first"}]}
    manifest = store.load_pdf_manifest()
    problems = []
    counts = Counter()
    for doc in collection_documents(collection):
        counts["countries"] += 1
        publication = store.load_publication(doc["slug"])
        if publication is None:
            problems.append({"country": doc["slug"], "problem": "publication not stored"})
            continue
        for a in html_attachments(publication):
            counts["notes_listed"] += 1
            index = store.load_note(doc["slug"], note_slug(a["url"]))
            if not index or not index.get("current_sha256"):
                problems.append({"country": doc["slug"], "note": note_slug(a["url"]), "problem": "note not stored"})
            elif index.get("status") != "live":
                problems.append({"country": doc["slug"], "note": note_slug(a["url"]), "problem": f"listed but status {index.get('status')}"})
            else:
                counts["notes_stored"] += 1
        for a in file_attachments(publication):
            if not is_pdf(a):
                continue
            counts["pdfs_listed"] += 1
            entry = manifest.get(a["url"])
            if not entry:
                problems.append({"country": doc["slug"], "url": a["url"], "problem": "PDF not mirrored"})
                continue
            counts["pdfs_mirrored"] += 1
            # Files may live in R2 rather than on this disk; integrity checks whichever are here.
            counts["pdfs_on_this_disk"] += store.pdf_path(entry["sha256"]).exists()
        if not html_attachments(publication):
            counts["pdf_only_countries"] += 1
    images = store.load_image_manifest()
    for url, used_by in current_image_refs(store).items():
        counts["images_used"] += 1
        if url in images:
            counts["images_mirrored"] += 1
        else:
            problems.append({"url": url, "used_by": sorted(used_by), "problem": "image not mirrored"})
    return {"counts": dict(counts), "problems": problems}


def check_live(client, store: Store) -> dict:
    results = Counter()
    differences = []
    for country, note, index in store.iter_notes():
        if index.get("status") != "live":
            continue
        r = client.get(api_url(index["base_path"]))
        if not r.ok:
            results["error"] += 1
            differences.append({"country": country, "note": note, "problem": f"fetch failed: {r.status}"})
            continue
        body, _ = split_item(r.json())
        if body is not None and sha256_bytes(body.encode("utf-8")) == index["current_sha256"]:
            results["identical"] += 1
        else:
            results["changed_since_sync"] += 1
            differences.append({"country": country, "note": note, "problem": "live body differs from stored current version"})
    return {"results": dict(results), "problems": differences}


# --- HTML vs PDF -------------------------------------------------------------------------------
def _tokens(text: str) -> list[str]:
    text = unicodedata.normalize("NFKC", text).replace("­", "").lower()
    return re.findall(r"[a-z]+", text)


def block_texts(html_body: str) -> list[str]:
    """Text of each innermost block (paragraph, list item, heading, cell), footnote markers removed.

    Taking blocks separately stops a heading running into the next paragraph, which no PDF does.
    """
    root = lxml_html.fragment_fromstring(html_body, create_parent="div")
    for el in root.xpath("//sup[a[starts-with(@href, '#fn')]] | //a[@role='doc-noteref']"):
        el.drop_tree()
    for br in root.iter("br"):
        br.tail = " " + (br.tail or "")
    blocks = []
    for el in root.iter(*BLOCK_TAGS):
        if not any(child.tag in BLOCK_TAGS for child in el.iterdescendants()):
            text = " ".join(el.text_content().split())
            if text:
                blocks.append(text)
    return blocks


def containment(html_body: str, pdf_txt: str, min_words: int = 8) -> dict:
    """Share of the HTML note's sentences that appear, word for word, in the PDF's text.

    Words only: punctuation, digits (page numbers, superscript footnote numbers) and line breaks
    differ between the two formats, so they are ignored. A sentence that straddles a PDF page
    break can be missed, so a few misses are expected even when the editions match.
    """
    haystack = " " + " ".join(_tokens(pdf_txt)) + " "
    sentences = [s for block in block_texts(html_body) for s in re.split(r"(?<=[.!?])\s+", block)
                 if len(_tokens(s)) >= min_words]
    exact, split, missing = 0, 0, []
    for s in sentences:
        words = _tokens(s)
        if " " + " ".join(words) + " " in haystack:
            exact += 1
        elif _found_in_pieces(words, haystack):
            split += 1                   # same words, interrupted by a page break, footer or footnote
        else:
            missing.append(s)            # in practice mostly chart captions held as images in the PDF
    total = len(sentences)
    return {"sentences": total, "found": exact + split, "exact": exact, "split_by_layout": split,
            "ratio": round((exact + split) / total, 4) if total else None,
            "missing_examples": [m[:160] for m in missing[:3]]}


def _found_in_pieces(words: list[str], haystack: str) -> bool:
    """True if a sentence's opening and closing five words, or most of its six-word runs, are in the PDF."""
    run = lambda chunk: " " + " ".join(chunk) + " "
    if run(words[:5]) in haystack and run(words[-5:]) in haystack:
        return True
    sixes = [run(words[i:i + 6]) for i in range(max(1, len(words) - 5))]
    return sum(r in haystack for r in sixes) >= max(1, len(sixes) // 2)


def _norm_title(title: str) -> str:
    return " ".join(_ACCESSIBLE_RE.sub("", title or "").split()).lower()


def pair_pdfs(publication: dict) -> dict[str, str]:
    """HTML attachment url -> url of its PDF edition: same title, else the closest unclaimed title."""
    pdfs = {a["url"]: _norm_title(a.get("title")) for a in file_attachments(publication) if is_pdf(a)}
    pairs, unmatched = {}, []
    for a in html_attachments(publication):
        title = _norm_title(a.get("title"))
        url = next((u for u, t in pdfs.items() if t == title and u not in pairs.values()), None)
        if url:
            pairs[a["url"]] = url
        else:
            unmatched.append((a["url"], title))
    for html_url, title in unmatched:
        free = {u: t for u, t in pdfs.items() if u not in pairs.values()}
        best = max(free, key=lambda u: difflib.SequenceMatcher(None, title, free[u]).ratio(), default=None)
        if best and difflib.SequenceMatcher(None, title, free[best]).ratio() >= 0.6:
            pairs[html_url] = best
    return pairs


def check_pdfs(store: Store) -> dict:
    manifest = store.load_pdf_manifest()
    rows, problems = [], []
    for country in store.countries():
        publication = store.load_publication(country)
        if not publication:
            continue
        pairs = pair_pdfs(publication)
        for a in html_attachments(publication):
            note = note_slug(a["url"])
            index = store.load_note(country, note)
            url = pairs.get(a["url"])
            entry = manifest.get(url) if url else None
            if not index or not entry or not store.pdf_path(entry["sha256"]).exists():
                rows.append({"country": country, "note": note, "ratio": None, "problem": "no matching PDF"})
                continue
            result = containment(store.read_body(country, note, index["current_sha256"]),
                                 pdf_text(store.pdf_path(entry["sha256"])))
            row = {"country": country, "note": note, **result}
            rows.append(row)
            if result["ratio"] is not None and result["ratio"] < PDF_THRESHOLD:
                problems.append({"country": country, "note": note, "ratio": result["ratio"],
                                 "problem": f"under {PDF_THRESHOLD:.0%} of sentences found in the PDF"})
    ratios = sorted(r["ratio"] for r in rows if r.get("ratio") is not None)
    summary = {"compared": len(ratios), "unpaired": sum(1 for r in rows if r.get("ratio") is None),
               "median": ratios[len(ratios) // 2] if ratios else None, "min": ratios[0] if ratios else None}
    return {"summary": summary, "rows": rows, "problems": problems}


def check_anchors(store: Store) -> dict:
    """Every in-page link (#section, #fn:12, #fnref:12) in a current note points at an element that exists."""
    problems, checked = [], 0
    for country, note, index in store.iter_notes():
        if index.get("status") != "live":
            continue
        root = lxml_html.fragment_fromstring(store.read_body(country, note, index["current_sha256"]), create_parent="div")
        ids = {el.get("id") for el in root.iter() if isinstance(el.tag, str) and el.get("id")}
        ids |= {el.get("name") for el in root.iter("a") if el.get("name")}
        for a in root.iter("a"):
            href = a.get("href") or ""
            if href.startswith("#") and len(href) > 1:
                checked += 1
                if href[1:] not in ids:
                    problems.append({"country": country, "note": note, "href": href, "text": " ".join(a.text_content().split())[:60],
                                     "problem": "in-page link target missing"})
    return {"checked": checked, "problems": problems}


def link_summary(store: Store) -> dict:
    kinds = Counter()
    for country, note, index in store.iter_notes():
        if index.get("status") == "live":
            for link in extract_links(store.read_body(country, note, index["current_sha256"])):
                kinds[link["kind"]] += 1
    return dict(kinds)


def run(store: Store, client=None, *, live: bool = False, pdf: bool = False) -> dict:
    report = {"at": now_iso(), "integrity": check_integrity(store), "complete": check_complete(store),
              "links": link_summary(store), "anchors": check_anchors(store)}
    if live and client is not None:
        report["live"] = check_live(client, store)
    if pdf:
        report["pdf"] = check_pdfs(store)
    report["ok"] = not any(report[k]["problems"] for k in ("integrity", "complete", "live") if k in report)
    write_json(store.root / "verify-report.json", report)
    return report
