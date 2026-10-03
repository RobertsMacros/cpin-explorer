<img src="assets/roberts-macros/image.png" alt="Roberts Macros" width="72" align="right">

# CPIN Explorer

*Roberts Macros: no macro too micro.*

A verbatim, versioned mirror of the Home Office's
[Country Policy and Information Notes](https://www.gov.uk/government/collections/country-policy-and-information-notes)
(CPINs) on GOV.UK, with a record of every edition we have seen, so that changes can be shown as
inline redlines on a timeline.

It has three parts:

1. **Scraper** (`src/cpin/`, built): fetches every country page and every note from the GOV.UK
   Content API, stores each note's body exactly as published, mirrors the PDF editions, and keeps
   every version it sees. Older editions are recovered, where possible, from the Internet Archive.
2. **Site** (not built yet): a static site with a COBE globe, a country page per country, a reader
   that keeps GOV.UK's formatting and links, and search within a country and across all of them.
3. **Comparison** (prototype only): a timeline slider across editions and inline redlines
   between any two of them. See `prototypes/redline-timeline/`.

## Status

**2 October 2026: one tested run. Not yet sustained operation.**

- **Full sync:** 47 countries, 164 HTML notes and 175 PDFs (173.4 MB) in 3 min 49 s, no errors.
- **`verify --live --pdf`:**
  - All 164 bodies and 175 PDFs match their recorded hashes.
  - Every country, note and PDF GOV.UK lists is stored.
  - A live re-fetch of all 164 notes was byte-identical to the stored bodies.
  - Across 147,182 sentences, 96.6% of the HTML edition's sentences appear word for word in the PDF edition, and 3.2% are the same words split by page layout. 0.2% are unmatched, mostly chart captions that the PDF holds as images.
  - Every note scores at least 95%.
- **Internet Archive backfill:** running. The first two countries yielded 28 earlier editions at URLs GOV.UK has since retired. For example, Afghanistan "fear of the Taliban" goes from v2.0 (Feb 2022) to v5.0 (Oct 2025).
- **Images:** all 408 images the current notes embed (mostly SVG maps and charts, 44.0 MB) are mirrored and hash-verified. `verify` confirms every image a current note uses is held. None of the source images has alt text.
- **PDF-only countries:** France and Gambia have no HTML edition. Their PDFs are mirrored, but their text is not yet extracted.
- **Kept verbatim, as published:**
  - Title typos: "(accesible)", "country police and information note", "country and policy information note".
  - A broken Markdown link in a China note.
- **Not done yet:**
  - Scheduled runs. The workflow is written, but the repository is not on GitHub.
  - R2 storage for PDFs.
  - Series grouping of editions.
  - The site.

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
- **Nothing is deleted:** a note that disappears from GOV.UK is marked `removed`.
- **Checks** (`./cpin verify`): every stored body and PDF still matches its hash; every country,
  note and PDF GOV.UK lists is stored; with `--live`, a fresh fetch matches the stored body; with
  `--pdf`, each HTML note's sentences are found word for word in its PDF edition.
- **Archived editions** from the Internet Archive are labelled `source: wayback` with the capture
  time and archive URL. Their text is verbatim; their markup is the archive page's, re-serialised.

## Commands

```bash
python3 -m venv .venv && .venv/bin/pip install -e ".[dev]"
.venv/bin/pytest -q
./cpin sync            # quick: one request (a 304) when nothing has changed
./cpin sync --full     # re-fetch every note; catches silent edits
./cpin verify --pdf
./cpin backfill        # older editions from the Internet Archive
./cpin images          # mirror every image the current notes embed (sync does this for changed countries)
./cpin status
```

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
# http://localhost:8781/prototypes/search/?q=internal%20relocation              full-text search
```

- **Report page** (`prototypes/reader/`): one page per report, `?country=<slug>&series=<key>`. It opens on
  the latest edition, verbatim and clean, with contents, find-in-text, mirrored images and links preserved.
  Links to notes we hold open here; links to country pages open the dashboard at that country; Word
  bookmarks that GOV.UK lost are repaired; cited sources carry their link status ("Moved", "Dead" with the
  archived copy) and the head sums them up. Older links (`?country=&note=`) are mapped to their report.
  - **History**, open by default above the text (collapsible): every edition held and every GOV.UK update
    on one timeline, with the rolling "As at" date, Play, and a change log. Each edition is captioned with
    the Home Office's own "Changes from last version of this note" (rendered as published, tables
    included), else its GOV.UK change note, plus a computed line (most-changed sections, words added and
    removed) labelled as computed. GOV.UK updates whose edition is not held are dated stops too, so a
    report with one edition still has a playable history. Section and paragraph numbers in captions
    ("sections 13.4, and 16.3 to 16.5") link into the text and highlight what they refer to.
  - **Time travel:** moving the slider shows that edition, clean (`&edition=<id>`); "Read the latest
    guidance" goes back. The reading place is kept by paragraph number.
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
    `cpin-highlights-v1`) until logins exist; the Saved page exports them as Markdown or JSON.
  - Timeline, captions and paragraph references are pure functions in
    `prototypes/shared/report-history.js` (tested in `web/test/report-history.test.mjs`); the slider and
    rolling digits are `prototypes/shared/timeline.js` + `timeline.css`.
- `./cpin export` also writes `prototypes/data/series/` (every edition held of each report; gitignored,
  regenerate it).
- **Search:** full-text search across every live note, or within one country's notes, with
  [Pagefind](https://pagefind.app) (MIT) running in the browser. `cd web && npm run search-index` writes
  one record per h2/h3 section of each live note's current edition (`src/cpin/search_records.py` →
  `prototypes/data/search-records.jsonl`; body text only, footnote markers removed, no footnote list,
  bibliography or version control), then builds the index into `prototypes/search/pagefind/` (gitignored;
  rebuild after each export). On 2 October 2026: 3,945 records from 164 notes, an 18 MB index in about
  4,200 files, built in about a minute. The dashboard's ⌘K box adds an "In the text" group (scoped to the
  selected country, or everywhere), each country has a box for its own notes, and
  `prototypes/search/?q=&country=&kind=` lists every hit grouped by note with filters. A hit opens the
  reader at its section with `&q=`, which fills find-in-note and glides to the first match.

The look follows the COBE site: white, one electric blue, Geist Sans for reading and Geist Pixel /
Geist Mono for labels and numbers, all self-hosted (`prototypes/vendor/`, built by `web/build-vendor.mjs`).
The globe is [COBE](https://cobe.vercel.app) v2. COBE has no render loop of its own, so the page drives
it and stops drawing when nothing moves. Clicks are mapped back to latitude/longitude by inverting COBE's
projection (`prototypes/shared/globe-math.js`), then to a country (`country-locator.js`).

**Borders:** `prototypes/vendor/countries-gbr.json` is built by `web/build-borders.mjs` from Natural
Earth's 1:10m countries, **UK point of view** (public domain; revision recorded in `VERSIONS.json`). It
puts Crimea in Ukraine, Gaza in Palestine and Somaliland in Somalia, which the standard de facto borders
do not. It leaves the Golan Heights unassigned, so `config/countries.json` patches that to Syria for
clicks. Small states (Gambia, Lebanon, Kuwait, Jamaica, Trinidad and Tobago, Palestine, El Salvador) are
tiny on a globe, so every country has a clickable pin and appears in the A–Z list.

**Credit:** the Home Office is credited in text ("Source: Home Office, GOV.UK"). Its logo is not used:
the Open Government Licence excludes departmental logos, and it would suggest official endorsement.

`.github/workflows/sync.yml` runs a quick sync daily and a full sync weekly, and commits changes
to `data/`. It does nothing until the repository is on GitHub. PDFs are kept out of git
(`data/pdfs/files/`); they are meant for Cloudflare R2, which is not set up yet.

## Data layout

See the docstring at the top of `src/cpin/store.py`.

## Roadmap

- Site: globe (COBE), country pages, reader, search, filters; responsive from phone to 4K.
- Comparison: timeline slider and inline/side-by-side redlines, built on the prototype.
- Series grouping: linking a note's successive editions, which GOV.UK publishes at new URLs.
- PDF-only notes (currently France and Gambia): text extraction for search and comparison.
- Link checker: test the sources each note cites, and show where they lead.
- Hosting: Cloudflare (static assets, R2 for PDFs); login can be added with Cloudflare Access.

## Licence and attribution

Contains public sector information licensed under the
[Open Government Licence v3.0](https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/).
The notes are Crown copyright. This is an independent mirror, not an official Home Office
service; always check the current edition on GOV.UK.

Brand artwork: the RM mark in `assets/roberts-macros/` is copied from
[Roberts-Macros-assets](https://github.com/RobertsMacros/Roberts-Macros-assets) at revision
`95e38faf099249376af855cf509967aa2e93ac0c` (see `assets/roberts-macros/SOURCE.txt`).
