"""Check the sources the notes cite: does each link still work, and where does it lead now?

Politeness: one honest User-Agent, robots.txt honoured, one request at a time per site with a delay
between them (many sites are checked in parallel), HEAD first and, where a site mishandles HEAD, a
GET that reads no body. A site that refuses automated requests (401/403/429/451) is recorded as
'restricted': that says nothing about whether the page exists, so it is never called broken.

For links that are broken or unreachable, the Internet Archive's availability API is asked for the
capture closest to when the note cited them, so a reader can still see the source as cited.

Statuses: ok · moved (works, but redirects somewhere materially different) · broken (404/410) ·
restricted · server-error (5xx) · unreachable (DNS, TLS, timeout, connection) · robots (not checked:
the site's robots.txt disallows it) · other (any other response).
"""
import re
import threading
import time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from urllib.parse import quote, urldefrag, urlsplit
from urllib.robotparser import RobotFileParser

import httpx

from . import config
from .links import extract_links
from .store import Store, now_iso, read_json, write_json

HEAD_UNRELIABLE = {400, 403, 404, 405, 406, 429, 500, 501, 502, 503}   # retry these with GET
RESTRICTED = {401, 403, 429, 451}
PER_SITE_DELAY = 1.5


_SOFT_404_PATH = re.compile(r"suspendedpage|/404\b|not-?found|page-?not-?found|error-?page|/expired", re.IGNORECASE)
_PARKING_HOSTS = ("hugedomains.com", "dan.com", "sedo.com", "afternic.com", "parkingcrew.net", "bodis.com")


def soft_404(url: str, final_url: str | None) -> str | None:
    """Why a redirect that 'works' really means the page is gone, or None."""
    if not final_url:
        return None
    fp, up = urlsplit(final_url), urlsplit(url)
    if _SOFT_404_PATH.search(fp.path + "?" + fp.query):
        return "redirects to an error or suspended-account page"
    if any(fp.netloc.lower().endswith(h) for h in _PARKING_HOSTS):
        return "redirects to a domain-parking page"
    if fp.path.strip("/") == "" and up.path.strip("/") not in ("", "index.html", "index.htm", "en"):
        return "redirects from a specific page to the site's home page"
    return None


def classify(code: int | None, url: str, final_url: str | None, error: str | None) -> str:
    if error:
        return "unreachable"
    if code in (404, 410):
        return "broken"
    if code in RESTRICTED:
        return "restricted"
    if code is not None and code >= 500:
        return "server-error"
    if code is not None and 200 <= code < 300:
        if soft_404(url, final_url):
            return "broken"
        return "moved" if final_url and _material_change(url, final_url) else "ok"
    return "other"


def _material_change(a: str, b: str) -> bool:
    """A redirect only counts as a move if the site or path changed, not just http->https or a slash."""
    pa, pb = urlsplit(a), urlsplit(b)
    host = lambda p: p.netloc.lower().removeprefix("www.")
    return host(pa) != host(pb) or pa.path.rstrip("/").lower() != pb.path.rstrip("/").lower()


def cited_urls(store: Store, countries: set[str] | None = None) -> dict[str, dict]:
    """Every http(s) link in current notes -> the notes citing it and when each note was published."""
    found: dict[str, dict] = {}
    for country, note, index in store.iter_notes():
        if index.get("status") != "live" or (countries and country not in countries):
            continue
        current = next(v for v in index["versions"] if v["sha256"] == index["current_sha256"])
        cited_at = current.get("public_updated_at") or current["first_seen"]
        for link in extract_links(store.read_body(country, note, index["current_sha256"])):
            if link["kind"] not in ("external", "govuk"):
                continue
            url = urldefrag(link["href"])[0]
            if url.startswith("/"):
                url = config.GOVUK + url
            if not url.startswith(("http://", "https://")):
                continue
            entry = found.setdefault(url, {"used_by": set(), "cited_at": cited_at, "kind": link["kind"]})
            entry["used_by"].add(f"{country}/{note}")
            entry["cited_at"] = min(entry["cited_at"], cited_at)
    return found


class SiteChecker:
    """Checks one site's URLs in order, honouring its robots.txt and a delay between requests."""

    def __init__(self, client: httpx.Client, delay: float = PER_SITE_DELAY, sleep=time.sleep):
        self.client, self.delay, self.sleep = client, delay, sleep

    def robots(self, origin: str) -> RobotFileParser:
        rp = RobotFileParser()
        try:
            r = self.client.get(origin + "/robots.txt", follow_redirects=True, timeout=10)
            if r.status_code == 200:
                rp.parse(r.text.splitlines())
            else:
                rp.allow_all = True
        except httpx.HTTPError:
            rp.allow_all = True
        return rp

    def check(self, url: str) -> dict:
        code = final = error = None
        try:
            r = self.client.head(url, follow_redirects=True)
            code, final = r.status_code, str(r.url)
            if code in HEAD_UNRELIABLE:
                self.sleep(self.delay)
                with self.client.stream("GET", url, follow_redirects=True) as g:   # headers only; no body read
                    code, final = g.status_code, str(g.url)
        except (httpx.HTTPError, ValueError) as e:
            code, error = None, f"{type(e).__name__}: {e}"[:160]
        result = {"status": classify(code, url, final, error), "code": code,
                  "final_url": final if final and final != url else None, "error": error}
        reason = soft_404(url, final) if not error and code and 200 <= code < 300 else None
        if reason:
            result["reason"] = reason
        return result

    def run(self, urls: list[str]) -> dict[str, dict]:
        parts = urlsplit(urls[0])
        rp = self.robots(f"{parts.scheme}://{parts.netloc}")
        results = {}
        for i, url in enumerate(urls):
            if not rp.can_fetch(config.USER_AGENT, url):
                results[url] = {"status": "robots", "code": None, "final_url": None, "error": None,
                                "checked_at": now_iso()}
                continue
            if i:
                self.sleep(self.delay)
            results[url] = self.check(url) | {"checked_at": now_iso()}
        return results


def archived_copy(client: httpx.Client, url: str, cited_at: str) -> dict | None:
    """The Internet Archive capture closest to when the note cited the link, if any."""
    stamp = cited_at[:10].replace("-", "")
    try:
        r = client.get(f"https://archive.org/wayback/available?url={quote(url, safe='')}&timestamp={stamp}", timeout=30)
        closest = r.json().get("archived_snapshots", {}).get("closest") if r.status_code == 200 else None
    except (httpx.HTTPError, ValueError):
        return None
    if not closest or not closest.get("available") or str(closest.get("status")) not in ("200", "None"):
        return None
    t = closest["timestamp"]
    return {"archived_url": closest["url"].replace("http://", "https://", 1),
            "archived_at": f"{t[0:4]}-{t[4:6]}-{t[6:8]}T{t[8:10]}:{t[10:12]}:{t[12:14]}Z"}


def check_links(store: Store, *, max_age_days: int = 30, limit: int | None = None, countries: set[str] | None = None,
                workers: int = 12, transport: httpx.BaseTransport | None = None, sleep=time.sleep,
                log=print) -> dict:
    """Check cited links that are new or were last checked more than max_age_days ago."""
    path = store.root / "links" / "manifest.json"
    manifest = read_json(path, {})
    for url, entry in manifest.items():        # rules change; stored responses are re-read, not re-fetched
        if entry.get("status") not in ("robots", None):
            entry["status"] = classify(entry.get("code"), url, entry.get("final_url"), entry.get("error"))
            reason = soft_404(url, entry.get("final_url")) if entry["status"] == "broken" and entry.get("code") == 200 else None
            entry.pop("reason", None)
            if reason:
                entry["reason"] = reason
    cited = cited_urls(store, countries)
    cutoff = (datetime.now(timezone.utc) - timedelta(days=max_age_days)).strftime("%Y-%m-%dT%H:%M:%SZ")
    due = [u for u in cited if (manifest.get(u, {}).get("checked_at") or "") < cutoff]
    due.sort(key=lambda u: (u in manifest, u))                 # never-checked first
    if limit:
        due = due[:limit]
    by_site = defaultdict(list)
    for url in due:
        by_site[urlsplit(url).netloc.lower()].append(url)
    log(f"links: {len(cited)} cited · {len(due)} due across {len(by_site)} sites")

    lock = threading.Lock()
    done = 0
    client_args = {"headers": {"User-Agent": config.USER_AGENT, "Accept-Language": "en-GB,en;q=0.8"},
                   "timeout": httpx.Timeout(20, connect=10), "max_redirects": 10, "transport": transport}

    def work(site_urls):
        with httpx.Client(**client_args) as client:
            return SiteChecker(client, sleep=sleep).run(site_urls)

    started = now_iso()
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = [pool.submit(work, urls) for urls in sorted(by_site.values(), key=len, reverse=True)]
        for future in as_completed(futures):
            results = future.result()
            with lock:
                for url, result in results.items():
                    previous = manifest.get(url, {})
                    manifest[url] = {**previous, **result, "kind": cited[url]["kind"], "cited_at": cited[url]["cited_at"],
                                     "used_by": sorted(cited[url]["used_by"])}
                done += len(results)
                if done % 500 < len(results):
                    log(f"  {done}/{len(due)} checked")
                    write_json(path, dict(sorted(manifest.items())))     # progress survives an interruption

    # Archived copies for links that no longer work (serially: one site, be gentle). Includes dead links
    # from earlier runs whose lookup never happened, so an interrupted run catches up.
    dead = [u for u in cited if manifest.get(u, {}).get("status") in ("broken", "unreachable", "server-error")
            and "archived_url" not in manifest[u]]
    log(f"  looking up archived copies for {len(dead)} dead links")
    with httpx.Client(**client_args) as client:
        for i, url in enumerate(dead):
            if i:
                sleep(1.0)
            found = archived_copy(client, url, manifest[url]["cited_at"])
            manifest[url].update(found or {"archived_url": None})
            if i % 100 == 99:
                write_json(path, dict(sorted(manifest.items())))
    for url, entry in manifest.items():                     # links no longer cited stay, marked as such
        entry["still_cited"] = url in cited
    write_json(path, dict(sorted(manifest.items())))
    summary = summarise(manifest, cited)
    store.append_run({"kind": "links", "mode": "check", "started": started, "finished": now_iso(),
                      "checked": len(due), "summary": summary})
    return summary


def export_link_status(store: Store, out_dir) -> int:
    """Per-country files the reader loads: url -> status, final URL and archived copy."""
    from pathlib import Path
    manifest = read_json(store.root / "links" / "manifest.json", {})
    keep = ("status", "code", "final_url", "archived_url", "archived_at", "checked_at")
    per_country: dict[str, dict] = defaultdict(dict)
    for url, entry in manifest.items():
        for use in entry.get("used_by", []):
            per_country[use.split("/", 1)[0]][url] = {k: entry.get(k) for k in keep if entry.get(k) is not None}
    for country, links in per_country.items():
        write_json(Path(out_dir) / f"{country}.json", dict(sorted(links.items())))
    return len(per_country)


def summarise(manifest: dict, cited: dict | None = None) -> dict:
    counts = defaultdict(int)
    for url, entry in manifest.items():
        if cited is None or url in cited:
            counts[entry.get("status", "unchecked")] += 1
    counts["archived_copies_found"] = sum(1 for e in manifest.values() if e.get("archived_url"))
    return dict(counts)
