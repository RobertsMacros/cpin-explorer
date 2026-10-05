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
          f" · removed: {len(report.removed)} · restored: {len(report.restored)} · retitled: {len(report.retitled)}")
    for label, p in (("PDFs", report.pdfs), ("images", report.images)):
        if p:
            print(f"  {label}: {p['checked']} checked · {p['downloaded']} downloaded"
                  f" ({p['bytes_downloaded'] / 1e6:.1f} MB) · {p['replaced_same_url']} replaced at same URL")
    for e in report.errors[:10]:
        print(f"  ERROR {e}")
    if len(report.errors) > 10:
        print(f"  ... and {len(report.errors) - 10} more errors (see data/runs.jsonl)")
    if report.pending:
        print(f"  to fetch again on the next run: {', '.join(report.pending)}")


def cmd_sync(args, store):
    with PoliteClient() as client:
        report = sync(client, store, full=args.full, assets=not args.no_assets, only=set(args.country) or None)
    _print_run(report)
    return 1 if report.errors else 0


def cmd_supplementary(args, store):
    from pathlib import Path
    from .supplementary import archive_hand_list, collect
    from .store import read_json
    with PoliteClient() as client:
        report = collect(client, store)
    _print_run(report)
    if args.hand_list:
        count = archive_hand_list(read_json(store.root / "wayback-catalogue.json", {}), Path(args.hand_list))
        print(f"wrote {count} editions for manual checking to {args.hand_list}")
    return 1 if report.errors else 0


def cmd_links(args, store):
    from pathlib import Path

    from .linkcheck import check_links, export_link_status
    summary = check_links(store, max_age_days=args.max_age, limit=args.limit, countries=set(args.country) or None,
                          log=lambda m: print(m, flush=True))
    print("links:", " · ".join(f"{k} {v}" for k, v in sorted(summary.items())))
    n = export_link_status(store, Path(args.out))
    print(f"wrote link status for {n} countries to {args.out}/")
    return 1 if summary.get('archive_lookup_failures') else 0


def cmd_images(args, store):
    from .images import current_image_refs, every_image_ref, mirror_images
    from .store import now_iso
    errors = []
    refs = every_image_ref(store) if args.all else current_image_refs(store)
    with PoliteClient() as client:
        stats = mirror_images(client, store, refs, seen_at=now_iso(), errors=errors)
    print(f"images: {stats['checked']} checked · {stats['downloaded']} downloaded ({stats['bytes_downloaded'] / 1e6:.1f} MB)"
          f" · {stats['unchanged']} already held · {len(errors)} errors")
    for e in errors[:10]:
        print(f"  ERROR {e}")
    return 1 if errors else 0


def cmd_rederive(args, store):
    """Recompute what the indexes hold that is derived from the stored bodies: each version's label and its
    text fingerprint. The bodies themselves are never touched. Run it after changing how either is made."""
    from .fingerprint import text_sha256, version_banner
    labels = fingerprints = 0
    for country, note, index in store.iter_notes():
        dirty = False
        for v in index["versions"]:
            body = store.read_body(country, note, v["sha256"])
            now = version_banner(body)
            if now != v.get("version_banner"):
                print(f"  {country}/{note} {v['sha256'][:8]}: version {v.get('version_banner')!r} -> {now!r}")
                v["version_banner"] = now
                dirty = True
                labels += 1
            if (now := text_sha256(body)) != v.get("text_sha256"):
                v["text_sha256"] = now
                dirty = True
                fingerprints += 1
        if dirty and not args.dry_run:
            store.save_note(country, note, index)
    would = "would change" if args.dry_run else "changed"
    print(f"rederive: {labels} version label(s) {would} · {fingerprints} text fingerprint(s) {would}")
    return 0


def cmd_pdftext(args, store):
    """Turn PDFs into readable text (pdftext.py): the editions published as a PDF only, into the store; or,
    with --check, every PDF that has a web version beside it, to measure how well the extraction does."""
    import json
    from pathlib import Path

    from . import pdftext
    from .export import pdf_only_files, recovered_pdf_jobs
    from .govuk import html_attachments, note_slug
    from .verify import pair_pdfs
    manifest = store.load_pdf_manifest()
    if args.sheets:
        # Every picture carried over to a web edition, on contact sheets, to look over (docs/methods/pdf-and-web.md, rule 5).
        sheets = pdftext.contact_sheets(store, args.sheets)
        print(f"pdftext sheets: {len(sheets)} contact sheets in {args.sheets}/ · look for a logo, a signature, a stamp or a piece of a table: none should be there")
        return 0
    if args.figures:
        # Pictures a PDF has that GOV.UK's web version of the same edition leaves out: kept, with their place.
        jobs = []
        for slug in sorted(store.load_state()["countries"]):
            if args.country and slug not in args.country:
                continue
            publication = store.load_publication(slug) or {}
            for html_url, pdf_url in pair_pdfs(publication).items():
                note, entry = note_slug(html_url), manifest.get(pdf_url)
                index = store.load_note(slug, note)
                if not index or not entry or index.get("status") != "live" or not store.pdf_path(entry["sha256"]).exists():
                    continue
                jobs.append((f"{slug}/{note}", str(store.pdf_path(entry["sha256"])), entry["sha256"],
                             store.read_body(slug, note, index["current_sha256"]), index["current_sha256"]))
        jobs = jobs[:args.limit] if args.limit else jobs
        summary = pdftext.missing_figures_into_store(store, jobs, log=lambda m: print(m, flush=True), force=args.force)
        print(f"pdftext figures: {summary['pairs']} reports with a web version and a PDF · {summary['figures']} pictures the web versions"
              f" leave out, kept · {summary['unplaced']} could not be placed · {summary['errors']} PDFs failed")
        return 1 if summary['errors'] else 0
    if args.check:
        jobs = []
        for slug in sorted(store.load_state()["countries"]):
            if args.country and slug not in args.country:
                continue
            publication = store.load_publication(slug) or {}
            for html_url, pdf_url in pair_pdfs(publication).items():
                note, entry = note_slug(html_url), manifest.get(pdf_url)
                index = store.load_note(slug, note)
                if not index or not entry or not store.pdf_path(entry["sha256"]).exists():
                    continue
                jobs.append((f"{slug}/{note}", str(store.pdf_path(entry["sha256"])), store.read_body(slug, note, index["current_sha256"])))
        jobs = jobs[:args.limit] if args.limit else jobs
        results = pdftext.check_pairs(jobs)
        good = {k: v for k, v in results.items() if "error" not in v}
        found = sorted(v["web_wording_found"] for v in good.values())
        extra = sorted(v["extracted_wording_in_web"] for v in good.values())
        pick = lambda xs, q: xs[min(len(xs) - 1, int(len(xs) * q))] if xs else None
        print(f"pdftext check: {len(good)} pairs compared, {len(results) - len(good)} failed")
        print(f"  the web version's wording found in the extraction: median {pick(found, .5)}, worst tenth {pick(found, .1)}, worst {found[0] if found else None}")
        print(f"  the extraction's wording found in the web version: median {pick(extra, .5)}, worst tenth {pick(extra, .1)}, worst {extra[0] if extra else None}")
        for key in ("headings", "footnotes", "list_items", "tables", "figures"):
            same = sum(1 for v in good.values() if v[key][0] == v[key][1])
            print(f"  {key}: same count in {same} of {len(good)}")
        Path(args.report).write_text(json.dumps(dict(sorted(results.items())), indent=1) + "\n", "utf-8")
        print(f"  details: {args.report}")
        return 1 if len(good) != len(results) else 0
    # Two kinds of edition are read from a PDF: one the country page lists now with no web version, and one it
    # no longer lists, recovered from the Internet Archive (./cpin recover) with no web version held.
    done = problems = recovered = withdrawn = 0
    state = store.load_state()
    wanted = [(slug, title, url, False, manifest.get(url)) for slug, title, url in pdf_only_files(store)]
    wanted += [(slug, title, url, True, entry) for slug, title, url, entry in recovered_pdf_jobs(store)]
    for slug, title, url, archived, entry in sorted(wanted, key=lambda job: (job[0], job[1], job[2], job[4].get('sha256', '') if job[4] else '')):
        if args.country and slug not in args.country:
            continue
        if not entry:
            print(f"  {slug}: not mirrored: {title}")
            problems += 1
            continue
        meta = pdftext.extract_into_store(store, entry["sha256"], force=args.force)
        where = "archived copy" if archived else "listed on GOV.UK"
        if meta is None:
            print(f"  {slug}: the PDF is not on this disk (run ./cpin {'recover' if archived else 'sync'}): {title}")
            problems += 1
        elif meta.get("no_text_layer"):
            print(f"  {slug}: a scan with no text layer, left as a PDF ({where}): {title}")
            problems += 1
        else:
            done += 1
            recovered += archived
            withdrawn += not archived and bool(state['countries'].get(slug, {}).get('withdrawn_at'))
            print(f"  {slug}: {title} ({where}): {meta['pages']} pages, {meta['headings']} headings, {meta['paragraphs']} paragraphs, "
                  f"{meta['footnotes']} footnotes, {meta['tables']} tables, {meta['figures']} figures"
                  f"{', ' + str(len(meta['warnings'])) + ' warnings' if meta['warnings'] else ''}", flush=True)
    print(f"pdftext: {done} PDF-only editions have text ({done - recovered - withdrawn} current, {withdrawn} withdrawn on GOV.UK,"
          f" {recovered} recovered from archives and repositories) · {problems} without")
    return 1 if problems else 0


def cmd_compare(args, store):
    """Compare each web version with its PDF (webpdf.py) and keep the real differences in data/pdfs/compare/.
    Prints the standard table (docs/methods/pdf-and-web.md, rule 3) and the notes to open and read."""
    import json
    import time
    from pathlib import Path

    from . import webpdf
    from .govuk import note_slug
    from .verify import pair_pdfs
    manifest = store.load_pdf_manifest()
    jobs = []
    for slug in sorted(store.load_state()["countries"]):
        if args.country and slug not in args.country:
            continue
        publication = store.load_publication(slug) or {}
        for html_url, pdf_url in pair_pdfs(publication).items():
            note, entry = note_slug(html_url), manifest.get(pdf_url)
            index = store.load_note(slug, note)
            if not index or not entry or index.get("status") != "live" or not store.pdf_path(entry["sha256"]).exists():
                continue
            jobs.append((f"{slug}/{note}", str(store.pdf_path(entry["sha256"])), entry["sha256"],
                         store.read_body(slug, note, index["current_sha256"]), index["current_sha256"]))
    jobs = jobs[:args.limit] if args.limit else jobs
    started = time.time()
    done = webpdf.compare_into_store(store, jobs, workers=args.workers, force=args.force, log=lambda m: print(m, flush=True))
    summary = webpdf.summarise(done["records"])
    for line in webpdf.table(summary):
        print(line)
    print(f"  {done['done']} compared now · {done['done_before']} already done · {len(done['errors'])} failed"
          f" · {time.time() - started:.0f} seconds")
    Path(args.report).write_text(json.dumps(summary, indent=1, ensure_ascii=False) + "\n", "utf-8")
    print(f"  details: {args.report} · one record per note in {webpdf.compare_path(store, 'x').parent}/")
    if args.page:
        from . import discrepancies
        made = discrepancies.write(store, args.page)
        print(f"  to read through: {made['path']} ({made['notes']} notes, {made['bytes'] // 1024} KB)")
    return 1 if done['errors'] else 0


def cmd_backfill(args, store):
    with PoliteClient(timeout=120) as client:
        report = backfill(client, store, only=set(args.country) or None)
    _print_run(report)
    return 0


def cmd_recover(args, store):
    """Removed editions from the Internet Archive: catalogue first (data/wayback-catalogue.json), then fetch."""
    import signal

    from .recover import CATALOGUE, ordered, recover
    from .store import read_json
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(143))      # a kill ends the run tidily: progress is saved
    only = set(args.country) or None
    with PoliteClient(timeout=120) as client:
        report = recover(client, store, only=only, discover_only=args.discover_only,
                         refresh=args.refresh, max_files=args.max_files, max_bytes=args.max_mb * 1_000_000,
                         html=args.html, all_pdfs=args.all_pdfs, log=lambda m: print(m, flush=True))
    countries = read_json(store.root / CATALOGUE, {}).get("countries", {})
    print(f"{'country':34} {'listed':>6} {'held':>5} {'not held':>8} {'in IA':>6} {'not in':>6}   a fetch would download")
    rows = [(slug, countries[slug]["summary"]) for slug in ordered(countries, only)]
    total = {k: sum(s.get(k, 0) for _, s in rows) for k in rows[0][1]} if rows else None
    for slug, s in rows + ([(f"all {len(rows)}", total)] if len(rows) > 1 else []):
        print(f"{slug:34} {s['editions']:6} {s['held']:5} {s['not_held']:8} {s['not_held_in_archive']:6}"
              f" {s['not_held_not_in_archive']:6}   {s['pdfs_to_fetch']} PDFs ({s['pdf_bytes_to_fetch'] / 1e6:.1f} MB)")
    print("listed: every listing an archived country page showed · held: of those, held here (by address, file, or title and month)"
          " · not held: editions, a repeat listing counted once · in IA / not in: with and without a PDF in the Internet Archive")
    if total:
        print(f"not fetched unless asked: {total['pdfs_beside_held_web_versions']} PDFs beside web versions already held (--all-pdfs),"
              f" {total['html_captures_to_read']} archived web pages not read before (--html)")
    _print_run(report)
    return 1 if any(e.get("stage") == "stopped" for e in report.errors) else 0


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
        # Not every kind of run records the same things (a links check has no versions), so nothing is assumed.
        print(f"last run:  {last.get('kind', '?')} {last.get('mode', '')} {last.get('finished', '?')}"
              f" · {len(last.get('new_versions') or [])} new versions · {len(last.get('errors') or [])} errors")
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
    written = len(list(Path(args.series_out).glob("*/*.json")))
    comparable = {(c["slug"], r["key"]) for c in data["countries"] for r in c["reports"] if r["editions"] > 1}
    print(f"wrote {args.out}: {t['countries']} countries, {t['notes']} live notes, "
          f"{t['archived_editions']} archived editions, {len(data['recent_changes'])} recent changes")
    print(f"wrote {written} report histories to {args.series_out}/ ({len(comparable)} with 2+ editions to compare)")
    missing = [c["slug"] for c in data["countries"] if not c["iso_n3"] and not c["dropped_from_collection"]]
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
    p = sub.add_parser("supplementary", help="hold the approved withdrawn pages and About CPINs")
    p.add_argument("--hand-list", metavar="FILE", help="also write the National Archives manual-check list (no requests to it)")
    p.set_defaults(func=cmd_supplementary)
    p = sub.add_parser("images", help="mirror every image the current notes embed")
    p.add_argument("--all", action="store_true", help="every edition held, not only the current ones (archived and replaced editions too)")
    p.set_defaults(func=cmd_images)
    p = sub.add_parser("links", help="check the sources the notes cite (new links, and any not checked recently)")
    p.add_argument("--max-age", type=int, default=30, help="re-check links last checked more than this many days ago")
    p.add_argument("--limit", type=int, default=None, help="check at most this many links")
    p.add_argument("--country", action="append", default=[])
    p.add_argument("--out", default="prototypes/data/links", help="per-country status files for the reader")
    p.set_defaults(func=cmd_links)
    p = sub.add_parser("rederive", help="recompute what indexes hold that is derived from stored bodies (version labels, text fingerprints)")
    p.add_argument("--dry-run", action="store_true", help="list what would change, write nothing")
    p.set_defaults(func=cmd_rederive)
    p = sub.add_parser("pdftext", help="extract the text of editions published as a PDF only")
    p.add_argument("--check", action="store_true", help="measure the extraction against web versions of the same editions")
    p.add_argument("--figures", action="store_true", help="keep the pictures a PDF has that the web version of the same edition leaves out")
    p.add_argument("--sheets", metavar="DIR", default=None, help="write contact sheets of the pictures carried over to web editions, to check by eye")
    p.add_argument("--force", action="store_true", help="extract again even where it has been done")
    p.add_argument("--country", action="append", default=[])
    p.add_argument("--limit", type=int, default=None, help="with --check: compare at most this many pairs")
    p.add_argument("--report", default="data/pdftext-check.json", help="with --check: where the details go")
    p.set_defaults(func=cmd_pdftext)
    p = sub.add_parser("compare", help="compare each web version with its PDF and record the real differences")
    p.add_argument("--country", action="append", default=[], help="limit to a country slug (repeatable)")
    p.add_argument("--limit", type=int, default=None, help="compare at most this many pairs")
    p.add_argument("--force", action="store_true", help="compare again even where it has been done")
    p.add_argument("--workers", type=int, default=3, help="worker processes (reading a PDF is the slow part)")
    p.add_argument("--page", metavar="FILE", default=None, help="also write the differences as one page to read through (HTML)")
    p.add_argument("--report", default="data/pdf-web-compare.json", help="where the summary goes")
    p.set_defaults(func=cmd_compare)
    p = sub.add_parser("backfill", help="recover older editions from the Internet Archive")
    p.add_argument("--country", action="append", default=[])
    p.set_defaults(func=cmd_backfill)
    p = sub.add_parser("recover", help="removed editions (earlier addresses, PDF-only) from the Internet Archive")
    p.add_argument("--country", action="append", default=[], help="limit to a country slug (repeatable)")
    p.add_argument("--discover-only", action="store_true",
                   help="build data/wayback-catalogue.json and report; download no edition")
    p.add_argument("--refresh", action="store_true", help="ask the Archive's index again instead of reusing its answers")
    p.add_argument("--html", action="store_true", help="also read archived web pages not read before (copies of editions held)")
    p.add_argument("--all-pdfs", action="store_true", help="also fetch the PDFs listed beside web versions that are held")
    p.add_argument("--max-files", type=int, default=2000, help="fetch nothing if the total would exceed this many files")
    p.add_argument("--max-mb", type=int, default=1500, help="fetch nothing if the total would exceed this many MB")
    p.set_defaults(func=cmd_recover)
    p = sub.add_parser("verify", help="check the mirror is complete and verbatim")
    p.add_argument("--live", action="store_true", help="re-fetch current notes and compare bytes")
    p.add_argument("--pdf", action="store_true", help="compare each HTML note with its PDF edition")
    p.set_defaults(func=cmd_verify)
    p = sub.add_parser("status", help="summarise what is stored")
    p.set_defaults(func=cmd_status)
    p = sub.add_parser("export", help="write the data the site reads")
    p.add_argument("--out", default="prototypes/dashboard/data.json")
    p.add_argument("--series-out", default="prototypes/data/series", help="one history file per report")
    p.set_defaults(func=cmd_export)
    p = sub.add_parser("series", help="group notes into series (editions of one report)")
    p.add_argument("--country", action="append", default=[])
    p.set_defaults(func=cmd_series)
    args = parser.parse_args(argv)
    return args.func(args, Store())


if __name__ == "__main__":
    sys.exit(main())
