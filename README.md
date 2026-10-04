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
- **PDF-only editions:** eleven reports have a current edition with no web version (Gambia's one report; France: safe third
  country; Ghana and Brazil: sexual orientation; Palestine: humanitarian situation in Gaza; India: political parties; two for
  Zimbabwe; fact-finding reports for Albania, Sri Lanka and Vietnam). Their text is taken from the PDFs and laid out like any
  other edition (`./cpin pdftext`, `src/cpin/pdftext.py`), so they can be read, searched, cited and compared; each is marked
  "From the PDF" and links the PDF, because the layout is a reconstruction. See "Text from PDFs" below.
- **Kept verbatim, as published:**
  - Title typos: "(accesible)", "country police and information note", "country and policy information note".
  - A broken Markdown link in a China note.
- **Since then (4 October 2026):** the Internet Archive backfill covered all 47 countries (239 archive
  copies, which are 158 archived editions: two copies whose words are the same, white space aside, are one
  edition); 333 editions are grouped into 197 reports; the link checker has tested 16,495 cited links; the
  site is hosted on Cloudflare and redeployed after each sync that changes content.
- **Not done yet:**
  - R2 storage for PDFs.

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
./cpin rederive        # recompute what is derived from stored bodies (version numbers, text fingerprints); bodies untouched
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

`.github/workflows/sync.yml` runs a quick sync daily and a full sync weekly, commits changes to
`data/`, and, when content changed, calls `deploy.yml`. PDFs are kept out of git
(`data/pdfs/files/`); they are meant for Cloudflare R2, which is not set up yet.

## Hosting

The site is a static-assets-only Cloudflare Worker (`web/wrangler.jsonc`), live at
<https://cpin-explorer.robert-m-w-stevens.workers.dev> (`/` redirects to the globe).

- **Public, hidden from search engines:** every response carries `X-Robots-Tag: noindex, nofollow,
  noarchive`. `robots.txt` keeps crawlers off the bulk data but not off pages, because a crawler that
  can't fetch a page never sees its noindex.
- **Build:** `web/build-site.mjs` copies only what the pages load into `site/` (gitignored), keeping the
  repo's layout so relative links work, and checks Cloudflare's limits (25 MB a file, 20,000 files).
  PDFs are not shipped; PDF links go to GOV.UK.
- **Deploy by hand:** after `./cpin export` and `cd web && npm run search-index`, run
  `cd web && npm run deploy` (needs `npx wrangler login` once).
- **Deploy automatically:** `.github/workflows/deploy.yml` runs after a sync that changed content, on
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
