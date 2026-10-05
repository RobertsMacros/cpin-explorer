# Published review backfill — 5 October 2026

Implemented and checked locally. Not pushed or deployed. The owner prefers daily
checks eventually, but explicitly asked to focus on backfilling first; no recurring
automation or GitHub workflow was enabled.

The [curated directory](published-review-directory.md) contains seven publishers and
42 publications: direct CPIN reviews, reviews of European and US country reports,
and separately labelled practitioner or policy context. It includes all 19 review
publications linked from the current GOV.UK IAGCI collection (including thematic and
production reviews). This establishes coverage of that index on this run, not all
reviews ever published or all countries’ independent audit coverage.

Forty curated publications have a readable captured original publication or named
repository copy. ARC’s 2021 US State Department executive summary and Iraq component
remain unavailable. Its expired TLS certificate prevented automated access to six
addresses (the index and five documents). The collector did not disable certificate
verification. Three ARC papers were recovered from named ecoi.net copies, including
the China CPIN commentary, Iraq CPIN commentary and Afghanistan/Somalia EASO review.
The repository copy is attributed to the original authors and kept as a distinct
snapshot; it is not independent corroboration. The US study’s existence and scope
are recorded from publisher and distribution descriptions, but its full text was
not retrieved.

Across all backfill runs, 106 successful response addresses are retained
in 104 distinct content-addressed files (93.9 MB).
Every held file’s SHA-256 matches its name; 0 hash problems.
There are 71 discovery candidates, which include duplicate formats,
contextual papers and some original CPINs linked from review pages. They are **not**
71 independently verified audits. The bounded selected traversal
has no pending addresses; six primary-host failures remain recorded. The command
correctly returns 1 for those gaps, while retaining successes.

The existing polite HTTP client, redirect/host guards and source extractor are
reused; no new crawler dependency or AI call was introduced. Collection retains
raw PDF text by physical page, without OCR. Evidence caches, attempts and candidates
are excluded from Git and the site. The curated public metadata contains titles,
links, dates, publisher identity and scope, not full review text or public quotations.

The footnote overlay links whole-report reviews under Published reviews only for
explicitly mapped edition/text identities. These links never assign a source flag
or checked tick. Eleven report/edition associations are recorded; they are not eleven
verified findings. The January 2025 Albania mental-health review remains background
because two held snapshots share the date/version label and their exact applicability
has not been resolved. Existing citation-level IAGCI pilot findings remain separate.

All 856 held readable editions have local analysis contexts. Country-specific and
cross-cutting review metadata is supplied separately as exact-edition or background
context. Every imported review has unassessed merits. Instructions require checking
original evidence, cut-off dates, counter-evidence and Home Office replies, with
copies and co-authored reviews kept together. No contradiction analysis ran.

Checks: all 315 Python and 333 JavaScript tests passed, reader JavaScript syntax is
valid, and the site builds successfully (7,909 files, 452 MB). The deployed site was
not updated. These checks do not establish a new rendered-browser validation; the
new report-level panel is covered by renderer and edition-separation tests.

See [collection limits and assessment method](../methods/published-reviews.md).
