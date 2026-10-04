# Handover: CPIN Explorer, 4 October 2026

For whoever picks this up next (written for Codex). Read `AGENTS.md` first: its rules are the project's
constitution. Then `README.md`, then `docs/methods/pdf-and-web.md` before touching anything that reads a PDF.

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
