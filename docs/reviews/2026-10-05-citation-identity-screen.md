# First mechanical citation identity screen

The owner requested a no-model check of whether footnotes identify the sources
they link to. This extends the existing private collector and text cache rather
than fetching again or introducing a second parser. No changes to CPIN bodies,
human decisions, published reviews or live-site flags were made.

Run: `scripts/check_citation_identity.py --out data/source-evidence/since-2020`
with the repository virtual environment, 5 October 2026 at 21:31 UTC.

| Observation | Footnote occurrences |
| --- | ---: |
| Inventory entries | 84,612 |
| Readable, held source and candidate title mechanically screened | 32,621 |
| Source evidence needed | 25,705 |
| Citation-title parsing needed | 18,799 |
| Held source not readable | 1,282 |
| No source URL in the index | 6,152 |
| Multiple links needing title attribution | 53 |

Within the screened entries, 12,710 candidate titles occur in front matter;
10,261 were not located and 9,650 are truncated. HTML publication metadata matches
the citation date in 6,815 occurrences and conflicts in 1,736; the other 24,070
have unavailable or ambiguous citation dates/publication metadata. Title and date
both match in 3,552 occurrences. These are overlapping observations, not completed
checks or confirmed errors. Counts include repetition across editions and reports.

The screen hashes 10,764 distinct source files: zero integrity issues. No network
requests, model calls or findings were published. All 328 Python tests pass,
including checks that access dates are excluded, source pinpoint wording survives,
ambiguity does not pass, and corrupt objects do not become evidence. Existing
source cache/queue reuse remains unchanged.

## Reading the apparent date conflicts

Two retained HTML sources illustrate the limits. Human Rights Watch's World
Report 2019 Afghanistan chapter has matching title metadata but a publication
metadata date of 4 December 2018, whereas the CPIN cites 17 January 2019. That
metadata does not establish the report's public release date, so it is a review
candidate, not a CPIN error. The retained SJAC *Human Rights Violations in Syria:
December 2024 - January 2025* page visibly says 23 January 2025 and has that date
in its publication metadata; several Syria citations say 22 January. This is an
observable one-day discrepancy in the held 2026 snapshot, with historical
applicability still unverified. Neither candidate has been published as a flag.

PDF cover text comes from the existing unverified raw extraction. Consequential
findings require the standing independent PDF reading procedure. Publisher,
source page/paragraph, source version at the time of the CPIN, and contextual
support are outside this first screen. A title in a landing page or contents list
is insufficient to prove the cited document was retrieved.

## Bibliography and repeated uses

Bibliography entries identify the documents used for claim checks; they are not
discarded. The 120,137-block inventory includes at least 22,732 entries under
explicit bibliography headings. Their title/date/link checks can be shared with
footnote uses. Comparing a claim contextually happens at its substantive use,
rather than separately treating the bibliography line as another substantive
claim. The earlier 85,704–89,790 workload figures concern potential substantive
comparison candidates, not the total outstanding metadata/document work.

Cross-edition/report reuse may ignore CPIN paragraph-number changes and harmless
whitespace, but must retain source pinpoint differences, source content identity,
relevant context and qualifiers. Similar wording is a grouping proposal, not an
automatic reusable conclusion. Published criticisms remain edition-scoped.

## Gaming PC

The available 50-thread inventory exposed this Mac's local sessions and cloud
sessions, but no connected Windows/gaming-PC session. Hardware has not been
inspected and no local model has been installed or benchmarked. The owner was
asked for the session name or GPU/video-memory details while the mechanical
screen continued independently.
