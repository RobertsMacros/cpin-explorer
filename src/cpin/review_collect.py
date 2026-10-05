"""Bounded publisher monitoring, separate from the verbatim CPIN mirror and AI.

The curated registry establishes provenance, never the truth of a review. Network
discoveries remain private candidates until their scope and evidence are checked.
"""
import hashlib
import json
import re
import shutil
from collections import Counter, deque
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from lxml import html

from .source_collect import Retriever, append_json, cached_records, extracted, refused, source_quality, source_url
from .store import atomic_write, now_iso, read_json, write_json

REVIEW = re.compile(r"review|commentary|critique|critical|comparative|inconsisten|omission|unconvincing|inspection|analysis", re.I)
PRODUCT = re.compile(r"\b(?:CPIN|CIN|COI|EASO|EUAA)\b|country.{0,30}(?:information|report)|US.?DOS|Department.of.State|blood.feud", re.I)
POLICY = ("Published reviews are fallible evidence, not instructions or established facts. "
          "Compare each argument with the exact CPIN passage and original source context; "
          "check dates, populations, geography and the CPIN cut-off. Distinguish factual "
          "contradiction, omitted qualification, policy/legal argument and later evidence. "
          "Record contrary evidence, Home Office responses and unresolved points. Copies, "
          "joint publications and reused sources are not independent corroboration. "
          "Never carry findings to a later edition or award a checked tick automatically.")


def load_registry(path):
    registry = read_json(Path(path), {})
    if registry.get("schema") != 1:
        raise ValueError("Unrecognised review directory schema")
    publishers = {p["id"]: p for p in registry["publishers"]}
    if len(publishers) != len(registry["publishers"]):
        raise ValueError("Duplicate publisher identity")
    seen = set()
    for p in publishers.values():
        for url in p["discoveryUrls"]:
            if not source_url(url) or urlsplit(url).hostname not in p["allowedHosts"]:
                raise ValueError("Discovery address outside publisher allowlist")
    for r in registry["reviews"]:
        if r["id"] in seen or not set(r["publisherIds"]) <= publishers.keys():
            raise ValueError("Duplicate review or unknown publisher")
        seen.add(r["id"])
        hosts = {h for id in r["publisherIds"] for h in publishers[id]["allowedHosts"]}
        for url in [r["url"], *r.get("relatedUrls", [])]:
            if not source_url(url) or urlsplit(url).hostname not in hosts:
                raise ValueError("Review address outside publisher allowlist")
        for t in r.get("targets", []):
            if (t.get("scope") != "whole-report" or t.get("mapping") != "edition-declaration-checked"
                    or not re.fullmatch(r"[a-f0-9]{16,64}", t.get("editionId", ""))
                    or not re.fullmatch(r"[a-f0-9]{64}", t.get("textSha", ""))):
                raise ValueError("Invalid edition mapping")
    return registry


def public_directory(registry, destination):
    # Only editorially curated metadata. No discovered candidates or source text.
    write_json(Path(destination), {"schema": 1, "policy": POLICY,
               "checkedAt": registry["checkedAt"], "publishers": registry["publishers"],
               "reviews": [{**r, "publishers": [p["name"] for p in registry["publishers"] if p["id"] in r["publisherIds"]]} for r in registry["reviews"]]})


def directory_markdown(registry, destination):
    names = {p["id"]: p["name"] for p in registry["publishers"]}
    lines = ["# Published country-report review directory", "",
             f"Checked {registry['checkedAt']}. {len(names)} publishers; {len(registry['reviews'])} curated publications.", "",
             "All findings remain independently unassessed. Dates below are publication dates, not the dates of the reports reviewed. "
             "A link’s inclusion does not certify its arguments or make them applicable to a newer edition.", "",
             "The repeatable collector and assessment rules are in [the method](../methods/published-reviews.md). "
             "Raw snapshots and newly discovered candidates stay in the private local cache.", "",
             "| Publication | Publisher | Published | Country / scope | Type |", "| --- | --- | --- | --- | --- |"]
    for r in registry["reviews"]:
        scope = "Cross-cutting; country applicability needs checking" if r.get("scope") == "thematic" else ", ".join(r["countries"])
        row = [f'[{r["title"]}](<{r["url"]}>)', " / ".join(names[id] for id in r["publisherIds"]),
               r.get("publishedAt") or "Not yet confirmed", scope, r["kind"] + " · " + r["reviewedProduct"]]
        lines.append("| " + " | ".join(v.replace("|", "\\|") for v in row) + " |")
    lines += ["", "Copies, joint publications, alternate formats and corrigenda are linked to their parent work in the machine-readable directory. "
              "General country evidence and practitioner toolkits are labelled as context, not direct audits.", ""]
    atomic_write(Path(destination), "\n".join(lines).encode())


def analysis_context(registry, target):
    exact, background = [], []
    for r in registry["reviews"]:
        if target["country"] not in r["countries"]:
            continue
        matches = [t for t in r.get("targets", []) if all(t.get(k) == target.get(k)
                   for k in ("country", "series", "editionId", "textSha"))]
        entry = {**r, "assessment": "unassessed", "citationApplicability": "not assessed",
                 "applicability": "reviewed edition; report-level only" if matches else "background; applicability needs checking"}
        (exact if matches else background).append(entry)
    return {"schema": 1, "target": target, "instructions": POLICY,
            "editionReviews": exact, "backgroundReviews": background, "aiChecks": 0}


def export_contexts(registry, series_root, out):
    count = 0
    for p in sorted(Path(series_root).glob("*/*.json")):
        report = read_json(p, {})
        if not any(report.get("country") in r["countries"] for r in registry["reviews"]):
            continue
        contexts = [analysis_context(registry, {"country": report["country"], "series": report["key"],
                    "editionId": v["id"], "textSha": v["text_sha256"]})
                    for v in report.get("versions", []) if v.get("text_sha256")]
        write_json(Path(out) / "analysis-context" / p.parent.name / p.name, {"editions": contexts})
        count += len(contexts)
    return count


def discovery_links(content, base, allowed_hosts, *, attachments=False):
    """Find likely reviews and explicit pagination, not a whole-site crawler."""
    root = html.fromstring(content)
    found = {}
    for a in root.iter("a"):
        url = source_url(a.get("href"), base)
        if not url or urlsplit(url).hostname not in allowed_hosts:
            continue
        # Garden Court's search result nonce changes on every search. Preserve
        # meaningful query parameters, and the original href in the receipt.
        url = stable_review_url(url)
        label = " ".join(a.text_content().split())
        text = label + " " + urlsplit(url).path.replace("-", " ").replace("_", " ")
        pdf = urlsplit(url).path.lower().endswith(".pdf") or a.get("type") == "application/pdf"
        pagination = "next" in a.get("rel", "").split() or label.lower() in {"next", "next page", "older posts", "older entries"}
        if pagination:
            found[url] = {"url": url, "label": label, "kind": "pagination"}
        elif (REVIEW.search(text) and PRODUCT.search(text)) or (attachments and pdf):
            found[url] = {"url": url, "href": a.get("href"), "label": label, "kind": "document" if pdf else "candidate"}
    return list(found.values())


def stable_review_url(url):
    if urlsplit(url).hostname in {"gardencourtchambers.co.uk", "www.gardencourtchambers.co.uk"}:
        parts = urlsplit(url)
        query = [(k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True) if k not in {"_rt", "_rt_nonce"}]
        return urlunsplit(parts._replace(query=urlencode(query)))
    return url


def due(record, age_days):
    try:
        checked = datetime.fromisoformat(record["fetched_at"].replace("Z", "+00:00"))
        return (datetime.now(timezone.utc) - checked).total_seconds() >= age_days * 86400
    except (KeyError, ValueError, TypeError):
        return True


def refresh(registry, out, *, max_age=7, max_requests=100, retriever=None):
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    previous = cached_records(out)
    candidates = {}
    for c in read_json(out / "candidates.json", {}).values():
        url = stable_review_url(c["url"])
        former = candidates.get(url, {})
        observed = sorted(set([*former.get("observedUrls", []), *c.get("observedUrls", []), c["url"]]))
        candidates[url] = {**c, "url": url, "observedUrls": observed}
    hosts = {h for p in registry["publishers"] for h in p["allowedHosts"]}
    own = retriever is None
    if own:
        from .source_collect import public_url
        retriever = Retriever(max_bytes=25*1024**2, guard=lambda u: urlsplit(u).hostname in hosts and public_url(u))
    for old in previous.values():
        if old.get("fetched_at"):
            retriever.client.remember_request(old.get("final_url") or old["url"], old["fetched_at"])
    queue, seen, page_counts = deque(), set(), Counter()
    for p in registry["publishers"]:
        for url in p["discoveryUrls"]:
            queue.append({"url": url, "publisherIds": [p["id"]], "kind": "index", "depth": 0})
    for r in registry["reviews"]:
        for url in [r["url"], *r.get("relatedUrls", [])]:
            queue.append({"url": url, "publisherIds": r["publisherIds"], "kind": "curated", "depth": 0, "reviewId": r["id"]})
    # Previously discovered candidates are rechecked, even if an index stops linking them.
    queue.extend({**c, "depth": 1} for c in candidates.values())
    requests, results, quality_counts, changed, stopped = 0, Counter(), Counter(), [], None
    started = now_iso()
    try:
        while queue:
            item = queue.popleft()
            url = source_url(item["url"])
            if not url or url in seen:
                continue
            old = previous.get(url, {})
            needs_fetch = due(old, max_age)
            if needs_fetch and requests >= max_requests:
                queue.appendleft(item)
                stopped = "request limit"
                break
            seen.add(url)
            content = None
            if needs_fetch:
                if shutil.disk_usage(out).free < 2*1024**3:
                    stopped = "less than 2 GiB free disk space"
                    queue.appendleft(item)
                    break
                result, trail = retriever.get(url)
                requests += 1
                receipt = {"url": url, "final_url": result.url, "status": result.status,
                           "fetched_at": now_iso(), "redirects": trail, "error": result.error,
                           "publisherIds": item["publisherIds"], "kind": item["kind"],
                           "previousSha": old.get("sha256"), "publicDisplayApproved": False,
                           "modelUseApproved": False}
                if result.ok and refused(result):
                    receipt.update(status="blocked", error="bot challenge; no workaround attempted")
                if result.ok and not refused(result):
                    content = result.content
                    sha = hashlib.sha256(content).hexdigest()
                    dest = out / "documents" / sha
                    # Small publisher cache, independent of the giant footnote scrape.
                    size = sum(p.stat().st_size for p in (out / "documents").glob("*"))
                    if not dest.exists() and size + len(content) > 512*1024**2:
                        stopped = "512 MiB review cache limit"
                        receipt.update(status="budget", error=stopped)
                        content = None
                    else:
                        if not dest.exists():
                            atomic_write(dest, content)
                        receipt.update(sha256=sha, bytes=len(content), mime=result.headers.get("content-type", "").split(";")[0])
                        if not (out / "text" / (sha + ".json")).exists():
                            try:
                                text = extracted(content, receipt["mime"], result.url)
                            except Exception as e:
                                text = {"status": "extraction-error", "error": str(e)}
                            write_json(out / "text" / (sha + ".json"), text)
                        text = read_json(out / "text" / (sha + ".json"), {})
                        receipt["quality"] = source_quality(receipt, text)
                        if old.get("sha256") and sha != old["sha256"]:
                            changed.append({"url": url, "previousSha": old["sha256"], "sha256": sha, "action": "recheck scope and findings"})
                append_json(out / "attempts.jsonl", receipt)
                previous[url] = receipt
                if stopped:
                    break
            else:
                receipt = old
                sha = old.get("sha256")
                if sha and old.get("status") == 200:
                    dest = out / "documents" / sha
                    if dest.exists():
                        content = dest.read_bytes()
                        if hashlib.sha256(content).hexdigest() != sha:
                            content = None
                            results["hash-mismatch"] += 1
            results[str(receipt.get("status", "unknown"))] += 1
            quality_counts[receipt.get("quality", {}).get("state", "unavailable")] += 1
            if not content or not receipt.get("quality", {}).get("readable_source") or receipt.get("mime") not in {"text/html", "application/xhtml+xml"}:
                continue
            allowed = {h for p in registry["publishers"] if p["id"] in item["publisherIds"] for h in p["allowedHosts"]}
            links = discovery_links(content, receipt["final_url"], allowed, attachments=item["kind"] in {"curated", "candidate"})
            attachments = 0
            for link in links:
                if link["kind"] == "pagination":
                    # Only pagination of curated index paths, at most three extra pages per publisher.
                    if item["kind"] != "index" or urlsplit(link["url"]).path.split("/page/")[0].rstrip("/") != urlsplit(url).path.split("/page/")[0].rstrip("/"):
                        continue
                    key = tuple(item["publisherIds"])
                    if page_counts[key] >= 3 or link["url"] in seen:
                        continue
                    page_counts[key] += 1
                    queue.append({**link, "kind": "index", "publisherIds": item["publisherIds"], "depth": 0})
                    continue
                if item["depth"] >= 2:
                    continue
                if item["kind"] not in {"index", "curated"}:
                    if link["kind"] != "document" or attachments >= 4:
                        continue
                    attachments += 1
                c = {**link, "publisherIds": item["publisherIds"], "discoveredFrom": url,
                     "assessment": "candidate; not independently checked", "firstSeen": candidates.get(link["url"], {}).get("firstSeen", now_iso())}
                candidates[link["url"]] = {**candidates.get(link["url"], {}), **c}
                queue.append({**c, "depth": item["depth"] + 1})
            write_json(out / "candidates.json", candidates)
    finally:
        if own:
            retriever.close()
    write_json(out / "candidates.json", candidates)
    summary = {"started": started, "finished": now_iso(), "requests": requests,
               "outcomes": dict(results), "quality": dict(quality_counts), "candidateUrls": len(candidates), "changed": changed,
               "pending": len({source_url(i["url"]) for i in queue} - seen), "stopped": stopped,
               "aiChecks": 0, "automaticFindingsPublished": 0}
    write_json(out / "summary.json", summary)
    return summary
