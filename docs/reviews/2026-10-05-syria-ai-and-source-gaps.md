# Syria: source gaps and first AI checks, 5 October 2026

The source badges now display a small symbol only: grey circle, yellow/red flag,
or green tick. The meaning remains in the tooltip and accessible label. Green
still requires an identified human check; an AI no-issue result remains grey.

## Retrieval coverage is not review coverage

The earlier since-2023 pilot's 70.3% means **2,149 of 3,055 footnotes have readable
text for all their linked sources**. It does not mean those sources support the
CPIN, or that an AI or person has checked them.

The 906 other footnotes have these primary reasons. Mixed failures retain all
their individual receipts; each footnote is counted once in this table.

| Primary reason | Footnotes |
| --- | ---: |
| Site refusal or host paused after a refusal | 389 |
| Robots exclusion or failed robots check | 347 |
| Saved response contains no readable article text | 86 |
| Missing/broken address | 28 |
| No HTTP source address in the footnote | 28 |
| Timeout/server failure | 14 |
| Unresolvable or unsafe address | 11 |
| Payment required | 1 |
| Other HTTP failure | 2 |

A paused host means the individual address may never have been tried. The
collector stops requesting a host after a refusal, sometimes on an address cited
by another country. This is a limitation of this collection, not proof that every
affected document is inaccessible. Failed robots checks sometimes mean the
robots.txt request itself returned 403, rather than an explicit exclusion rule.

Some gaps can be recovered from identifiable publisher PDFs or named repository
copies. JavaScript dashboards and viewer pages need separate checks. Private
responses labelled 'available on request' cannot simply be downloaded, although
material reproduced in a CPIN annex may itself be reviewable. Malformed source
addresses are retained as printed; any proposed corrected source belongs in the
review evidence, never a rewritten CPIN.

The external-document collector now discovers explicitly identified PDF iframe,
embed and object addresses, including the UN viewer's PDF endpoint. It ignores
arbitrary frames. The discovered UN endpoints refused access through robots
rules, so **no UN PDFs were recovered by this change**. Access refusals remain
recorded; the collector does not bypass them.

## Expanded Syria scope

The owner's 'everything in Syria' request includes all **23 held editions across
14 reports**, with 3,440 footnotes and 5,860 claim/direct-link blocks. The private
`data/source-evidence/syria-all/` inventory has 1,635 primary addresses and 197
explicit document addresses. All 1,832 have outcomes, including failures.
It retains 1,137 responses, 1,106 readable extractions and 1,097 distinct source
files with matching SHA256 hashes. Under the original-address coverage measure,
2,339 footnotes have all linked text, 1,061 have no readable linked text and 40
have no HTTP source address. The expanded scope therefore has 68.0% retrieval
coverage; this is a different denominator from the earlier 70.3%.

## Actual analysis performed

Two individual citation uses were analysed interactively by Codex, separately
from the deterministic mirror. This is **not a completed Syria contradiction
analysis**. The exact model identifier is not exposed in this session. Records
retain exact edition/text hashes, source hashes, retrieval times, scope and
prompt revision `syria-evidence-review-1`.

1. **Military service, July 2025, paragraph 8.1.1, footnote 5:** yellow AI flag for
   a citation-link mismatch. The footnote names the April 2021 *Syria: Military
   service* report, but its address opens the October 2024 *Country Focus* PDF.
   The held intended 2021 report's page 13 supports ages 18–42 and service of
   18–21 months. The claim is explicitly about the Assad regime; section 8.2
   discusses later voluntary recruitment. This is not a finding that those
   figures are false. The original link remains verbatim, with the intended
   report separately linked in the AI review.
2. **Kurds and Kurdish areas, December 2025, paragraph 16.2.9, footnote 202:**
   no contradiction found in the quotation's figures, time period or attribution
   against EUAA October 2024 *Security Situation*, printed page 31, physical PDF
   page 32. This checks quotation fidelity, not the truth of the underlying SNHR
   evidence or the wider CPIN assessment. It receives no green tick.

Both source PDFs were hash-checked and read from their raw text layers. Poppler
`pdftotext` independently agrees on the relevant passages. The military-service
footnote's incorrect address was confirmed in the stored canonical HTML. Public
extracts contain only a two-word cover label and six-word evidence phrase, with
EUAA attribution and its reproduction permission. Full source text stays private.
No canonical CPIN text or history was altered.

The complete private queue retains source receipts and edition-specific review
context. Its 4,124 blocks with some readable source text are candidates for
analysis, not completed checks; 1,736 have no readable source. Two scoped checks
leave 5,858 blocks pending, plus whole-report context and unreferenced assessment
passages. No automated model calls have run. No AI API credentials are configured;
the owner has been asked which service to use before implementing the full run.

## Published-review research

Two Syria works were added to the existing directory (now 44 publications):

- [IAGCI's review of the December 2014 Syria security/humanitarian guidance](https://www.gov.uk/government/publications/syria-country-information-and-guidance-iagci-review),
  published in December 2016, with Home Office responses. It concerns a historical
  predecessor of CPINs, not the held 2020–2026 editions.
- [ARC/Dutch Council for Refugees' July 2020 commentary](https://www.ecoi.net/en/document/2032701.html)
  on seven EASO Syria reports. The named repository confirms identity, co-authors,
  original address and scope; publisher access failed. Its contents remain
  unassessed. It is a source-report critique, not a direct UK CPIN audit.

Neither supplies a finding about the two citations checked above. Their arguments
are not carried into later editions automatically. The May 2026 IAGCI call for
Syria reviewers is a commissioning announcement, not a completed review.

## Validation

318 Python tests and 333 JavaScript tests pass. The rebuilt site excludes private
evidence. Desktop and 390px touch Chromium checks confirm compact symbols,
accessible labels and edition-bound AI records. Native Edge remains untested.
Publication and live verification are recorded after deployment below.
