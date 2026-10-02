# cpin-extractor: rules for agents

A verbatim, versioned mirror of the Home Office's Country Policy and Information Notes (CPINs) on
GOV.UK, built in three parts: the scraper (`src/cpin/`, Python), the site (not built yet), and the
comparison layer (timeline and inline redlines). UK English throughout.

## Commands
```bash
.venv/bin/pytest -q          # tests (no network)
./cpin sync                  # quick: one request when nothing changed
./cpin sync --full           # re-fetch every note; catches silent edits
./cpin verify --pdf          # integrity, completeness, HTML-vs-PDF cross-check
./cpin backfill              # older editions from the Internet Archive
./cpin status
```
Setup: `python3 -m venv .venv && .venv/bin/pip install -e ".[dev]"`. Locally, use `./cpin`
rather than `python -m cpin`: on this Mac something keeps setting the Finder `hidden` flag on
the editable install's `.pth` file, and Python 3.13+ skips hidden `.pth` files ("No module named
cpin"). `./cpin` puts `src/` on the path directly. CI (Linux) uses `python -m cpin`.

## Rules
1. **Verbatim.** Stored note bodies are exactly what the Content API returned. Never rewrite,
   clean or reformat them; derived views (plain text, diffs, link lists) are computed from them.
   No LLM in the pipeline. Any summary of changes must be labelled as such and kept apart from
   the source text; GOV.UK's own change notes are preferred.
2. **Never delete history.** A note that disappears is marked `removed`; its versions stay.
3. **Identity is the content hash, not the URL.** GOV.UK edits notes in place without changing
   dates, and retires URLs when it publishes a new edition.
4. **Polite, honest scraping.** One honest User-Agent with no personal contact details,
   robots.txt and Crawl-delay respected, per-host delays in `config.HOST_DELAY`, no browser
   impersonation, no workarounds for 403s or bot checks.
5. **Label provenance.** Versions from the Internet Archive keep `source: wayback`, the capture
   time and the archive URL, and must be shown as archived copies.
6. **Branding.** This is a Roberts Macros work tool: use the RM mark in `assets/roberts-macros/`
   (revision in `SOURCE.txt`) in the user interface. Refresh it from the assets repo, not by hand.
7. **Honest claims.** One successful run shows a tested run, not sustained operation. Record real
   results, failures and limits in the README status section.
8. Data is Crown copyright under the Open Government Licence v3.0; keep the attribution.
9. **Globe: COBE (https://cobe.vercel.app), not globe.gl.** Owner's decision: COBE looks better
   and globe.gl had performance problems. COBE draws a dotted globe with markers, not country
   shapes, so clicking a country means inverse-projecting the pointer to latitude/longitude and
   testing it against country outlines (e.g. d3-geo `geoContains`), with markers for the 47
   countries. Self-host it; no CDN at runtime.
10. **Motion must be smooth ("no snaps").** Everything eases and glides: no jumps, no
    scroll-snapping. Honour `prefers-reduced-motion`.
11. **Look: the COBE site** (white, one electric blue, square corners, blue pixel-font label tags).
    Tokens and fonts live in `prototypes/shared/theme.css`; reading text is Geist Sans, chrome is
    Geist Pixel / Geist Mono. No serif, no beige ("looks like an AI artifact" was the complaint).
12. **Borders: Natural Earth UK point of view** (`web/build-borders.mjs`), not de facto borders.
    Map corrections belong in `config/countries.json`, with a reason, and a test in
    `web/test/country-locator.test.mjs`.
13. **No Home Office logo.** Credit in text ("Source: Home Office, GOV.UK"); the OGL excludes
    departmental logos and the site must not look official.
14. Images inside notes are mirrored (`./cpin images`, and by `sync`); bodies keep GOV.UK's `src`,
    and the site substitutes the mirrored copy when rendering.

Front-end checks: `cd web && npm test` (projection maths and country picking against real borders).
