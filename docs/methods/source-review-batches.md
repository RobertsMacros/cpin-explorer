# Reviewing source uses in batches

The source collector and review directory are inputs to review. They make no
model calls and do not change CPIN text. Interactive AI findings live separately
in `prototypes/reviews/published.json`; human notes are browser-local. A queue
entry or a saved PDF is never a completed check.

## Reproduce the 2020-onwards work

From the repository root:

```sh
./cpin sources --all-editions --since 2020-01-01 \
  --date-evidence config/source-publication-dates.json \
  --inventory-only --out data/source-evidence/since-2020
.venv/bin/python scripts/reuse_source_evidence.py \
  --out data/source-evidence/since-2020 \
  --cache data/source-evidence --cache data/review-evidence \
  --cache data/source-evidence/syria-all
.venv/bin/python scripts/source_copy_coverage.py \
  --out data/source-evidence/syria-since-2023 \
  --cache data/source-evidence --cache data/source-evidence/syria-source-copies
.venv/bin/python scripts/prepare_source_review_queue.py \
  --out data/source-evidence/since-2020 \
  --cache data/source-evidence --cache data/source-evidence/syria-source-copies
```

Reuse is by exact URL, retaining successful captures even after a later refusal.
Immutable objects are hard-linked to avoid copying gigabytes. Hash problems are
reported explicitly. The date evidence supplies missing dates only when the
country, series, edition and text hash match; month precision is recorded and the
first day is only a sorting value. It never rewrites a report or overrides a known
date. Current held coverage is not exhaustive coverage of all published editions.

The private queue retains each claim, footnote, source receipt/hash, full-edition
identity, index pointer and exact/background review IDs. A source copy retains its
own URL and hash; it is never represented as a successful fetch of the original
address. The queue deliberately contains no automatic findings or blanket approval
to send cached third-party text to a model. Source text stays in its private cache.
Claims without a reliable paragraph/section or with duplicate footnote IDs require
anchor checks. Unreferenced footnotes remain separately counted in the inventory.

## A bounded review batch

Start with 10–25 citation uses sharing a source report. Read the surrounding CPIN
passages and the source's relevant pages, neighbouring qualifications, methodology,
date and references. Use raw PDF text and an independent reader for consequential
findings, keeping printed and physical page numbers distinct. Full-text retrieval
is useful preparation; it is not evidence that the source's asserted facts are true.

For each use, record the precise claim, source hash/location, supporting evidence,
contrary evidence, dates/population/geography, external-review arguments and any
response, then a scoped result: possible contradiction, omitted qualification,
unsupported inference, citation mismatch, no issue in the checked use, or unable
to check. Missing, ambiguous or stale evidence stays unable to check. Do not infer
a contradiction from a failed download. A policy disagreement or later event is
not automatically a factual error in an earlier report.

Check evidence quotations against the held bytes before publishing; check anchors
against the actual reader. Stop on mismatched identities or unsupported references.
Keep prompts, input hashes, model identity where available, results, costs if billed
and human decisions. Re-run changed evidence rather than carrying a finding to a
new CPIN text hash. A resumable journal must retain previous decisions.

Human review should examine every proposed flag and a sample of no-issue results.
Use known citation mismatches, faithful quotations, unavailable evidence and date
conflicts to calibrate a pilot; no error-rate estimate exists yet. A second model
agreeing is additional analysis, not independent verification. Major errors are
red, minor errors yellow; AI no-issue results stay grey. Green requires a named,
scoped human check. Review organisations and responses remain fallible evidence.

## Cost illustration, checked 5 October 2026

No paid AI calls have been made. Interactive Codex work consumes the existing
account allowance. Source downloading, indexing and cache reuse have no model fee.

For illustration only, assume **8,000 input tokens and 700 billed output tokens,
including reasoning, per claim block**. This has not been measured in an API pilot.
Using all 120,137 indexed claim/direct-link blocks gives:

| API model | Standard tokens, full pass | Batch tokens, full pass |
| --- | ---: | ---: |
| GPT-6 Luna | about US$138 | about US$69 |
| GPT-6.1 Sol | about US$2,763 | about US$1,382 |

These are calculated from the current [official OpenAI pricing](https://developers.openai.com/api/docs/pricing)
and [Sol model rates](https://developers.openai.com/api/docs/models/gpt-6.1-sol):
short-context Standard Sol is US$2/million input and US$10/million output tokens;
Luna is US$0.10 and US$0.50 respectively. Batch is half Standard. Prices and access
must be rechecked before use. Longer context, more reasoning/output, retries,
second passes, tools, cache writes, tax and human time can increase the total;
document/group reuse and excluding irrelevant blocks can reduce it. The table is
neither a spending commitment nor evidence that either model meets the task's
accuracy requirements. Use the small pilot to measure actual cost and mistakes
before choosing a bulk service or spending cap.

Copilot at work could be used manually with small permitted evidence packets;
[Copilot Chat does not provide a bulk API](https://learn.microsoft.com/copilot/faq).
Its availability does not establish suitability or accuracy for this workload.
No integration, model endpoint, payment or recurring task has been enabled.
