# Reliability repairs and Gaza evidence follow-up, 10 October 2026

## Reliability repairs

The two P2 findings in the 9 October readiness review are repaired. Saved-item
reads now retain both request and mutation generations: a response cannot
replace an edit made while it was in flight, even after that edit has finished
saving. Older overlapping reads and their errors are ignored; a new account
initialisation invalidates prior reads. Conflict resolution also advances the
mutation generation. This establishes refresh ordering in controlled tests,
not a fresh signed-in production cross-device acceptance test.

Daily sync keeps a binary patch before committing fetched data and a verified
Git recovery bundle before pushing. Normal Git merges reconcile independent
concurrent main changes, retaining both histories. Three push attempts are
allowed; conflicting changes stop without automatic conflict resolution.
An uncertain acknowledgement is checked against the fetched remote history.
Failed publication uploads the recovery files for seven days. Sync runs only
from main and checks out full ancestry. The deploy output is set only after
successful publication; existing verification and failure gates remain.

Five isolated real-Git tests cover independent changes, conflicts, a lost push
acknowledgement, a non-race push failure and retry exhaustion. Each recovery
bundle is verified and fetched into a recovery ref. Four account regressions
cover delayed reads after completed saves, reversed replies, obsolete errors
and account reinitialisation. Full checks: **421 Python, 366 JavaScript and 99
disposable workerd/D1 account checks passed**. Retained-data verification passes:
406 bodies, 710 PDFs and 684 images match hashes, with zero integrity problems.
This does not establish a genuine scheduled changed-content republish. A job
timeout or infrastructure failure can prevent the artifact-upload step running;
the seven-day download window is a recovery limit, not permanent storage.

### Recovering a failed publication

Download the failed run's `unpublished-sync-<run>-<attempt>` artifact before it
expires. Work in a separate clean checkout of this repository, with its main
history fetched. Verify `sync.bundle` against the SHA256 and prerequisite in
`manifest.json`; then run `git bundle verify /path/to/sync.bundle` and
`git fetch /path/to/sync.bundle HEAD:refs/heads/recovered-sync`. Inspect that
branch and reconcile it with current main using normal review. Never force
push or automatically choose one side of a content conflict. The retained
`changes.patch` is a fallback if commit/bundle creation itself failed; review
it in a separate checkout rather than applying it blindly to current data.
Recovery does not require fetching the sources again.

## Nine Gaza evidence gaps

Scope: Palestine, Gaza humanitarian situation, PDF edition
`c769bfa4982ca24f`, published 29 September 2026. Text SHA256
`db3340c44ca6c9f14379c2a4ca65c9e3b9a1ceb2a9a8ac3ad6728fdebeb7e029`;
body SHA256 `890b7c0678e661b9381540f6d4bee374facade8020f51b1ff89e413300970fb5`.
These are source-use comparisons, not verification of the underlying estimates.
Historical byte identity at the CPIN's access dates remains unestablished.

| Use / footnote | Result | Evidence and remaining limit |
|---|---|---|
| 80 / 80 | Unresolved | WFP's July PDF is identified on its own index, but the download presents a bot check; the summary lacks the employment passage. |
| 98 / 106 | Unresolved | The held GHO page lacks the full quotation. The recovered Flash Appeal is a different publication and gives late November, not October; it cannot establish a misquotation of GHO. |
| 133 / 145 | Unresolved | The WFP summary does not establish the 100% versus 64% poverty passage. |
| 134 / 146–147 | Partly answered | UNSCO's April RDNA, printed p44 / physical p46, contains the full agricultural quotation. The CPIN's inserted historical GBP conversion remains unverified. |
| 135 / 148 | Comparison resolved | RDNA printed p52 / physical p54 contains the CPI quotation and the January, March and October sequence. No copying discrepancy found; omitted continuation gives a separate 2025 annual comparison. |
| 138 / 151 | Comparison resolved | OCHA's original Flash Appeal, p3 and p20, identifies the food-security target as 2.1m in Gaza. The larger OPT target is kept separate. This establishes a planning target, not actual delivery. |
| 142 / 155–157 | Partly answered | OCHA's 31 July report corroborates the April–June 59% / 1.2m / 212,000 figures and distinguishes the July–December projection. The original IPC passage and complete governorate/Phase 2 table remain unavailable. |
| 144 / 159–160 | Unresolved | OCHA corroborates decreasing prices and qualifications, but does not supply the complete WFP quotation. The held BBC article is context for the inserted Iran date, not the WFP passage. |
| 145 / 161 | Unresolved | The WFP household-survey passage and methodological details remain unavailable. Do not infer survey size, sampling or fieldwork date from a summary. |

Two comparisons are resolved, two partly answered and five unresolved: **seven
uses retain evidence limits**. No new confirmed factual error or public flag
results from this follow-up. Earlier human reviews, Home Office responses,
AI assessments and canonical CPIN text are unchanged. Dated follow-up records
are retained separately; an old unresolved assessment is not silently replaced.

Recovered source PDFs were hash-checked, read with PyMuPDF and independently
with Poppler, and the relevant RDNA pages and OCHA target table inspected
visually. RDNA SHA256:
`76d6e50448b529f827f7721643e4d470b6afe8774a60a818898cc6c22d6599dc`;
Flash Appeal SHA256:
`ee4dded0bdb2eaecdf4554236ed7ae1644b75275f12953108fea1ec8ef339e1c`.
Original bytes, extraction, independent readings and retrieval receipts remain
in the private source-evidence cache; they are not included in public builds.

Sources: [UNSCO's assessment and attachment](https://unsco.unmissions.org/en/node/135058),
[OCHA's Flash Appeal and attachment](https://www.ochaopt.org/content/flash-appeal-occupied-palestinian-territory-2026),
[OCHA's 31 July report](https://www.ochaopt.org/content/humanitarian-situation-report-31-july-2026)
and [WFP's monthly publication index](https://www.wfp.org/publications/202324-wfp-palestine-monthly-market-dashboard).
Independent UN and Daleel Madani copies were also considered; existing host
refusals and unreadable robots files were respected. No browser impersonation,
paid model calls, bulk retrieval or retries through refused hosts were used.
The search was bounded, not exhaustive proof that no accessible copy exists.

## Local-model trial

The eight frozen private calibration cases remain prepared. The gaming PC's
hardware and installed runtime have not been observed from this Mac chat.
Its archived chat can be read, but no remote command surface is available here.
Hardware capture and the actual eight-case model run remain pending access;
no model, weights or runtime have been installed and no trial result is claimed.
