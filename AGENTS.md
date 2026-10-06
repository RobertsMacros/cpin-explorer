# cpin-explorer: rules for agents

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
./cpin recover               # removed editions it cannot see (PDF-only, or under a page's earlier address): catalogue, then fetch
./cpin pdftext               # text of editions published as a PDF only (--check measures the extraction)
./cpin pdftext --figures     # pictures a PDF has that the web version of the same edition leaves out
./cpin compare               # real differences between each web version and its PDF (docs/methods/pdf-and-web.md)
./cpin status
```
Setup: `python3 -m venv .venv && .venv/bin/pip install -e ".[dev]"`, and `cd web && npm ci`.
**Keep the repo out of iCloud-synced folders** (Documents, Desktop): with "Optimise Mac Storage", iCloud
evicts files (including `.venv` and `node_modules`) and every read then hangs on a download; it also set a
`hidden` flag on the editable install's `.pth` file, so Python 3.13+ ignored it ("No module named cpin").
It now lives in `~/Developer/cpin-explorer`. `./cpin` (puts `src/` on the path itself) still works either way.

## Rules
1. **Verbatim.** Stored note bodies are exactly what the Content API returned. Never rewrite,
   clean or reformat them; derived views (plain text, diffs, link lists) are computed from them.
   No LLM in the pipeline. Any summary of changes must be labelled as such and kept apart from
   the source text; GOV.UK's own change notes are preferred.
2. **Never delete history.** A note that disappears is marked `removed`; its versions stay. The day an
   edition stops being the one on GOV.UK is kept (`status_log`, each version's `last_seen`, and the
   export's `left_govuk`) and shown as its archive date, with the two checks it fell between. Only what
   this copy saw happen has such a date: an Internet Archive copy has its capture dates instead.
3. **Identity is the content hash, not the URL.** GOV.UK edits notes in place without changing
   dates, and retires URLs when it publishes a new edition.
4. **Polite, honest scraping.** One honest User-Agent with no personal contact details,
   robots.txt and Crawl-delay respected, per-host delays in `config.HOST_DELAY`, no browser
   impersonation, no workarounds for 403s or bot checks.
5. **Label provenance.** Versions from the Internet Archive keep `source: wayback`, the capture
   time and the archive URL, and must be shown as archived copies. An edition published as a PDF only
   is read from the PDF (`src/cpin/pdftext.py`): its text is an extraction, kept apart from the stored
   bodies (`data/pdfs/text/`), marked `source: pdf`, and must be shown as "From the PDF" with the PDF
   linked, never as verbatim. The extractor reads the PDF's own text layer (no OCR, no LLM) and refuses
   a scan; change it only with `./cpin pdftext --check` run before and after, and bump `EXTRACTOR`.
   A picture taken from the PDF and shown beside a web edition's text (`shared/pdf-figures.js`) is marked
   "From the PDF" and stays outside the text: never part of a quotation, a highlight or a citation.
   An edition recovered as a PDF from the Internet Archive (`./cpin recover`) is both: its manifest entry
   keeps `source: wayback`, the archive URL and the capture time, and it is shown as "From the PDF" and as
   an archived copy, with the Archive's address as its source (never GOV.UK's, which now leads elsewhere).
   **Anything that reads a PDF or compares it with the web version follows `docs/methods/pdf-and-web.md`:**
   a difference is real only when the PDF's raw text confirms it (never from the extraction alone); kinds
   of difference are kept apart; figures are given as a range with word counts, and the worst cases are
   read by hand first; the extractor is changed only with the check run before and after.
6. **Branding.** This is a Roberts Macros work tool. Header, tab icon, 404 page and Word export use
   CPIN Explorer's own mark (the globe in miniature: `assets/cpin-explorer/mark.svg`, drawn live in the
   header by `prototypes/shared/brand-mark.js`, loaded in every page's head) with the wordmark in
   `prototypes/shared/brand.css` ("CPIN" square pixel in blue, "EXPLORER" mono, same size): the owner's
   choices, recorded in `prototypes/brand/`. Every page's footer shows the RM mark alone, with no
   slogan (owner's decision), from `assets/roberts-macros/derived/` (source revision in `SOURCE.txt`;
   refresh from the assets repo, not by hand), next to "Report a bug" (address in
   `prototypes/shared/site-config.js`). Use the same header and footer markup on any new page.
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
    Tokens and fonts live in `prototypes/shared/theme.css`. Keep all four fonts exactly as they are
    (owner's decision): Geist Sans (reading text), Geist Mono (dates, buttons, small details), Geist
    Pixel (labels, tags, numbers), Geist Pixel Line (big titles such as country names). No serif, no
    beige ("looks like an AI artifact" was the complaint).
12. **Borders: Natural Earth UK point of view** (`web/build-borders.mjs`), not de facto borders.
    Map corrections belong in `config/countries.json`, with a reason, and a test in
    `web/test/country-locator.test.mjs`.
13. **No Home Office logo.** Credit in text ("Sources: Home Office, GOV.UK"); the OGL excludes
    departmental logos and the site must not look official.
14. Images inside notes are mirrored (`./cpin images`, and by `sync`); bodies keep GOV.UK's `src`,
    and the site substitutes the mirrored copy when rendering.
15. **Clear up after yourself.** Browser checks must not leave anything in the temp folders. Between
    2 and 4 October 2026 about 2,200 Chrome launches left a `cpin-chrome-*` profile each (29 GB) plus
    a Chrome `code_sign_clone` each, and with 3.9 GB of session scratch files that filled the disk.
    So: reuse one browser and one profile for a whole run rather than launching per page or per check;
    quit the browser cleanly (`browser.close()`, never `kill`), which is what lets Chrome remove its
    own clone; delete any temporary profile or folder you created in a `finally`; stop Playwright
    daemons (`cliDaemon`) you started; and remove large scratch files when the task ends. Before
    finishing, confirm nothing is left:
    `ls -d "$(getconf DARWIN_USER_TEMP_DIR)"cpin-* 2>/dev/null | wc -l` should print 0.

Front-end checks: `cd web && npm test` (projection maths and country picking against real borders).
