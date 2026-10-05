# Main publication review, 5 October 2026

The owner authorised a push to `main` after completion and review. The publication includes the handover
commit `c5f7c5d`, interrupted-work completion, all 140 archive imports and the `pdftext-6` cleanup. This is
the implementing agent's review, not an independent review. Earlier detailed evidence remains in the
[handover completion review](2026-10-04-handover-completion.md),
[archive collection record](2026-10-04-national-archives-links.md) and
[PDF-only cleanup review](2026-10-05-pdf-only-cleanup.md).

## Publication checks

Review covered immutable source storage and PDF histories, offline archive import and exact provenance,
polite HTTP and redirect handling, extraction evidence, reader and saved citations, former-country handling,
and site assembly. No new extractor or reader changes were made during this final publication review.
Known limits in the source audit remain disclosed, including reused footnote numbers in Rwanda annex 2.

The workflow review found that missing Cloudflare secrets also skipped push tests. `deploy.yml` now runs
Python tests, retained-data verification and JavaScript tests independently of those secrets; publication
requires both passing tests and credentials. Both test environments install Poppler so the independent
PDF audit fixture runs. The deploy job repeats validation against the latest `main`, because a daily sync
may have committed new data after its caller started. The sync retains fetched data before reporting later
failures and cannot publish on a failed job. Its scheduled operation remains to be verified after activation.

Local checks: 277 Python tests and 322 JavaScript tests pass. All 405 stored bodies, 707 original PDFs and
682 mirrored images match their hashes; current-collection completeness has zero problems. The catalogue
holds 829/829 listed editions, with zero unresolved editions among the 32 retained failed attempts.

## Main integration and fresh checkout

The remote advanced to `6bbbe5b` while the handover was being completed. It contains observation timestamps
and the daily run log, not new source bodies or code. The integration preserves all 794 changed remote observation timestamps or later local observations and
all 20 run-log entries. The 408 conflicting image observation timestamps were resolved to the later value.
All 405 stored source bodies remain byte-identical and all 707 PDF manifest identities and historical hashes
are unchanged. CSV indices retain their standard CRLF records; `.gitattributes` makes the whitespace check
accept those line endings rather than changing the supplied exports. Both staged and working-tree whitespace
checks pass.

A fresh tree assembled from the Git index passes all 277 Python tests and retained-data verification. With
no original PDF directory, export preserves all 532 displayed PDF editions and all 535 reachable PDF IDs
including aliases; every one of the 140 imported archive editions is reachable. The web-image cache was
copied locally to simulate the deployment mirror cache. Search and site builds pass from this fresh tree:
4,335 current search records and 7,905 site files (452 MB). This checks build reproducibility without
requesting any archive PDF or depending on locally held originals. The rebuilt working checkout also passes
322 JavaScript tests and produces the same site file count. The earlier browser checks still apply because
this final review made no reader or extractor changes.

The GitHub push and validation outcome will be added after the run finishes.

Cloudflare secrets are absent. Pushing to `main` activates the rewritten daily workflow and push checks;
it does not update the live site while publication is skipped. The live deployment remains `f389a3e`.
