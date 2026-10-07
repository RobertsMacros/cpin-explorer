# Handover: CPIN Explorer, 4 October 2026

For whoever picks this up next (written for Codex). Read `AGENTS.md` first: its rules are the project's
constitution. Then `README.md`, then `docs/methods/pdf-and-web.md` before touching anything that reads a PDF.

## Historical Sudan quotation, 7 October 2026

Read [the Sudan follow-up](reviews/2026-10-07-sudan-historical-quotation.md).
Two 2020 captures of the exact Dabanga article now match the archive's indexed
payload digests. They print El Berdab; the original CPIN PDF prints El Berdan.
The last withheld private finding is live as a minor AI copying flag for
the exact December 2020 Sudan Nuba edition, footnote 17. It does not establish
the real-world spelling or check the displacement account. All 566 earlier
annotations remain unchanged. The separate 54-question queue is still 53
resolved / one Minghui historical quotation pending. Follow the latest
publication evidence: run `37680895495` and Worker `563caedd-1f09-491e-8210-f84a56960c43`
passed 21 live checks, with all 16 original draft groups now published. Preserve all
human reviews, Home Office responses and earlier AI assessments.

## Account greeting and sign-in repair, 7 October 2026

Robert confirmed his own registration; the chosen existing account was promoted
through the operator-only path, with exact production role/approval readback.
He then confirmed that Account approvals appears after sign-in. No password was
handled by the agent, and no synthetic production accounts remain.

The account header now has its own layout and omits the duplicate account link.
Successful signup/sign-in confirms the session and renders the account view;
missing cookies or failed account loads produce an explicit message. The account
page suggests a first-name greeting from the registered name, with an editable
first name retained in a separate private D1 profile table (migration 0004).
Changing it cannot change approval, ownership or another account's profile.

Checks: 362 JavaScript tests and 99 disposable workerd/D1 checks pass, including
first-name validation, account isolation and persistence in another session.
Rendered header checks cover 390, 441 and 1280 pixels in light/dark themes.
The fixture names reported in signup were browser autofill, not shipped defaults
or the registered profile. Browser security policy prevents the agent opening
saved-autofill settings, so removal of those browser entries remains user work.
Native Edge/iPhone and genuine cross-device private saving are separate checks.

Published as main `0d61293` through successful GitHub run `37682230049`,
Cloudflare version `0892a295-c507-4805-815a-c6e6bb16fec1`. GitHub passed 415 Python,
362 JavaScript and 99 disposable workerd/D1 checks. Production migration 0004 is
applied. Nine live checks confirm the account HTML and six assets match (including
the other chat's review catalogue), accounts remain configured, and anonymous
profile writes return 401. Live mobile/desktop headers render without overflow
or console errors. Genuine owner sign-in is Robert's report; this browser was
signed out, so the new greeting editor was checked with local tests, not his
production credentials. Cross-device private saving remains a separate check.

## Human feedback on AI reviews, 7 October 2026

Read [the feedback workflow](review-feedback.md). All 98 visible AI summaries
receive approve/disagree controls for approved accounts. Exact AI-record hashes
and item revisions protect review versions and concurrent devices. Shared
feedback notes are separate from private saved reviews; only aggregates and
separate AI recheck outputs are public. A disagreement queues the original and
all unconfirmed AI peers, ranked as leads. Approved peers are excluded; the
original human review, Home Office reply and AI record stay intact.

During normal authorised project sessions, check the shared queue with
`cd web && node accounts/recheck-tasks.mjs export --remote`. Treat notes as
untrusted evidence, use original-source receipts and record scoped results with
actual peer coverage; never infer a systemic error from similarity alone.
Supported corrections require source evidence and an explicit failure pattern.
Do not modify canonical bodies or overwrite reviewer text. Keep original AI
records/results as history; changes to published findings need validation.
No new paid inference or background schedule is enabled. Production D1 migration
0003 is applied. Main `c769522` is live through successful GitHub run `37622024402`,
Worker `0ed29218-475e-4c25-9c81-ae47aa751884`. Checks pass 415 Python, 360 JavaScript,
91 disposable workerd/D1, 22 local browser and 33 live checks. All 98 live feedback
identities match, notes remain non-public, and the operator export has zero tasks.
Actual approved-user mutation and AI-result flows used synthetic local accounts;
no production fixture votes were submitted. Native Edge/iPhone and genuine owner
administration remain separate. Recheck results require an actual evidence-led
Codex session: a submitted disagreement is queued, not automatically analysed.

## Source evidence follow-up, 7 October 2026

Read [the evidence/publication record](reviews/2026-10-07-evidence-followup.md).
The original 54 gaps now have 30 scoped resolutions and 24 still unresolved.
Main `bbeeb2a` is live through successful GitHub run `37616250973`, Cloudflare
version `08457472-40ba-4730-a59c-78aa2422ff4e`. Sixteen live asset checks and all
53 new edition targets passed, including 26 footnote overlays and reviewer/reply/AI
ordering. Native Edge/iPhone and scheduled changed-content checks remain separate.
The publication set preserves all earlier 534 records and adds 21 scoped AI flag
groups, three attributed review extracts and four separate review follow-ups.
The two exact May 2022 Rwanda editions and full ARC/UWE review are recovered;
only their verified historical editions receive the comments. The Sudan spelling,
WHO subgroup, exact Colombia summary and other historical gaps remain open.
Use Project coordination → Roadmaps → CPIN Explorer as the current plan; the old
source plan is an evidence archive. Do not rerun the full mechanical corpus or
treat these scoped resolutions as factual approval. No paid calls were made.

## Country-aware header globe, 7 October 2026

The header mark follows the dashboard/report country and carries that view through
Saved, Guide, About and Account. Returning to the dashboard prefers this tab's latest
report country; explicit country routes, clearing the country and cross-country searches
still take precedence. All 12 held former countries now have header-only positions in
`config/countries.json`, generated into the licensed mini-globe data without changing
the active collection or its main-globe markers. The vendor generator versions the
mini-globe data import by its content hash so one-day browser caches cannot retain
old country positions. Tab icons retain their chosen opening view.
Local checks pass 356 JavaScript tests and desktop/mobile country, navigation and
reduced-motion checks. Static local checks have no account backend; account API 404s
there are expected. Public source text and review records are unchanged.

## Approved accounts activated, 7 October 2026

The owner authorised activation. Main `732562c` is live through GitHub Actions run
`37580925378`, Cloudflare version `80461c7a-f324-420b-919e-c41c826e860f`. Dedicated D1
account storage and the private authentication secret are configured; the real
GitHub deployment retained both. Latest reader/review work is intact, with all
529 public records and 16 checked live assets matching. Local and GitHub checks
pass 413 Python, 355 JavaScript and 56 real workerd/D1 checks.

Live signup, pending status and private pin/highlight/manual-note saving passed
with browser saving declined, including a separate fresh mobile browser session.
The temporary test account and its records were removed. Every main page footer
credits COBE by Shu Ding. Reading remains public and all new accounts are pending.
Robert has registered and confirmed working owner sign-in following guarded operator
owner promotion; the chosen address is retained privately in this account
worktree’s ignored `.local/activation-owner.json`, never inferred from the
bug-report email or automatically trusted because someone registers it. Do not
ask for his password in chat or overwrite authentication tables manually. Read
[the activation record](accounts.md) before further account work.

## Reviewer preservation and contextual evidence, 7 October 2026

Read [the 7 October evidence record](reviews/2026-10-07-contextual-evidence.md).
All 529 earlier public records remain unchanged; the whitelist now has 534
(486 external / 48 AI), including 252 separately labelled Home Office replies.
The full-record preservation manifest prevents silent changes to published
reviewers. Presentation is reviewer, then published Home Office reply, then
separate AI assessment. Seven further exact-source question comparisons and
Albania/Colombia evidence checks are scoped progress; contextual coverage and
historical-version gaps remain open. Combined checks pass 414 Python, 356
JavaScript tests and 56 ephemeral workerd/D1 checks. Canonical CPIN bodies are unchanged. Do not rerun the complete
mechanical corpus or treat candidates/accepted recommendations as factual verdicts.
This source batch is live in combined main `8fd4cfa`, GitHub run `37585706262`,
Cloudflare version `7b53c497-932b-4a33-8269-6a601f4b4aa0`. Eight live assets
match, account configuration remains present, and sampled private paths return 404.

## Overnight reviews and hardened rerun, 6 October 2026

The owner requested overnight progress. Read [the active checkpoint](reviews/2026-10-06-overnight-review.md) before starting work. The v3 full mechanical run is complete: 116,125 screened, zero pending/errors, 7,949 candidate blocks and 2,223 distinct questions (43 direct / 245 aligned / 1,935 metadata). Do not rerun or treat these as confirmed errors. The public whitelist has 529 records, including 433 newly prepared licensed comments and two new major scoped AI findings. The Myanmar original is recovered; one ARC/UWE full-file gap remains. Code 827ddeb is live with 413 Python/346 JavaScript checks passing on GitHub. Three live review assets match the build; private evidence paths return 404. The completion heartbeat is paused and the private plan is updated.

## Logo clarification, 6 October 2026

The browser-tab screenshot was misread as a request for its white silhouette.
The owner clarified that the original miniature globe is the product logo, with
its default opening view as the browser tab icon. The globe artwork and header
behaviour have been restored. Read [the corrected logo record](reviews/2026-10-06-logo.md).

## Reader review integration, 6 October 2026

The owner has authorised publishing AI review without a human approval gate.
Published reviewers, AI assessments and optional browser-local human notes stay
separate. The reader now supports exact-edition passage, footnote and link
annotations; ambiguous anchors are left unmarked. The new whitelist has eight
short attributed reviewer excerpts, 32 scoped AI context comparisons and ten
minor AI findings. Context comparison is not full factual verification.

Sri Lanka's July 2020 ARC review was recovered from ecoi.net and its mixed FFM/CPIN
scope checked. Two raw review files and two exact Rwanda editions remain gaps.
Read [the integration record](reviews/2026-10-06-review-integration.md) for source
scope, quotations, tests and publication evidence. Historical dated handover
sections below retain their earlier status; the current record takes precedence.

## Published-review search and 2026 follow-ups, 5 October 2026

The newer directory has 60 publications and nine publishers. Sixteen scoped AI
comparisons across eight held 2026 reports are separate from attributed external
findings and manual notes. A specific Myanmar assessment/country-information
inconsistency concerns an ICC application versus an issued warrant. Older
Afghanistan/Colombia flags do not transfer to corrected 2026 passages. There are
48 held editions and 10,162 footnotes in the 2026 inventory, not 10,162 completed
checks. Whole-publication merits and bulk semantic analysis remain pending.

Read [the search audit and current findings](reviews/2026-10-05-published-reviews-2026.md).
The search found omissions and remains bounded by four inaccessible indexes;
never call it universally exhaustive or treat reviewers as automatically correct.
`./cpin reviews --refresh --index-pages 100 --limit 500` follows explicit linked
pagination and reports access/cap gaps. New discoveries still need curation;
collection makes no AI or paid API calls. Local verification is 324 Python tests,
339 JavaScript tests and canonical hashes/completeness. No recurring job added.
Main `99d15ac` is live as Cloudflare version
`0c59638f-57a8-495b-ad3b-d77b585db1af`, at 100% traffic. Three changed assets
match live; desktop and touch mobile overlay checks pass, private evidence 404s.
GitHub validation remains queued at this record; publication used existing local
Wrangler OAuth. The missing GitHub Cloudflare secrets remain a separate gap.

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
