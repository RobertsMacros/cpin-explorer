"""The polite client (http.py): robots.txt decides before any page is asked for, and silence is not permission."""
import httpx
import pytest

from cpin.http import PoliteClient

PAGE = "https://www.gov.uk/api/content/some/page"


def client_for(handler, **kwargs):
    slept = []
    client = PoliteClient(transport=httpx.MockTransport(handler), sleep=slept.append, max_retries=1, **kwargs)
    return client, slept


def site(robots):
    """A handler that answers robots.txt with `robots` (a response, or an exception to raise) and any page with 200."""
    asked = []

    def handler(request: httpx.Request) -> httpx.Response:
        asked.append(request.url.path)
        if request.url.path == "/robots.txt":
            if isinstance(robots, Exception):
                raise robots
            return robots
        return httpx.Response(200, content=b"{}")
    return handler, asked


@pytest.mark.parametrize("robots", [httpx.ConnectError("connection refused"), httpx.ReadTimeout("timed out"),
                                    httpx.Response(503), httpx.Response(500), httpx.Response(429)])
def test_robots_txt_that_cannot_be_read_is_not_permission(robots):
    handler, asked = site(robots)
    client, _ = client_for(handler)
    result = client.get(PAGE)
    assert result.status == "robots" and not result.ok and "could not be read" in result.error
    assert asked == ["/robots.txt", "/robots.txt"], "asked again once, and the page never"
    assert client.get(PAGE).status == "robots" and len(asked) == 2, "nor is the host asked again in this run"
    again, _ = client_for(site(httpx.Response(404))[0])          # the next run asks afresh
    assert again.get(PAGE).ok


@pytest.mark.parametrize("status", [404, 410])
def test_a_host_with_no_robots_txt_has_no_rules(status):
    handler, asked = site(httpx.Response(status))
    client, _ = client_for(handler)
    assert client.get(PAGE).ok and asked == ["/robots.txt", "/api/content/some/page"]


@pytest.mark.parametrize("status", [401, 403, 451])
def test_a_refused_robots_file_is_unknown_not_permission(status):
    handler, asked = site(httpx.Response(status))
    client, _ = client_for(handler)
    assert client.get(PAGE).status == "robots" and asked == ["/robots.txt"]


def test_robots_txt_that_recovers_on_the_second_try_is_read():
    answers = iter([httpx.Response(503), httpx.Response(200, text="User-agent: *\nDisallow: /api/content/some")])

    def handler(request):
        return next(answers) if request.url.path == "/robots.txt" else httpx.Response(200, content=b"{}")
    client, _ = client_for(handler)
    result = client.get(PAGE)
    assert result.status == "robots" and result.error == "disallowed by robots.txt"
    assert client.get("https://www.gov.uk/api/content/other").ok


def test_crawl_delay_is_honoured_when_it_is_longer_than_our_own():
    handler, _ = site(httpx.Response(200, text="User-agent: *\nCrawl-delay: 7\nDisallow:"))
    client, slept = client_for(handler)
    assert client.get(PAGE).ok and client.get(PAGE).ok
    assert slept and 6 < max(slept) <= 7, "the second request waited for the delay the site asks for"


def test_the_national_archives_is_never_fetched_even_for_robots(site, client):
    result = client.get('https://webarchive.nationalarchives.gov.uk/ukgwa/timeline/https://www.gov.uk/example')
    assert result.status == 'robots' and not site.requests


def test_robots_redirect_cannot_contact_the_national_archives():
    asked = []
    def handler(request):
        asked.append(str(request.url))
        return httpx.Response(302, headers={"location": "https://webarchive.nationalarchives.gov.uk/robots.txt"})
    client, _ = client_for(handler)
    assert client.get(PAGE).status == "robots"
    assert all("nationalarchives" not in url for url in asked)
