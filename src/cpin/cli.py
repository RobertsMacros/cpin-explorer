"""Command line: python -m cpin <command>."""
import argparse
import sys
from collections import Counter

from . import verify as verify_mod
from .http import PoliteClient
from .store import Store
from .sync import sync
from .titles import parse_note_title, series_key
from .wayback import backfill


def _print_run(report):
    print(f"{report.kind} ({report.mode}) {report.started} -> {report.finished}")
    print(f"  collection: {report.collection} · countries fetched: {len(report.countries_checked)}"
          f" · notes checked: {report.notes_checked}")
    first = sum(1 for v in report.new_versions if v.get("first_for_note"))
    print(f"  new versions: {len(report.new_versions)} ({first} first sightings)"
          f" · removed: {len(report.removed)} · restored: {len(report.restored)}")
    for label, p in (("PDFs", report.pdfs), ("images", report.images)):
        if p:
            print(f"  {label}: {p['checked']} checked · {p['downloaded']} downloaded"
                  f" ({p['bytes_downloaded'] / 1e6:.1f} MB) · {p['replaced_same_url']} replaced at same URL")
    for e in report.errors[:10]:
        print(f"  ERROR {e}")
    if len(report.errors) > 10:
        print(f"  ... and {len(report.errors) - 10} more errors (see data/runs.jsonl)")


def cmd_sync(args, store):
    with PoliteClient() as client:
        report = sync(client, store, full=args.full, assets=not args.no_assets, only=set(args.country) or None)
    _print_run(report)
    return 1 if report.errors else 0


def cmd_links(args, store):
    from pathlib import Path

    from .linkcheck import check_links, export_link_status
    summary = check_links(store, max_age_days=args.max_age, limit=args.limit, countries=set(args.country) or None,
                          log=lambda m: print(m, flush=True))
    print("links:", " · ".join(f"{k} {v}" for k, v in sorted(summary.items())))
    n = export_link_status(store, Path(args.out))
    print(f"wrote link status for {n} countries to {args.out}/")
    return 0


def cmd_images(args, store):
    from .images import current_image_refs, mirror_images
    from .store import now_iso
    errors = []
    with PoliteClient() as client:
        stats = mirror_images(client, store, current_image_refs(store), seen_at=now_iso(), errors=errors)
    print(f"images: {stats['checked']} checked · {stats['downloaded']} downloaded ({stats['bytes_downloaded'] / 1e6:.1f} MB)"
          f" · {stats['unchanged']} already held · {len(errors)} errors")
    for e in errors[:10]:
        print(f"  ERROR {e}")
    return 1 if errors else 0


def cmd_backfill(args, store):
    with PoliteClient(timeout=120) as client:
        report = backfill(client, store, only=set(args.country) or None)
    _print_run(report)
    return 0


def cmd_verify(args, store):
    client = PoliteClient() if args.live else None
    try:
        report = verify_mod.run(store, client, live=args.live, pdf=args.pdf)
    finally:
        if client:
            client.close()
    i, c = report["integrity"], report["complete"]
    print(f"integrity: {i['bodies_ok']} bodies, {i['pdfs_ok']} PDFs and {i['images_ok']} images match their hashes"
          f" · {len(i['problems'])} problems")
    print(f"complete:  {c.get('counts')} · {len(c['problems'])} problems")
    print(f"links:     {report['links']}")
    if "live" in report:
        print(f"live:      {report['live']['results']}")
    if "pdf" in report:
        print(f"pdf:       {report['pdf']['summary']} · {len(report['pdf']['problems'])} under threshold")
    for section in ("integrity", "complete", "live"):
        for p in report.get(section, {}).get("problems", [])[:10]:
            print(f"  {section.upper()} {p}")
    print("OK" if report["ok"] else "PROBLEMS FOUND (details in data/verify-report.json)")
    return 0 if report["ok"] else 1


def cmd_status(args, store):
    state = store.load_state()
    statuses, sources = Counter(), Counter()
    for _, _, index in store.iter_notes():
        statuses[index.get("status")] += 1
        for v in index["versions"]:
            sources[v["source"]] += 1
    manifest = store.load_pdf_manifest()
    mirrored = [e for e in manifest.values() if store.pdf_path(e["sha256"]).exists()]
    pdf_only = [c["name"] for slug, c in state["countries"].items()
                if not any(True for _ in store.notes_for(slug))]
    print(f"countries: {len(state['countries'])}"
          f" (dropped from collection: {sum(1 for c in state['countries'].values() if c.get('dropped_from_collection'))})")
    print(f"notes:     {dict(statuses)}")
    print(f"versions:  {sum(sources.values())} {dict(sources)}")
    print(f"PDFs:      {len(mirrored)} mirrored of {len(manifest)} known ({sum(e['bytes'] for e in mirrored) / 1e6:.1f} MB)")
    if pdf_only:
        print(f"PDF-only:  {', '.join(sorted(pdf_only))}")
    runs = store.runs()
    if runs:
        last = runs[-1]
        print(f"last run:  {last['kind']} {last['mode']} {last['finished']} · {len(last['new_versions'])} new versions"
              f" · {len(last['errors'])} errors")
    return 0


def cmd_series(args, store):
    state = store.load_state()
    try:
        for slug in sorted(state["countries"]):
            if args.country and slug not in args.country:
                continue
            groups: dict[str, list] = {}
            for note, index in store.notes_for(slug):
                parsed = parse_note_title(index["title"], state["countries"][slug]["name"])
                groups.setdefault(series_key(parsed), []).append((parsed.month or "?", index["status"], note))
            print(f"{state['countries'][slug]['name']}: {len(groups)} series")
            for key, members in sorted(groups.items()):
                print(f"  {key}")
                for month, status, note in sorted(members):
                    print(f"      {month}  {status:8} {note}")
    except NotImplementedError as e:
        print(f"series: {e} (see src/cpin/titles.py)")
        return 2
    return 0


def cmd_export(args, store):
    from pathlib import Path

    from .export import export_dashboard
    data = export_dashboard(store, Path(args.out), series_out=Path(args.series_out))
    t = data["totals"]
    comparable = {(c["slug"], n["series"]) for c in data["countries"] for n in c["notes"] if n.get("compare_url")}
    print(f"wrote {args.out}: {t['countries']} countries, {t['notes']} live notes, "
          f"{t['archived_editions']} archived editions, {len(data['recent_changes'])} recent changes")
    print(f"wrote {len(comparable)} comparable reports (2+ editions) to {args.series_out}/")
    missing = [c["slug"] for c in data["countries"] if not c["iso_n3"]]
    if missing:
        print(f"  countries with no map entry in config/countries.json: {', '.join(missing)}")
        return 1
    return 0


def main(argv=None):
    parser = argparse.ArgumentParser(prog="cpin", description="Verbatim, versioned mirror of Home Office CPINs.")
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("sync", help="fetch changes from GOV.UK")
    p.add_argument("--full", action="store_true", help="re-fetch every note (catches silent edits)")
    p.add_argument("--no-assets", action="store_true", help="skip mirroring PDFs and images")
    p.add_argument("--country", action="append", default=[], help="limit to a country slug (repeatable)")
    p.set_defaults(func=cmd_sync)
    p = sub.add_parser("images", help="mirror every image the current notes embed")
    p.set_defaults(func=cmd_images)
    p = sub.add_parser("links", help="check the sources the notes cite (new links, and any not checked recently)")
    p.add_argument("--max-age", type=int, default=30, help="re-check links last checked more than this many days ago")
    p.add_argument("--limit", type=int, default=None, help="check at most this many links")
    p.add_argument("--country", action="append", default=[])
    p.add_argument("--out", default="prototypes/data/links", help="per-country status files for the reader")
    p.set_defaults(func=cmd_links)
    p = sub.add_parser("backfill", help="recover older editions from the Internet Archive")
    p.add_argument("--country", action="append", default=[])
    p.set_defaults(func=cmd_backfill)
    p = sub.add_parser("verify", help="check the mirror is complete and verbatim")
    p.add_argument("--live", action="store_true", help="re-fetch current notes and compare bytes")
    p.add_argument("--pdf", action="store_true", help="compare each HTML note with its PDF edition")
    p.set_defaults(func=cmd_verify)
    p = sub.add_parser("status", help="summarise what is stored")
    p.set_defaults(func=cmd_status)
    p = sub.add_parser("export", help="write the data the site reads")
    p.add_argument("--out", default="prototypes/dashboard/data.json")
    p.add_argument("--series-out", default="prototypes/data/series", help="one file per report with 2+ editions")
    p.set_defaults(func=cmd_export)
    p = sub.add_parser("series", help="group notes into series (editions of one report)")
    p.add_argument("--country", action="append", default=[])
    p.set_defaults(func=cmd_series)
    args = parser.parse_args(argv)
    return args.func(args, Store())


if __name__ == "__main__":
    sys.exit(main())
