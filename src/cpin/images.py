"""Mirror the images (mostly SVG maps and charts) that note bodies embed.

GOV.UK serves them from its asset host; when an edition is retired its images can go with it.
Images are stored by sha256 like the PDFs. Note bodies are never rewritten: the site swaps in
the mirrored copy when it renders a note.
"""
from urllib.parse import urljoin

from lxml import html as lxml_html

from . import config
from .fingerprint import sha256_bytes
from .http import PoliteClient
from .store import Store

EXTENSIONS = {"image/svg+xml": ".svg", "image/png": ".png", "image/jpeg": ".jpg", "image/gif": ".gif", "image/webp": ".webp"}


def image_urls(body_html: str) -> list[str]:
    """Absolute URLs of every <img> in a body, in order, without duplicates."""
    if not body_html or not body_html.strip():
        return []
    root = lxml_html.fragment_fromstring(body_html, create_parent="div")
    urls = [urljoin(config.GOVUK + "/", img.get("src")) for img in root.iter("img") if img.get("src")]
    return list(dict.fromkeys(urls))


def current_image_refs(store: Store, countries: set[str] | None = None) -> dict[str, set[str]]:
    """Image URL -> the 'country/note' keys of current notes that use it."""
    refs: dict[str, set[str]] = {}
    for country, note, index in store.iter_notes():
        if (countries and country not in countries) or index.get("status") != "live":
            continue
        for url in image_urls(store.read_body(country, note, index["current_sha256"])):
            refs.setdefault(url, set()).add(f"{country}/{note}")
    return refs


def every_image_ref(store: Store) -> dict[str, set[str]]:
    """Image URL -> the 'country/note' keys of every edition held that uses it: current, replaced, withdrawn,
    and archive copies. An edition that is no longer on GOV.UK is exactly the one whose pictures may go from
    GOV.UK's asset host next, so the site holds them itself (the owner's decision, 3 October 2026)."""
    refs: dict[str, set[str]] = {}
    for country, note, index in store.iter_notes():
        for version in index["versions"]:
            for url in image_urls(store.read_body(country, note, version["sha256"])):
                refs.setdefault(url, set()).add(f"{country}/{note}")
    return refs


def mirror_images(client: PoliteClient, store: Store, refs: dict[str, set[str]], *, seen_at: str, errors: list) -> dict:
    manifest = store.load_image_manifest()
    stats = {"checked": 0, "downloaded": 0, "unchanged": 0, "replaced_same_url": 0, "bytes_downloaded": 0}
    for url, notes in sorted(refs.items()):
        stats["checked"] += 1
        entry = manifest.get(url)
        used_by = sorted(set(entry.get("used_by", [])) | notes) if entry else sorted(notes)
        # Only ask "changed since?" when our copy is actually on disk: a fresh checkout has the
        # manifest (in git) but not the files, and a 304 would leave the file missing.
        held = entry and store.image_path(entry["sha256"], entry.get("ext", "")).exists()
        r = client.get(url, etag=entry.get("etag") if held else None, follow=True)
        if r.not_modified:
            entry.update(last_seen=seen_at, used_by=used_by)
            stats["unchanged"] += 1
            continue
        if not r.ok:
            errors.append({"url": url, "status": r.status, "error": r.error, "used_by": sorted(notes)})
            continue
        content_type = r.headers.get("content-type", "").split(";")[0].strip().lower()
        sha = sha256_bytes(r.content)
        ext = EXTENSIONS.get(content_type, "")
        if store.image_path(sha, ext).exists():
            stats["unchanged"] += 1
        else:
            store.write_image(sha, ext, r.content)
            stats["downloaded"] += 1
            stats["bytes_downloaded"] += len(r.content)
        previous = list(entry.get("previous", [])) if entry else []
        if entry and entry["sha256"] != sha:
            stats["replaced_same_url"] += 1
            previous.append({k: entry.get(k) for k in ("sha256", "ext", "bytes", "first_seen", "last_seen")})
        manifest[url] = {
            "sha256": sha, "ext": ext, "bytes": len(r.content), "content_type": content_type, "etag": r.etag,
            "first_seen": entry["first_seen"] if entry and entry["sha256"] == sha else seen_at,
            "last_seen": seen_at, "used_by": used_by,
            **({"previous": previous} if previous else {}),
        }
    store.save_image_manifest(manifest)
    return stats
