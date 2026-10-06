"""Prepare verified image bytes for publication, without refreshing historical URLs.

The published Explorer is our own deployment backup, not a new evidence source.
Only exact, manifest-named image files are downloaded; their hashes must match.
New/missing originals still use the normal robots-respecting source client.
Daily sync remains responsible for checking whether source images have changed.
"""
import json
import re
import time

import httpx

from . import config
from .fingerprint import sha256_bytes
from .http import PoliteClient, bounded_get
from .images import EXTENSIONS, every_image_ref, mirror_images
from .store import Store, now_iso

PUBLISHED_SITE = "https://cpin-explorer.co.uk"
MAX_IMAGE_BYTES = 25 * 1024 * 1024


def prepare_images(store, source_client, published_client, *, refs=None, sleep=time.sleep):
    refs = every_image_ref(store) if refs is None else refs
    manifest = store.load_image_manifest()
    stats = {"required": len(refs), "held": 0, "restored": 0, "source_downloaded": 0}
    backup_gaps, missing = [], {}
    for url, notes in sorted(refs.items()):
        entry = manifest.get(url)
        if not entry:
            missing[url] = notes
            continue
        sha, ext = entry["sha256"], entry.get("ext", "")
        if not re.fullmatch(r"[0-9a-f]{64}", sha) or ext not in set(EXTENSIONS.values()) | {""}:
            raise ValueError("Unsafe image filename in the manifest")
        target = store.image_path(sha, ext)
        if target.exists() and sha256_bytes(target.read_bytes()) == sha:
            stats["held"] += 1
            continue
        backup_url = f"{PUBLISHED_SITE}/data/images/files/{sha}{ext}"
        try:
            # Deployment-owned file recovery: fixed origin, no redirects or URL discovery.
            r = bounded_get(published_client, backup_url, max_bytes=MAX_IMAGE_BYTES,
                            follow_redirects=False)
            if r.status_code == 200 and sha256_bytes(r.content) == sha:
                store.write_image(sha, ext, r.content)
                stats["restored"] += 1
                print(f"restored published image {sha}{ext}", flush=True)
            else:
                reason = "hash mismatch" if r.status_code == 200 else f"HTTP {r.status_code}"
                backup_gaps.append({"url": url, "backup": backup_url, "reason": reason})
                missing[url] = notes
        except (httpx.HTTPError, ValueError) as e:
            backup_gaps.append({"url": url, "backup": backup_url, "reason": str(e)[:200]})
            missing[url] = notes
        sleep(config.HOST_DELAY.get("cpin-explorer.co.uk", config.DEFAULT_DELAY))

    errors = []
    if missing:
        fetched = mirror_images(source_client, store, missing, seen_at=now_iso(), errors=errors)
        stats["source_downloaded"] = fetched["downloaded"]
    # A cache hit or an HTTP 200 is insufficient: every required file must hash-match.
    manifest = store.load_image_manifest()
    gaps = []
    for url in refs:
        entry = manifest.get(url)
        target = store.image_path(entry["sha256"], entry.get("ext", "")) if entry else None
        if not target or not target.exists() or sha256_bytes(target.read_bytes()) != entry["sha256"]:
            gaps.append(url)
    return {**stats, "backup_gaps": backup_gaps, "source_errors": errors, "missing": gaps}


def main():
    with PoliteClient(max_bytes=MAX_IMAGE_BYTES) as source_client, httpx.Client(
        timeout=30, follow_redirects=False, headers={"User-Agent": config.USER_AGENT}
    ) as published_client:
        result = prepare_images(Store(config.DATA_DIR), source_client, published_client)
    print(json.dumps(result, indent=2))
    return 1 if result["missing"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
