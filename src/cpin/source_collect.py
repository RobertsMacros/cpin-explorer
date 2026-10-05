"""Private, resumable source evidence collection. No AI calls or source republication.

Edition/claim/footnote indexing uses the held export, including already-extracted PDF
editions. Retrieval deduplicates exact HTTP addresses and retains content-addressed
snapshots. Source retrieval now is not evidence of what a historical source said then.
"""
import hashlib
import heapq
import ipaddress
import json
import re
import shutil
import socket
import threading
from datetime import date
from collections import Counter, defaultdict, deque
from concurrent.futures import ThreadPoolExecutor, wait, FIRST_COMPLETED
from functools import lru_cache
from pathlib import Path
from urllib.parse import parse_qs, urldefrag, urljoin, urlsplit, urlunsplit

import httpx
from lxml import etree, html

from . import config
from .http import PoliteClient, FetchResult
from .store import atomic_write, now_iso, read_json, write_json

METHOD = "source-collection-v2"
FOOTNOTE_ID = re.compile(r"^(?:fn:|fn-?)(\d+)$")
PARAGRAPH = re.compile(r"^(\d+(?:\.\d+){1,4})\b")


def refused(result):
    return (result.status in {"blocked",401,403,429,451} or result.error == "HTTP 429" or
            result.headers.get("x-amzn-waf-action", "").lower() in {"challenge","captcha"} or
            result.headers.get("cf-mitigated", "").lower() == "challenge")


def source_url(href, base=config.GOVUK):
    """Remove fragments; do not guess corrections to broken PDF-extracted URLs."""
    href = (href or "").strip()
    if not href or href.startswith(("#", "mailto:", "tel:")):
        return None
    if re.search(r"[\s\x00-\x1f\x7f]", href):
        return None
    try:
        p = urlsplit(urljoin(base, href))
        if p.scheme not in {"http", "https"} or not p.hostname or p.username or p.password:
            return None
        if p.port not in {None, 80, 443} or "." not in p.hostname or "\\" in href:
            return None
        netloc = p.netloc.lower()
        return str(httpx.URL(urlunsplit((p.scheme.lower(), netloc, p.path or "/", p.query, ""))))
    except (ValueError, httpx.InvalidURL):
        return None


@lru_cache(maxsize=10000)
def public_host(host):
    try:
        addresses = socket.getaddrinfo(host, None, type=socket.SOCK_STREAM)
        return bool(addresses) and all(ipaddress.ip_address(item[4][0]).is_global for item in addresses)
    except (OSError, ValueError):
        return False


def public_url(url):
    normal = source_url(url)
    return bool(normal and public_host(urlsplit(normal).hostname))


def plain(el):
    return " ".join(el.text_content().split())


def document_links(root):
    """Explicit PDF links/embeds only, excluding arbitrary embedded web content."""
    links = []
    for el in root.iter():
        if el.tag not in {"a", "iframe", "embed", "object"}:
            continue
        href = el.get("href") if el.tag == "a" else el.get("data") if el.tag == "object" else el.get("src")
        if not href:
            continue
        try:
            parsed = urlsplit(href)
        except ValueError:
            continue
        label = plain(el) if el.tag == "a" else "Embedded PDF"
        pdf = (parsed.path.lower().endswith(".pdf") or el.get("type") == "application/pdf"
               or parse_qs(parsed.query).get("t") == ["pdf"])
        if pdf or (el.tag == "a" and re.search(r"\bPDF\b", label)):
            links.append({"href":href, "label":label, "discovery":"anchor" if el.tag == "a" else "embedded-pdf"})
    return links


def edition_index(report, edition):
    body = edition.get("body") or ""
    root = html.fragment_fromstring(body or "<div/>", create_parent="div")
    footnotes, by_id, claims, links, invalid = [], {}, [], [], []
    for el in root.iter():
        m = FOOTNOTE_ID.match(el.get("id", ""))
        if not m:
            continue
        rec = {"number":int(m[1]), "id":el.get("id"), "text":plain(el), "links":[], "claims":[]}
        footnotes.append(rec)
        by_id.setdefault(rec["id"], []).append(rec)
        for a in el.iter("a"):
            href = a.get("href", "")
            if not href or href.startswith("#"):
                continue
            url = source_url(href)
            rec["links"].append({"href":href, "url":url, "discovery":"anchor"})
        # Keep printed URLs too, but never silently repair punctuation or line-wraps.
        unlinked = " ".join(el.xpath(".//text()[not(ancestor::a)]"))
        known = {link["url"] for link in rec["links"]}
        for raw in re.findall(r'https?://[^\s<>"\[\]]+', unlinked):
            url = source_url(raw)
            if url and url not in known:
                rec["links"].append({"href":raw, "url":url, "discovery":"plain-text candidate",
                                     "boundary_uncertain":raw[-1:] in ".,;:)"})
                known.add(url)
    section = ""
    for el in root.iter():
        if el.tag in {"h1", "h2", "h3", "h4"}:
            section = plain(el)
        if el.tag not in {"p", "li", "td", "th"}:
            continue
        if any(FOOTNOTE_ID.match(a.get("id", "")) for a in [el, *el.iterancestors()]):
            continue
        # A containing list item/paragraph must not duplicate a more specific block.
        if el.xpath(".//p | .//li | .//td | .//th"):
            continue
        refs = []
        direct = []
        for a in el.iter("a"):
            href = a.get("href", "")
            ref = urldefrag(href)[1] if href.startswith("#") else ""
            if FOOTNOTE_ID.match(ref):
                refs.append(ref)
            elif href and not href.startswith(("#", "mailto:", "tel:")):
                direct.append({"href":href, "url":source_url(href)})
        if not refs and not direct:
            continue
        text = plain(el)
        number = PARAGRAPH.match(text)
        rec = {"id":len(claims), "paragraph":number[1] if number else "", "section":section,
               "text":text, "footnotes":refs, "links":direct}
        claims.append(rec)
        for ref in refs:
            for footnote in by_id.get(ref, []):
                footnote["claims"].append(rec["id"])
    for a in root.iter("a"):
        href = a.get("href", "")
        if not href or href.startswith(("#", "mailto:", "tel:")):
            continue
        url = source_url(href)
        entry = {"href":href, "url":url, "label":plain(a)}
        (links if url else invalid).append(entry)
    seen_links = {link["url"] for link in links}
    for footnote in footnotes:
        for link in footnote["links"]:
            if link["url"] and link["url"] not in seen_links:
                links.append({**link, "label":"Printed address in footnote"})
                seen_links.add(link["url"])
    # Printed addresses in a bibliography/body are preserved as candidates too.
    outside_links = " ".join(root.xpath(".//text()[not(ancestor::a)]"))
    for raw in re.findall(r'https?://[^\s<>"\[\]]+', outside_links):
        url = source_url(raw)
        if url and url not in seen_links:
            links.append({"href":raw,"url":url,"label":"Printed address in report",
                          "discovery":"plain-text candidate","boundary_uncertain":raw[-1:] in ".,;:)"})
            seen_links.add(url)
    missing = sorted({ref for c in claims for ref in c["footnotes"] if ref not in by_id})
    return {"method":METHOD, "country":report["country"], "series":report["key"], "editionId":edition["id"],
            "textSha":edition.get("text_sha256"), "bodySha":hashlib.sha256(body.encode()).hexdigest(),
            "source":edition.get("source"), "published":edition.get("published"), "current":bool(edition.get("current")),
            "footnotes":footnotes, "claims":claims, "links":links, "invalid_links":invalid,
            "diagnostics":{"missing_footnotes":missing, "duplicate_footnotes":[k for k,v in by_id.items() if len(v)>1],
                           "unreferenced_footnotes":sum(not f["claims"] for f in footnotes)}}


def build_inventory(series_root, out, *, all_editions=False, countries=None, since=None, date_evidence=None):
    out = Path(out)
    urls, counts, problems, index_paths = {}, Counter(), [], []
    dates = {(r['country'], r['series'], r['editionId'], r['textSha']): r
             for r in (date_evidence or {}).get('editions', [])}
    for path in sorted(Path(series_root).glob("*/*.json")):
        report = read_json(path)
        if not isinstance(report, dict) or "versions" not in report:
            continue
        if countries and report["country"] not in countries:
            continue
        counted = False
        for edition in report["versions"]:
            if not all_editions and not edition.get("current"):
                continue
            evidence = None
            if not edition.get('published'):
                evidence = dates.get((report['country'], report['key'], edition['id'], edition.get('text_sha256')))
            published_value = edition.get('published') or (evidence or {}).get('published')
            if since:
                try:
                    published = date.fromisoformat((published_value or "")[:10])
                except (ValueError, TypeError):
                    problems.append({"report":str(path), "edition":edition["id"], "error":"publication date unknown; cannot apply since filter"})
                    continue
                if published < date.fromisoformat(since):
                    continue
            if not edition.get("body"):
                problems.append({"report":str(path), "edition":edition["id"], "error":"no readable body"})
                continue
            index = edition_index(report, edition)
            if evidence:
                index['published'] = published_value
                index['publicationEvidence'] = evidence
            if not counted:
                counts["reports"] += 1
                counted = True
            rel = f'index/{report["country"]}/{path.stem}/{edition["id"]}.json'
            write_json(out / rel, index)
            index_paths.append(rel)
            counts["editions"] += 1
            counts["footnotes"] += len(index["footnotes"])
            counts["claims"] += len(index["claims"])
            counts["invalid_links"] += len(index["invalid_links"])
            counts["missing_footnote_refs"] += len(index["diagnostics"]["missing_footnotes"])
            counts["duplicate_footnotes"] += len(index["diagnostics"]["duplicate_footnotes"])
            counts["unreferenced_footnotes"] += index["diagnostics"]["unreferenced_footnotes"]
            linked = defaultdict(set)
            for f in index["footnotes"]:
                for link in f["links"]:
                    if link["url"]:
                        linked[link["url"]].add(f["number"])
            for link in index["links"]:
                url = link["url"]
                row = urls.setdefault(url, {"url":url, "current":False, "cited_by":{}})
                row["current"] |= index["current"]
                row["cited_by"][rel] = sorted(linked.get(url, []))
    catalogue = sorted(urls.values(), key=lambda r:(not r["current"], r["url"]))
    counts["urls"] = len(catalogue)
    atomic_write(out / "urls.jsonl", ("".join(json.dumps(r,ensure_ascii=False)+"\n" for r in catalogue)).encode())
    summary = {"method":METHOD, "built_at":now_iso(), "scope":"all held editions" if all_editions else "current held editions",
               "since":since, "index_paths":index_paths, "counts":dict(counts), "problems":problems}
    write_json(out / "inventory.json", summary)
    return catalogue, summary


class Retriever:
    """Coordinate hosts across redirects; only the network runs concurrently."""
    def __init__(self, *, max_bytes=25*1024*1024, client_factory=None, guard=public_url):
        self.max_bytes, self.guard = max_bytes, guard
        self.factory = client_factory or (lambda:PoliteClient(timeout=20, max_retries=1, max_bytes=max_bytes, url_guard=guard))
        self.registry, self.locks, self.refusals = threading.Lock(), {}, {}
        self.client = self.factory()

    def get(self, url):
        trail, seen = [], set()
        for _ in range(8):
            if url in seen:
                return FetchResult(url,"redirect-loop",error="redirect loop"), trail
            seen.add(url)
            host = urlsplit(url).netloc
            with self.registry:
                lock = self.locks.setdefault(host, threading.Lock())
            with lock:
                if host in self.refusals:
                    return FetchResult(url,"host-refused",error=f"no request: host paused after refusal at {self.refusals[host]}"), trail
                result = self.client.get(url)
                if refused(result):
                    self.refusals[host] = url
                    if result.headers.get("x-amzn-waf-action") or result.headers.get("cf-mitigated"):
                        result.error = "bot challenge response; no workaround attempted"
            trail.append({"url":url,"status":result.status})
            if result.status in {301,302,303,307,308} and result.location:
                nxt = source_url(urljoin(url,result.location))
                if not nxt:
                    return FetchResult(url,"unsafe",error="invalid redirect address"), trail
                url = nxt
                continue
            return result, trail
        return FetchResult(url,"redirect-limit",error="too many redirects"), trail

    def close(self):
        self.client.close()


def extracted(content, mime, url):
    """Derived text with page/block locations, never presented as a verified quotation."""
    import importlib.metadata
    if not content.strip():
        return {"status":"no-text", "kind":"html" if mime in {"text/html","application/xhtml+xml"} else mime or "unknown",
                "text":"", "title":"", "extractor":"empty-response-v1", "verified":False}
    if content.startswith(b"%PDF-"):
        import pymupdf
        with pymupdf.open(stream=content, filetype="pdf") as doc:
            if doc.is_encrypted:
                return {"status":"encrypted", "kind":"pdf", "pages":[]}
            pages = [{"page":i+1,"text":page.get_text("text")} for i,page in enumerate(doc)]
        text = "\n\n".join(p["text"] for p in pages)
        return {"status":"extracted" if len(text.strip()) >= 100 else "no-text", "kind":"pdf", "pages":pages,
                "text":text,"extractor":f'PyMuPDF {importlib.metadata.version("pymupdf")}', "verified":False}
    if mime in {"text/html","application/xhtml+xml"} or content.lstrip().lower().startswith((b"<!doctype html",b"<html")):
        import trafilatura
        text = trafilatura.extract(content,url=url,include_comments=False,include_tables=True,favor_recall=True) or ""
        root = html.fromstring(content)
        titles = root.xpath("//title/text()")
        documents = [{**link,"url":source_url(link["href"],url)} for link in document_links(root)
                     if source_url(link["href"],url)]
        return {"status":"extracted" if len(text.strip()) >= 100 else "no-text", "kind":"html", "text":text,
                "title":titles[0].strip() if titles else "", "document_links":documents,
                "extractor":f'Trafilatura {importlib.metadata.version("trafilatura")}', "verified":False}
    if mime == "text/plain":
        text=content.decode("utf-8",errors="replace")
        return {"status":"extracted" if len(text.strip())>=100 else "no-text","kind":"text","text":text,"extractor":"utf8-v1","verified":False}
    return {"status":"unsupported","kind":mime or "unknown"}


def append_json(path, record):
    path.parent.mkdir(parents=True,exist_ok=True)
    # An interrupted final line remains a diagnostic, rather than being joined to
    # the next valid record and losing that next result on resume.
    needs_newline = False
    if path.exists() and path.stat().st_size:
        with path.open("rb") as tail:
            tail.seek(-1, 2); needs_newline = tail.read(1) != b"\n"
    with path.open("a",encoding="utf-8") as f:
        if needs_newline: f.write("\n")
        f.write(json.dumps(record,ensure_ascii=False)+"\n")


def cached_records(out):
    records = {}
    path=out / "attempts.jsonl"
    if path.exists():
        for line in path.open(encoding="utf-8"):
            try:
                r=json.loads(line)
                records[r["url"]]=r
            except (ValueError,KeyError):
                continue
    return records


def collect(catalogue, out, *, workers=8, limit=None, retry_failures=False, retriever=None, max_total_bytes=6*1024**3, log=print):
    """Bounded fair scheduling: one in-flight cited URL per host, saved after every result."""
    out=Path(out);out.mkdir(parents=True,exist_ok=True)
    previous=cached_records(out)
    groups=defaultdict(deque)
    pending=0
    for row in catalogue:
        old=previous.get(row["url"])
        if old and old["status"]!="budget" and (not retry_failures or old["status"]=="downloaded"):
            continue
        if limit is not None and pending >= limit:
            break
        groups[urlsplit(row["url"]).netloc].append(row["url"]);pending+=1
    current_hosts = {urlsplit(r["url"]).netloc for r in catalogue if r["current"]}
    hosts=deque(sorted(groups,key=lambda h:(h not in current_hosts,-len(groups[h]))))
    # Keep the longest queues moving while reserving at least half the workers for
    # other hosts. Otherwise a host with thousands of citations gets only one turn
    # per rotation through thousands of one-off domains, leaving a very long tail.
    long_hosts = {host for host in hosts if len(groups[host]) >= 50}
    long_queue = [(-len(groups[host]),host) for host in long_hosts]
    heapq.heapify(long_queue)
    hosts = deque(host for host in hosts if host not in long_hosts)
    own=retriever is None;retriever=retriever or Retriever()
    if own:
        for row in previous.values():
            if not row.get("fetched_at"):continue
            for hop in row.get("redirects",[]):
                if hop["status"] not in {"robots","unsafe","host-refused"}:
                    retriever.client.remember_request(hop["url"],row["fetched_at"])
    if not retry_failures:
        for row in previous.values():
            if row["status"] in {"blocked","401","403","429","451"} or row.get("error") in {"HTTP 429","bot challenge response; no workaround attempted"}:
                url=row.get("final_url") or row["url"]
                retriever.refusals[urlsplit(url).netloc]=url
    existing=sum(p.stat().st_size for p in (out/"documents").glob("*"))
    completed, counts, bytes_held, stopped = 0, Counter(), existing, None
    started=now_iso()
    def save(url,result,trail):
        nonlocal bytes_held
        record={"url":url,"final_url":result.url,"fetched_at":now_iso(),"status":str(result.status),"http_status":result.status if isinstance(result.status,int) else None,
                "redirects":trail,"error":result.error, "source_version":"retrieved now; historical applicability unverified",
                "public_display_approved":False,"model_ingestion_approved":False,
                "challenge_header":result.headers.get("x-amzn-waf-action") or result.headers.get("cf-mitigated")}
        if result.ok:
            digest=hashlib.sha256(result.content).hexdigest()
            doc=out / "documents" / digest
            record.update(sha256=digest,bytes=len(result.content),content_type=result.headers.get("content-type",""),etag=result.etag)
            if not doc.exists() and bytes_held+len(result.content)>max_total_bytes:
                record.update(status="budget",error="local source cache byte limit reached")
            else:
                if not doc.exists():
                    atomic_write(doc,result.content);bytes_held+=len(result.content)
                try:
                    extraction=extracted(result.content,record["content_type"].split(";")[0].lower(),result.url)
                    write_json(out / "text" / f"{digest}.json",extraction)
                    record.update(status="downloaded", extraction=extraction["status"],kind=extraction["kind"])
                except Exception as e:
                    record.update(status="downloaded",extraction="error",error=f"{type(e).__name__}: {e}"[:300])
        append_json(out/"attempts.jsonl",record);previous[url]=record
        return record
    try:
        with ThreadPoolExecutor(max_workers=workers) as pool:
            futures={}
            while hosts or long_queue or futures:
                if shutil.disk_usage(out).free<2*1024**3:
                    stopped="less than 2 GiB free disk space";hosts.clear();long_queue.clear()
                while (hosts or long_queue) and len(futures)<workers and stopped is None:
                    long_active = sum(host in long_hosts for host,_ in futures.values())
                    if long_queue and (not hosts or long_active < max(1,workers//2)):
                        _,host=heapq.heappop(long_queue)
                    elif hosts:
                        host=hosts.popleft()
                    else:
                        break
                    url=groups[host].popleft()
                    futures[pool.submit(retriever.get,url)]=(host,url)
                if not futures:
                    break
                done,_=wait(futures,timeout=1,return_when=FIRST_COMPLETED)
                for future in done:
                    host,url=futures.pop(future)
                    try:result,trail=future.result()
                    except Exception as e:result,trail=FetchResult(url,"error",error=f"{type(e).__name__}: {e}"[:300]),[]
                    record=save(url,result,trail);counts[record["status"]]+=1;completed+=1
                    if record["status"]=="budget":stopped="local source cache byte limit reached";hosts.clear();long_queue.clear()
                    if refused(result):
                        while groups[host]:
                            skipped = groups[host].popleft()
                            refusal=FetchResult(skipped,"host-refused",error=f"no request: host paused after refusal at {url}")
                            save(skipped,refusal,[]);counts["host-refused"]+=1;completed+=1
                    if groups[host] and stopped is None:
                        if host in long_hosts:heapq.heappush(long_queue,(-len(groups[host]),host))
                        else:hosts.append(host)
                    if completed%25==0 or record["status"] in {"budget","blocked"}:
                        write_json(out/"progress.json",{"started":started,"updated":now_iso(),"selected":pending,"completed":completed,"counts":dict(counts),"cache_bytes":bytes_held})
                        log(f"sources: {completed}/{pending} completed · {counts['downloaded']} downloaded · {bytes_held/1e6:.1f} MB",flush=True)
    finally:
        if own:retriever.close()
    statuses=Counter(previous[r["url"]]["status"] if r["url"] in previous else "pending" for r in catalogue)
    summary={"method":METHOD,"started":started,"finished":now_iso(),"selected":pending,"completed":completed,
             "counts":dict(statuses),"cache_bytes":bytes_held,"stopped":stopped,"ai_checks":0}
    write_json(out/"summary.json",summary)
    atomic_write(out/"failures.jsonl",("".join(json.dumps(r,ensure_ascii=False)+"\n" for r in previous.values() if r["status"]!="downloaded")).encode())
    return summary


def linked_documents(out, known_urls):
    """At most two explicit PDF downloads per short landing page; no site crawling.

    A linked report is a separate source, not automatically the evidence cited by a
    footnote. Keep the parent relationship for later human/AI applicability checks.
    """
    out=Path(out); found={}; known=set(known_urls); definitions={}
    for record in cached_records(out).values():
        if record.get("status")!="downloaded" or not record.get("sha256"):
            continue
        text=read_json(out/"text"/f'{record["sha256"]}.json',{})
        if text.get("kind")!="html" or len(text.get("text", ""))>5000:
            continue
        digest=record["sha256"]
        # Resolve relative download addresses for this URL, not another URL that
        # happened to return the same bytes. Also finds explicit PDF-labelled links.
        if digest not in definitions:
            try:
                root=html.fromstring((out/"documents"/digest).read_bytes())
                definitions[digest]=document_links(root)
            except (OSError,ValueError,etree.ParserError):
                definitions[digest]=text.get("document_links",[])
        choices=[]
        base=record.get("final_url") or record["url"]
        for link in definitions[digest]:
            url=source_url(link.get("href") or link.get("url"),base)
            if url and (len(text.get("text", ""))<1500 or re.search(r"download|full report|full text|pdf", link["label"], re.I)):
                choices.append({"url":url,"label":link["label"],"discovery":link.get("discovery","anchor")})
        for link in choices[:2]:
            if link["url"] in known:
                continue
            row=found.setdefault(link["url"],{"url":link["url"],"current":False,"linked_from":[],"cited_by":{}})
            row["linked_from"].append({"url":record["url"],"sha256":record["sha256"],"label":link["label"],"discovery":link["discovery"]})
    rows=sorted(found.values(),key=lambda r:r["url"])
    atomic_write(out/"linked-documents.jsonl",("".join(json.dumps(r,ensure_ascii=False)+"\n" for r in rows)).encode())
    return rows


def audit_collection(catalogue, out, linked=None):
    """Re-read actual files/hashes; distinguish saved bytes from usable extracted text."""
    out=Path(out);records=cached_records(out);counts=Counter();extractions=Counter();issues=[];checked=set()
    all_rows={r["url"]:r for r in [*catalogue,*(linked or [])]}
    for url in all_rows:
        record=records.get(url)
        if not record:
            counts["pending"]+=1;continue
        counts[record["status"]]+=1
        if record["status"]!="downloaded":continue
        digest=record.get("sha256")
        extra=read_json(out/"text"/f'{digest}.json',{})
        extra_status=extra.get("status","missing")
        extractions[extra_status]+=1
        if digest in checked:continue
        checked.add(digest)
        path=out/"documents"/str(digest)
        if not path.exists():
            issues.append({"url":url,"error":"missing source file","sha256":digest});continue
        actual=hashlib.sha256(path.read_bytes()).hexdigest()
        if actual!=digest:issues.append({"url":url,"error":"source hash mismatch","sha256":digest})
        if extra_status=="extracted" and not extra.get("text", "").strip():
            issues.append({"url":url,"error":"extraction marked successful without text","sha256":digest})
    result={"checked_at":now_iso(),"url_count":len(all_rows),"counts":dict(counts),"extractions":dict(extractions),
            "unique_documents":len(checked),"issues":issues,"ai_checks":0,"public_display_approved":False}
    write_json(out/"audit.json",result)
    return result


def inventory_paths(out):
    """Only the active inventory, retaining older index files as history."""
    out = Path(out)
    summary = read_json(out / "inventory.json", {})
    if "index_paths" in summary:
        return [out / rel for rel in summary["index_paths"]]
    return sorted((out / "index").glob("*/*/*.json"))


def export_lists(catalogue, out):
    """Human-readable CSV lists; source text itself stays in the private cache."""
    import csv
    def safe_row(values):
        # Keep spreadsheet text cells from becoming formulae. Exact hrefs stay in JSON.
        return ["'"+v if isinstance(v,str) and v[:1] in {"=","+","-","@","\t","\r"} else v for v in values]
    out=Path(out);records=cached_records(out)
    atomic_write(out/"urls.txt",("\n".join(r["url"] for r in catalogue)+"\n").encode())
    with (out/"sources.csv").open("w",encoding="utf-8-sig",newline="") as file:
        writer=csv.writer(file)
        writer.writerow(["URL","Current edition cites it","Editions citing it","Status","Extraction","Retrieved","Final URL","SHA256"])
        for row in catalogue:
            r=records.get(row["url"],{})
            writer.writerow(safe_row([row["url"],row["current"],len(row.get("cited_by",{})),r.get("status","pending"),r.get("extraction",""),r.get("fetched_at","") if r.get("status")=="downloaded" else "",r.get("final_url",""),r.get("sha256","")]))
    with (out/"footnotes.csv").open("w",encoding="utf-8-sig",newline="") as file:
        writer=csv.writer(file)
        writer.writerow(["Country","Report","Edition","CPIN text SHA256","CPIN provenance","Published","Footnote","Footnote text","Section and paragraph","Source URL","Original href","Mapping note","Link discovery","URL boundary needs check"])
        for p in inventory_paths(out):
            d=read_json(p)
            for f in d["footnotes"]:
                claims=[d["claims"][i] for i in f["claims"]]
                context=" | ".join(f'{c["section"]}: {c["paragraph"] or "unnumbered passage"}' for c in claims)
                problem="duplicate footnote ID" if f["id"] in d["diagnostics"]["duplicate_footnotes"] else "no citation marker found" if not claims else ""
                for link in f["links"] or [{"url":"","href":""}]:
                    mapping = " | ".join(filter(None,[problem,"invalid source URL" if link["href"] and not link["url"] else ""]))
                    writer.writerow(safe_row([d["country"],d["series"],d["editionId"],d["textSha"],d["source"],d["published"],f["number"],f["text"],context,link["url"],link["href"],mapping,link.get("discovery",""),bool(link.get("boundary_uncertain"))]))


def checked_source_copies(registry, caches):
    """Curated document matches require retained bytes matching their identity."""
    valid, issues = [], []
    for copy in registry.get('copies', []):
        digest = copy.get('sha256', '')
        if not re.fullmatch(r'[0-9a-f]{64}', digest):
            issues.append({'sha256':digest,'error':'invalid matching-copy identity'})
            continue
        path = next((Path(c)/'documents'/digest for c in caches if (Path(c)/'documents'/digest).is_file()), None)
        if path is None or hashlib.sha256(path.read_bytes()).hexdigest() != digest:
            issues.append({'sha256':digest,'error':'held matching copy missing or hash mismatch'})
            continue
        valid.append(copy)
    return valid, issues


def footnote_coverage(out):
    """Retrieval coverage, not correctness or a judgement about source use."""
    out=Path(out);records=cached_records(out);totals=Counter();countries=defaultdict(Counter);scopes=defaultdict(Counter)
    quality_by_url=read_json(out/"source-quality.json",{}).get("sources",{})
    for path in inventory_paths(out):
        edition=read_json(path)
        country=countries[edition["country"]]
        scope=scopes["current" if edition["current"] else "historical"]
        for f in edition["footnotes"]:
            urls={link["url"] for link in f["links"] if link["url"]}
            available=sum(records.get(u,{}).get("status")=="downloaded" and
                          quality_by_url.get(u,{}).get("readable_source",records.get(u,{}).get("extraction")=="extracted") for u in urls)
            state="no_http_source_link" if not urls else "all_linked_sources_have_text" if available==len(urls) else "some_linked_sources_have_text" if available else "no_linked_source_text"
            flags=["footnotes",state]
            if not f["claims"] or f["id"] in edition["diagnostics"]["duplicate_footnotes"]:
                flags.append("citation_mapping_needs_check")
            if any(link.get("boundary_uncertain") for link in f["links"]):
                flags.append("url_boundary_needs_check")
            for flag in flags:totals[flag]+=1;country[flag]+=1;scope[flag]+=1
    report={"checked_at":now_iso(),"basis":"retrieval and extraction only; source version and wording have not been verified",
            "totals":dict(totals),"by_country":{k:dict(v) for k,v in sorted(countries.items())},"by_scope":{k:dict(v) for k,v in scopes.items()}}
    write_json(out/"footnote-coverage.json",report)
    return report


def source_quality(record, text):
    """Conservative diagnostics for a fetched page; no judgement about the claim."""
    from .linkcheck import soft_404
    if record.get("challenge_header"):
        return {"state":"access_or_error_page", "reason":"explicit bot-challenge response header", "readable_source":False}
    title = text.get("title", "").strip()
    warning = soft_404(record["url"], record.get("final_url")) if record.get("final_url") != record["url"] else None
    if warning:
        return {"state":"redirect_needs_check", "reason":warning, "readable_source":False}
    if re.match(r"^(just a moment|access denied|attention required|robot check|human verification|verify (?:that )?you(?: are|'re) (?:a )?human|403 forbidden|404(?:\D|$)|page not found|not found)", title, re.I):
        return {"state":"access_or_error_page", "reason":f"returned page title: {title}", "readable_source":False}
    return {"state":text.get("status","missing"), "reason":"", "readable_source":text.get("status")=="extracted"}


def audit_quality(out):
    out=Path(out);records=cached_records(out);result={};counts=Counter()
    for url,record in records.items():
        if record["status"]!="downloaded" or not record.get("sha256"):continue
        text=read_json(out/"text"/f'{record["sha256"]}.json',{})
        verdict=source_quality(record,text)
        result[url]={"url":url,"sha256":record["sha256"],"method":"source-quality-v2",**verdict}
        counts[verdict["state"]]+=1
    write_json(out/"source-quality.json",{"checked_at":now_iso(),"counts":dict(counts),"sources":result})
    return result
