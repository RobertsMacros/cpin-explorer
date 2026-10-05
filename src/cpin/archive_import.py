"""Register already-downloaded archive PDFs and reconcile the catalogue, without network access."""
from collections import defaultdict
from copy import deepcopy
from datetime import datetime, timezone
from hashlib import sha256
import re

from .recover import (CATALOGUE, Held, edition_status, held_editions, mark_held_elsewhere,
                      page_count, pdf_problem, save_catalogue, summarise)
from .store import now_iso, read_json

RECOVERED_SOURCES = {"wayback", "national-archives", "repository"}
NATIONAL_CAPTURE = re.compile(r"^https://webarchive\.nationalarchives\.gov\.uk/ukgwa/(\d{14})/(https://.+)$")


def browser_copies(report: dict) -> list[dict]:
    """Convert successful dated browser downloads to one record per original address and hash."""
    grouped = defaultdict(list)
    for record in report["records"]:
        if record["status"] != "saved":
            raise ValueError("The browser report still has unsuccessful downloads")
        match = NATIONAL_CAPTURE.fullmatch(record["url"])
        if not match:
            raise ValueError("Not a dated National Archives capture")
        captured = datetime.strptime(match[1], "%Y%m%d%H%M%S").replace(tzinfo=timezone.utc)
        grouped[match[2], record["sha256"]].append({
            **record, "captured_at": captured.strftime("%Y-%m-%dT%H:%M:%SZ")})
    copies = []
    for (original, digest), records in grouped.items():
        records.sort(key=lambda r: r["captured_at"])
        first = records[0]
        copies.append({"original_url": original, "sha256": digest, "bytes": first["bytes"],
                       "pages": first["pages"], "title": first["edition"],
                       "source": "national-archives", "archive_provider": "National Archives",
                       "archive_url": first["url"], "captured_at": first["captured_at"],
                       "other_captures": [{"archive_url": r["url"], "captured_at": r["captured_at"]}
                                          for r in records[1:]]})
    return copies


def repository_copies(report: dict) -> list[dict]:
    """Repository copies have a source URL and download date, but no invented archive capture time."""
    return [{"original_url": r["original_url"], "sha256": r["sha256"], "bytes": r["bytes"],
             "pages": r["pages"], "title": r["edition"], "source": "repository",
             "archive_provider": r["provider"], "archive_url": r["url"], "captured_at": None,
             "source_page": r["source_page"], "downloaded_at": r["downloaded_at"]}
            for r in report["records"] if r["status"] == "saved"]


def register_copies(store, copies: list[dict]) -> dict:
    """Validate the whole import before changing the manifest. Preserve every earlier version."""
    catalogue = read_json(store.root / CATALOGUE)
    files = {f["url"]: (slug, edition, f) for slug, country in catalogue["countries"].items()
             for edition in country["editions"] for f in edition["files"]}
    manifest = deepcopy(store.load_pdf_manifest())
    stats = {"registered": 0, "already_registered": 0, "preserved_live": 0}
    seen = now_iso()
    for copy in copies:
        url, digest = copy["original_url"], copy["sha256"]
        if not re.fullmatch(r"[0-9a-f]{64}", digest):
            raise ValueError("Invalid PDF hash")
        slug, edition, listed = files[url]
        if copy["title"] != edition["title"]:
            raise ValueError(f"The download title does not match its catalogue edition: {url}")
        if copy["source"] not in RECOVERED_SOURCES:
            raise ValueError("Unsupported recovered source")
        body = store.pdf_path(digest).read_bytes()
        if (sha256(body).hexdigest() != digest or len(body) != copy["bytes"] or pdf_problem(body)
                or page_count(body) != copy["pages"]):
            raise ValueError(f"Downloaded PDF failed validation: {url}")
        entry = {**copy, "country": slug, "etag": None, "first_seen": seen, "last_seen": None,
                 "first_listed": listed["first_listed"], "last_listed": listed["last_listed"],
                 "listed_at": edition["listed_at"], "pages_listed": listed.get("pages"),
                 "also_listed_as": listed.get("also_listed_as", [])}
        prior = manifest.get(url)
        existing = [prior, *prior.get("previous", [])] if prior else []
        if any(e["sha256"] == digest for e in existing):
            stats["already_registered"] += 1
            continue
        if prior:
            previous = list(prior.get("previous", []))
            if prior.get("source") == "live":
                # Importing historical bytes must never make the live file an older one.
                prior["previous"] = [*previous, entry]
                stats["preserved_live"] += 1
            else:
                entry["previous"] = [*previous, {k: v for k, v in prior.items() if k != "previous"}]
                manifest[url] = entry
        else:
            manifest[url] = entry
        stats["registered"] += 1
    store.save_pdf_manifest(manifest)
    return stats


def reconcile_catalogue(store) -> dict:
    """Refresh holdings offline; retain failed attempts and record how their edition is now held."""
    catalogue = read_json(store.root / CATALOGUE)
    held = Held(store)
    for slug, country in catalogue["countries"].items():
        for edition in country["editions"]:
            for item in edition["files"]:
                item["held"] = held.find(item)
            edition["status"] = edition_status(edition)
        mark_held_elsewhere(country["editions"], held_editions(store, slug, country["name"], held.manifest), country["name"])
        country["summary"] = summarise(country, country["summary"]["html_captures_to_read"])
    resolved = 0
    for failure in catalogue.get("failures", []):
        country = catalogue["countries"].get(failure["country"], {})
        evidence = None
        if failure.get("note"):
            edition = next((e for e in country.get("editions", [])
                            if any(h["note"] == failure["note"] for h in e["html"])), None)
            if edition:
                evidence = next((f["held"] for f in edition["files"] if f["held"]), None)
        else:
            evidence = held.find(failure)
        if evidence:
            path = store.pdf_path(evidence["sha256"])
            body = path.read_bytes() if path.exists() else b""
            if sha256(body).hexdigest() == evidence["sha256"] and not pdf_problem(body) and page_count(body):
                failure["resolution"] = {"status": "edition-held", "checked_at": now_iso(),
                                         "held": evidence,
                                         "note": "The failed capture remains a failed attempt; a valid PDF of its edition is held."}
                resolved += 1
                continue
        failure["resolution"] = {"status": "unresolved", "checked_at": now_iso()}
    catalogue["failure_summary"] = {"attempts_retained": len(catalogue.get("failures", [])),
                                    "editions_held": resolved,
                                    "unresolved": len(catalogue.get("failures", [])) - resolved}
    catalogue["holdings_checked_at"] = now_iso()
    save_catalogue(store, catalogue)
    return {"totals": catalogue["totals"], "failures": catalogue["failure_summary"]}
