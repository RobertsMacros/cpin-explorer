"""One sync run: collection -> changed countries -> their notes (and PDFs).

Quick mode trusts the collection's ETag and each country's public_updated_at, so a day with no
changes costs one request (a 304). Full mode re-fetches every note regardless; that is how
silent in-place edits (same URL, same date, different text) are caught, so run it weekly.

A note is marked removed only when its country's publication was fetched successfully and no
longer lists it. A failed fetch never removes anything.
"""
from dataclasses import asdict, dataclass, field
from urllib.parse import urlsplit

from . import config
from .govuk import api_url, collection_documents, html_attachments, note_slug, split_item
from .http import PoliteClient
from .images import current_image_refs, mirror_images
from .pdfs import mirror_pdfs
from .store import Store, now_iso


@dataclass
class RunReport:
    kind: str
    mode: str
    started: str
    finished: str | None = None
    collection: str = "not fetched"      # fetched | changed | unchanged | error
    countries_checked: list[str] = field(default_factory=list)
    notes_checked: int = 0
    new_versions: list[dict] = field(default_factory=list)
    removed: list[dict] = field(default_factory=list)
    restored: list[dict] = field(default_factory=list)
    pdfs: dict = field(default_factory=dict)
    images: dict = field(default_factory=dict)
    errors: list[dict] = field(default_factory=list)

    @property
    def changed(self) -> bool:
        return bool(self.new_versions or self.removed or self.restored or self.pdfs.get("replaced_same_url")
                    or self.images.get("replaced_same_url"))


def sync(client: PoliteClient, store: Store, *, full: bool = False, assets: bool = True,
         only: set[str] | None = None) -> RunReport:
    report = RunReport(kind="sync", mode="full" if full else "quick", started=now_iso())
    state = store.load_state()
    etag = None if (full or store.load_collection() is None) else state.get("collection_etag")

    r = client.get(api_url(config.COLLECTION_PATH), etag=etag)
    if r.not_modified:
        report.collection = "unchanged"
        return _finish(store, state, report)
    if not r.ok:
        report.collection = "error"
        report.errors.append({"url": r.url, "status": r.status, "error": r.error})
        return _finish(store, state, report)

    collection = r.json()
    store.save_collection(collection)
    state["collection_etag"] = r.etag
    report.collection = "changed" if etag else "fetched"

    docs = collection_documents(collection)
    fetched = {}
    for doc in docs:
        slug = doc["slug"]
        if only and slug not in only:
            continue
        known = state["countries"].get(slug, {})
        if (not full and known.get("public_updated_at") == doc["public_updated_at"]
                and store.load_publication(slug) is not None):
            continue
        publication = _sync_country(client, store, doc, report)
        if publication is None:
            continue                     # error recorded; state left alone so the next run retries
        fetched[slug] = publication
        state["countries"][slug] = {
            "name": doc["name"], "base_path": doc["base_path"], "content_id": doc["content_id"],
            "public_updated_at": doc["public_updated_at"], "last_fetched": report.started,
        }

    listed = {d["slug"] for d in docs}
    for slug, known in state["countries"].items():
        if slug not in listed and not known.get("dropped_from_collection"):
            known["dropped_from_collection"] = report.started    # keep everything; just note it

    if assets and fetched:               # binary assets: PDF editions, and images the notes embed
        report.pdfs = mirror_pdfs(client, store, fetched, seen_at=report.started, errors=report.errors)
        refs = current_image_refs(store, set(fetched))
        report.images = mirror_images(client, store, refs, seen_at=report.started, errors=report.errors)
    return _finish(store, state, report)


def _sync_country(client: PoliteClient, store: Store, doc: dict, report: RunReport) -> dict | None:
    slug = doc["slug"]
    r = client.get(api_url(doc["base_path"]))
    if not r.ok:
        report.errors.append({"country": slug, "url": r.url, "status": r.status, "error": r.error})
        return None
    publication = r.json()
    store.save_publication(slug, publication)
    report.countries_checked.append(slug)

    listed = set()
    for attachment in html_attachments(publication):
        note = note_slug(attachment["url"])
        listed.add(note)                 # listed even if the fetch below fails, so it is never removed
        path = urlsplit(attachment["url"]).path
        nr = client.get(api_url(path))
        if not nr.ok:
            report.errors.append({"country": slug, "note": note, "url": nr.url, "status": nr.status, "error": nr.error})
            continue
        item = nr.json()
        body, meta = split_item(item)
        if body is None:
            report.errors.append({"country": slug, "note": note, "url": nr.url, "status": 200,
                                  "error": f"no body (schema {item.get('schema_name')})"})
            continue
        report.notes_checked += 1
        record, is_new = store.record_version(
            slug, note, body=body, meta=meta, seen_at=report.started, source="live",
            title=item.get("title") or attachment.get("title"), base_path=path,
            public_updated_at=item.get("public_updated_at"))
        previous_status = store.set_current(slug, note, record["sha256"], at=report.started)
        entry = {"country": slug, "note": note, "title": record["title"], "sha256": record["sha256"]}
        if is_new:
            versions = store.load_note(slug, note)["versions"]
            report.new_versions.append({**entry, "first_for_note": len(versions) == 1})
        if previous_status == "removed":
            report.restored.append(entry)

    for note, index in store.notes_for(slug):
        if index.get("status") == "live" and note not in listed:
            store.mark_removed(slug, note, at=report.started)
            report.removed.append({"country": slug, "note": note, "title": index.get("title")})
    return publication


def _finish(store: Store, state: dict, report: RunReport) -> RunReport:
    report.finished = now_iso()
    store.save_state(state)
    store.append_run(asdict(report))
    return report
