# Syria source collection pilot — 5 October 2026

The owner requested a Syria test for editions published from 1 January 2023,
followed by publication of the reader and saved-page changes. This is a source
collection test; no AI contradiction assessment ran.

The held export contains 17 qualifying content snapshots across 12 report series.
They were published in 2025–2026; no newly published 2023–2024 edition is held.
This is coverage of the held histories, not proof that no other edition existed.
Older editions published before 2023, even if still current during 2023, are outside
the requested publication-date scope. Repeated snapshots of one edition label
remain distinct by their content identity.

The inventory indexes 3,055 footnotes and 5,159 cited passages/direct-link blocks,
with 1,423 unique source addresses. Short landing pages supplied 154 additional
explicit PDF addresses. All 1,577 addresses have a recorded outcome; none is pending.

| Outcome | Addresses |
| --- | ---: |
| Response captured | 1,045 |
| Robots exclusion | 236 |
| Host paused following a refusal; no further request | 233 |
| HTTP 404 | 25 |
| Blocked | 10 |
| Unsafe or unresolvable address | 8 |
| Other HTTP/network outcomes | 20 |

Of the captured responses, 1,019 have extracted text, 25 have no readable text and
one is unsupported. They occupy 1,009 distinct content-addressed files. Every file
matches its SHA-256; the integrity audit reports no problems. Captured HTML/PDF
text is a derived, unverified reading. PDF pages retain physical page numbers.

| Footnote retrieval coverage | Footnotes |
| --- | ---: |
| All linked source addresses have readable text | 2,149 |
| No linked source address has readable text | 878 |
| No HTTP source link | 28 |

Readable source coverage is 70.3%. Three unreferenced footnotes need a citation
mapping check; two printed URL endings need inspection. There are no missing
footnote references or duplicate footnote identifiers in this scope. Discovering a
PDF on a landing page does not establish that it is the exact source cited; the
coverage measure conservatively uses the original footnote's source address.

All outcomes were already settled in the catalogue-wide cache. The pilot reused
those immutable snapshots rather than making redundant requests: zero new network
requests and zero model calls. Its receipts retain retrieval dates, outcomes,
redirects, hashes and the cache provenance. Retrieval today does not establish
what an external source said when an earlier CPIN was published.

The private outputs are in `data/source-evidence/syria-since-2023/`:
`footnotes.csv`, `sources.csv`, `urls.txt`, `pilot.json`, `audit.json` and
`footnote-coverage.json`, alongside receipts, indexes and hashed snapshots. They
are excluded from Git and the website. Full third-party documents are not approved
for public display or model ingestion. No source status was silently promoted to
an AI finding or a human check.

The source command now accepts `--since YYYY-MM-DD`. Regression checks cover the
publication-date boundary, unknown dates, archive dates and narrowing an existing
inventory without including retained older indexes in its coverage or CSV.

Checks before publication: 317 Python tests and 333 JavaScript tests pass;
405 CPIN bodies, 707 PDFs and 682 images pass integrity verification with zero
current-collection completeness problems. The site builds (7,909 files, 452 MB)
and Wrangler's dry run reports no bindings. Deployment and rendered-browser
results are recorded separately after they have completed.

The assembled site passes Chromium checks at 1280×900 and 390×844 touch. The
January 2023 Albania blood-feud edition displays its two mapped whole-report
reviews with the limits of their applicability. Syria footnotes display Published
reviews, AI review and Manual additions separately. A test private note survives
reload; country/report pins survive reload and unpinning works. Source-click
previews, the delayed desktop selection toolbar and saving a highlight pass.
The phone footnote sheet fits the viewport after its animation finishes and has
no horizontal overflow. No console warnings or errors were recorded. Test browser
contexts were isolated and closed; their test notes were not added to user storage.
These checks cover Chromium, not native Edge, Safari or a physical iPhone.
