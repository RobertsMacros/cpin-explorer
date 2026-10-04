"""One sync run: collection -> changed countries -> their notes (and PDFs).

Quick mode trusts the collection's ETag and each country's public_updated_at, so a day with no
changes costs one request (a 304). Full mode re-fetches every note regardless; that is how
silent in-place edits (same URL, same date, different text) are caught, so run it weekly.

A note is marked removed only when its country's publication was fetched successfully and no
longer lists it. A failed fetch never removes anything, and nor does a doubtful answer: a 200 that is
not JSON, or not plainly the country's publication with its list of attachments, is an error for that
page and the run goes on. A country page the collection stops listing keeps everything; its notes are
marked removed with the reason (`DROPPED`), since nothing vouches for them as current any more.

Whatever a run did not finish is tried again by the next one. A country whose page, a note or a file
failed, or which had changed but was not asked for (`only`), is listed in the state file's `pending`.
While that list is not empty the collection is fetched without its ETag and those countries are fetched
whatever their date, so a new edition cannot sit behind a 304. Such a country also keeps the date it had:
this copy does not yet hold what GOV.UK published on the newer one.
"""
from dataclasses import asdict, dataclass, field
from urllib.parse import urlsplit

from . import config
from .govuk import api_url, collection_documents, html_attachments, note_slug, split_item
from .http import PoliteClient
from .images import current_image_refs, mirror_images
from .pdfs import mirror_pdfs
from .store import Store, now_iso


DROPPED = "country page no longer in the collection"      # why a note was marked removed (status_log)


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
    retitled: list[dict] = field(default_factory=list)   # the same body under another title (store._log_title)
    pdfs: dict = field(default_factory=dict)
    images: dict = field(default_factory=dict)
    errors: list[dict] = field(default_factory=list)
    pending: list[str] = field(default_factory=list)     # countries the next run must fetch again

    @property
    def changed(self) -> bool:
        return bool(self.new_versions or self.removed or self.restored or self.retitled
                    or self.pdfs.get("replaced_same_url") or self.images.get("replaced_same_url"))


def sync(client: PoliteClient, store: Store, *, full: bool = False, assets: bool = True,
         only: set[str] | None = None) -> RunReport:
    report = RunReport(kind="sync", mode="full" if full else "quick", started=now_iso())
    state = store.load_state()
    # The checks before this one that reached GOV.UK, newest first: a note found gone now was still listed at
    # the last of them (an unchanged collection means no country page had changed), so that is when it was last
    # known to be there. A check that left the note's country still to fetch saw nothing of it, and is passed
    # over. Read from the run log, not kept in the state file: a quiet day must leave nothing to commit but the log.
    checks = [run for run in reversed(store.runs())
              if run.get("kind") == "sync" and run.get("collection") in ("fetched", "changed", "unchanged")]
    pending = set(state.get("pending", []))
    report.pending = sorted(pending)                      # still true if this run gets no further
    etag = None if (full or pending or store.load_collection() is None) else state.get("collection_etag")

    r = client.get(api_url(config.COLLECTION_PATH), etag=etag)
    if r.not_modified:
        report.collection = "unchanged"
        return _finish(store, state, report)
    if not r.ok:
        report.collection = "error"
        report.errors.append({"url": r.url, "status": r.status, "error": r.error})
        return _finish(store, state, report)

    collection, problem = _item(r)
    problem = problem or _not_the_collection(collection)
    if problem:                          # nothing is saved and no country is taken to have been dropped
        report.collection = "error"
        report.errors.append({"url": r.url, "status": r.status, "error": problem})
        return _finish(store, state, report)
    store.save_collection(collection)
    state["collection_etag"] = r.etag
    report.collection = "changed" if etag else "fetched"

    docs = collection_documents(collection)
    listed = {d["slug"] for d in docs}
    pending &= listed                    # a country no longer listed has nothing to fetch
    fetched = {}
    for doc in docs:
        slug = doc["slug"]
        known = state["countries"].get(slug, {})
        due = (slug in pending or known.get("public_updated_at") != doc["public_updated_at"]
               or store.load_publication(slug) is None or bool(known.get("dropped_from_collection")))
        if only and slug not in only:
            if due:
                pending.add(slug)        # changed, but not asked for: the next run must not pass it by
            continue
        if not (full or due):
            continue
        previous_check = next((run["started"] for run in checks if slug not in run.get("pending", [])), None)
        publication, complete = _sync_country(client, store, doc, report, previous_check)
        if publication is None:
            pending.add(slug)            # error recorded; state left alone
            continue
        fetched[slug] = publication
        state["countries"][slug] = {
            "name": doc["name"], "base_path": doc["base_path"], "content_id": doc["content_id"],
            # The date says what this copy holds. With a note missing it holds less: the date stays.
            "public_updated_at": doc["public_updated_at"] if complete else known.get("public_updated_at"),
            "last_fetched": report.started,
        }
        if complete:
            pending.discard(slug)
        else:
            pending.add(slug)

    for slug, known in state["countries"].items():
        if slug not in listed and not known.get("dropped_from_collection"):
            known["dropped_from_collection"] = report.started    # keep everything; say when it was found gone
            last_listed = next((run["started"] for run in checks if slug not in run.get("pending", [])), None)
            for note, index in store.notes_for(slug):
                if index.get("status") == "live":
                    store.mark_removed(slug, note, at=report.started, last_listed=last_listed, why=DROPPED)
                    report.removed.append({"country": slug, "note": note, "title": index.get("title"), "why": DROPPED})

    if assets and fetched:               # binary assets: PDF editions, and images the notes embed
        before = len(report.errors)
        report.pdfs = mirror_pdfs(client, store, fetched, seen_at=report.started, errors=report.errors)
        refs = current_image_refs(store, set(fetched))
        report.images = mirror_images(client, store, refs, seen_at=report.started, errors=report.errors)
        for slug in _countries_of(report.errors[before:]) & set(fetched):
            pending.add(slug)            # a file that failed: the country is fetched again, and the file with it
    state["pending"] = report.pending = sorted(pending)
    return _finish(store, state, report)


def _countries_of(errors: list[dict]) -> set[str]:
    """The countries a list of errors is about: a PDF's error names its country, an image's the notes
    that use it ('country/note')."""
    return ({e["country"] for e in errors if e.get("country")}
            | {use.split("/", 1)[0] for e in errors for use in e.get("used_by", [])})


def _item(r) -> tuple[dict | None, str | None]:
    """The content item a 200 response holds, or why it holds none. GOV.UK can answer 200 with an error
    page: that is a failed fetch of one page, to be recorded and tried again, not a reason to stop the run."""
    try:
        item = r.json()
    except ValueError as e:
        return None, f"not JSON: {e}"[:200]
    return (item, None) if isinstance(item, dict) else (None, "not a content item: JSON, but not an object")


def _not_the_collection(item: dict | None) -> str | None:
    """Why an answer is not plainly the collection with its list of country pages, or None when it is.
    An answer without the list would otherwise read as every country having been dropped."""
    if item is None:
        return None
    links = item.get("links")
    documents = links.get("documents") if isinstance(links, dict) else None
    if not isinstance(documents, list) or not documents:
        return f"not the collection: it lists no country pages (schema {item.get('schema_name')})"
    if not all(isinstance(d, dict) and d.get("title") and d.get("base_path") for d in documents):
        return "not the collection: a country page is listed without its title or address"
    return None


def _not_the_publication(item: dict | None, doc: dict) -> str | None:
    """Why an answer is not plainly this country's publication with its list of attachments, or None when
    it is. Notes are marked removed by their absence from that list, so the list must really be there."""
    if item is None:
        return None
    if item.get("schema_name") != "publication" or item.get("base_path") != doc["base_path"]:
        return f"not the country's publication (schema {item.get('schema_name')}, address {item.get('base_path')})"
    details = item.get("details")
    attachments = details.get("attachments") if isinstance(details, dict) else None
    if not isinstance(attachments, list) or not all(isinstance(a, dict) for a in attachments):
        return "the publication has no list of attachments"
    if not all(a.get("url") for a in html_attachments(item)):
        return "the publication lists a web version without its address"
    return None


def _sync_country(client: PoliteClient, store: Store, doc: dict, report: RunReport,
                  previous_check: str | None = None) -> tuple[dict | None, bool]:
    """Fetch one country page and each note it lists. Returns (the publication, or None if it could not be
    read; whether every note it lists was read and stored)."""
    slug = doc["slug"]
    r = client.get(api_url(doc["base_path"]))
    if not r.ok:
        report.errors.append({"country": slug, "url": r.url, "status": r.status, "error": r.error})
        return None, False
    publication, problem = _item(r)
    problem = problem or _not_the_publication(publication, doc)
    if problem:                          # the page held is kept, and no note is marked removed
        report.errors.append({"country": slug, "url": r.url, "status": r.status, "error": problem})
        return None, False
    store.save_publication(slug, publication)
    report.countries_checked.append(slug)

    listed, complete = set(), True
    for attachment in html_attachments(publication):
        note = note_slug(attachment["url"])
        listed.add(note)                 # listed even if the fetch below fails, so it is never removed
        path = urlsplit(attachment["url"]).path
        nr = client.get(api_url(path))
        if not nr.ok:
            report.errors.append({"country": slug, "note": note, "url": nr.url, "status": nr.status, "error": nr.error})
            complete = False
            continue
        item, problem = _item(nr)
        body, meta = split_item(item) if item is not None else (None, {})
        if not isinstance(body, str):
            report.errors.append({"country": slug, "note": note, "url": nr.url, "status": 200,
                                  "error": problem or f"no body (schema {item.get('schema_name')})"})
            complete = False
            continue
        report.notes_checked += 1
        titles = {v["sha256"]: v.get("title") for v in (store.load_note(slug, note) or {}).get("versions", [])}
        record, is_new = store.record_version(
            slug, note, body=body, meta=meta, seen_at=report.started, source="live",
            title=item.get("title") or attachment.get("title"), base_path=path,
            public_updated_at=item.get("public_updated_at"))
        previous_status = store.set_current(slug, note, record["sha256"], at=report.started)
        entry = {"country": slug, "note": note, "title": record["title"], "sha256": record["sha256"]}
        if is_new:
            versions = store.load_note(slug, note)["versions"]
            report.new_versions.append({**entry, "first_for_note": len(versions) == 1})
        elif titles.get(record["sha256"]) != record["title"]:     # the same body under another title
            report.retitled.append({"country": slug, "note": note, "title": record["title"], "was": titles.get(record["sha256"])})
        if previous_status == "removed":
            report.restored.append(entry)

    for note, index in store.notes_for(slug):
        if index.get("status") == "live" and note not in listed:
            store.mark_removed(slug, note, at=report.started, last_listed=previous_check)
            report.removed.append({"country": slug, "note": note, "title": index.get("title")})
    return publication, complete


def _finish(store: Store, state: dict, report: RunReport) -> RunReport:
    report.finished = now_iso()
    if not state.get("pending"):
        state.pop("pending", None)       # a quiet day must leave the state file as it was
    store.save_state(state)
    store.append_run(asdict(report))
    return report
