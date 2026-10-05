# Expanded mechanical screen: 5 October 2026

The owner requested a substantially expanded deterministic check catalogue and
an overnight pass over the linked since-2020 inventory. The catalogue now has
51 rule types, including eligibility and evidence-gap routes as well as direct
comparisons. The full pass has started; it is not a completed review.

## Scope and evidence

The held inventory contains 485 editions in 268 series, 84,612 footnotes and
120,137 indexed text blocks. This run covers all 116,125 blocks with at least one
HTTP source URL, including bibliography entries. The other 4,012 blocks have no
usable source URL and are an explicit gap outside this linked-source pass. This
does not establish coverage of every edition ever published.

The runner freezes existing source receipts, verifies source bytes against their
SHA256, retains extraction hashes and records missing or unreadable evidence.
It makes no HTTP requests, archive searches or model calls. The already-running
source collector remains a separate process; its later receipts do not change
this pass's frozen snapshot. No paid service or local model is enabled.

Each occurrence retains its edition, claim, source URL and hashes. Equivalent
source comparisons can be reused only with matching text, context, source bytes,
source pinpoint and method version. CPIN paragraph renumbering can be ignored;
changes to the source's page or paragraph number cannot. Reference mappings and
edition dates are checked separately for every occurrence.

## Implementation and validation

The expanded implementation adds complete and elliptical quotation location,
bounded near-quotation alignment, omitted qualifier and changed number, unit or
negation candidates, declared PDF page labels, physical-page links, retained HTML
and browser text fragments, stable identifiers, ISBN checksums, citation dates,
bibliography conflicts and narrowly specified arithmetic. PDF comparison
candidates require corroboration from the existing independent reader.
Typography-only dash differences remain observations.

All **345 Python tests pass**, with five pre-existing PyMuPDF deprecation warnings.
Fixtures cover ambiguous alignment, rounding, printed versus physical pages,
negation and sign preservation, independent-reader disagreement, changed-byte
invalidation, resumed work, CPIN renumbering and changed source pinpoints.

The final-code pilots completed with no processing errors:

| Pilot | Blocks screened | Remaining | Candidate rows | Rows with explicit gaps |
| --- | ---: | ---: | ---: | ---: |
| Syria | 250 | 0 | 10 | 240 |
| Afghanistan, mixed source formats | 200 | 0 | 12 | 188 |

Candidate row counts are not counts of confirmed errors. One row can contain
several candidates and other gaps. The Syria pilot exposed a dash-only near-match
which was corrected to an observation before the full pass. The fixtures and
pilots establish tested operation, not measured accuracy or sustained unattended
operation.

Tested evaluator SHA256:
`081aeb1c3232d34bfc0f5d54f643392fd312150c20be6f0a3d963597cfd4c913`.
Tested runner SHA256:
`d75321484ce3b3a82ba7527e034deb42bccf56f96855bc6d2ecbdaa586beb093`.
The reusable-result fingerprint also includes Python and independent-reader
version/file information.

## Native background job

The one-off macOS LaunchAgent `com.robertsmacros.cpin.mechanical-20261005`
started its current worker at **22:08:08 UTC on 5 October** (23:08 BST), PID 54487.
At 22:12:41 UTC it reported **running**, with all 116,125 blocks queued, 420
screened and 115,705 remaining. This is a recorded progress snapshot, not the
latest live total. Current progress is in `job.json` below.

Initial preparation attempts were stopped before analysis to correct the native
job's executable path and strengthen reader-change invalidation. The final job
explicitly includes `/opt/homebrew/bin`, so `pdftotext` is available. Interrupted
preparation records remain private; active totals are filtered by the final
scope fingerprint.

The LaunchAgent uses `caffeinate -i -s`, a low scheduling priority, no automatic
restart and these limits: ten hours per invocation, 6 GiB of derived readings and
database files, and a 2 GiB free-disk floor. The Mac needs to stay powered and
operational; closing the lid can interrupt it. The display can sleep.

Private output directory:
`data/source-evidence/mechanical-overnight-2026-10-05/`.
It contains `job.json`, a transactionally checkpointed `results.sqlite3`, frozen
receipts, compressed readings, `run.log` and `run-errors.log`. On completion or a
budget stop it exports `summary.json`, `candidates.csv`, `candidate-sample.json`
and `REPORT.md`. These files are excluded from Git and the public build.

To resume an interrupted or budget-stopped pass, after confirming the worker has
ended:

```bash
PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin \
  .venv/bin/python scripts/run_mechanical_checks.py \
  --inventory data/source-evidence/since-2020 \
  --out data/source-evidence/mechanical-overnight-2026-10-05 \
  --cache data/source-evidence --max-hours 10 --max-gb 6
```

The process lock prevents two runs writing this output simultaneously. A resume
retains completed work, while changed inputs or evaluator code invalidate the
affected scope. Processing errors and incomplete totals are reported explicitly.

An hourly heartbeat, **CPIN mechanical overnight follow-up**, checks this job in
the current chat. It stays quiet during healthy progress, reports completion,
failure or a budget stop, inspects a varied result sample, then removes this
task's one-off LaunchAgent and pauses itself. It does not automatically publish
findings or restart collectors.

## Boundaries and publication

Every pass applies to its named mechanical comparison. Missing quotation text,
retrieval failures and unreliable extraction remain unable-to-check results;
they are not evidence that a CPIN claim is false. Metadata conflicts remain
candidates. Structured table interpretation, general paraphrase support, legal
holdings, legislation version applicability and historical source selection
remain unassessed. No global correctness score or human green tick is inferred.

Canonical CPIN text and the site UI are unchanged. Findings require inspection
against the original source and their exact CPIN edition before any public flag.
The expanded code and documentation are intended for main; private evidence is
not published. The previously failed hosted GitHub job was retried separately:
[run 37377524475](https://github.com/RobertsMacros/cpin-explorer/actions/runs/37377524475)
completed successfully on 5 October. That is distinct from this local overnight
run.

See the [full catalogue](../methods/mechanical-source-checks.md) and
[bounded reuse assessment](../research/mechanical-source-checks/REPORT.md).
