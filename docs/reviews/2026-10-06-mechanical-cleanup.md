# Mechanical screen repairs and controlled rerun

The owner requested correction of the four processing failures and systematic
false positives, followed by a comparable full rerun and a smaller ranked review
queue. No paid AI service is enabled. This record distinguishes verified repairs,
the completed full pass and subsequent bounded hardening replay.

## Baseline and repairs

The first pass visited all 116,125 linked blocks in the held since-2020 inventory.
It recorded 8,249 candidate rows, 107,872 rows with explicit gaps and four
processing errors. It reused 11,874 computations. Those candidate rows were not
8,249 established errors; most flags concerned citation dates and metadata.

Method `mechanical-source-use-v2` repairs these systematic cases:

- Incomplete PDF page-label rules now leave uncovered intervals unmapped. No
  printed labels are inferred. The HRW World Report 2019 PDF has 331 uncovered
  physical pages and 15 declared labels; it reads successfully. All four formerly
  failing occurrences replay without an exception.
- Raised numeric PDF spans need a corresponding bottom-of-page note and anchored
  neighbouring text before exclusion from a derived comparison. Raw readings and
  adjustments remain retained. Ordinary numbers are preserved. The Finnish-source
  sample's superscript 150/151 candidates disappear, with its independent reading
  reused under matching source/extraction and executable fingerprints.
- HTML headings need structural markup. Raw quotation matches are attempted
  first. The Russia sample's omitted subheading no longer becomes changed negation.
  Its effect on context remains unassessed.
- HTML footnotes need an explicit reference target and anchored paragraph text.
  Marker-shaped PDF endnotes or unresolved HTML references remain a furniture gap
  if their structure cannot be established. They are not stripped into a match
  or reported as a changed number. Genuine numerical substitutions remain
  candidates. A broader 45-group number pilot exposed these additional styles
  before completion; the first partial rerun was checkpointed and stopped at
  6,888 blocks, and the corrected scope restarted. Partial records are retained
  separately in the journal and excluded from final-scope totals.
- Grouped numbers are consumed whole: `800 to 5,000` does not become `800 to 5`.
- Population words count as numerical units only next to a value. The Algeria
  sample no longer produces changed-unit from an inserted reference to people;
  its wording/version difference remains an ordinary near-quotation candidate.
- Small-denominator ratios within a coarse rounding interval remain observations
  unless explicitly exact. Exact or large-denominator inconsistencies remain
  candidates. Relative growth/change percentages above 100 can also be legitimate
  and are routed to observations rather than blanket share errors.
- Plain `Accessed:` dates now join the already-recognised access-date syntax and
  are separated from publication dates. Impossible dates in either role can still
  be detected.
- DOI sentence punctuation is separated from the identifier, so a citation's
  terminal full stop does not manufacture an identifier conflict. Balanced
  parentheses inside identifiers remain preserved.

All **359 Python tests pass**, with the five existing PyMuPDF deprecation warnings.
Regression cases preserve genuine altered numbers, negation and numerical units,
exact/large-denominator arithmetic, structural heading boundaries, unmatched
numeric tokens, partial PDF numbering, frozen receipts and version/context-aware
review grouping. Four-error replay and sampled repairs are retained in
`data/source-evidence/mechanical-cleanup-pilot-2026-10-06/`.

Final tested evaluator SHA256:
`cfdf139bccc0104181390bf6fc437750c7fdadc701f251fd244f56df2c6d2454`.
Runner SHA256:
`6f2f4db854b840bced4106e257f5d5ac609122f15287fec0a018da073d9bec35`.

## Comparable full pass

The first native worker started at 08:19:58 UTC on 6 October (09:19 BST), PID 93582,
under one-off LaunchAgent `com.robertsmacros.cpin.mechanical-cleanup-20261006`.
It queues the same 116,125 linked blocks and explicitly reuses the original
receipt snapshot:
`sources-eb75b8ce31f86ab28645d3e4020c64a483284266ed142182f2739a649de3b425.json`.
New collector receipts cannot enter this comparison. Source bytes are rehashed;
the original CPIN index and extraction pipeline are unchanged.

The final tested marker cleanup was then restarted under the same one-off
LaunchAgent. The earlier progress belongs to the interrupted preliminary scope.
The final scope completed on 6 October: **116,125 screened, zero pending, zero
processing errors**, including all four previously failed occurrences. It recorded
**7,975 candidate blocks**, compared with the baseline 8,249 (274 fewer, 3.32%).
Changed-number candidates fell from 247 to 65. The 2,267 distinct review
questions comprise 64 priority 1, 257 priority 2 and 1,946 priority 3 questions.
Priority describes the evidence route, never confidence.

There were 104,251 distinct computations and 11,874 exact reuses. Availability
gaps include 49,681 unavailable source-use receipts; quotation, ellipsis and
printed-page gaps overlap. No semantic support assessment was performed. The
completion inspection read 20 direct questions and four matching controls,
retained the unresolved source-version questions and confirmed two minor typos
(the Cameroon date below and Syria’s “milliion”). These are not substantive
claim contradictions. Full private results are in `FOLLOW-UP.md`,
`completion-sample-assessments.json` and `inspected-findings.json`.

Outputs live in `data/source-evidence/mechanical-cleanup-2026-10-06/` and retain
the baseline separately. Final exports include `ranked-review-queue.json` with
distinct questions and every affected edition target. Direct-comparison questions
come before aligned wording/identity questions, then metadata/ellipsis questions.
This ordering is not a confidence score and never propagates a verdict to an
unexamined claim. Repeated metadata questions can group without pretending their
underlying claims have been assessed.

The completed worker had a process lock, transactional checkpoints, a ten-hour limit,
6 GiB output limit, 2 GiB free-space floor and `caffeinate -i -s`. The Mac needed to remain powered and
operational during that run. The completion follow-up has reported the result,
removed the one-off native job and paused itself. No new downloads, model calls or public findings were made.

## One inspected, minor finding

The archived **Cameroon, internal relocation, December 2020** PDF's Sources cited
entry for Lloyds Bank gives **“Last accessed: 32 December 2020”**. This is an
impossible calendar date. It is present visibly on printed page 32 / physical
page 33, in raw PyMuPDF text and independently in Poppler text. The retained
PDF SHA256 matches its manifest. The intended date has not been established.

Exact target: edition `24ec673545de394e`, text SHA256
`8f76bbb02339be8816ba01b13c0835fdce8e9820c153bbe71dbe72c9223d2a2e`,
series `note:internal-relocation`, bibliography claim 99. PDF SHA256:
`24ec673545de394e7ec38434b6f70086a2812b39b2ee7bde39a270658c8365af`.

This supports a **minor yellow citation flag for this archived edition only**.
It is not a substantive claim contradiction or evidence that the underlying
source is wrong. The scoped inspection, source hashes and page image are retained
privately in `inspected-findings.json` and the pilot directory. No human approval
tick is inferred and no flag has been published.

Further contextual review will read the strongest remaining questions in bounded
batches. The owner is not being asked to inspect thousands of raw rows. A flag
still needs source identity, meaningful discrepancy and exact edition/anchor
validation; absence of a match remains an evidence gap.

## Further hardening before the next number review

Method `mechanical-source-use-v3` is tested against the retained completion
sample, separately from another full corpus run. Literal quotations and canonical
CPIN bodies are untouched. The additional rules distinguish derived numeral
formatting, omitted source attribution and unresolved percentage notation.

- Bounded number words (0–999), comma/space thousands groups and unambiguous
  decimal commas compare as quantities in aligned passages. Space grouping needs
  a matching comma-grouped counterpart. Three-digit decimal-comma ambiguities
  are not normalised into approval. Literal matches remain separate observations.
- Ordered numerical comparisons preserve swapped figures. Ordered units and
  numerical slots preserve swapped scales and moved percentage signs. Signs,
  negation and qualifiers remain significant. Missing percentage notation remains
  a contextual gap and wording candidate, not a changed digit.
- PDF notes recognise single-span bottom references, explicit endnote sections
  and linked numbered bibliographic lists. A bottom note needs smaller type and
  a matching raised reference before exclusion from a derived body view. Legal
  numerical superscripts and common measurement exponents are preserved. Both
  raw readings and each adjustment stay available; Poppler must independently
  support an alleged PDF discrepancy.
- HTML accessible “Footnote 24” references resolve their actual targets. Unlinked
  superscripts need corresponding bracketed note entries. Ambiguous or repeated
  contexts remain untouched. Copied source markers in a CPIN quotation are routed
  using the evidenced source context, not treated as altered quantities.
- A currency conversion inside a quotation needs its own retained footnote to
  another source before separation from the underlying quoted fee. The conversion
  remains unverified, with its supporting URLs retained. That mapping now forms
  part of the reuse key; harmless renumbering can still reuse computation.
- Explicit omitted email/interview attribution dates remain contextual questions.
  Unit misspellings remain wording candidates rather than changed numerical scale.
  Neither route approves a quotation or suppresses other altered values.
- Queue preparation hashes each distinct held source and extraction. Rewritten
  bytes invalidate persisted reuse even when file sizes and timestamps are
  preserved. Derived readings are checked against source/extraction hashes and
  their own checksum before reuse. Malformed, duplicate or incomplete PDF page
  inventories are explicit evidence gaps.
- Runner regression checks cover lock collisions, database failure, finite budgets,
  empty scopes, mid-batch time stops and checkpointed resumption. Completion is
  recorded only after exports; CSV/report replacement is atomic. Time and free
  space are checked between rows; output size remains checked between batches.
  An in-flight document read and queue preparation are not forcibly interrupted.

All **394 Python tests pass**, including 66 mechanical tests, with the existing
five PyMuPDF deprecation warnings. `./cpin verify` checks 405 bodies, 707 PDFs
and 682 images with zero integrity or completeness problems. The selected
20-case replay reduced changed-number candidates **18 → 5**, changed-unit
candidates **3 → 0**, and near-quotation candidates **19 → 10**. The five
numerical survivors include the Nigeria year question and four source-version
gaps; they are still candidates, not established errors. Cameroon’s impossible
date remains a candidate; Syria’s spelling typo remains a wording candidate.
All four previously inspected quotation controls still match, with no new
candidate rules on those controls.

Private replay: `data/source-evidence/mechanical-hardening-pilot-2026-10-06/`,
including `summary.json`, `inspected-sample-replay.json`,
`match-controls-replay.json` and `former-errors-replay.json`. This deliberately
selected regression sample cannot establish a false-positive rate or predict
whole-corpus reduction. Source bytes, old run journals and exact edition targets
remain retained. No new full run, retrieval, model calls, public flags or site
deployment were started. The next work is bounded inspection of the uninspected
direct questions; the original 44-question count remains a v2 queue count until
that queue is replayed.
