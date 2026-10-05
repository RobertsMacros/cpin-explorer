# Handover completion and local audit, 4 October 2026

The three interrupted handover tasks are complete locally: recovered PDF editions are readable and cited
as archived PDF copies; the twelve former countries and About CPINs are available; saved highlights remain
pinned until the reader explicitly changes their citation. Code, workflow and performance checks found
faults that were corrected. The changes remain uncommitted on `handover-2026-10-04`, based on `c5f7c5d`.
Nothing has been pushed or deployed; the live site remains the earlier `f389a3e` deployment.

## Scope and review findings

This review covered the handover changes from `f389a3e` through `c5f7c5d`, together with this local completion,
across Python storage, recovery, export, verification and link checking; browser rendering, citations,
Saved, Word export and deployment workflows. It is the implementing agent's review, not a separate
independent reviewer or a GitHub workflow run.

| Fault found | Resulting behaviour |
|---|---|
| PDF replacement and aliases could refer to the wrong bytes or edition | Previous metadata and hashes are retained; recovered jobs use their own record; reused URLs and missing files retain the correct identity |
| A withdrawn page could enter current counts, or retain current styling | Seven withdrawn and five taken-down countries appear as former countries, with no current reports; grey readers carry withdrawal/archive provenance |
| Pinned highlights could inherit current paragraph or source details | Citation context stays with the saved edition; current-match context is separate and complete before the action is offered |
| Old “still” records could offer an incomplete current citation | They require a fresh verified match; cached checks are cleared after changing the citation; marks are unwrapped before rerendering |
| Word heading links could lead to current guidance while quoting an archive | Heading and citation links both use the chosen citation's source |
| Failed processing stages could appear successful to CI | PDF extraction, figure checks and comparisons return failure; sync retains fetched data before verification and deploys only after successful checks |
| Robots redirects and archive lookups could bypass the intended host rules | Shared redirect-aware robots handling fails closed; National Archives requests are refused before transport; 403/429 checks are not retried using GET |
| Archive queries could use a country-page date or overwrite a failed lookup as complete | Queries use the note's own date, validate capture timestamps and retain failure state for retry |
| Controls or whitespace could obscure executable link schemes | Derived source rendering rejects such schemes while preserving ordinary source text and GOV.UK links |
| Async content and fonts caused large initial layout shifts | Reader, About and Saved reserve their layout and reveal after fonts; the empty mobile dashboard panel keeps the footer below the viewport |
| Reduced-motion styling retained animation delays | Both animation and transition delays are zero with reduced motion |
| Counts excluded PDF histories or included the About PDF | Export counts all report histories; dashboard counts country PDFs only and shows former-country totals accurately |

Shared helpers remain in use for citation context, source rendering, PDF records and robots handling.
No new frontend framework or duplicate generic subsystem was introduced. Stored source bodies were not
rewritten, and no source history was deleted. Unreferenced derived pictures remain in the repository but
are excluded from the site build.

## Coverage and provenance

The export contains 47 current countries, 12 former countries, 175 current reports and 380 report histories.
174 histories contain multiple editions. It shows 524 archived editions, including 364 PDF editions, and
holds 241 web archive captures. The store holds 566 country-report PDFs plus one About CPINs PDF.

The seven withdrawn pages supply 17 PDFs. Their GOV.UK withdrawal dates are Angola, Liberia and Mali:
26 November 2019; Cameroon: 14 August 2024; Malawi: 13 January 2025; North Korea: 15 July 2021; Rwanda:
24 April 2025. The five taken-down countries supply nine archive PDFs and three web captures. Each keeps
its source and capture time. About CPINs is GOV.UK's June 2026 publication, with its 99 body paragraphs
stored verbatim and linked from the Guide.

The recovered catalogue covers 52 countries: the 47 current countries and five taken-down countries. It
lists 829 editions, 689 held and 140 without a held archive copy; 17 held editions are recognised under
another listing. Discovery read 3,138 listing captures. Counts differ from the original handover's
820/681/139 because the five taken-down countries have since been investigated. The catalogue also retains
32 failed-capture records from recovery, including truncated files; those records remain visible rather
than treating the failed capture as a usable edition.

The manual hand-check list is `~/Documents/GitHub/outputs/CPIN editions to look for at the National Archives.html`:
140 editions, grouped by country, with GOV.UK addresses and National Archives timeline links. No request,
including a robots request, was made to the National Archives' web archive.

## Local verification

`.venv/bin/pytest -q`: 251 passed, with five existing PyMuPDF binding deprecation warnings. `npm test`:
320 passed. Local runtimes are Python 3.14.7 and Node 26.4; the workflow's Python 3.13/Node 24 environment
has not been exercised on GitHub.

`./cpin verify` confirms 405 stored bodies, 567 PDFs and 682 images match their hashes, with no problems.
Current collection completeness is 47 countries, 164 stored/listed HTML notes, 175 mirrored/listed PDFs and
408 mirrored/used images. This was a local integrity check, not another live full sync.

| Command | Earlier full build | Final cached build |
|---|---:|---:|
| `./cpin export` | 30.52 s | 28.08 s |
| `npm run search-index` | 14.81 s | Not rerun: indexed report bodies unchanged |
| `npm run site` | 9.91 s | 6.76 s |
| `./cpin verify` | 5.00 s | 2.80 s |

Pagefind contains 4,335 records from 175 current notes, including 4,160 section records, in 4,601 files
(19.5 MB). The built site contains 7,678 files (417 MB), below the configured 20,000-file and 25 MB per-file
limits. PDF files are not shipped to the Worker; archived PDF source links point to their archive copy.

The complete PDF pipeline and before/after scores are recorded separately in
[the PDF extraction review](2026-10-04-pdf-extraction.md).

## Browser checks

Chromium and installed WebKit 26.6 each passed seven routes at 1440×900 and 390×844: dashboard, About,
Guide, Saved, current Iran, withdrawn Cameroon and an archived Afghan PDF edition. Screenshots were
inspected; no horizontal overflow or console/page errors were reported. About's header and body align,
current guidance remains blue and older/withdrawn pages are grey. Dark mode and reduced motion were
also checked in phone WebKit, including Cameroon country selection and “internal relocation” search
(633 passages). Former-country search shows four Cameroon reports and zero current reports.
Gambia's current PDF-only report was checked in its dashboard and phone reader, with the “From the PDF”
label and no overflow. Iran's rewrite notice, explicit redline choice, inline comparison and side-by-side
comparison were exercised in WebKit; both rendered comparison views were inspected.

Real browser selection and saving were checked for a recovered Afghan PDF: its highlight retains PDF
provenance, archive URL and capture date, and reloads without nested marks. An Iran v6 highlight still
cites v6 paragraph 2.1.1 while the separate match points to v7 paragraph 1.1.1; the current-edition action
moves the citation to v7. The generated Word document's XML and relationships preserve the archived
heading/citation URL before that action. Test highlights were isolated and removed after checking.

Native macOS Safari 27.0 was inspected with current and older Iran editions, About, Guide and withdrawn
Cameroon. iPhone Simulator Safari on iOS 27 was inspected with About, current Iran and withdrawn Cameroon.
Simulator automation did not reliably deliver taps/swipes, so this is a rendering check, not a physical
iPhone gesture check. The simulator started by this task was shut down afterwards.

## Local performance measurements

These are three fresh browser-context navigations per page, cache disabled, on the local Mac over HTTP,
without network or CPU throttling. They are not live-site or field Core Web Vitals results. Saved was an
empty fresh-context collection. Measurement uses PerformanceObserver plus a Chromium DevTools Protocol
trace, following the [Chrome performance documentation](https://developer.chrome.com/docs/devtools/performance).

| Page / width | FCP range | LCP range | CLS range |
|---|---:|---:|---:|
| Dashboard / 1440 | 48–112 ms | 48–112 ms | 0.00576–0.00599 |
| Reader / 1440 | 60–76 ms | 112–172 ms | 0 |
| About / 1440 | 52–64 ms | 52–64 ms | 0 |
| Saved / 1440 | 40–80 ms | 40–88 ms | 0 |
| Dashboard / 390 | 72–80 ms | 72–80 ms | 0.00158 |
| Reader / 390 | 56–72 ms | 108–136 ms | 0.00003 |
| About / 390 | 48–60 ms | 60–84 ms | 0 |
| Saved / 390 | 56–68 ms | 56–84 ms | 0 |

Before the layout fixes, reader CLS ranged from 0.4423–0.4428 on desktop and 0.6176–0.6366 on phone;
About reached 0.5508 on desktop and 0.1709–0.1979 on phone. Mobile dashboard was 0.1988–0.226.
The final reader load/find trace contained 8,443 events and no RunTask over 50 ms; its longest listed
HandlePostMessage was 28.969 ms. Two desktop dashboard navigations still recorded 63 ms and 76 ms long
tasks during globe startup; the final mobile dashboard runs recorded none.

The measured Iran reader loads roughly 2.5 MB of uncompressed resources, including a 921,796-byte dashboard
JSON, 418,156-byte history and 260,556-byte links JSON. Local speed does not establish slow-network speed;
reducing those payloads is a further possible optimisation. No Lighthouse or production score is claimed.

## Dead-link archive refresh

The polite serial refresh completed all 1,470 archive lookups near each note's own date, from 15:51:28 to
18:11:40 BST: 2 h 20 min 12 s. Copies were found for 677 dead cited links. All 1,470 have the requested
date recorded and no lookup remained undated. Link status was re-exported and the site rebuilt afterwards.

The existing 16,495 cited URLs had no site-status check due: 10,922 OK, 1,002 moved, 550 broken, 832
unreachable, 88 server errors, 2,363 restricted, 672 excluded by robots and 66 other results. This run
refreshed archive availability; it did not retest all 16,495 source websites or prove that an available
capture preserves every word of the cited source. The 793 dead links without an archive copy remain visible.

## Remaining owner decisions and external checks

The owner must add `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` to GitHub. The rewritten sync and
deploy workflow has not run there, and merging this branch activates it. No merge, workflow dispatch,
commit, push or deployment was performed during this work.

The repeated-paragraph citation section name remains enabled pending the owner's answer. The choice of
web versus PDF wording where publications differ also remains with the owner. Physical iPhone gestures,
flag-zoom preferences and the older personal design choices listed in the original handover remain open.
