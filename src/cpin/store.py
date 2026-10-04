"""On-disk store. Everything here is either verbatim from a source or bookkeeping about when
we saw it. Nothing is ever deleted: a note that disappears from GOV.UK changes status.

data/
  collection.json                          latest collection item (verbatim API JSON)
  state.json                               collection ETag; per-country public_updated_at; `pending`, the
                                           countries the next sync must fetch again (sync.py)
  countries/<country>/publication.json     latest publication item (verbatim API JSON)
  countries/<country>/notes/<note>/
      index.json                           every version of this note, oldest first; a version GOV.UK has
                                           retitled or redated keeps each title and date in `title_log`
      <sha256[:16]>.html                   verbatim details.body of one version
      <sha256[:16]>.meta.json              the rest of that API item (or the archive capture)
  pdfs/manifest.json                       PDF url -> sha256, size, ETag, first/last seen; a PDF recovered
                                           from the Internet Archive has source 'wayback', its archive_url,
                                           captured_at and when the country page listed it (recover.py)
  pdfs/files/<sha256>.pdf                  mirrored PDFs (not committed to git)
  wayback-catalogue.json                   every edition the archived country pages ever listed, and whether
                                           it is held, recoverable or lost (recover.py)
  wayback-cache/                           what `recover` has read from the Archive (not committed to git)
  images/manifest.json                     image url -> sha256, type, ETag, the notes that use it
  images/files/<sha256>.<ext>              mirrored images (not committed to git)
  runs.jsonl                               one line per sync or backfill run
"""
import json
import os
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

from . import config
from .fingerprint import sha256_text, text_sha256, version_banner


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def to_utc(stamp: str | None) -> str | None:
    """Normalise an ISO timestamp with any offset to UTC 'YYYY-MM-DDTHH:MM:SSZ'."""
    if not stamp:
        return None
    dt = datetime.fromisoformat(stamp.replace("Z", "+00:00"))
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def atomic_write(path: Path, data: bytes):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=".tmp-")
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
        os.replace(tmp, path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


def write_json(path: Path, obj):
    atomic_write(path, (json.dumps(obj, ensure_ascii=False, indent=2) + "\n").encode("utf-8"))


def read_json(path: Path, default=None):
    try:
        return json.loads(Path(path).read_text("utf-8"))
    except FileNotFoundError:
        return default


def version_date(v: dict) -> str:
    """Best available date for ordering: GOV.UK's own date, else the archive capture, else first seen."""
    captures = v.get("captures") or []
    return v.get("public_updated_at") or (captures[0]["captured_at"] if captures else None) or v["first_seen"]


def _log_title(version: dict, title: str | None, public_updated_at: str | None, seen_at: str) -> bool:
    """GOV.UK can give a note another title or date and leave its body alone. The title carries the month
    a citation uses, so the change must not pass unseen. The version takes the title and date GOV.UK gives
    now, and its `title_log` lists each pair it has carried and when this copy first saw it, oldest first:
    [{at, title, public_updated_at}]. A version never retitled or redated has no log. Returns True when
    something changed."""
    now = {"title": title or version.get("title"), "public_updated_at": public_updated_at or version.get("public_updated_at")}
    was = {key: version.get(key) for key in now}
    if now == was:
        return False
    version.setdefault("title_log", [{"at": version["first_seen"], **was}]).append({"at": seen_at, **now})
    version.update(now)
    return True


class Store:
    def __init__(self, root: Path = config.DATA_DIR):
        self.root = Path(root)

    # --- paths -----------------------------------------------------------------------------
    def country_dir(self, country: str) -> Path:
        return self.root / "countries" / country

    def note_dir(self, country: str, note: str) -> Path:
        return self.country_dir(country) / "notes" / note

    def body_path(self, country: str, note: str, sha256: str) -> Path:
        return self.note_dir(country, note) / f"{sha256[:16]}.html"

    def pdf_path(self, sha256: str) -> Path:
        return self.root / "pdfs" / "files" / f"{sha256}.pdf"

    # --- collection, state, publications ---------------------------------------------------
    def load_state(self) -> dict:
        state = read_json(self.root / "state.json", {})
        state.setdefault("collection_etag", None)
        state.setdefault("countries", {})
        return state

    def save_state(self, state: dict):
        write_json(self.root / "state.json", state)

    def save_collection(self, item: dict):
        write_json(self.root / "collection.json", item)

    def load_collection(self) -> dict | None:
        return read_json(self.root / "collection.json")

    def save_publication(self, country: str, item: dict):
        write_json(self.country_dir(country) / "publication.json", item)

    def load_publication(self, country: str) -> dict | None:
        return read_json(self.country_dir(country) / "publication.json")

    def countries(self) -> list[str]:
        base = self.root / "countries"
        return sorted(p.name for p in base.iterdir() if p.is_dir()) if base.exists() else []

    # --- notes -----------------------------------------------------------------------------
    def load_note(self, country: str, note: str) -> dict | None:
        return read_json(self.note_dir(country, note) / "index.json")

    def save_note(self, country: str, note: str, index: dict):
        write_json(self.note_dir(country, note) / "index.json", index)

    def notes_for(self, country: str):
        for path in sorted((self.country_dir(country) / "notes").glob("*/index.json")):
            yield path.parent.name, read_json(path)

    def iter_notes(self):
        for country in self.countries():
            for note, index in self.notes_for(country):
                yield country, note, index

    def read_body(self, country: str, note: str, sha256: str) -> str:
        return self.body_path(country, note, sha256).read_bytes().decode("utf-8")

    def record_version(self, country: str, note: str, *, body: str, meta: dict, seen_at: str, source: str,
                       title: str, base_path: str, public_updated_at: str | None = None,
                       capture: dict | None = None) -> tuple[dict, bool]:
        """Store one observed version of a note. Returns (version record, is_new).

        A version is identified by the sha256 of its exact body. An archived copy whose visible
        text matches a version we already hold is recorded as a capture of that version rather
        than as a new one, because archive pages are re-serialised HTML.

        The same body seen live again under another title, or with another date, is still the same
        version: it takes the new title and date, and its `title_log` keeps what they were (see
        `_log_title`).
        """
        sha = sha256_text(body)
        tsha = text_sha256(body)
        index = self.load_note(country, note) or {
            "country": country, "note": note, "title": title, "base_path": base_path,
            "status": "live" if source == "live" else "archived", "current_sha256": None, "versions": [],
        }
        same = next((v for v in index["versions"] if v["sha256"] == sha), None)
        if same is None and source == "wayback":
            same = next((v for v in index["versions"] if v["text_sha256"] == tsha), None)
        if same is not None:
            if source == "live":
                same["last_seen"] = max(same.get("last_seen") or seen_at, seen_at)
                if _log_title(same, title, to_utc(public_updated_at), seen_at):
                    index["title"] = same["title"]
            if capture and capture not in same.setdefault("captures", []):
                same["captures"].append(capture)
                same["captures"].sort(key=lambda c: c["captured_at"])
            self.save_note(country, note, index)
            return same, False

        body_file = self.body_path(country, note, sha)
        atomic_write(body_file, body.encode("utf-8"))
        write_json(body_file.with_suffix(".meta.json"), meta)
        record = {
            "sha256": sha,
            "text_sha256": tsha,
            "source": source,
            "title": title,
            "public_updated_at": to_utc(public_updated_at),
            "first_seen": seen_at,
            "last_seen": seen_at if source == "live" else None,
            "version_banner": version_banner(body),
            "bytes": len(body.encode("utf-8")),
        }
        if capture:
            record["captures"] = [capture]
        index["versions"].append(record)
        index["versions"].sort(key=version_date)
        if source == "live":
            index["title"] = title
            index["base_path"] = base_path
        self.save_note(country, note, index)
        return record, True

    def set_current(self, country: str, note: str, sha256: str, *, at: str) -> str:
        """Mark a version as the one GOV.UK serves now. Returns the note's previous status."""
        index = self.load_note(country, note)
        previous = index.get("status")
        index["current_sha256"] = sha256
        if previous != "live":
            index["status"] = "live"
            index.setdefault("status_log", []).append({"status": "live", "at": at})
        self.save_note(country, note, index)
        return previous

    def mark_removed(self, country: str, note: str, *, at: str, last_listed: str | None = None, why: str | None = None):
        """A note GOV.UK no longer lists: found gone at `at`; last known to be listed at `last_listed` (the
        check before, when there was one), so it went between the two. `why` is given when it is not the
        country page that stopped listing the note, but the collection that stopped listing the country page."""
        index = self.load_note(country, note)
        index["status"] = "removed"
        index.setdefault("status_log", []).append({"status": "removed", "at": at, **({"last_listed": last_listed} if last_listed else {}),
                                                   **({"why": why} if why else {})})
        self.save_note(country, note, index)

    # --- PDFs and run log ------------------------------------------------------------------
    def load_pdf_manifest(self) -> dict:
        return read_json(self.root / "pdfs" / "manifest.json", {})

    def save_pdf_manifest(self, manifest: dict):
        write_json(self.root / "pdfs" / "manifest.json", dict(sorted(manifest.items())))

    def write_pdf(self, sha256: str, data: bytes):
        atomic_write(self.pdf_path(sha256), data)

    # --- Images embedded in note bodies ------------------------------------------------------
    def image_path(self, sha256: str, ext: str) -> Path:
        return self.root / "images" / "files" / f"{sha256}{ext}"

    def load_image_manifest(self) -> dict:
        return read_json(self.root / "images" / "manifest.json", {})

    def save_image_manifest(self, manifest: dict):
        write_json(self.root / "images" / "manifest.json", dict(sorted(manifest.items())))

    def write_image(self, sha256: str, ext: str, data: bytes):
        atomic_write(self.image_path(sha256, ext), data)

    def append_run(self, record: dict):
        path = self.root / "runs.jsonl"
        path.parent.mkdir(parents=True, exist_ok=True)
        # A run killed part-way through its line leaves no newline: start a fresh line, or this record
        # would be joined to the damaged one and lost with it.
        broken = False
        if path.exists() and path.stat().st_size:
            with path.open("rb") as f:
                f.seek(-1, os.SEEK_END)
                broken = f.read(1) != b"\n"
        with path.open("a", encoding="utf-8") as f:
            f.write(("\n" if broken else "") + json.dumps(record, ensure_ascii=False) + "\n")

    def runs(self) -> list[dict]:
        """Every run on record, oldest first. A line that is not a run record (a half-written last line,
        after a run was killed) is passed over and named on stderr: the log is bookkeeping, and one damaged
        line must not stop every later sync and export. The line itself is left where it is."""
        path = self.root / "runs.jsonl"
        if not path.exists():
            return []
        runs = []
        for number, line in enumerate(path.read_text("utf-8", errors="replace").splitlines(), 1):
            if not line.strip():
                continue
            try:
                record = json.loads(line)
            except ValueError:
                print(f"cpin: {path.name} line {number} is not JSON; passed over", file=sys.stderr)
                continue
            if isinstance(record, dict):
                runs.append(record)
            else:
                print(f"cpin: {path.name} line {number} is not a run record; passed over", file=sys.stderr)
        return runs
