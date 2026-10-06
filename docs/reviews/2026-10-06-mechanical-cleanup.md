# Mechanical screen repairs and controlled rerun

The owner requested correction of the four processing failures and systematic
false positives, followed by a comparable full rerun and a smaller ranked review
queue. No paid AI service is enabled. This record distinguishes verified repairs,
one inspected finding and the ongoing full pass.

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
The final candidate reduction and error count are not yet known; current worker,
scope and totals are in the private `job.json`.

Outputs live in `data/source-evidence/mechanical-cleanup-2026-10-06/` and retain
the baseline separately. Final exports include `ranked-review-queue.json` with
distinct questions and every affected edition target. Direct-comparison questions
come before aligned wording/identity questions, then metadata/ellipsis questions.
This ordering is not a confidence score and never propagates a verdict to an
unexamined claim. Repeated metadata questions can group without pretending their
underlying claims have been assessed.

The worker has a process lock, transactional checkpoints, a ten-hour limit,
6 GiB output limit, 2 GiB free-space floor and `caffeinate -i -s`. The Mac needs
to remain powered and operational. The existing completion follow-up has been
updated for this rerun and will compare final counts, inspect a bounded sample,
report failures/budget stops and then remove this task's one-off native job and
pause itself. It makes no new downloads, model calls or public findings.

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
