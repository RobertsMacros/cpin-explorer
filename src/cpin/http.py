"""Polite HTTP client, after barrister-directory's scrapers/http.py.

- One honest User-Agent; no browser impersonation.
- robots.txt is honoured, including Crawl-delay. One that cannot be read (a network error, a 5xx, a 429)
  is not permission: nothing is asked of that host for the rest of the run.
- Requests to each host are spaced out (config.HOST_DELAY).
- 429/5xx/network errors are retried with backoff (Retry-After honoured). A 403 is
  reported as `blocked` and never worked around.
- ETags are sent back so unchanged resources come back as 304.
- Redirects are only followed when asked, and never off-site.
"""
import json
import time
from datetime import datetime, timezone
from dataclasses import dataclass, field
from urllib.parse import urljoin, urlsplit
from urllib.robotparser import RobotFileParser

import httpx

from . import config

RETRY_STATUSES = {429, 500, 502, 503, 504}


class ResponseTooLarge(ValueError):
    """A bounded source request exceeded its decoded-body limit."""


def bounded_get(client, url, *, max_bytes=None, url_guard=None, **kwargs):
    if url_guard is not None and not url_guard(url):
        raise ValueError("URL is not an allowed public HTTP address")
    if max_bytes is None:
        return client.get(url, **kwargs)
    with client.stream("GET", url, **kwargs) as r:
        if r.status_code != 200:
            payload = b""  # error/redirect pages are not evidence
        else:
            length = r.headers.get("content-length", "")
            if length.isdigit() and int(length) > max_bytes:
                raise ResponseTooLarge(f"response exceeds {max_bytes} bytes")
            chunks, size = [], 0
            for chunk in r.iter_bytes(chunk_size=65536):
                size += len(chunk)
                if size > max_bytes:
                    raise ResponseTooLarge(f"response exceeds {max_bytes} decoded bytes")
                chunks.append(chunk)
            payload = b"".join(chunks)
        headers = {k:v for k,v in r.headers.items() if k not in {"content-encoding", "content-length"}}
        return httpx.Response(r.status_code, headers=headers, content=payload, request=r.request)


def robots_response(client, url, *, max_bytes=None, url_guard=None, **kwargs):
    """Read robots redirects explicitly so a forbidden archive host is never contacted."""
    for _ in range(6):
        p = urlsplit(url)
        if p.hostname == "webarchive.nationalarchives.gov.uk" or p.scheme not in {"http", "https"}:
            raise ValueError("robots redirect cannot be fetched automatically")
        r = bounded_get(client, url, follow_redirects=False, max_bytes=max_bytes, url_guard=url_guard, **kwargs)
        if r.status_code not in {301, 302, 303, 307, 308}:
            return r
        if not r.headers.get("location"):
            raise ValueError("robots redirect has no address")
        url = urljoin(url, r.headers["location"])
    raise ValueError("too many robots redirects")


@dataclass
class FetchResult:
    url: str
    status: int | str            # HTTP status, or 'blocked' / 'robots' / 'error'
    content: bytes = b""
    etag: str | None = None
    location: str | None = None
    error: str | None = None
    headers: dict = field(default_factory=dict)

    @property
    def ok(self) -> bool:
        return self.status == 200

    @property
    def not_modified(self) -> bool:
        return self.status == 304

    @property
    def text(self) -> str:
        return self.content.decode("utf-8", errors="replace")

    def json(self):
        return json.loads(self.content)


class PoliteClient:
    def __init__(self, user_agent: str = config.USER_AGENT, timeout: float = 60, max_retries: int = 3,
                 transport: httpx.BaseTransport | None = None, sleep=time.sleep,
                 max_bytes: int | None = None, url_guard=None):
        self.max_bytes, self.url_guard = max_bytes, url_guard
        self.user_agent = user_agent
        self.max_retries = max_retries
        self._sleep = sleep
        self._client = httpx.Client(timeout=timeout, follow_redirects=False, transport=transport,
                                    headers={"User-Agent": user_agent, "Accept-Language": "en-GB,en;q=0.8"})
        self._robots: dict[str, RobotFileParser] = {}
        self._unread: dict[str, str] = {}             # origin -> why its robots.txt could not be read
        self._delay: dict[str, float] = {}
        self._last: dict[str, float] = {}

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()

    def close(self):
        self._client.close()

    def remember_request(self, url: str, fetched_at: str):
        """Restore host spacing from a durable receipt when a collector resumes."""
        try:
            stamp = datetime.fromisoformat(fetched_at.replace("Z", "+00:00"))
            elapsed = max(0, (datetime.now(timezone.utc) - stamp).total_seconds())
            last = time.monotonic() - elapsed
            host = urlsplit(url).netloc
            self._last[host] = max(last, self._last.get(host, last))
        except (ValueError, TypeError):
            pass

    def _robots_for(self, scheme: str, host: str) -> RobotFileParser:
        origin = f"{scheme}://{host}"
        if origin not in self._robots:
            rp = RobotFileParser()
            # Standard behaviour (RFC 9309): 4xx means "no rules"; a 5xx or a network error means the rules
            # are unknown, which is "assume disallowed", never "allowed". A 429 is the host asking us to wait,
            # so it is read the same way. Asked again, after a pause, before giving up for this run.
            unread = None
            for attempt in range(self.max_retries + 1):
                try:
                    r = robots_response(self._client, origin + "/robots.txt",
                                        max_bytes=min(self.max_bytes, 1024 * 1024) if self.max_bytes else None, url_guard=self.url_guard)
                    unread = f"HTTP {r.status_code}" if r.status_code in RETRY_STATUSES | {401, 403, 451} or 300 <= r.status_code < 400 else None
                except (httpx.HTTPError, ValueError) as e:
                    r, unread = None, f"{type(e).__name__}: {e}"[:200]
                if unread is None or (r is not None and r.status_code in {401, 403, 451}) or attempt == self.max_retries:
                    break
                self._sleep(2.0 ** (attempt + 1))
            if unread:
                rp.disallow_all = True
                self._unread[origin] = unread
            elif r.status_code == 200:
                rp.parse(r.text.splitlines())
            else:
                rp.allow_all = True
            self._robots[origin] = rp
            crawl = None if (rp.allow_all or rp.disallow_all) else rp.crawl_delay(self.user_agent)
            self._delay[host] = max(float(crawl or 0), config.HOST_DELAY.get(host, config.DEFAULT_DELAY))
        return self._robots[origin]

    def get(self, url: str, *, etag: str | None = None, accept: str | None = None,
            follow: bool = False, max_hops: int = 5) -> FetchResult:
        """GET with robots, throttling and retries. With follow=True, same-host redirects are followed."""
        result = self._get_once(url, etag=etag, accept=accept)
        for _ in range(max_hops):
            is_redirect = isinstance(result.status, int) and 300 <= result.status < 400 and result.status != 304
            if not (follow and is_redirect and result.location):
                break
            nxt = urljoin(result.url, result.location)
            if urlsplit(nxt).netloc != urlsplit(result.url).netloc:
                break                    # never follow off-site
            result = self._get_once(nxt, etag=None, accept=accept)
        return result

    def _get_once(self, url: str, *, etag: str | None, accept: str | None) -> FetchResult:
        parts = urlsplit(url)
        if self.url_guard is not None and not self.url_guard(url):
            return FetchResult(url, "unsafe", error="URL is not an allowed public HTTP address")
        if parts.hostname == "webarchive.nationalarchives.gov.uk":
            return FetchResult(url, "robots", error="National Archives: manual checking only")
        if not self._robots_for(parts.scheme, parts.netloc).can_fetch(self.user_agent, url):
            unread = self._unread.get(f"{parts.scheme}://{parts.netloc}")
            return FetchResult(url, "robots", error=f"robots.txt could not be read ({unread}), so nothing was asked of this host"
                               if unread else "disallowed by robots.txt")
        headers = {}
        if etag:
            headers["If-None-Match"] = etag
        if accept:
            headers["Accept"] = accept
        host = parts.netloc
        error = None
        for attempt in range(self.max_retries + 1):
            wait = self._last.get(host, 0) + self._delay.get(host, config.DEFAULT_DELAY) - time.monotonic()
            if wait > 0:
                self._sleep(wait)
            backoff = 2.0 ** (attempt + 1)
            try:
                r = bounded_get(self._client, url, headers=headers, max_bytes=self.max_bytes, url_guard=self.url_guard)
            except ResponseTooLarge as e:
                return FetchResult(url, "too-large", error=str(e))
            except ValueError as e:
                return FetchResult(url, "unsafe", error=str(e))
            except httpx.HTTPError as e:
                r, error = None, f"{type(e).__name__}: {e}"[:200]
            finally:
                self._last[host] = time.monotonic()
            if r is not None:
                if r.status_code == 403:
                    return FetchResult(url, "blocked", error="403 Forbidden")
                if r.status_code not in RETRY_STATUSES:
                    return FetchResult(url, r.status_code, r.content, r.headers.get("etag"),
                                       r.headers.get("location"), headers=dict(r.headers))
                error = f"HTTP {r.status_code}"
                retry_after = r.headers.get("retry-after", "")
                if retry_after.isdigit():
                    backoff = min(float(retry_after), 120.0)
            if attempt < self.max_retries:
                self._sleep(backoff)
        return FetchResult(url, "error", error=error)
