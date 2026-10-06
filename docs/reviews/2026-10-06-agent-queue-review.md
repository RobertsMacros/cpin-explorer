# Bounded AI review of the existing mechanical queue

This pass disposes the existing **2,267 distinct questions**, not every factual
claim in the 116,125-block corpus. It uses retained evidence and interactive Codex
analysis. No paid API/local-model calls, bulk source or archive collection,
canonical CPIN edits, public flags or deployment were made.

All 64 direct and 257 wording/identity comparisons have scoped outcomes. The
1,946 metadata/ellipsis questions have pattern triage with representative
inspection, not individual factual approvals. Source furniture, source citations,
changing pages, editorial additions and unsupported comparisons are distinguished
from literal copying discrepancies. A later page is not proof of historical
misquotation. Pending disposition is zero; unresolved factual/contextual work is
not zero.

## Narrow findings

Six new private minor findings are retained, alongside the two previously
inspected Cameroon access-date and Syria spelling typos. They concern Nigeria's
Biafra independence year, four citation title-year/link discrepancies and the
Vietnam Legal Atlas link to the wrong question. Nigeria's historical date is
corroborated by a [contemporary US State Department telegram](https://history.state.gov/historicaldocuments/frus1964-68v24/d386);
the origin of the erroneous quotation remains unknown without the historical IPOB
source. These are background/citation findings, not a determination of asylum
risk. No new major claim error is independently confirmed by this batch. An Iraq
2022/2023 label with correctly distinguished coverage/release dates remains
ambiguous and was not promoted.

Each saved finding retains exact edition/text/body hashes, original citation and
source identity, checked location and limitations. Human approval is absent;
findings stay private. Prior published findings retain their separate attribution.

## Additional repairs and verification

A quotation beginning with a numeric source marker exposed an empty-prefix
IndexError during preparation. The guard now retains the comparison instead of
crashing. Inline glossary buttons had caused missing terms in saved extraction;
comparison-only recovery uses the original DOM and one unique neighbouring
context. It does not rewrite extraction or CPIN text. Recovered negations still
generate differences when absent from the quotation. UKUT 00066 and 66 are
equivalent; 67 remains different. Percentage ranges and intact URL escapes are
handled without hiding a genuinely negative share or an out-of-range endpoint.

All **398 Python tests pass**. The private pass also retains 74 targeted replays:
five glossary examples, one case-number example and all 68 percentage questions.
Some glossary examples retain smaller spelling/punctuation differences; recovery
does not automatically approve the remaining text. The original preparation
packets are immutable, with post-fix comparisons in a separate journal. No new
full-corpus reduction estimate is available.

## Published reviews: held-evidence screening and contextual pass

All 60 publications have identity/scope triage:

| Route | Publications |
| --- | ---: |
| Held direct CPIN reviews | 20 |
| Background research/process guidance | 13 |
| Reviews of another product | 5 |
| Exact criticised Rwanda editions missing | 2 |
| Criticised editions before the since-2020 pass | 17 |
| Full review evidence unavailable | 3 |

The pass saves **32 scoped argument applications across the 20 held direct
reviews**, including Home Office responses and contrary considerations where
inspected. The corrected export has 53 edition associations across 48 held bodies.
The statelessness review's December 2018 Palestinian CPIN was previously mapped
to a later fact-finding report and July 2022 Gaza note; those two associations
have been removed. The original journal is retained alongside the correction.
Original PDF bytes were hash checked; 78 document reading records retain PyMuPDF
and independent Poppler output. Copies/large-print versions are not independent
corroboration. The review directory does not establish exhaustive publisher
discovery.

Afghanistan's former-officials discussion has identical substantive prose and
figures in the held August 2024 and August 2025 bodies after removing paragraph
and footnote labels and punctuation. This verifies that narrow reuse claim, not
the whole editions or their legal conclusions. The reporting-limit sentence is
already present; it would be wrong to say the CPIN entirely ignores reporting
restrictions. Its prior UNAMA source-summary concern remains separately scoped.

MiCLU's mental-health paper names January 2025 but some quoted paragraph
references no longer match that note. Its free-medicines allegation is a strong
follow-up candidate, requiring the original reimbursement evidence; it is not
yet a confirmed major error. Public employment does not exclude private practice,
and a later Fastbase listing cannot establish its historical content. The review's
26–50% follow-up band also does not establish strictly more than half missed care
at the upper endpoint. Reviewers are not assumed correct.

The continuation finishes **bounded AI screening and publication-level contextual
assessment**, with 108 closer comparison-packet assessments. The 1,301 extraction
units screened include table fragments, pages, repeated material and front matter;
they are not 1,301 independently verified claims. Zero pending screening does not
mean zero unresolved merits. Individual source verification is still required
where the retained evidence does not establish a conclusion.

Two further private minor citation findings were supported: Georgia's December
2023 political note labels a Georgia CIA target as India, and Colombia's January
2025 actors-of-protection bibliography misnames and mislinks an Amnesty report.
The original Amnesty cover and the correct citations in footnotes 108–110 show
that the review's claim that the report was not cited is wrong for the held bodies.
No new major claim error was independently confirmed. A Colombia prejudice-motive
summary is a strong unresolved comparison: it describes all 107 recorded victims
as prejudice-motivated while its detailed source quotation identifies a confirmed
subset of 18 victims. The exact primary PDF returned 404 in the held snapshot.

Preparation now recovers paragraph references followed by a full stop, retains
whole original pages for ambiguous table-cell roles, excludes private Myanmar
military-service COIR pages and removes scripts/navigation from the Garden Court
article reading. Neither Home Office acceptance nor a proposed source replacement
proves a factual correction. Quoted source errors and alternative spellings are
kept distinct from CPIN copying errors.

Five full-review/exact-edition gaps, historical source versions and disputed
claims remain explicit. The private `PUBLISHED-REVIEW-REPORT.md` records the
continuation's methods, findings and limits. The local-model trial, human workflow
and publication stages have not started.

## Private results

The retained local directory is
`data/source-evidence/agent-review-2026-10-06`:

- `REPORT.md`: readable result and remaining work.
- `question-packets.jsonl` and `question-assessments.jsonl`: all 2,267 questions.
- `post-fix-replays.json`: latest targeted code comparisons.
- `inspected-findings.json`: eight narrow minor findings, with original evidence.
- `publication-dispositions.json`: all 60 publication routes.
- `publication-applications-corrected.jsonl`: 32 scoped applications with the
  Palestinian mapping correction; the original journal is retained.
- `publication-ai-screening-assessments.jsonl`: 1,301 bounded screening outcomes,
  not factual approvals.
- `publication-detailed-comparison-assessments.jsonl`: 108 closer assessments.
- `publication-inspected-findings.json`: two additional narrow minor findings.
- `PUBLISHED-REVIEW-REPORT.md`: continuation results and unresolved evidence.
- `publication-argument-locators.jsonl`: remaining argument locations, no merits verdict.
- `afghanistan-section-10-6-reuse-proof.json`: exact body comparison proof.

These caches and source bytes are private and excluded from the live site.
