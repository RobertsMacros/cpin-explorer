# Handover: CPIN Explorer, 4 October 2026

For whoever picks this up next (written for Codex). Read `AGENTS.md` first: its rules are the project's
constitution. Then `README.md`, then `docs/methods/pdf-and-web.md` before touching anything that reads a PDF.

## Review integration and 2020 backfill, 5 October 2026

The latest work exposes all 44 found review publications in footnote overlays,
with exact-edition context separate from unassessed country background. Checked
EUAA source copies recover 67 Syria citations; comparable since-2023 source access
is 72.5%, up from 70.3%. Seven narrowly scoped Syria AI checks are now recorded;
bulk semantic review remains pending. The held-edition inventory since 1 January
2020 has 485 editions, 84,612 footnotes and 33,061 primary URLs. Private source
caches and queues stay excluded from Git/site exports. No paid API or recurring
task was enabled. Read [the run record](reviews/2026-10-05-reviews-and-2020-backfill.md)
and [the batch method](methods/source-review-batches.md), including date evidence,
remaining retrieval/anchor gaps and cost assumptions, before continuing. The
existing slow one-off global collector remains active; do not duplicate or discard
its pending work. The owner's later explicit main push/live publication request
supersedes the historical publication hold below.
Main `2f847e8` was pushed and deployed as Cloudflare version
`07657e95-d4af-4c78-8e5b-dac95136cf0d` at 100% traffic. Five reader/review assets
match live responses; desktop and 390px overlays pass with private evidence 404s.

## Source reviews and Syria pilot published, 5 October 2026

At the owner's request, `main` commit `5178f26` was pushed and deployed to the
existing Cloudflare Worker. Version `3c38496c-d57d-4dea-9b5c-b8e341b618cb` serves
100% of traffic. The live site now has separate Published reviews, AI review and
Manual additions in footnotes, strictly edition-bound whole-report review links,
browser-local country/report pins and the source-preview/selection fixes.
Live Chromium checks at 1280×900 and 390×844 touch pass without console errors;
29 deployed assets, including all Syria histories, match the assembled site.

The Syria pilot selects held editions published from 1 January 2023: 17 snapshots,
3,055 footnotes, 1,577 addresses with settled outcomes and 70.3% readable source
coverage. It reused and hash-checked existing captures. No AI contradiction checks
ran; full source text stays private and unapproved for model/public use. See
[the pilot record](reviews/2026-10-05-syria-source-pilot.md). The wider source job
is still running through its slow tail. No recurring review checks were configured.
GitHub's Cloudflare publication secrets remain missing; local deployment does not
enable automated republishing. Native Edge still needs checking.

## Live publication, 5 October 2026

The owner subsequently requested an update to the live site. Local Wrangler OAuth access was already
available, so reviewed `main` commit `e176b37` was rebuilt and deployed directly to the existing
`cpin-explorer` Worker. Cloudflare version `687bb668-ad2b-4bd4-8539-0c3042fc2a6b` serves 100% of traffic.
The live dashboard, source-link data, About page, search script and histories containing all 140 imported
editions match 143 checked build assets byte for byte. The dashboard-to-Afghanistan history-to-January 2016
National Archives reader flow passes at 1280×720; source labelling is correct and the console is clean.
Root redirect, noindex headers and the 404 page also pass. See the later live-publication section in
[the main review](reviews/2026-10-05-main-review.md). GitHub's Cloudflare secrets are still missing; this
manual deployment does not enable automatic republishing. Earlier undeployed statuses below are dated history.

## Main publication review, 5 October 2026

The owner authorised pushing the completed work to `main` on 5 October, and the push is complete.
GitHub validation of `e06b66a` passed 278 Python and 322 JavaScript tests, retained-data verification and
the offline export. This supersedes the publication hold in the historical sections below. See [the main publication review](reviews/2026-10-05-main-review.md)
for the final checks and GitHub outcome, and [the PDF-only cleanup review](reviews/2026-10-05-pdf-only-cleanup.md)
for source evidence and the remaining reused-footnote-number limitation. Local suites now pass 278 Python
and 322 JavaScript tests. Push validation runs without Cloudflare credentials; publication still requires
both missing secrets. The scheduled workflow is active on `main`, but a scheduled run remains unverified.

## Local completion, 4 October 2026

Codex completed the interrupted work locally on this branch, based on `c5f7c5d`. Changes remain
uncommitted, unpushed and undeployed; live remains the earlier `f389a3e` deployment. Read
[the completion and audit review](reviews/2026-10-04-handover-completion.md) and
[the PDF extraction review](reviews/2026-10-04-pdf-extraction.md) for the current results and limits.

Recovered PDF editions are displayed and cite their archive source. Seven withdrawn and five taken-down
countries are held and shown as former countries. About CPINs is linked from the Guide. The manual National
Archives list now has 140 editions. Pinned highlights, current-match notes, the current-edition action and
Word export were checked and corrected. Local suites pass 251 Python and 320 JavaScript tests; integrity
and completeness checks pass. The code and performance audit and desktop/phone browser rendering checks
are recorded in the reviews. Physical iPhone gestures remain unchecked.

The dead-link archive refresh completed all 1,470 lookups, finding copies for 677 dead cited links; the
link status was re-exported. GitHub's two Cloudflare secrets are still missing, and the rewritten workflow
has never run there. The citation's
section name for repeated paragraph numbers remains enabled pending the owner's decision. Do not commit,
push, merge or deploy until the owner says “push”.

A later local helper, `scripts/save_pdf_links.py`, saves exact PDF links serially using the existing polite
client. It preserves bytes, validates PDF structure and records sources and failures; it does not automate
the National Archives or import files into report histories. The full Python suite now has 256 passing tests.
See README’s “Save original PDFs from exact links” section.

At the owner's later explicit request, Codex collected National Archives links through the browser:
two supplied search exports and all 141 timeline addresses for the 140 missing editions. The timelines
list 1,265 dated PDF links for 138 PDF addresses, plus 18 HTML captures; two addresses say URL not found.
Files are in `~/Documents/GitHub/outputs/CPIN National Archives PDF links.txt` and the companion coverage
CSV. The wider export-and-timeline union has 4,200 links. At the owner's subsequent explicit download
request, all 1,265 requested timeline PDF captures were downloaded through the ordinary browser and
validated. They contain 138 distinct PDFs (81,815,314 bytes, 5,135 pages), saved under
`data/pdfs/files/`, with friendly named links in `data/pdfs/national-archives/By country/`.
The download records and indices are in `data/pdfs/national-archives/`. Four initial timeouts succeeded on retry;
there are no failed or pending downloads in that set. `PDF index.csv` lists the 138 files;
`Capture index.csv` and `download-report.json` preserve all 1,265 source URLs and hashes.
The wider 4,200-link union was not downloaded. At that stage no files were imported into report histories; the 5 October completion below supersedes
that status. The pipeline's National Archives guard remains enabled. Read
[the link collection and download record](reviews/2026-10-04-national-archives-links.md). The original manual-only
instructions below describe the earlier handover; do not treat this browser collection as permission to
turn on unattended archive downloads.

## Archive integration completed locally, 5 October 2026

The 138 National Archives PDFs and two remaining Home Office PDFs from ecoi.net are now imported,
extracted and displayed. The existing catalogue is fully held: 829 of 829 editions, zero missing.
All 32 earlier failed attempts retain their errors and now record valid PDF evidence for the edition;
none remains unresolved. This resolves missing editions, not the failed capture URLs themselves.

Run `scripts/import_archive_downloads.py` with the project's Python to re-import the local records;
it makes no network requests and preserves live files and history. The National Archives HTTP guard
remains enabled. `data/pdfs/national-archives/PDF index.csv` now lists all 140 original files,
`import-report.json` records import and failure reconciliation, and `integration-check.json` records
all 140 exported editions with exact source addresses and hashes. The manual hand-check HTML is
refreshed to zero outstanding editions; its original version is retained with the download records.

Current local totals: 435 report histories (217 comparable), 664 archived editions, 706 country PDFs
plus the About PDF. All 535 PDF-only editions have extracted text; zero extraction failures.
The rebuilt search index has 4,335 current-guidance records and the site has 7,905 files (452 MB).
Suites pass 263 Python and 322 JavaScript tests; integrity and current-collection completeness pass.
The source labels and citations distinguish Internet Archive, National Archives and ecoi.net.
Desktop and mobile Chromium checks cover National Archives and both ecoi.net recoveries, plus returning
to Pakistan's current edition. Native Safari was tested before this import, not rerun on these additions.
Changes remain uncommitted, unpushed and undeployed until the owner says “push”.

The sections below preserve the original handover snapshot from `c5f7c5d`; their stopped/not-started labels
and counts describe that earlier point. Use the reviews above and README Status for current local state.

## What this is

A mirror of the UK Home Office's Country Policy and Information Notes (CPINs) from GOV.UK, for an asylum
lawyer (the owner, non-technical) who reads, compares and cites them. Python scraper and pipeline in `src/cpin`
(`./cpin <command>`), a static site in `prototypes/` (plain HTML, CSS, ES modules, no framework), build and
deploy in `web/` (Cloudflare static-assets Worker). Live: https://cpin-explorer.robert-m-w-stevens.workers.dev
(last deployed from commit `f389a3e`; everything on this branch is NOT deployed).

## How the owner works

- Short messages, often from an iPhone on the live site. Plain UK English back, no jargon.
- Standing wishes: smooth motion ("no snaps"), four Geist fonts unchanged, checked on desktop (1440x900) and
  phone (390x844), a code review before pushing, and **commit, push and deploy only when told "push"**.
- Challenges numbers. Never give a single figure for a difference: follow `docs/methods/pdf-and-web.md`.
- Citations must be exact. A wrong word in a quote or a wrong paragraph number is the worst fault possible.

## Rules that must not be broken

- Stored text is verbatim; nothing is deleted from history; identity is the content hash (AGENTS.md).
- Polite scraping: the one honest User-Agent, robots.txt obeyed (an unreadable robots.txt means "do not
  fetch"), per-host delays, no workarounds for 403s, rate limits or bot checks.
- **The National Archives' web archive forbids automated tools: never fetch from it.**
- Never put the owner's personal email in a request. No Home Office logo (never a picture from a PDF's cover).
- No LLM and no OCR in the pipeline. Text read from a PDF is marked "From the PDF", never "Verbatim".
- No runtime CDN. Roberts Macros branding as recorded in `assets/`.

## State of this branch

Tests when written: `.venv/bin/pytest -q` 227 pass; `cd web && npm test` 317 pass. **This round has not had
the usual code review**, and three pieces of work were stopped part-way (below). Review before merging to
`main` or deploying. Merging to `main` also puts the rewritten `.github/workflows/sync.yml` into service; it has
never run on GitHub.

Done and checked in the browser this round:

- PDF text extraction (`src/cpin/pdftext.py`), pictures only the PDF has, shown beside the web text.
- Web-against-PDF comparison with a second independent reader (`src/cpin/webpdf.py`, method `webpdf-8`); the
  report page's "PDF differs" chip; `./cpin compare --page FILE` writes the list the owner reads.
- Citations: name "web version" or "PDF version"; give the PDF's paragraph number only where confirmed; name the
  section where the Home Office uses a paragraph number twice (the owner has not yet confirmed he wants this
  last one: ask).
- Quoting faults fixed: leading figures kept, table cells and line breaks spaced, Cmd+C clean, mistyped and
  full-stopped paragraph numbers read correctly.
- Dates: an edition's date is the note's own ("valid from", else title month), never the country page's.
- Editions that differ only in white space are one edition (`fingerprint.text_sha256`); 336 editions, 199 reports.
- Scraper hardening: failed fetches retried (`state.json` `pending`), commit before verify, guards against
  false removals, title log, PDFs re-downloaded when missing.
- Alignment pass across every page (see the patterns commented in `prototypes/shared/theme.css`).
- A page showing anything but the guidance in force turns grey (`[data-outdated]` in `reader.css`).
- Pictures of archived editions are mirrored (`./cpin images --all`).

## Stopped part-way: finish or check these first

1. **Recovery of older editions** (`src/cpin/recover.py`, `tests/test_recover.py`, `data/wayback-catalogue.json`).
   The catalogue covers all 47 countries: 820 editions listed, 681 held, 139 in no archive, 32 fetch failures
   (for example PDFs the Internet Archive holds cut short). The helper was stopped while making the export and
   site SHOW recovered PDF editions (it was on the dashboard's per-country count). Check: do recovered PDFs have
   extracted text (`./cpin pdftext`)? Do they appear as editions in `prototypes/data/series` after
   `./cpin export`, marked both "From the PDF" and archived copy? How do reader, citation and dashboard treat
   them? Add the missing tests. Coverage background: `docs/reviews/2026-10-03-coverage.md`.
2. **Owner's decisions not yet carried out** (he said yes to all):
   - Fetch the seven withdrawn country pages still on GOV.UK and their 17 PDFs (Angola, Cameroon, Liberia,
     Malawi, Mali, North Korea, Rwanda); show them marked "Withdrawn <date>", never as current, not counted among
     the 47, and grey like any outdated page. Look for the five taken-down countries (Botswana, Mauritius,
     Moldova, Morocco, South Africa) in the Internet Archive.
   - Hold a copy of GOV.UK's "About country policy and information notes" (June 2026) and link it from the guide.
   - Write `~/Documents/GitHub/outputs/CPIN editions to look for at the National Archives.html`: every edition
     the Internet Archive lacks, by country, with its GOV.UK address and a link to
     `https://webarchive.nationalarchives.gov.uk/ukgwa/timeline/<address>` for him to click by hand.
3. **Saved highlights pinned to their edition** (owner's decision). `citeContext` in
   `prototypes/shared/highlights.js` now cites the edition a highlight was saved from, and the tests pass, but
   the helper was stopped before finishing: check the reader (`place()` in `reader.js`), the saved page
   (`saved.js` `checkNote`), the Word export, the "Still in the current edition (v7.0, para x)" note, the
   "Cite the current edition instead" action, old records with `check: "still"`, and the guide's wording.
   Verify in the real reader on desktop and phone.

## Not started

- The code and performance audit the owner asked for: "Shared helpers where possible and nothing ugly in
  there", Python and front end, with timings.
- A network run of `./cpin links` so archived copies of dead links are re-sought near each note's own date.
- Add `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` as GitHub secrets (the owner must do this himself;
  without them the daily sync cannot redeploy the site).
- Safari and iPhone check of the alignment pass and the grey page (only Chrome was used).

## Open questions for the owner

- Keep the section name on citations to a repeated paragraph number? ("at [12.2.5] (under ‘14. State treatment’)")
- Which version to quote where web and PDF differ (he has the list:
  `~/Documents/GitHub/outputs/CPIN web and PDF - where they differ.html`).
- Flag-zoom numbers in `prototypes/dashboard/country-glow.js` (he said he will look later).
- Older small items: mini-globe logo, RM logo background, Iran Kurds previously-public sections, chooser
  tap-through, glossary wording, Iran 'honour' grouping.

## Commands

```
.venv/bin/pytest -q                  cd web && npm test
./cpin sync [--full]                 ./cpin verify [--live]
./cpin pdftext [--figures|--check|--sheets DIR]
./cpin compare [--force] [--page FILE]
./cpin recover                       ./cpin images [--all]
./cpin supplementary [--hand-list FILE]
./cpin rederive                      ./cpin export
cd web && npm run search-index && npm run site && npx wrangler deploy     # only when the owner says "push"
```

Local preview: serve the repo root and open `/prototypes/dashboard/index.html`. `prototypes/data/` and
`data/pdfs/files`, `data/images/files` are not in git: run `./cpin export`, and `./cpin sync --full` or the
mirrors' commands, to rebuild them on a fresh checkout. The machine this was built on is short of memory: keep
workers to 2 or 3 and one heavy job at a time.

## Where to read more

`docs/methods/pdf-and-web.md` (the standing method), `docs/reviews/` (dated audits: PDF text, PDF against web,
coverage, topic groups, dot targets), `docs/design-handover/` (the design language, for reuse in other tools).
