"""Polite HTTP client, after barrister-directory's scrapers/http.py.

- One honest User-Agent; no browser impersonation.
- robots.txt is honoured, including Crawl-delay.
- Requests to each host are spaced out (config.HOST_DELAY).
- 429/5xx/network errors are retried with backoff (Retry-After honoured). A 403 is
  reported as `blocked` and never worked around.
- ETags are sent back so unchanged resources come back as 304.
- Redirects are only followed when asked, and never off-site.
"""
import json
import time
from dataclasses import dataclass, field
from urllib.parse import urljoin, urlsplit
from urllib.robotparser import RobotFileParser

import httpx

from . import config

RETRY_STATUSES = {429, 500, 502, 503, 504}


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
                 transport: httpx.BaseTransport | None = None, sleep=time.sleep):
        self.user_agent = user_agent
        self.max_retries = max_retries
        self._sleep = sleep
        self._client = httpx.Client(timeout=timeout, follow_redirects=False, transport=transport,
                                    headers={"User-Agent": user_agent, "Accept-Language": "en-GB,en;q=0.8"})
        self._robots: dict[str, RobotFileParser] = {}
        self._delay: dict[str, float] = {}
        self._last: dict[str, float] = {}

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()

    def close(self):
        self._client.close()

    def _robots_for(self, scheme: str, host: str) -> RobotFileParser:
        origin = f"{scheme}://{host}"
        if origin not in self._robots:
            rp = RobotFileParser()
            try:
                r = self._client.get(origin + "/robots.txt", follow_redirects=True)
                # Standard behaviour: 4xx means "no rules"; 5xx means "assume disallowed".
                if r.status_code == 200:
                    rp.parse(r.text.splitlines())
                elif r.status_code >= 500:
                    rp.disallow_all = True
                else:
                    rp.allow_all = True
            except httpx.HTTPError:
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
        if not self._robots_for(parts.scheme, parts.netloc).can_fetch(self.user_agent, url):
            return FetchResult(url, "robots", error="disallowed by robots.txt")
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
                r = self._client.get(url, headers=headers)
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
