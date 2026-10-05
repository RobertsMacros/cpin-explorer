import json

import httpx
import pytest

from cpin.linkcheck import check_links, cited_urls, classify, export_link_status

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
        if host == "dead-host.example":                      # gone altogether: robots.txt cannot be reached either
            raise httpx.ConnectError("name or service not known", request=request)
        if request.url.path == "/robots.txt":
            if host == "polite.example":
                return httpx.Response(200, text="User-agent: *\nDisallow: /private")
            if host == "flaky.example":
                return httpx.Response(503)
            if host == "slow.example":
                return httpx.Response(200, text="User-agent: *\nCrawl-delay: 9")
            return httpx.Response(404)
        if host in ("flaky.example", "slow.example"):
            return httpx.Response(200)
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
    # A host whose robots.txt cannot be reached is unreachable: that is recorded, and its page is never asked for.
    assert asked_of(web, "dead-host.example") == [("GET", "https://dead-host.example/robots.txt")]
    assert manifest["https://dead-host.example/x"]["asked"] == "robots.txt" and "asked" not in manifest["https://ok.example/report"]


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


def test_a_country_with_no_checked_links_still_gets_a_file(store_with_links, tmp_path):
    """Its only report is a PDF: the reader asks for a file per country, and a missing one is an error in its log."""
    store_with_links.country_dir("gambia").mkdir(parents=True)
    check_links(store_with_links, transport=httpx.MockTransport(FakeWeb()), sleep=lambda s: None, log=lambda m: None)
    assert export_link_status(store_with_links, tmp_path) == 1, "still one country with links"
    assert json.loads((tmp_path / "gambia.json").read_text()) == {}


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


def asked_of(web, host: str) -> list[tuple]:
    """The requests made to one host, in order."""
    return [(m, u) for m, u in web.requests if httpx.URL(u).host == host]


def store_citing(store, *urls):
    body = "<div class='govspeak'>" + "".join(f'<p><a href="{u}">source</a></p>' for u in urls) + "</div>"
    store.record_version("kenya", "note-b", body=body, meta={}, seen_at="2026-10-02T00:00:00Z", source="live",
                         title="Country policy and information note: actors of protection, Kenya, July 2026",
                         base_path="/government/publications/kenya/note-b", public_updated_at="2026-07-27T10:00:00Z")
    store.set_current("kenya", "note-b", store.load_note("kenya", "note-b")["versions"][0]["sha256"], at="2026-10-02T00:00:00Z")
    return store


def test_a_site_whose_robots_txt_answers_with_a_server_error_is_asked_for_nothing_else(store):
    store_citing(store, "https://flaky.example/a", "https://flaky.example/b")
    web = FakeWeb()
    check_links(store, transport=httpx.MockTransport(web), sleep=lambda s: None, log=lambda m: None)
    assert asked_of(web, "flaky.example") == [("GET", "https://flaky.example/robots.txt")]
    manifest = json.loads((store.root / "links" / "manifest.json").read_text())
    for url in ("https://flaky.example/a", "https://flaky.example/b"):       # recorded as what the site answered, and to what
        assert (manifest[url]["status"], manifest[url]["code"], manifest[url]["asked"]) == ("server-error", 503, "robots.txt")

    class Well(FakeWeb):                                     # the site is well again: it has no robots.txt
        def __call__(self, request):
            if request.url.host == "flaky.example" and request.url.path == "/robots.txt":
                return httpx.Response(404)
            return super().__call__(request)
    check_links(store, max_age_days=-1, transport=httpx.MockTransport(Well()), sleep=lambda s: None, log=lambda m: None)
    manifest = json.loads((store.root / "links" / "manifest.json").read_text())
    assert manifest["https://flaky.example/a"]["status"] == "ok" and "asked" not in manifest["https://flaky.example/a"]


def test_a_sites_crawl_delay_is_honoured(store):
    store_citing(store, "https://slow.example/1", "https://slow.example/2", "https://ok.example/report")
    slept = []
    check_links(store, transport=httpx.MockTransport(FakeWeb()), sleep=slept.append, log=lambda m: None, workers=1)
    assert slept.count(9.0) == 1, "nine seconds between the two requests to the site that asks for it"
    manifest = json.loads((store.root / "links" / "manifest.json").read_text())
    assert manifest["https://slow.example/1"]["status"] == manifest["https://slow.example/2"]["status"] == "ok"


def test_a_link_is_dated_by_the_notes_own_date_not_the_country_pages(store):
    """GOV.UK dates a note by its country page, which moves when any note there changes. The archived copy of a
    dead link must be the one nearest to when the Home Office read the page: the note's "valid from" date."""
    body = ('<div class="govspeak"><p><a href="https://gone.example/page">source</a></p>'
            '<h2>Version control</h2><ul><li>version 1.0</li><li>valid from 5 July 2022</li></ul></div>')
    store.record_version("kenya", "note-a", body=body, meta={}, seen_at="2026-10-02T00:00:00Z", source="live",
                         title="Country policy and information note: actors of protection, Kenya, July 2022",
                         base_path="/government/publications/kenya/note-a", public_updated_at="2026-09-01T14:41:42Z")
    index = store.load_note("kenya", "note-a")
    store.set_current("kenya", "note-a", index["versions"][0]["sha256"], at="2026-10-02T00:00:00Z")
    assert cited_urls(store)["https://gone.example/page"]["cited_at"] == "2022-07-05T00:00:00Z"

    web = FakeWeb()
    check_links(store, transport=httpx.MockTransport(web), sleep=lambda s: None, log=lambda *a: None)
    asked = [u for m, u in web.requests if "archive.org/wayback/available" in u]
    assert len(asked) == 1 and asked[0].endswith("timestamp=20220705")
    path = store.root / "links" / "manifest.json"
    assert json.loads(path.read_text())["https://gone.example/page"]["archived_for"] == "2022-07-05"


def test_a_copy_sought_for_another_date_is_looked_up_again(store):
    """A manifest from before the note's own date was used holds copies found near the page's date."""
    body = ('<div class="govspeak"><p><a href="https://gone.example/page">source</a></p>'
            '<h2>Version control</h2><ul><li>version 1.0</li><li>valid from 5 July 2022</li></ul></div>')
    store.record_version("kenya", "note-a", body=body, meta={}, seen_at="2026-10-02T00:00:00Z", source="live",
                         title="t", base_path="/government/publications/kenya/note-a", public_updated_at="2026-09-01T14:41:42Z")
    index = store.load_note("kenya", "note-a")
    store.set_current("kenya", "note-a", index["versions"][0]["sha256"], at="2026-10-02T00:00:00Z")
    path = store.root / "links" / "manifest.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    from cpin.store import now_iso
    path.write_text(json.dumps({"https://gone.example/page": {
        "status": "broken", "code": 404, "checked_at": now_iso(), "kind": "external", "cited_at": "2026-09-01T14:41:42Z",
        "used_by": ["kenya/note-a"], "archived_url": "https://web.archive.org/web/20260901000000/https://gone.example/page",
        "archived_at": "2026-09-01T00:00:00Z"}}))

    web = FakeWeb()
    check_links(store, transport=httpx.MockTransport(web), sleep=lambda s: None, log=lambda *a: None)
    assert [u for m, u in web.requests if "archive.org" in u and u.endswith("timestamp=20220705")], "looked up again, for the note's date"
    assert not [u for m, u in web.requests if u.startswith("https://gone.example")], "the link itself was checked recently and is not fetched again"
    entry = json.loads(path.read_text())["https://gone.example/page"]
    assert entry["archived_for"] == "2022-07-05" and entry["cited_at"] == "2022-07-05T00:00:00Z"

    again = FakeWeb()
    check_links(store, transport=httpx.MockTransport(again), sleep=lambda s: None, log=lambda *a: None)
    assert not [u for m, u in again.requests if "archive.org" in u], "and not a third time"

@pytest.mark.parametrize('code', [403, 429])
def test_access_refusals_are_not_retried_with_get(code):
    from cpin.linkcheck import SiteChecker
    requests = []
    def respond(request):
        requests.append((request.method, request.url.path))
        return httpx.Response(404 if request.url.path == '/robots.txt' else code)
    with httpx.Client(transport=httpx.MockTransport(respond)) as client:
        assert SiteChecker(client, sleep=lambda _: None).run(['https://refused.example/doc'])['https://refused.example/doc']['status'] == 'restricted'
    assert requests == [('GET', '/robots.txt'), ('HEAD', '/doc')]


def test_redirect_destination_is_checked_against_its_own_robots():
    from cpin.linkcheck import SiteChecker
    requests = []
    def respond(request):
        requests.append(str(request.url))
        if request.url.host == 'target.example':
            assert request.url.path == '/robots.txt', 'a forbidden redirect must not fetch its page'
            return httpx.Response(200, text='User-agent: *\nDisallow: /')
        if request.url.path == '/robots.txt': return httpx.Response(404)
        return httpx.Response(301, headers={'location': 'https://target.example/private'})
    with httpx.Client(transport=httpx.MockTransport(respond)) as client:
        result = SiteChecker(client, sleep=lambda _: None).run(['https://start.example/doc'])
    assert result['https://start.example/doc']['status'] == 'robots'
    assert 'https://target.example/robots.txt' in requests


@pytest.mark.parametrize('closest', [[], {'available': True, 'status': '200'},
                                      {'available': True, 'timestamp': 'bad', 'url': 'https://example.org'}])
def test_a_malformed_archive_answer_is_a_failure_not_an_absent_capture(closest):
    from cpin.http import PoliteClient
    from cpin.linkcheck import archived_copy
    def response(request):
        if request.url.path == '/robots.txt':
            return httpx.Response(404)
        return httpx.Response(200, json={'archived_snapshots': {'closest': closest}})
    with PoliteClient(transport=httpx.MockTransport(response), sleep=lambda _: None) as client:
        if closest == []:  # An empty result has no capture to offer.
            assert archived_copy(client, 'https://example.org/note', '2026-10-04') is None
        else:
            with pytest.raises(RuntimeError, match='archive lookup failed'):
                archived_copy(client, 'https://example.org/note', '2026-10-04')
