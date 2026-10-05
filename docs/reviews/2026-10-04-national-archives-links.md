# National Archives link collection, 4 October 2026

The owner explicitly requested the underlying dated PDF links from all addresses in the manual list.
The two National Archives full-text searches were exported through the site's supplied CSV controls:
"country policy and information note", filtered to PDF, 1,788 rows; "country information and guidance",
filtered to PDF, 1,440 rows. The exports contain 3,007 distinct capture links. Both complete exports
are preserved in `~/Documents/GitHub/outputs/CPIN National Archives exports/`.

Full-text search did not cover every requested address. All 141 supplied timeline addresses were then
opened through the browser. "Show one instance per day" was switched off and "Show redirects" stayed
off. Every dated capture link was read from the page's anchors. Each collected count equals the
timeline's displayed instance count. Source addresses and saved capture dates match independent
checksums of the browser-collected data; no timestamps were guessed.

The timelines yielded 1,265 dated PDF capture links for 138 PDF addresses, and 18 HTML captures for
Brazil's accessible internal-relocation edition. Two original addresses reported URL not found:
Kenya's operational guidance note, December 2013, and Pakistan's Ahmadis note, June 2018. This says
nothing about possible captures at other addresses. The list represents 140 edition rows because
Brazil's row supplies both a PDF and an HTML address.

Saved outputs under `~/Documents/GitHub/outputs/`:

- `CPIN National Archives PDF links.txt`: all 1,265 PDF links from the requested timelines.
- `CPIN National Archives PDF links and titles.csv`: the same links with country, edition and capture date.
- `CPIN National Archives timeline coverage.csv`: every supplied address, capture count and result.
- `CPIN National Archives HTML capture links.txt`: the 18 HTML links, kept out of the PDF list.
- `CPIN National Archives PDF links - all collected.txt`: 4,200 distinct links, combining both full-text
  exports and the requested PDF timelines. Includes records beyond the 140 missing editions.
- `CPIN National Archives capture dates.txt`: observed timestamps keyed to the zero-based row of the
  existing timeline address file.
- `CPIN National Archives link collection.json`: counts, omissions and validation limits.

At the end of the link collection phase, PDF bodies had not been validated or imported. Attempts to
download one Afghanistan sample through the browser's `downloadMedia` tool timed out. These were
archive-listed PDF capture addresses, not 1,265 different PDF editions. Captures often repeat the same edition.

The earlier browser request to the archive's robots.txt returned ERR_BLOCKED_BY_CLIENT. That error
does not establish the current server response or current robots rules. It was not bypassed. This
collection followed the owner's explicit browser request; it does not change the unattended pipeline's
National Archives exclusion, introduce browser impersonation in the HTTP client, or enable bulk PDF
downloads. All changes remain local, uncommitted, unpushed and undeployed.

## Subsequent browser downloads, 4 October 2026

The owner explicitly requested downloading the PDFs. An ordinary browser download event followed by
navigation to a collected capture URL succeeded where `downloadMedia` had timed out. All 1,265 PDF
capture URLs from the missing-edition timelines were downloaded serially through the in-app browser.
Four initial download-event timeouts (indices 404, 637, 995 and 1253) succeeded on retry with a longer
wait. Final state: 1,265 saved captures, zero failed, zero pending, 138 distinct SHA256 fingerprints.
Every capture for each original PDF address has the same file fingerprint. The wider union of
4,200 search-export and timeline links was kept separate and was not downloaded.

Saved originals are now in the project's `data/pdfs/files/`. At the owner's correction, the download
package was moved out of Downloads and all 138 original hashes and named files were checked again.
Records and indices are in `data/pdfs/national-archives/`. Its `By country/` contains 138 friendly
named PDFs across 31 countries, hard-linked to the original bytes; its `files` shortcut points to
the project PDF store. Repeated capture dates do not create duplicate copies. Total unique size is
81,815,314 bytes and 5,135 pages.

- `PDF index.csv`: 138 files, with country, edition, relative path, capture count, source URL,
  fingerprint, page count and size.
- `Capture index.csv`: all 1,265 successful source URLs and their saved file paths.
- `download-report.json`: complete per-capture status, metadata, original download path and saved path.
- `integrity-check.json`: final independent check of every unique file's SHA256, PDF structure and
  page count; every friendly named file also matches its recorded hash.
- `browser-downloads.jsonl`: browser download events, including initial timeouts and successful retries.
- `queue.txt`: the full 4,200-link union, with the requested 1,265 timeline PDFs first. The report's
  `total_links` explicitly restricts this run to those first 1,265 entries.

`scripts/file_browser_downloads.py` is an offline filing helper: it consumes download events from this
chat, validates PDF bodies with the existing structural checks, files originals by hash, writes the
indices and report, then removes only the redundant browser-created copies directly in Downloads.
No PDF text was extracted and no files were added to report histories or the site. The archive HTTP
guard and unattended pipeline remain unchanged. The two original addresses with no listed captures
(Kenya operational guidance, December 2013; Pakistan Ahmadis, June 2018) remain unavailable at those
addresses. The 18 HTML capture URLs were not treated as PDFs.

The remaining browser download files were also cleared from Downloads: the two original search CSVs
are preserved in `data/pdfs/national-archives/search-exports/` and match the earlier export copies byte
for byte. One delayed Zimbabwe PDF download left a duplicate outside the download package; its SHA256
matches the verified project original, so that redundant copy was removed after checking the stored file.

## Offline import and gap closure, 5 October 2026

All 138 distinct National Archives PDFs are imported into the existing manifest and reader pipeline.
The two addresses with no National Archives captures were closed using copies of the original Home Office
PDFs held by ecoi.net: Kenya operational guidance v8.0 (December 2013, 31 pages) and Pakistan Ahmadis v3.0
(June 2018, 77 pages). Raw cover text confirms both identities. A Refworld attempt was refused by its
robots response; it was not bypassed. That failure remains in `repository-downloads.json`.

`import-report.json`: 140 registered; catalogue 829/829 held, zero missing; 32 failed attempts retained,
all 32 editions now linked to valid PDF evidence, zero unresolved editions. It makes no claim that the
failed capture URLs themselves now work or that every historical report ever issued is catalogued.

`integration-check.json`: all 140 original hashes, PDF structures, page counts, exact titles, historical
status, source addresses and capture dates match their exported editions; every copy appears once with
readable text and its pictures held. All 535 wanted PDF-only editions extracted; none failed. The extractor
is unchanged (`pdftext-3`), uses the existing text layer and does not claim to reproduce exact PDF layout.
Both OSCOLA and tribunal citations were checked for all 140 real imported editions: correct source URL and
provider; ecoi.net copies have no invented capture date.

The largest warning count belongs to Afghanistan women fearing gender-based harm/violence (March 2020):
53 unmatched PDF bookmarks and one footnote mark (107) not located. The original PDF has 53 pages but its
page footer says “Page 6 of 7” on actual page 6. Reading that raw page confirms the assessment, numbered
paragraphs and headings present in the extraction; the warnings are retained. Original source bytes were
not changed. Exact layout and unusual footnote positions remain checkable in the linked PDF.

Fresh checks pass: 263 Python tests, 322 JavaScript tests, original-file integrity and current-collection
completeness. Export: 435 report histories (217 comparable), 664 archived editions, 706 country PDFs plus
About CPINs. Search: 4,335 current-guidance records. Build: 7,905 files, 452 MB, within hosting limits.

On the rebuilt local site, Chromium at 1440×900 and 390×844 was checked through dashboard -> Afghanistan
history -> January 2016 -> source panel, Pakistan June 2018 -> ecoi.net source panel -> latest current
GOV.UK edition, and Kenya December 2013 -> ecoi.net source panel. Console: no relevant errors or warnings;
mobile: no horizontal document overflow or broken images. Browser checking caught and corrected dashboard
tooltips that still named Internet Archive, and the blank topic of the country-wide Kenya guidance is now
shown as “Operational guidance note” while its existing series address is preserved. The reader, citations,
guide and glossary distinguish archive and repository provenance. Native Safari was not rerun for these
new additions. The original 4 October Safari work remains a separate check.

All 140 PDFs have friendly named hardlinks in `By country/` and rows in `PDF index.csv`. The old manual
HTML list is preserved as `original-hand-check-list.html`; its current copy shows zero outstanding editions.
The wider 4,200-link collection and all original capture records are retained. The importer makes no
network request; the National Archives HTTP guard remains enabled. All changes remain local, uncommitted,
unpushed and undeployed until the owner says “push”.
