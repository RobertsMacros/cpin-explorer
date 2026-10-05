<img src="assets/cpin-explorer/favicon.svg" alt="CPIN Explorer" width="72" align="right">

# CPIN Explorer

*A Roberts Macros work tool.*

A verbatim, versioned mirror of the Home Office's
[Country Policy and Information Notes](https://www.gov.uk/government/collections/country-policy-and-information-notes)
(CPINs) on GOV.UK, with a record of every edition we have seen, so that changes can be shown as
inline redlines on a timeline.

It has three parts:

1. **Scraper** (`src/cpin/`, built): fetches every country page and every note from the GOV.UK
   Content API, stores each note's body exactly as published, mirrors the PDF editions, and keeps
   every version it sees. Older editions are recovered, where possible, from the Internet Archive.
2. **Site** (`prototypes/`, built): a static site with a COBE globe, a panel per country, one page
   per report that keeps GOV.UK's formatting and links, saved highlights with citations, and search
   within a country and across all of them. Live at
   <https://cpin-explorer.robert-m-w-stevens.workers.dev> (public, but marked noindex).
3. **Comparison** (built, in the report page): a timeline slider across editions and inline or
   side-by-side redlines between any two of them.

## Status

**5 October 2026: compact source marks and first Syria AI checks live.**
Source badges now show a symbol only, with accessible labels and tooltips. Two
interactive AI checks are published: a yellow flag for military-service footnote
5 linking a named April 2021 report to an October 2024 PDF, and a scoped no-issue
quotation check for Kurds paragraph 16.2.9. Neither confers human approval.
All 23 held Syria editions (14 reports, 3,440 footnotes) are inventoried, but the
full contradiction analysis remains pending; no automated AI service or API
credentials are configured. The previous 70.3% is retrieval coverage, not review
coverage. Its 906 gaps have an explicit reason breakdown. The review directory
now includes 44 publications, including two historical Syria works whose merits
and applicability remain unassessed. All 318 Python and 333 JavaScript tests pass.
Commit `41ba54f` is deployed as Cloudflare version
`23af3904-7891-4009-a53d-c6b65017213d`, serving 100% of traffic. All four changed
assets match the build byte for byte; live desktop and 390px touch Chromium
checks pass with no console warnings or errors, and private evidence paths
return 404. [GitHub validation](https://github.com/RobertsMacros/cpin-explorer/actions/runs/37348069618)
passed; its deploy job was skipped, so the existing local Wrangler login was used.
This supersedes the earlier no-AI-analysis status below. See
[scope, findings and gaps](docs/reviews/2026-10-05-syria-ai-and-source-gaps.md).

The owner's subsequent severity rule is red for major errors and yellow for minor
errors, regardless of reviewer type. The manual status menu records that choice;
AI findings remain labelled as awaiting human review. The Syria citation-link
mismatch is minor; the published Afghanistan returnee inconsistency is major
because it affects the account of returnee treatment. Older private issues without
severity retain a grey flag until classified. All 335 JavaScript tests pass;
desktop and 390px touch checks confirm both severity choices survive reloads.
Commit `c90ca81` is live as Cloudflare version
`95fffb24-7217-4201-b716-f9fb24ecbab5`. Both changed assets match the deployed
reader responses byte for byte; live desktop/mobile severity and persistence
checks pass. [GitHub validation](https://github.com/RobertsMacros/cpin-explorer/actions/runs/37352572538)
records the checks for this code revision. Publication used the existing local
Wrangler login.

**5 October 2026: Syria source pilot checked; reviews and Saved pins live.**
For held editions published from 1 January 2023, the pilot indexes 17 snapshots,
3,055 footnotes and 1,577 source/PDF addresses. Every address has a recorded outcome;
2,149 footnotes (70.3%) have readable linked-source text. The pilot reuses the
catalogue-wide capture and verifies 1,009 distinct files with zero hash problems.
Failures remain explicit; there are no AI contradiction judgements. Full evidence
stays private. All 317 Python and 333 JavaScript tests pass, retained CPIN integrity
passes and Wrangler's dry run succeeds. The owner authorised publication: `main`
commit `5178f26` is deployed as Cloudflare version `3c38496c-d57d-4dea-9b5c-b8e341b618cb`,
serving 100% of traffic. Live review metadata, reader/Saved assets and all Syria
histories match 29 checked build assets byte for byte. Chromium desktop and 390px
touch checks pass for the review overlay, edition-bound report reviews, private-note
and pin persistence, source previews and highlighting, without console warnings
or errors. Root redirect, noindex and 404 checks pass; private evidence is not served.
This supersedes the earlier undeployed statuses below. Notes and pins remain
browser-local; AI analysis and recurring review checks have not been enabled.
[GitHub validation](https://github.com/RobertsMacros/cpin-explorer/actions/runs/37336806773)
also passed; its deploy job was skipped, so publication used the existing local login.
See [scope, coverage and limits](docs/reviews/2026-10-05-syria-source-pilot.md).

**5 October 2026: external-review directory and backfill implemented locally; not deployed.**
Seven publishers and 42 curated publications cover direct CPIN reviews, international
country-report critiques and separately labelled practitioner/policy context. The private
collector retains hashed snapshots and a discovery queue; `./cpin reviews --refresh` is
repeatable. Reviews remain unassessed evidence. Report-level links are edition-bound in
the footnote overlay and never automatically assign source flags. Analysis contexts keep
exact edition reviews separate from background and require original-source checks,
counter-evidence and Home Office responses. All 315 Python and 333 JavaScript tests pass;
the site build succeeds. The owner prefers daily checks eventually but requested backfill
first; no recurring job or AI analysis has been enabled. See the [directory](docs/reviews/published-review-directory.md),
[method](docs/methods/published-reviews.md) and [run record](docs/reviews/2026-10-05-published-review-backfill.md).

**5 October 2026: catalogue-wide source collection running locally.**
All 116,458 footnotes in 856 held editions across 435 reports are indexed. The checked snapshot
has 26,938 saved responses and 25,476 distinct source files with matching hashes.
The last slow source requests and explicit PDF downloads continue in a one-off background job;
one host requires 500 seconds between requests. Lists, receipts and progress are in the private
`data/source-evidence/` cache, excluded from Git and site builds. All 307 Python and 332 JavaScript
tests pass; original CPIN integrity and completeness checks report no problems. No model calls,
AI contradiction judgements or deployment ran. See the [running collection report](docs/reviews/2026-10-05-source-collection.md)
and [method and limits](docs/methods/source-collection.md).

**5 October 2026: Saved pins and reader interaction fixes implemented locally; not deployed.**
Saved now adds and removes country and report pins (`cpin-pins-v1`); report pins open the latest
held edition, while highlights retain the edition they came from. Pins are browser-local, with
explicit warnings if a write only survives for the session; account syncing is not implemented.
The selection toolbar follows delayed desktop selection updates. Ordinary source links open a
preview on click as well as hover; touch previews include an explicit Open source action.
All 332 JavaScript tests pass and the site build succeeds (7,908 files). Chromium desktop and
390px touch checks cover selecting and saving, source previews, footnotes, pin reload persistence,
duplicate prevention and unpinning without removing highlights. Edge itself is not installed on
the test machine, so its reported behaviour still needs checking in Edge.

**5 October 2026: footnote reviews implemented locally; not deployed.** The existing footnote overlay
now displays separate Published reviews, AI review and Manual additions sections, with source-status flags, attributed
evidence excerpts and original-source links. One IAGCI finding is mapped to two citations in the August
2025 Afghanistan Taliban edition; it does not appear on the February 2026 edition. Human entries stay
in this browser, retain edit history and label identities as self-reported. No automatic AI checks,
periodic review import or shared team service have run. Source collection began later on 5 October. All 328 JavaScript tests
pass, and the site build succeeds (7,907 files). Chromium checks at 1280×720 and 375×812 confirm the
published finding, inline excerpt, private-note persistence, edit history and edition separation,
with no console warnings or errors. See [the design and limitations](docs/design-handover/reviews-and-notes.md).

**5 October 2026: handover, archive integration and PDF-only cleanup pushed to `main`.**
The owner authorised the push on 5 October. GitHub validation of `e06b66a` passed all 278 Python and
322 JavaScript tests, including retained-data verification and the offline export. Publication checks are recorded in
[the main review](docs/reviews/2026-10-05-main-review.md). At the owner's subsequent request, the live site
was updated from reviewed `main` commit `e176b37` using local Wrangler authentication. Cloudflare version
`687bb668-ad2b-4bd4-8539-0c3042fc2a6b` is serving 100% of traffic. Live checks match 143 assets byte for byte,
including the histories containing all 140 imported editions. The dashboard-to-archive reader flow and
National Archives source panel pass in Chromium at 1280×720, with no relevant console warnings or errors.
GitHub's two Cloudflare secrets are still missing, so automatic publication remains unavailable. These are
tested runs, not evidence of sustained operation.

- **Held and displayed:** 47 current countries and 12 former countries; 175 current reports; 435 report
  histories, of which 217 hold multiple editions; 664 archived editions, including 504 recovered as PDFs.
  There are 706 country-report PDFs and a separate PDF of GOV.UK's About CPINs publication.
- **Withdrawn and removed countries:** the seven withdrawn pages and their 17 PDFs are held, with withdrawal
  dates and grey reading pages. Archive recovery also holds nine PDFs and three web captures for the five
  taken-down countries. Former countries remain separate from the 47 current countries.
- **Archive catalogue:** all **829 of 829 catalogued editions** are held, across the 47 current countries and
  five taken-down countries. This is full coverage of the existing catalogue, not proof that every historical
  report ever issued has been discovered. The manual National Archives list now has zero outstanding editions.
- **Archive import, 5 October 2026:** all 138 distinct National Archives PDFs from the 1,265 browser-downloaded
  captures, plus Home Office copies of Kenya operational guidance (December 2013) and Pakistan Ahmadis
  (June 2018) recovered from ecoi.net, are registered, extracted and displayed in Explorer. All 140 exported
  editions were individually checked against their original PDF hashes, titles, sources and capture dates;
  each is historical and marked “From the PDF”. Both citation formats were checked for all 140 real editions. Repository copies have no invented capture dates. Citations,
  reader source panels and dashboard tooltips name the actual archive or repository.
  Original bytes remain in `data/pdfs/files/`, with all 140 friendly named links and the download indices in
  `data/pdfs/national-archives/`. The wider 4,200-link search collection was not downloaded; its extra captures
  are not needed to close the existing catalogue's gaps. The pipeline's National Archives HTTP guard remains
  enabled; this import is offline. The original 32 failed-fetch attempts are retained with resolution evidence:
  all 32 editions have valid held PDFs, leaving zero unresolved editions. The failed capture URLs themselves
  were not repaired. See `import-report.json` and `integration-check.json` in the download folder.
- **Citations:** saved highlights retain their saved edition, paragraph and source. A verified match in
  current guidance is shown separately; choosing “Cite the current edition instead” changes the citation.
  Reader, Saved and Word export were checked with an older Iran edition and a recovered Afghan PDF edition.
- **Local verification:** 278 Python tests and 322 JavaScript tests; 405 stored bodies, 707 PDFs and 682 images
  match their hashes, with no integrity or current-collection completeness problems. The site build contains
  7,905 files (452 MB), within its configured hosting limits.
- **PDF extraction, 5 October 2026:** `pdftext-6`; all 535 PDF-only files audited against raw source text
  and an independent Poppler reading. Old contents/margin furniture and sentence-order faults were cleaned
  in the derived view; 67 pipeline reading views changed (66 displayed editions). Original PDFs remain
  untouched and all 532 displayed PDF edition identities remain reachable. The 164 web/PDF checks and
  comparisons completed without failures; neither paired wording score worsened. All seven final picture
  contact sheets match the inspected sheets. See [the PDF-only review](docs/reviews/2026-10-05-pdf-only-cleanup.md)
  for source scores, manually resolved audit flags and the remaining reused-footnote-number limitation.
- **Archive browser checks, 5 October 2026:** the rebuilt local site passed Chromium checks at 1440×900 and
  390×844: dashboard to Afghanistan history to its January 2016 National Archives edition, Pakistan’s
  June 2018 ecoi.net copy and return to current guidance, and Kenya’s December 2013 guidance. Source panels
  name the correct provider, repository copies have no capture date, and there are no relevant console errors.
  These new additions have not been separately retested in native Safari or on a physical iPhone.
- **Earlier browser and performance checks, 4 October 2026:** Chromium and WebKit at 1440×900 and 390×844, native macOS Safari and
  iPhone Simulator Safari. The reader's initial layout jump was fixed. Physical iPhone gestures remain
  unchecked. See [the completion review](docs/reviews/2026-10-04-handover-completion.md) for measurements and scope.
- **Daily workflow:** reviewed and corrected; fetched data is committed before later processing failures are
  reported, and a failed sync cannot publish. Push validation now runs independently of Cloudflare secrets.
  `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` are still missing, so GitHub publication is skipped. The
  rewritten daily sync is active on `main`; it has not yet completed a scheduled GitHub run.
- **Dead-link archive refresh:** all 1,470 lookups completed near each note's own date, with archive copies
  found for 677 dead cited links; 2 h 20 min 12 s, no lookup left undated. Link status was re-exported.

**Earlier live-source check, 2 October 2026:** one full sync fetched 47 countries, 164 HTML notes and 175 PDFs
(173.4 MB) in 3 min 49 s, without errors. A live re-fetch of all 164 HTML bodies was byte-identical; all current
408 embedded images were held. The older sentence-based PDF check found 96.6% exact matches and 3.2% page-layout
splits across 147,182 sentences, with every note scoring at least 95%. This historical check is distinct from
the current extraction and word-by-word publication comparison. Source typos and broken source markup remain
unchanged in stored bodies.

To rebuild after importing already-downloaded archive PDFs:
```bash
.venv/bin/python scripts/import_archive_downloads.py  # offline; validates all files before writing the manifest
./cpin pdftext
./cpin export
(cd web && npm run search-index && npm run site)
```
Re-importing the same hashes is idempotent and preserves any existing live file and all PDF history.

## What it collects

The collection page lists one publication per country. Each publication holds several notes, each
as an HTML ("accessible") edition and a PDF edition. Most are country policy and information
notes; the rest are country information notes, country bulletins and fact-finding mission
reports. There are no regional or continent-wide notes.

## How it stays verbatim

- **Source:** the [GOV.UK Content API](https://www.gov.uk/api/content/government/collections/country-policy-and-information-notes),
  which returns each note's HTML body as published. That body is stored unchanged, byte for byte,
  with its sha256; nothing is cleaned or reformatted. Links to sources are therefore preserved
  exactly.
- **Versions:** a new version is recorded whenever the body's hash changes. GOV.UK edits notes in
  place without changing dates, and retires a note's URL when it publishes a new edition, so
  identity is the hash, never the URL. Each version also carries a hash of its visible text, so a
  markup-only change can be told apart from a wording change.
- **Nothing is deleted:** a note that disappears from GOV.UK is marked `removed`. From the day this site
  began watching, the day an edition is replaced or withdrawn is recorded and shown beside it ("Archived
  14 Oct 2026": the check that first found it gone, and the last check that saw it there).
- **Checks** (`./cpin verify`): every stored body and PDF still matches its hash; every country,
  note and PDF GOV.UK lists is stored; with `--live`, a fresh fetch matches the stored body; with
  `--pdf`, each HTML note's sentences are found word for word in its PDF edition.
- **Archived editions** from the Internet Archive are labelled `source: wayback` with the capture
  time and archive URL. Their text is verbatim; their markup is the archive page's, re-serialised.
- **Editions recovered as PDFs** (`./cpin recover`): an edition GOV.UK no longer lists, which the Internet
  Archive holds only as a PDF (every edition before late 2021 was published as a PDF only). The file is the
  Archive's own record of it, byte for byte, checked against the Archive's digest and against the page
  count GOV.UK listed; a capture that is cut short is refused. Its entry in `data/pdfs/manifest.json`
  says `source: wayback` with the archive address, the capture time and when the country page listed it.
  Its text is read from the PDF like any other PDF-only edition, so it is shown as both: "From the PDF"
  (never "Verbatim") and an archived copy, with the Archive's address as its source, and a citation
  from it says "PDF version" and "archived copy, Internet Archive, captured …". GOV.UK's own address
  for such a file is never given as its source: it now leads to a later edition.

## Commands

```bash
python3 -m venv .venv && .venv/bin/pip install -e ".[dev]"
.venv/bin/pytest -q
./cpin sync            # quick: one request (a 304) when nothing has changed
./cpin sync --full     # re-fetch every note; catches silent edits
./cpin verify --pdf
./cpin backfill        # older editions from the Internet Archive
./cpin recover         # removed editions the backfill cannot see (PDF-only, or under a page's earlier address):
                       # catalogue (data/wayback-catalogue.json), then fetch what is not held; --discover-only stops after the catalogue
./cpin pdftext         # read the text of PDF-only editions, listed now or recovered
./cpin supplementary   # hold the seven withdrawn countries, About CPINs and write the manual archive list
./cpin rederive        # recompute what is derived from stored bodies (version numbers, text fingerprints); bodies untouched
./cpin images          # mirror every image the current notes embed (sync does this for changed countries)
./cpin status
```

### Save original PDFs from exact links

Put one exact PDF link per line in a text file, then run from the repository root:

```bash
.venv/bin/python scripts/save_pdf_links.py links.txt --out ~/Downloads/CPIN-PDFs
```

The downloader uses the existing polite client, saves the original bytes under their content hashes,
checks that each PDF is readable and not truncated, and writes a separate JSON report of sources and failures.
It keeps existing files and earlier reports; it does not import the files into the site's edition histories.
Five synthetic tests cover byte preservation, repeat downloads, invalid/truncated responses, existing-file
corruption and refusal of National Archives requests. No live download was made to test this helper.

Supply a dated archive capture when an earlier edition is wanted. A GOV.UK URL may now lead to a newer
edition; a structural PDF check does not confirm its title or edition. Timeline pages are rejected, and
National Archives requests remain blocked by the handover's manual-access rule. The helper does not discover
captures, print pages to PDF or automate the National Archives list.

### Prototypes (site design)

```bash
./cpin export                         # writes prototypes/dashboard/data.json from the store
cd web && npm install && npm run vendor && npm test
python3 scripts/serve.py 8781         # from the repo root, then open:
# http://localhost:8781/prototypes/dashboard/                                   globe dashboard
# http://localhost:8781/prototypes/reader/?country=afghanistan&series=note:fear-taliban
#                                                                                 one report: read, history, changes
# http://localhost:8781/prototypes/redline-timeline/                            redline sample (invented text)
# http://localhost:8781/prototypes/saved/                                       saved highlights
# http://localhost:8781/prototypes/about/                                       GOV.UK About CPINs
# http://localhost:8781/prototypes/guide/                                       guide and glossary
# http://localhost:8781/prototypes/dashboard/?q=internal%20relocation            search (one box: countries, reports, text)
```

- **Report page** (`prototypes/reader/`): one page per report, `?country=<slug>&series=<key>`. It opens on
  the latest edition, verbatim and clean, with contents, find-in-text, mirrored images and links preserved.
  Links to notes we hold open here; links to country pages open the dashboard at that country; Word
  bookmarks that GOV.UK lost are repaired; cited sources carry their link status ("Moved", "Dead" with the
  archived copy). Older links (`?country=&note=`) are mapped to their report.
  - **Head:** three quiet lines (back to the country, the title, one line of version, date and links)
    and two chips: *Sources* (link counts and "next dead link") and *Verbatim* (where this edition's text
    came from: GOV.UK as at the last check, or the Internet Archive capture, with the verbatim title).
  - **Nothing above the text moves between editions:** fixed-height lines and caption box (long captions
    and tables open behind "More"), measured at 0 px across every edition of five reports.
  - **History**, open by default above the text (collapsible): every edition held and every GOV.UK update
    on one timeline, with the rolling "As at" date ("All editions" lists them). Each edition is captioned with
    the Home Office's own "Changes from last version of this note" (rendered as published, tables
    included), else its GOV.UK change note, plus a computed line (most-changed sections, words added and
    removed) labelled as computed. GOV.UK updates whose edition is not held are dated stops too, so a
    report with one edition still has a history to step through. Section and paragraph numbers in captions
    ("sections 13.4, and 16.3 to 16.5") link into the text and highlight what they refer to, and so do the
    report's own section names in the Home Office's statement ("Updated country information and
    assessment"): whole heading names only (`findSectionNames`).
  - **Pointing at the timeline:** the stop nearest the pointer, within 26 px, is the one it is on, however
    small its mark (`timeline.js`: `stopInReach`): it lights and sparkles, shows its tooltip (facts, a
    rule, then what it says), and is where a click goes. A tap goes to the nearest stop.
  - **Why an update has no text** (`report-history.js`: `updateKind`): "PDF only" when the Home Office
    published that edition without a web version (the PDF is linked), "Removed" when the note itself
    records a removal and nothing new, otherwise "Not held", with the reason on hover. A PDF-only edition
    whose text has been extracted is an edition like any other ("From the PDF"); these labels are for one
    whose PDF could not be read (`current_pdf_only` in the series file): the page then says so above
    everything and never calls the older text "latest"; the start page's card does the same.
  - **Where a link leads** (`reader/link-card.js`): resting the pointer on a link in the text, or focusing
    it, shows a small card: a source's site, address and link-check result (with the archived copy if it
    is dead); the report or country a link opens here; or the section a link within the page goes to.
    Nothing is fetched for it.
  - **Time travel:** moving the slider (click, drag or arrow keys) shows that edition, clean
    (`&edition=<id>`); "Latest guidance →" in the edition bar goes back. The reading place is kept by
    paragraph number.
  - **Rewrites:** `./cpin export` records how much of each edition's wording survives from the one before
    (`similarity_to_previous`: shared five-word phrases ÷ the larger edition). Below 25%
    (`REWRITE_THRESHOLD` in `report-history.js`) the caption says "Rewritten · about N% of the earlier
    wording kept", and Show changes offers the two editions side by side without marks instead of a
    redline (still one click away). A third of consecutive pairs are rewrites: see
    `docs/reviews/2026-10-03-rewritten-editions.md`.
  - **Show changes** turns the same reading area into a redline (Inline or Side-by-side) between the
    edition shown and the one before, or any two chosen with the Old and New handles
    (`&changes=1[&from=<id>][&view=sbs]`). Comparisons run in a Web Worker
    (`prototypes/shared/redline-engine.js`, `redline-worker.js`, `redline-diff.js`).
    `prototypes/redline-timeline/?country=&series=` now redirects here with changes shown; without a query
    it is still the invented sample. Reworked lists (items gaining or losing `<p>`, split, merged or moved
    into sub-lists) are compared as units, so an item reads as one changed item, not fragments.
  - **Minimap** (≥1200px): a strip at the text's edge showing the whole report: section ticks, insertions
    and deletions in two lanes when changes are shown, otherwise saved highlights and dead links; find
    matches; the part on screen. Click or drag to move; hover names the section
    (`prototypes/shared/minimap.js`, tested in `web/test/minimap.test.mjs`).
  - **Highlights:** select text in any edition to save a highlight. Each records the edition it was read
    in, paragraph number(s), section and the sources its footnotes cite, and cites that edition: GOV.UK
    while it is the live edition, otherwise its Internet Archive copy (dated from the capture in its
    address). On the latest edition, older highlights are re-anchored or flagged "Changed since you saved
    it", with a link to the redline. Highlights are kept in this browser (`localStorage`,
    `cpin-highlights-v1`) until logins exist; the Saved page exports them as Markdown, JSON or Word.
    Citation styles are "Full (OSCOLA)" and "Short (tribunal)".
  - Timeline, captions and paragraph references are pure functions in
    `prototypes/shared/report-history.js` (tested in `web/test/report-history.test.mjs`); the slider and
    rolling digits are `prototypes/shared/timeline.js` + `timeline.css` (`web/test/timeline.test.mjs`).
- `./cpin export` also writes `prototypes/data/series/` (every edition held of each report; gitignored,
  regenerate it).
- **Search:** one box, in the dashboard's header (`prototypes/dashboard/search-query.js`). As you type it
  lists countries, then reports, then passages from the full text. Reports sit under subject headings
  ("Humanitarian situation · 9 countries · 10 reports") from a reviewed table,
  `prototypes/shared/topic-groups.js`: GOV.UK words one subject many ways, so a title joins a group only
  if it is listed, or is a listed topic plus a place or bracketed note; anything else stands alone
  (`docs/reviews/2026-10-03-topic-groups.md`). Queries are read forgivingly ("country reports", "FFM",
  a country name) and never dead-end: with no title match the passages are the answer. "All N passages →"
  opens the full list in the panel with Kind and Country filters (`?q=&view=passages&country=&kind=`).
  Each country has a box for its own reports and their text. `prototypes/search/` now only redirects here.
  The text index is [Pagefind](https://pagefind.app) (MIT), in the browser (`shared/fulltext-search.js`):
  `cd web && npm run search-index` writes one record per h2/h3 section of each live note's current edition
  (`src/cpin/search_records.py` → `prototypes/data/search-records.jsonl`; body text only, no footnotes,
  bibliography or version control), then builds `prototypes/search/pagefind/` (gitignored; rebuild after
  each export). On 2 October 2026: 3,945 records from 164 notes, an 18 MB index in about 4,200 files. A
  hit opens the report at its section with `&q=`, which fills find-in-report and glides to the first match.
- **Dashboard** (`prototypes/dashboard/`): from 901 px the page is an app shell: header, the globe, the
  panel as its own scrolling column, and the footer always in view; below that it is one scrolling page.
  - **Choosing a country:** the dots are the targets (`pick.js`: a dot's drawn radius plus a margin,
    nearest dot wins); borders are the fallback, so a tiny country is as easy to pick as a large one.
    Hovering lights a country in its flag's colours after a short rest, with a crossfade; only a
    country too small on screen for its flag to read is outlined as well. Zoomed in (from about 1.5×),
    every country in view shows its flag (`country-glow.js`: `ambientLevel`).
  - **Sharp when zoomed:** COBE draws each land dot as a soft blob, which blurs when the globe is
    enlarged. `web/build-vendor.mjs` makes one change to its shader so the dots keep a crisp edge at any
    zoom (identical at 1×), recorded in `prototypes/vendor/VERSIONS.json`.
  - **"Accurate as of":** the header quietly asks GOV.UK's content API for the country pages' last-updated
    dates (once per visit, reused for 30 minutes) and shows "Accurate as of <now>", "GOV.UK has N newer
    updates", or "Copy fetched <when>" (`sync-status.js`). It compares dates, not text; the weekly full
    sync catches silent edits. All times are UK time (`shared/uk-time.js`).
- **The mark** (`shared/brand-mark.js`, `shared/mini-globe.js`): the header mark is the globe in
  miniature, the same dots in the same places (COBE's lattice and its land map, copied into
  `vendor/globe-mini-data.js` by `npm run vendor`). It shows the globe's opening view until a country
  is in hand (one open on the start page, a report being read), then turns to that country and marks
  it. The same code draws the globe's stand-in, so the start page shows its land from the first frame
  and the real globe settles in over it. `npm run mark` writes the static copies (`mark.svg`, favicon).
- **Header and footer** (`shared/brand.css`): CPIN Explorer's dotted-globe mark and wordmark; in the footer
  the RM mark, the sources credit, links to the guide and the glossary, and "Report a bug" (an email with
  the page and browser filled in; address in `shared/site-config.js`).
- **Text from PDFs** (`src/cpin/pdftext.py`, `./cpin pdftext`): the Home Office's PDFs are made in Word and carry
  their own text, so nothing is read by OCR (a scan would be refused, and left as a PDF). The extractor rebuilds the
  web layout from the pages: headings from the PDF's bookmarks (h2/h3/h4, as GOV.UK uses), numbered paragraphs, bulleted
  lists, tables, footnotes (the small type under the rule at the foot of each page, matched to the raised numbers),
  links, and figures (pictures and drawn charts are rendered as images); the cover, contents, page numbers and "Back
  to Contents" are left out, and a paragraph cut by a page end is rejoined. The result is kept in `data/pdfs/text/`
  (committed, with its figures) beside the PDFs (not committed), and the export adds it as an edition with
  `source: pdf`. `./cpin pdftext --check` runs the extractor on every PDF that also has a web version and compares
  the two: results in `docs/reviews/2026-10-03-pdf-text.md`.
- **Pictures only the PDF has** (`./cpin pdftext --figures`, `shared/pdf-figures.js`): GOV.UK's web version of a note
  often leaves out the PDF's maps and charts. For each report with both, the PDF's pictures are compared with the web
  version's, and those the web version lacks are kept (`data/pdfs/text/images/`) with their place: after which
  paragraph (`data/pdfs/figures/<pdf sha256>.json`, worked out for one exact web body). The reader shows each beside
  that paragraph, marked "From the PDF" and linked to its page of the PDF. It is display only: the stored body is not
  touched, the picture and its caption are outside the text a reader selects, saves or cites, and a picture whose
  place cannot be confirmed in the page is not shown. Never carried over: the cover's picture (the department's
  logo), small marks (logos, stamps, signatures), and tables drawn with shading. `./cpin pdftext --sheets DIR`
  writes them all onto contact sheets to look over.
- **Web version against PDF** (`./cpin compare`, `src/cpin/webpdf.py`): the two publications of one edition are
  not always the same text. Each pair is compared word by word and every difference is checked against the PDF's
  own raw text, and then by a second program that reads PDFs (poppler's `pdftotext`, `brew install poppler`), so that
  a fault in our reading of the PDF is never reported as a difference. `./cpin compare --page FILE` writes them all
  out as one page to read through. The standing method,
  which every such check follows, is `docs/methods/pdf-and-web.md`; the first full run is written up in
  `docs/reviews/2026-10-03-pdf-vs-web.md` (the middle note differs by five words; the worst by 4.4%).
- **Guide and glossary** (`prototypes/guide/`): how to use the site, in short task-led sections, and what
  the terms mean ("CPIN" spelled out first). The glossary's content is `shared/glossary.js` (this site's own
  explanations, not Home Office text); its terms are also listed under the results of the site's search.
- **Phones:** dots on a phone are closer together than a fingertip (Lebanon and Palestine: 5px), so a tap
  among several opens a short "Which country?" list instead of guessing (`dashboard/pick.js`,
  `docs/reviews/2026-10-03-dot-targets.md`).
- **Moving between pages:** where the browser supports view transitions between pages (Chrome, Edge,
  Safari), the globe draws in to the header mark as a report opens and opens out again on return, in
  about a quarter of a second, with no flourish (the owner found a turning globe slow); elsewhere, and
  with reduced motion, pages simply load (`shared/brand.css`). The start page opens on the country it
  is going to show, rather than flying there.
- **Renamed reports:** GOV.UK sometimes renames a report between editions, which would split its history.
  `_RENAMED` in `src/cpin/titles.py` lists the known cases (the version numbers show one lineage); the
  export clears series files left over from an earlier grouping.

The look follows the COBE site: white, one electric blue, Geist Sans for reading and Geist Pixel /
Geist Mono for labels and numbers, all self-hosted (`prototypes/vendor/`, built by `web/build-vendor.mjs`).
The globe is [COBE](https://cobe.vercel.app) v2. COBE has no render loop of its own, so the page drives
it and stops drawing when nothing moves. Clicks are mapped back to latitude/longitude by inverting COBE's
projection (`prototypes/shared/globe-math.js`), then to a country: its dot first (`dashboard/pick.js`),
then its borders (`country-locator.js`).

**Borders:** `prototypes/vendor/countries-gbr.json` is built by `web/build-borders.mjs` from Natural
Earth's 1:10m countries, **UK point of view** (public domain; revision recorded in `VERSIONS.json`). It
puts Crimea in Ukraine, Gaza in Palestine and Somaliland in Somalia, which the standard de facto borders
do not. It leaves the Golan Heights unassigned, so `config/countries.json` patches that to Syria for
clicks. Small states (Gambia, Lebanon, Kuwait, Jamaica, Trinidad and Tobago, Palestine, El Salvador) are
tiny on a globe, so every country has a clickable pin and appears in the A–Z list.

**Credit:** the Home Office is credited in text ("Sources: Home Office, GOV.UK"). Its logo is not used:
the Open Government Licence excludes departmental logos, and it would suggest official endorsement.

The branch’s rewritten `.github/workflows/sync.yml` is configured for a quick sync daily and a full sync
weekly, retaining changed `data/` before verification and deploying only after successful checks. It has not
yet run on GitHub. PDFs are kept out of git
(`data/pdfs/files/`); they are meant for Cloudflare R2, which is not set up yet.

## Hosting

The site is a static-assets-only Cloudflare Worker (`web/wrangler.jsonc`), live at
<https://cpin-explorer.robert-m-w-stevens.workers.dev> (`/` redirects to the globe).

- **Public, hidden from search engines:** every response carries `X-Robots-Tag: noindex, nofollow,
  noarchive`. `robots.txt` keeps crawlers off the bulk data but not off pages, because a crawler that
  can't fetch a page never sees its noindex.
- **Build:** `web/build-site.mjs` copies only what the pages load into `site/` (gitignored), keeping the
  repo's layout so relative links work, and checks Cloudflare's limits (25 MB a file, 20,000 files).
  PDFs are not shipped; PDF links go to GOV.UK or the recorded Internet Archive copy.
- **Deploy by hand:** after `./cpin export` and `cd web && npm run search-index`, run
  `cd web && npm run deploy` (needs `npx wrangler login` once).
- **Automatic deployment configuration (not yet verified on GitHub):** `.github/workflows/deploy.yml` runs after a sync that changed content, on
  pushes that change the site, or by hand. It needs two repository secrets, `CLOUDFLARE_API_TOKEN`
  (a token with "Edit Cloudflare Workers") and `CLOUDFLARE_ACCOUNT_ID`; without them it notes that and
  stops. Mirrored images are cached between runs, so only new ones are fetched.

## Data layout

See the docstring at the top of `src/cpin/store.py`.

## Roadmap

- Text from PDFs: figures are images with no description; tables that run over a page are separate tables; a chart's numbers are not text.
- R2 for the mirrored PDFs, so the site can serve its own copies.
- Cleaner URLs (`/reader/…` rather than `/prototypes/reader/…`) once the prototypes settle.
- Login, if wanted later, with Cloudflare Access.

## Licence and attribution

Contains public sector information licensed under the
[Open Government Licence v3.0](https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/).
The notes are Crown copyright. This is an independent mirror, not an official Home Office
service; always check the current edition on GOV.UK.

Brand artwork: the product mark (the dotted globe in the header, tab icon and Word export) is
CPIN Explorer's own, in `assets/cpin-explorer/` (options and choice: `prototypes/brand/`). The RM mark
in the footer is from `assets/roberts-macros/`, copied from
[Roberts-Macros-assets](https://github.com/RobertsMacros/Roberts-Macros-assets) at revision
`95e38faf099249376af855cf509967aa2e93ac0c`; the transparent crops of the mark in `derived/` are made from those
originals (see `assets/roberts-macros/SOURCE.txt`).

<img src="assets/roberts-macros/derived/rm-mark-ink.png" alt="Roberts Macros" width="110">
