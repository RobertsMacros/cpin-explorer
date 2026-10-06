# Overnight published-review and cheap-check work, 6 October 2026

The owner authorised material overnight progress on published reviews and cheap AI checks, prioritising recent editions. No paid model calls. Published comments remain attributed; mechanical candidates are not confirmed errors, and no global correctness judgement is made.

## Hardened full run

The v3 mechanical rerun started at 22:06:04 UTC under `caffeinate -i -s`, using the same 116,125 linked blocks and frozen receipts as the corrected v2 run. Output: `data/source-evidence/mechanical-final-2026-10-06`. Scope: `0cd594ca2b9b0b85b6149ad75d5be112ccdebbd7fbdd75e9606e10cad82e2e97`. Limits: eight hours, 4 GiB screening database/readings budget (final exports excluded), 2 GiB free-disk floor. Network requests and model calls are zero. `launch.json`, `job.json` and `process.log` show actual state; do not start another run.

The existing hourly follow-up is active and watches this run quietly. It must verify terminal totals, reuse, evidence gaps and candidates, compare v1/v2/v3, inspect bounded strong survivors, then report and pause. There is no new LaunchAgent. The Mac must remain powered and running. Source and result journals remain private and retained.

## Published-review expansion

Prepared and integrated 433 short IAGCI reviewer-owned excerpts across nine held
licensed works, with 251 separately labelled Home Office reply extracts and 218
unambiguous inline paragraph applications. Another 38 section indexes link every
physical page of the scoped reviews, including passages that could not safely be
copied. Six further short attributed concerns cover Iraq blood feuds, Georgia
LGBTI protection, Afghanistan former officials, Sri Lanka religious minorities
Albania blood feuds and the January 2026 Rohingya commentary. Their severity denotes the reviewer's concern; it is not
automatic agreement with its merits.

The public whitelist now contains 529 records: 485 external records and 44 AI
records. It retains all earlier entries. New comments are collapsed by default.
Original hashes, column-role decisions and independent Poppler concordance are
retained privately under `data/source-evidence/review-expansion-2026-10-06`.
Forty-eight cells failed reader concordance; 222 lacked a sufficiently long own
prefix before a nested source quotation. Ambiguous layouts, including El Salvador
and statelessness, retain page indexes rather than guessed comment attribution.
This is selective detailed integration, not a claim that every argument is copied
or factually verified. The ARC/UWE quantitative-risk raw review file and two exact Rwanda editions remain
missing; pre-2020 legacy reviews are outside this recent backfill.

## Substantive scoped AI findings

Two new major source-use findings have original evidence and separate AI labels:

- Colombia's January 2025 actors-of-protection paragraph 2.1.10 assigns a prejudice
  motive to all 107 police-violence victims. The publisher's full 2022 report gives
  107 total victims, at least 18 with confirmed prejudice motive, and 72 cases
  with undetermined motive. The original executive-summary URL remains unavailable;
  the full report corroborates the distinction but is not a byte-identical replacement.
- Afghanistan's August 2024/2025 fear-of-the-Taliban editions say UNAMA did not
  identify violation types or counts. The exact cited report identifies them and
  gives at least 218 killings, at least 14 disappearances, more than 424 arrests/
  detentions and more than 144 torture/ill-treatment instances. These figures
  concern former officials and ANDSF together; they do not settle civilian-only
  risk, unique people affected or the overall protection conclusion.

Both findings are tied to exact edition and text hashes. The Colombia source's
Spanish extract and UNAMA's English extract were checked against original PDF
pages and independent Poppler text. No raw mechanical candidate was automatically
published. Canonical CPIN text remains unchanged.

## Validation and publication

Local suites: 413 Python and 345 JavaScript tests passed. Fresh-export annotation
and preparation checks also passed after the final data additions. Built site:
7,889 files, 454 MB. Desktop and 390px browser checks verified collapsed reviewer
comments, separately labelled replies and the new AI overlays. The Afghanistan
finding is absent from current February 2026 guidance. These checks do not establish
native Edge or physical iPhone behaviour. Publication and final scan results are
recorded below after verification.

The Myanmar review was recovered through the normal guarded collector. Its author,
21 February 2026 date, version 4.0 and red-comment role were verified on original
pages 2 and 8. The 16-word extract agrees with independent Poppler text. An exact
paragraph 3.1.4 concern and a full page index are attributed to Derek Tonkin;
they do not establish current ICC warrant status or the wider criticism.


## Final mechanical completion, 6 October 2026 at 23:12 UTC

All 116,125 eligible linked blocks were screened; none remain. No processing
errors, including all four previous failures rechecked by exact edition/text hash
and claim identity. SQLite quick-check is clean. The process and caffeinate wrapper
have exited. Source receipts are frozen; network requests and model calls are zero.

Candidate blocks: baseline 8,249; corrected v2 7,975; hardened v3 **7,949**.
The raw decrease is small because metadata dominates. Distinct questions are now
**2,223**: **43** direct comparisons, **245** aligned wording/identity and **1,935**
metadata/ellipsis. Changed-number candidate occurrences fell 247 → 65 → 43.
Priority describes an evidence route, not confidence. A candidate is not an error.

104,251 distinct computations; 11,874 exact computations reused. There remain
49,681 unavailable source-use receipts. All 116,125 contextual-support checks are
explicitly unable: a mechanical screen does not establish the underlying truth.
4,012 unlinked blocks are outside this eligible inventory. Recent held coverage
includes 203 editions / 58,444 linked blocks dated 2024–2026, and 252 / 68,253
dated 2023–2026; this is not universal historical edition coverage.

Exact original comparison inputs validate reuse of 707 previous scoped
dispositions. No repaired-rule-not-reproduced verdict is carried onto a surviving
candidate. Before the fresh sample, 273 direct/aligned questions lack a fully
validated reusable disposition, and 1,243 metadata questions receive mechanical
pattern routing. These are conservative reuse counts, not 273 newly discovered
errors or 707 correctness approvals. Ten varied survivor comparisons and four
apparent matches were checked against held original bytes; PDF matches were
independently checked with Poppler. Source superscripts, bibliographical omissions,
number spacing and quotation boundaries account for the sampled survivors. No
new public flags result from those samples. Full contextual checks remain open.

The run completed within its eight-hour / four-GiB screening database-and-readings
budget and two-GiB free-space floor. Final exports are outside that byte budget.
`completion-verification.json` records actual output bytes and limits. Cold v1/v2
SQLite journals were losslessly compressed and round-trip/hash verified; their
original bytes remain recoverable, and source evidence was retained.

Private supporting records: `completion-error-verification.json`,
`reconciled-question-dispositions.jsonl`, and the adjacent
`review-expansion-2026-10-06/survivor-inspected-findings.json` and
`apparent-match-sample.json`. No canonical CPIN text was changed.

## Final publication verification

Code commit `827ddeb8f6f49cf1812b4897dc2b5cfea6cea7f9` is on main and live.
[GitHub run 37545932744](https://github.com/RobertsMacros/cpin-explorer/actions/runs/37545932744)
passed **413 Python and 346 JavaScript tests** and deployed Worker version
`f835f628-a6ce-4e97-a658-dc205cd342bf`. Live annotations, review directory and
source-review code match the local build hashes. Both sampled private evidence
paths return 404. The edition-panel AI empty-state now accounts for separately
stored directory assessments and unavailable/loading records. Canonical CPIN
text and hashes remain unchanged.

The private Source review plan and its pipeline are updated in place, with
Hide completed on by default. The completed-run heartbeat is paused; the worker
and caffeinate wrapper have exited. Neither earlier one-off LaunchAgent is loaded
or remains on disk. Source evidence and losslessly compressed older journals are
retained. No new model or publisher schedule was created.

An additional inspection of the strongest negation survivor finds a historical
version gap: the held Human Dignity Trust Zimbabwe page reports an October 2026
revision. Its present wording cannot establish the wording available to the
earlier CPIN. It remains unresolved, without a public substantive error flag.
