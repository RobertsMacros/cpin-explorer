"""Mirror the PDF edition of each note, and extract PDF text for cross-checks.

PDFs are stored by sha256 so identical files are kept once. GOV.UK has been seen to replace a
file at the same asset URL, so each manifest entry keeps the hashes it had before.
"""
from .fingerprint import sha256_bytes
from .govuk import file_attachments
from .http import PoliteClient
from .store import Store


def is_pdf(attachment: dict) -> bool:
    return attachment.get("content_type") == "application/pdf" or attachment.get("url", "").lower().endswith(".pdf")


def mirror_pdfs(client: PoliteClient, store: Store, publications: dict[str, dict], *, seen_at: str,
                errors: list) -> dict:
    manifest = store.load_pdf_manifest()
    stats = {"checked": 0, "downloaded": 0, "unchanged": 0, "replaced_same_url": 0, "bytes_downloaded": 0}
    for country, publication in publications.items():
        for attachment in file_attachments(publication):
            if not is_pdf(attachment):
                continue
            url = attachment["url"]
            stats["checked"] += 1
            entry = manifest.get(url)
            # The manifest, not the local disk, says what we hold: on a scheduled runner the files
            # live in R2, so an unchanged PDF must cost a 304, not a re-download.
            r = client.get(url, etag=entry.get("etag") if entry else None, follow=True)
            if r.not_modified:
                entry["last_seen"] = seen_at
                stats["unchanged"] += 1
                continue
            if not r.ok:
                errors.append({"country": country, "url": url, "status": r.status, "error": r.error})
                continue
            sha = sha256_bytes(r.content)
            if store.pdf_path(sha).exists():
                stats["unchanged"] += 1
            else:
                store.write_pdf(sha, r.content)
                stats["downloaded"] += 1
                stats["bytes_downloaded"] += len(r.content)
            previous = list(entry.get("previous", [])) if entry else []
            if entry and entry["sha256"] != sha:
                stats["replaced_same_url"] += 1
                previous.append({k: entry.get(k) for k in ("sha256", "bytes", "first_seen", "last_seen")})
            manifest[url] = {
                "sha256": sha,
                "bytes": len(r.content),
                "etag": r.etag,
                "country": country,
                "title": attachment.get("title"),
                "first_seen": entry["first_seen"] if entry and entry["sha256"] == sha else seen_at,
                "last_seen": seen_at,
                **({"previous": previous} if previous else {}),
            }
    store.save_pdf_manifest(manifest)
    return stats


def pdf_text(path) -> str:
    import pymupdf
    with pymupdf.open(path) as doc:
        return "\n".join(page.get_text() for page in doc)
