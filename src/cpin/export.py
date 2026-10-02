"""Export what the site needs from the store. Derived data only: the store is never changed.

Note titles and GOV.UK change notes are passed through verbatim; the only additions are
labels computed from them (kind, topic, month) and counts of what we hold.
"""
import json
import re
from pathlib import Path

from . import config
from .changes import change_statement, matching_change_notes, valid_from
from .govuk import file_attachments, html_attachments, note_slug
from .pdfs import is_pdf
from .store import Store, now_iso, to_utc, version_date
from .titles import parse_note_title, series_key
from .verify import pair_pdfs

COUNTRIES_CONFIG = config.ROOT / "config" / "countries.json"

# Display labels for the kinds of note GOV.UK publishes, including its own misspellings.
KIND_LABELS = [
    (r"country (?:policy|police) and information note|country and policy information note", "CPIN"),
    (r"country information note", "Country information note"),
    (r"country bulletin", "Country bulletin"),
    (r"fact-finding mission", "Fact-finding mission"),
    (r"country information and guidance", "Country information and guidance (legacy)"),
]


def kind_label(kind: str) -> str:
    for pattern, label in KIND_LABELS:
        if re.search(pattern, kind, re.IGNORECASE):
            return label
    return kind.capitalize() or "Note"


def series_path(country: str, key: str) -> str:
    """Path of a series file, relative to the series directory: 'afghanistan/note--fear-taliban.json'."""
    return f"{country}/{key.replace(':', '--')}.json"


def _edition(store: Store, country: str, name: str, note: str, index: dict, v: dict) -> dict:
    title = (v.get("title") or index["title"]).strip()
    month = parse_note_title(title, name).month
    captures = v.get("captures") or []
    captured = captures[0]["captured_at"] if captures else None
    body = store.read_body(country, note, v["sha256"])
    valid = valid_from(body)
    published = v.get("public_updated_at") or valid or (f"{month}-01T00:00:00Z" if month else None)
    precision = "day" if (v.get("public_updated_at") or valid) else ("month" if month else None)
    is_current = index.get("status") == "live" and v["sha256"] == index.get("current_sha256")
    return {
        "id": v["sha256"][:16],
        "note": note,
        "title": title,
        "source": v["source"],                                  # live (Content API) or wayback (archive copy)
        "published": published,
        "published_precision": precision,
        "valid_from": valid,                                    # from the note's own version control
        "change_statement": change_statement(body),             # verbatim, from 'Changes from last version'
        "captured_at": captured,
        "first_seen": v["first_seen"],
        "date": published or captured or v["first_seen"],
        "version": v.get("version_banner"),
        "current": is_current,
        "govuk_url": config.GOVUK + index["base_path"] if is_current else None,
        "archive_url": captures[-1]["archive_url"] if captures else None,
        "text_sha256": v["text_sha256"],
        "body": body,                                           # verbatim
    }


def build_series(store: Store, country: str, name: str, key: str, members: list, image_files: dict,
                 history: list | None = None) -> dict:
    """Every edition of one report, oldest first, with verbatim bodies. An edition held twice with the
    same text (an archive copy of one we also hold live) is listed once, preferring the live copy."""
    editions = sorted((_edition(store, country, name, note, index, v) for note, index in members for v in index["versions"]),
                      key=lambda e: (e["date"], e["first_seen"]))
    collapsed = []
    for e in editions:
        if collapsed and collapsed[-1]["text_sha256"] == e["text_sha256"]:
            keep, other = (e, collapsed[-1]) if e["source"] == "live" and collapsed[-1]["source"] != "live" else (collapsed[-1], e)
            keep.setdefault("also_held_as", []).append({k: other[k] for k in ("id", "note", "source", "captured_at", "archive_url")})
            collapsed[-1] = keep
            continue
        collapsed.append(e)
    topic_words = set(key.split(":", 1)[1].split("-")) - {"untitled"}
    for e in collapsed:                                          # GOV.UK's own dated change notes, verbatim
        e["govuk_change_notes"] = matching_change_notes(history or [], e["published"], topic_words)
    latest = parse_note_title(collapsed[-1]["title"], name)
    images = {url: f"../../data/images/files/{entry['sha256']}{entry.get('ext', '')}"
              for url, entry in image_files.items()
              if any(url in e["body"] for e in collapsed)}
    return {"country": country, "country_name": name, "key": key, "topic": latest.topic,
            "kind": kind_label(latest.kind), "versions": collapsed, "images": images}


def _note_entry(store: Store, country: str, name: str, note: str, index: dict, pdf_url: str | None,
                series: dict | None = None) -> dict:
    parsed = parse_note_title(index["title"], name)
    current = next((v for v in index["versions"] if v["sha256"] == index.get("current_sha256")), index["versions"][-1])
    archived = [v for v in index["versions"] if v["source"] == "wayback"]
    editions = series["versions"] if series else []
    return {
        "id": note,
        "title": index["title"].strip(),
        "kind": kind_label(parsed.kind),
        "topic": parsed.topic,
        "month": parsed.month,
        "status": index["status"],
        "version": current.get("version_banner"),
        "updated": version_date(current),
        "series": series["key"] if series else None,
        "editions": len(editions) or len(index["versions"]),           # editions of this report, across URLs
        "archived_editions": len(archived),
        "earliest": editions[0]["date"] if editions else version_date(index["versions"][0]),
        "latest_change": ({"version": editions[-1]["version"], "statement": editions[-1]["change_statement"]}
                          if editions and editions[-1]["change_statement"] else None),
        "compare_url": (f"../redline-timeline/index.html?country={country}&series={series['key']}"
                        if series and len(editions) > 1 else None),
        "govuk_url": config.GOVUK + index["base_path"] if index["status"] == "live" else None,
        "archive_url": (archived[-1].get("captures") or [{}])[-1].get("archive_url") if archived else None,
        "pdf_url": pdf_url,
    }


def build_dashboard(store: Store, countries_config: dict, series_out: Path | None = None) -> dict:
    """The dashboard's data. With series_out, also writes one file per report with 2+ editions."""
    state = store.load_state()
    manifest = store.load_pdf_manifest()
    image_files = store.load_image_manifest()
    mapping = countries_config["countries"]
    countries, recent = [], []
    for slug, known in sorted(state["countries"].items(), key=lambda kv: kv[1]["name"]):
        publication = store.load_publication(slug) or {}
        pairs = pair_pdfs(publication) if publication else {}
        paired_pdfs = set(pairs.values())
        notes = []
        live_by_url = {note_slug(a["url"]): pairs.get(a["url"]) for a in html_attachments(publication)}
        history = [{"date": to_utc(h.get("public_timestamp")), "note": " ".join((h.get("note") or "").split())}
                   for h in publication.get("details", {}).get("change_history", [])]
        history.sort(key=lambda h: h["date"] or "", reverse=True)
        groups: dict[str, list] = {}
        for note, index in store.notes_for(slug):
            groups.setdefault(series_key(parse_note_title(index["title"], known["name"])), []).append((note, index))
        for key, members in groups.items():
            series = build_series(store, slug, known["name"], key, members, image_files, history)
            if series_out and len(series["versions"]) > 1:
                path = Path(series_out) / series_path(slug, key)
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(json.dumps(series, ensure_ascii=False, separators=(",", ":")), "utf-8")
            for note, index in members:
                notes.append(_note_entry(store, slug, known["name"], note, index, live_by_url.get(note), series))
        for a in file_attachments(publication):        # PDF-only notes (no HTML edition)
            if is_pdf(a) and a["url"] not in paired_pdfs and not html_attachments(publication):
                parsed = parse_note_title(a.get("title", ""), known["name"])
                entry = manifest.get(a["url"], {})
                notes.append({"id": a["url"].rsplit("/", 1)[-1], "title": a.get("title", "").strip(),
                              "kind": kind_label(parsed.kind), "topic": parsed.topic, "month": parsed.month,
                              "status": "live", "pdf_only": True, "version": None,
                              "updated": to_utc(publication.get("public_updated_at")), "editions": 1,
                              "archived_editions": 0, "earliest": entry.get("first_seen"),
                              "govuk_url": config.GOVUK + known["base_path"], "archive_url": None,
                              "pdf_url": a["url"]})
        order = {"live": 0, "removed": 1, "archived": 2}
        notes.sort(key=lambda n: (order.get(n["status"], 3), -(int((n["updated"] or "0")[:10].replace("-", "")))))
        cfg = mapping.get(slug, {})
        countries.append({
            "slug": slug,
            "name": known["name"],
            "iso_n3": cfg.get("iso_n3"),
            "iso_a2": cfg.get("iso_a2"),
            "marker": cfg.get("marker"),
            "caveat": cfg.get("caveat"),
            "updated": to_utc(known.get("public_updated_at")),
            "govuk_url": config.GOVUK + known["base_path"],
            "notes": notes,
            "history": history,
        })
        recent += [{"country": slug, "name": known["name"], **h} for h in history]
    recent.sort(key=lambda h: h["date"] or "", reverse=True)
    live_notes = [n for c in countries for n in c["notes"] if n["status"] == "live"]
    runs = store.runs()
    return {
        "generated_at": now_iso(),
        "last_sync": next((r["finished"] for r in reversed(runs) if r["kind"] == "sync"), None),
        "source": config.GOVUK + config.COLLECTION_PATH,
        "licence": "Contains public sector information licensed under the Open Government Licence v3.0.",
        "totals": {
            "countries": len(countries),
            "notes": len(live_notes),
            "pdfs": len(manifest),
            "archived_editions": sum(n["archived_editions"] for c in countries for n in c["notes"]),
            "removed_or_archived_notes": sum(1 for c in countries for n in c["notes"] if n["status"] != "live"),
        },
        "countries": countries,
        "recent_changes": recent[:60],
        "feature_aliases": countries_config.get("feature_aliases", {}),
        "boundary_patches": countries_config.get("boundary_patches", []),
    }


def export_dashboard(store: Store, out: Path, countries_config_path: Path = COUNTRIES_CONFIG,
                     series_out: Path | None = None) -> dict:
    data = build_dashboard(store, json.loads(Path(countries_config_path).read_text("utf-8")), series_out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n", "utf-8")
    return data
