import httpx
import pytest

from cpin.deploy_images import MAX_IMAGE_BYTES, PUBLISHED_SITE, prepare_images
from cpin.fingerprint import sha256_bytes
from conftest import BODY, NOTE_PATH

URL = "https://assets.publishing.service.gov.uk/media/retired/map.svg"
SVG = b'<svg xmlns="http://www.w3.org/2000/svg"><circle r="4"/></svg>'


def record_image(store):
    sha = sha256_bytes(SVG)
    store.save_image_manifest({URL: {"sha256": sha, "ext": ".svg", "bytes": len(SVG)}})
    return sha


def published(site):
    return httpx.Client(transport=httpx.MockTransport(site.handler), follow_redirects=False)


def test_retired_source_restored_from_exact_published_copy(site, client, store):
    sha = record_image(store)
    body = BODY + f'<img src="{URL}">'
    note = NOTE_PATH.rsplit("/", 1)[-1]
    store.record_version("kenya", note, body=body, meta={}, seen_at="2026-10-06T00:00:00Z",
                         source="govuk", title="A note", base_path=NOTE_PATH)
    site.fail(URL, 410)
    site.raw(f"{PUBLISHED_SITE}/data/images/files/{sha}.svg", SVG)
    before = store.load_image_manifest()
    with published(site) as backup:
        result = prepare_images(store, client, backup, sleep=lambda _: None)
    assert result["restored"] == 1 and result["missing"] == []
    assert URL not in site.requests  # retirement never prevents reuse of the verified copy
    assert store.load_image_manifest() == before
    assert store.image_path(sha, ".svg").read_bytes() == SVG
    assert store.read_body("kenya", note, sha256_bytes(body.encode())) == body


def test_valid_cache_does_not_request_source_or_backup(site, client, store):
    sha = record_image(store)
    store.write_image(sha, ".svg", SVG)
    with published(site) as backup:
        result = prepare_images(store, client, backup, refs={URL: {"kenya/note"}}, sleep=lambda _: None)
    assert result["held"] == 1 and result["missing"] == []
    assert site.requests == []


def test_corrupt_cache_is_repaired_only_with_matching_backup(site, client, store):
    sha = record_image(store)
    store.write_image(sha, ".svg", b"corrupt")
    site.raw(f"{PUBLISHED_SITE}/data/images/files/{sha}.svg", SVG)
    with published(site) as backup:
        result = prepare_images(store, client, backup, refs={URL: {"kenya/note"}}, sleep=lambda _: None)
    assert result["restored"] == 1 and result["missing"] == []
    assert store.image_path(sha, ".svg").read_bytes() == SVG


def test_wrong_backup_and_gone_source_leave_explicit_failure(site, client, store):
    sha = record_image(store)
    site.raw(f"{PUBLISHED_SITE}/data/images/files/{sha}.svg", b"unrelated")
    site.fail(URL, 410)
    with published(site) as backup:
        result = prepare_images(store, client, backup, refs={URL: {"kenya/note"}}, sleep=lambda _: None)
    assert result["missing"] == [URL]
    assert result["backup_gaps"][0]["reason"] == "hash mismatch"
    assert result["source_errors"][0]["status"] == 410
    assert not store.image_path(sha, ".svg").exists()


def test_new_image_uses_normal_source_client(site, client, store):
    site.raw(URL, SVG, content_type="image/svg+xml")
    with published(site) as backup:
        result = prepare_images(store, client, backup, refs={URL: {"kenya/note"}}, sleep=lambda _: None)
    assert result["source_downloaded"] == 1 and result["missing"] == []
    assert site.requests == [URL]


@pytest.mark.parametrize("kind", ["redirect", "oversize"])
def test_backup_redirect_and_oversize_are_not_accepted(site, client, store, kind):
    sha = record_image(store)
    def handler(req):
        if kind == "redirect":
            return httpx.Response(302, headers={"location": "https://example.org/leak"})
        return httpx.Response(200, content=b"short", headers={"content-length": str(MAX_IMAGE_BYTES + 1)})
    site.fail(URL, 410)
    with httpx.Client(transport=httpx.MockTransport(handler)) as backup:
        result = prepare_images(store, client, backup, refs={URL: {"kenya/note"}}, sleep=lambda _: None)
    assert result["missing"] == [URL]
    assert not store.image_path(sha, ".svg").exists()


def test_unsafe_manifest_cannot_choose_backup_or_file_path(site, client, store):
    store.save_image_manifest({URL: {"sha256": "../outside", "ext": ".svg"}})
    with published(site) as backup, pytest.raises(ValueError, match="Unsafe image filename"):
        prepare_images(store, client, backup, refs={URL: {"kenya/note"}}, sleep=lambda _: None)
    assert site.requests == []
