#!/usr/bin/env python3
"""Reuse exact-address receipts and immutable files in a separately scoped inventory.

No requests, address guessing or CPIN changes. Keep successful captures even when
a later run recorded a failure. A reused response is not historically verified.
"""
import argparse
import json
import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from cpin.source_collect import (append_json, audit_collection, audit_quality,
                                 cached_records, export_lists, footnote_coverage,
                                 linked_documents)
from cpin.store import now_iso, read_json, write_json


def reuse(out, caches):
    out = Path(out)
    candidates = {}
    for cache in caches:
        cache = Path(cache)
        journal = cache / "attempts.jsonl"
        if not journal.exists():
            continue
        for line in journal.open(encoding="utf-8"):
            try:
                r = json.loads(line)
                url = r["url"]
            except (ValueError, KeyError):
                continue
            digest = r.get("sha256")
            if r.get("status") == "downloaded" and (not isinstance(digest, str) or not re.fullmatch(r'[0-9a-f]{64}', digest) or not (cache / "documents" / digest).is_file()):
                continue
            score = (r.get("status") == "downloaded", r.get("fetched_at", ""))
            if url not in candidates or score > candidates[url][0]:
                candidates[url] = (score, cache, r)
    primary = [json.loads(line) for line in (out / "urls.jsonl").read_text().splitlines()]
    existing = cached_records(out)
    reused = 0

    def copy_receipts(rows):
        nonlocal reused
        for row in rows:
            url = row["url"]
            if url not in candidates:
                continue
            _, cache, receipt = candidates[url]
            old = existing.get(url)
            if old and old.get("status") == "downloaded":
                continue
            if old and receipt.get("status") != "downloaded":
                continue
            if receipt.get("status") == "downloaded":
                digest = receipt["sha256"]
                for folder, name in [("documents", digest), ("text", digest + ".json")]:
                    source = cache / folder / name
                    destination = out / folder / name
                    if source.exists() and not destination.exists():
                        destination.parent.mkdir(parents=True, exist_ok=True)
                        os.link(source, destination)
            record = {**receipt, "reused_from": str(cache / "attempts.jsonl"), "reused_at": now_iso()}
            append_json(out / "attempts.jsonl", record)
            existing[url] = record
            reused += 1

    copy_receipts(primary)
    linked = linked_documents(out, [r["url"] for r in primary])
    copy_receipts(linked)
    audit_quality(out)
    coverage = footnote_coverage(out)
    audit = audit_collection(primary, out, linked)
    export_lists([*primary, *linked], out)
    result = {"checked_at": now_iso(), "receipts_reused": reused,
              "network_requests": 0, "ai_checks": 0, "audit": audit,
              "footnotes": coverage["totals"]}
    write_json(out / "reuse-report.json", result)
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--cache", type=Path, action="append", required=True)
    args = parser.parse_args()
    destination = args.out.resolve()
    private_root = (ROOT / "data/source-evidence").resolve()
    if not destination.is_relative_to(private_root) or any(destination == c.resolve() for c in args.cache):
        parser.error("Use a separate private data/source-evidence inventory as destination")
    if not (destination / "inventory.json").exists():
        parser.error("Build the destination inventory first with ./cpin sources --inventory-only")
    result = reuse(destination, [c.resolve() for c in args.cache])
    print(json.dumps({k: v for k, v in result.items() if k != "audit"}, indent=2))
    print("audit:", {k: result["audit"][k] for k in ["url_count", "counts", "unique_documents", "issues"]})
    sys.exit(bool(result["audit"]["issues"]))
