import json

import httpx
import pytest

from cpin.linkcheck import check_links, classify, export_link_status

LINKS = {
    "https://ok.example/report": "ok",
    "https://moves.example/old": "moved",
    "https://gone.example/page": "broken",
    "https://nohead.example/doc": "ok",
    "https://walled.example/news": "restricted",
    "https://dead-host.example/x": "unreachable",
    "https://polite.example/private/doc": "robots",
}


class FakeWeb:
    def __init__(self):
        self.requests = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        url, host, method = str(request.url), request.url.host, request.method
        self.requests.append((method, url))
        if host == "archive.org":
            return httpx.Response(200, json={"archived_snapshots": {"closest": {
                "available": True, "status": "200", "timestamp": "20250102030405",
                "url": "http://web.archive.org/web/20250102030405/https://gone.example/page"}}})
        if request.url.path == "/robots.txt":
            if host == "polite.example":
                return httpx.Response(200, text="User-agent: *\nDisallow: /private")
            return httpx.Response(404)
        if host == "dead-host.example":
            raise httpx.ConnectError("name or service not known", request=request)
        if host == "ok.example":
            return httpx.Response(200)
        if host == "moves.example":
            if request.url.path == "/old":
                return httpx.Response(301, headers={"location": "https://new-home.example/report"})
        if host == "new-home.example":
            return httpx.Response(200)
        if host == "gone.example":
            return httpx.Response(404)
        if host == "nohead.example":
            return httpx.Response(405) if method == "HEAD" else httpx.Response(200)
        if host == "walled.example":
            return httpx.Response(403)
        return httpx.Response(500)


@pytest.fixture
def store_with_links(store):
    body = "<div class='govspeak'>" + "".join(f'<p><a href="{u}#frag">source</a></p>' for u in LINKS) + \
           '<p><a href="#fn:1">[footnote 1]</a> <a href="mailto:x@y.z">mail</a></p></div>'
    store.record_version("kenya", "note-a", body=body, meta={}, seen_at="2026-10-02T00:00:00Z", source="live",
                         title="Country policy and information note: actors of protection, Kenya, July 2026",
                         base_path="/government/publications/kenya/note-a", public_updated_at="2026-07-27T10:00:00Z")
    index = store.load_note("kenya", "note-a")
    store.set_current("kenya", "note-a", index["versions"][0]["sha256"], at="2026-10-02T00:00:00Z")
    return store


def test_each_kind_of_outcome_is_classified(store_with_links):
    web = FakeWeb()
    summary = check_links(store_with_links, transport=httpx.MockTransport(web), sleep=lambda s: None, log=lambda m: None)
    manifest = json.loads((store_with_links.root / "links" / "manifest.json").read_text())
    assert {u: manifest[u]["status"] for u in LINKS} == LINKS
    assert manifest["https://moves.example/old"]["final_url"] == "https://new-home.example/report"
    assert manifest["https://gone.example/page"]["archived_url"].startswith("https://web.archive.org/web/2025")
    assert manifest["https://gone.example/page"]["used_by"] == ["kenya/note-a"]
    assert summary["ok"] == 2 and summary["restricted"] == 1
    # fragments are stripped, anchors and mailto links are not checked, robots-disallowed URLs are not fetched
    assert not any("polite.example/private" in u for m, u in web.requests if m in ("HEAD", "GET"))


def test_recently_checked_links_are_not_rechecked(store_with_links):
    run = lambda: check_links(store_with_links, transport=httpx.MockTransport(FakeWeb()), sleep=lambda s: None,
                              log=lambda m: None)
    run()
    web = FakeWeb()
    check_links(store_with_links, transport=httpx.MockTransport(web), sleep=lambda s: None, log=lambda m: None)
    assert web.requests == []


def test_export_writes_per_country_status(store_with_links, tmp_path):
    check_links(store_with_links, transport=httpx.MockTransport(FakeWeb()), sleep=lambda s: None, log=lambda m: None)
    assert export_link_status(store_with_links, tmp_path) == 1
    kenya = json.loads((tmp_path / "kenya.json").read_text())
    assert kenya["https://gone.example/page"]["status"] == "broken"


def test_https_upgrade_or_trailing_slash_is_not_a_move():
    assert classify(200, "http://a.example/x", "https://a.example/x/", None) == "ok"
    assert classify(200, "https://a.example/x", "https://b.example/x", None) == "moved"


@pytest.mark.parametrize("url, final", [
    ("http://cri.org.bd/publication/report.pdf", "http://cri.org.bd/cgi-sys/suspendedpage.cgi"),
    ("https://ngo.example/reports/2019/torture", "https://ngo.example/"),
    ("https://old-ngo.example/report", "https://www.hugedomains.com/domain_profile.cfm?d=old-ngo.example"),
    ("https://site.example/news/123", "https://site.example/page-not-found"),
])
def test_soft_404s_count_as_broken(url, final):
    assert classify(200, url, final, None) == "broken"


def test_moving_from_a_home_page_to_a_home_page_is_fine():
    assert classify(200, "https://ngo.example/", "https://www.ngo.example/en", None) != "broken"
