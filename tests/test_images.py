from conftest import BODY, NOTE_PATH, govuk

from cpin import verify
from cpin.images import image_urls
from cpin.sync import sync

NOTE = NOTE_PATH.rsplit("/", 1)[-1]
SVG_URL = "https://assets.publishing.service.gov.uk/media/xyz/map-of-kenya.svg"
SVG = b'<svg xmlns="http://www.w3.org/2000/svg"><circle r="4"/></svg>'
BODY_WITH_MAP = BODY.replace("</div>", f'<figure class="image embedded"><div class="img"><img src="{SVG_URL}" alt=""></div></figure></div>')


def serve_map(site, data=SVG, etag='"m1"'):
    site.raw(SVG_URL, data, etag=etag, content_type="image/svg+xml")


def test_image_urls_are_absolute_and_deduplicated():
    body = '<p><img src="/media/a.png"><img src="https://assets.publishing.service.gov.uk/b.svg"><img src="/media/a.png"></p>'
    assert image_urls(body) == ["https://www.gov.uk/media/a.png", "https://assets.publishing.service.gov.uk/b.svg"]


def test_sync_mirrors_embedded_images_without_touching_the_body(site, client, store):
    govuk(site, body=BODY_WITH_MAP)
    serve_map(site)
    report = sync(client, store)
    assert report.images["downloaded"] == 1
    entry = store.load_image_manifest()[SVG_URL]
    assert entry["ext"] == ".svg" and entry["used_by"] == [f"kenya/{NOTE}"]
    assert store.image_path(entry["sha256"], ".svg").read_bytes() == SVG
    index = store.load_note("kenya", NOTE)
    assert store.read_body("kenya", NOTE, index["current_sha256"]) == BODY_WITH_MAP     # src unchanged


def test_unchanged_image_costs_a_304_and_verify_counts_it(site, client, store):
    govuk(site, body=BODY_WITH_MAP)
    serve_map(site)
    sync(client, store)
    report = sync(client, store, full=True)
    assert report.images["unchanged"] == 1 and report.images["downloaded"] == 0
    complete = verify.check_complete(store)
    assert complete["counts"]["images_used"] == complete["counts"]["images_mirrored"] == 1
    assert verify.check_integrity(store)["images_ok"] == 1


def test_image_in_manifest_but_not_on_disk_is_fetched_again(site, client, store):
    # A fresh checkout (e.g. the deploy job) has the manifest from git but not the files.
    govuk(site, body=BODY_WITH_MAP)
    serve_map(site)
    sync(client, store)
    entry = store.load_image_manifest()[SVG_URL]
    store.image_path(entry["sha256"], ".svg").unlink()
    report = sync(client, store, full=True)
    assert report.images["downloaded"] == 1
    assert store.image_path(entry["sha256"], ".svg").read_bytes() == SVG


def test_missing_image_is_reported_not_fatal(site, client, store):
    govuk(site, body=BODY_WITH_MAP)                    # the image URL is never served: 404
    report = sync(client, store)
    assert any(e["url"] == SVG_URL for e in report.errors)
    assert verify.check_complete(store)["problems"][0]["problem"] == "image not mirrored"
