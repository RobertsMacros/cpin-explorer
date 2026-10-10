# Repository readiness review, 9 October 2026

Bounded review of current account state, release/sync workflows, handover,
research backlog and concurrent work. This is not an exhaustive security,
performance or factual-source audit. No implementation or deployment performed.

## Findings

1. **P2: account refresh can replace a newer saved edit with stale visible data.**
   `prototypes/shared/account-state.js:55–60` checks pending writes before its
   asynchronous read, then clears/replaces all rows without checking whether an
   edit occurred while the read was pending. Controlled reproduction: start a
   delayed read of an earlier highlight; edit and successfully flush it; return
   the earlier snapshot. Server quote is “New saved text”, visible quote becomes
   “Earlier text”, status is “saved”, pending is false. This reproduction does
   not establish server data loss. Guard application of reads with a mutation
   generation and request identity; add a regression for delayed refresh/edit
   ordering and overlapping refreshes.

2. **P2: scheduled content publication has no recovery for concurrent main pushes.**
   `.github/workflows/sync.yml:87–97` commits fetched data then issues plain
   `git push`. The sync concurrency group serialises syncs only; it does not
   prevent another author updating main between checkout and push. A normal
   non-fast-forward rejection fails publication, with no safe merge/retry or
   uploaded commit artifact. Preserve fetched results, safely reconcile remote
   history or stop with a recoverable artifact. Never resolve content conflicts
   by discarding canonical history. This is a code-path risk, not an observed
   failed scheduled changed-content run.

## Checks and boundaries

- Current JavaScript suite: 362 passed; working-tree whitespace check passed.
- Current retained-data integrity passed: 406 bodies, 710 PDFs and 684 images
  match hashes; all 164 listed web reports and 175 current PDFs are held. This
  checks the known stored collection, not discovery of every historical report.
- Fresh local Python suite could not complete cleanly: ENOSPC caused failures,
  fixture errors and an error during result reporting. Do not interpret this as
  415 current passing tests, or assign its individual failures to product bugs.
- Last successful publication: GitHub run 37833094232, 8 October 2026. Its
  reported scope is 415 Python, 362 JavaScript and 99 ephemeral account checks.
  The previous Poppler installation failure has a passing repaired release.
- Most recent scheduled sync, run 37785692320, succeeded with unchanged content;
  its deploy stage was skipped. Changed-content scheduled publication is pending.
- Disk reached ENOSPC. Only this review's disposable pytest directory was removed;
  subsequent free space was about 253 MiB. Original PDFs and source evidence
  remain intact. Make substantial room before further builds or bulk jobs.
- Local main is one documentation commit behind origin/main. Another actor's
  in-progress publisher discovery and Gaza contextual batch remain intact.
  Committed annotations: 569; working annotations at observation: 580.
  Those 11 additions are working drafts, not a verified new live release.

## Next steps, in order

1. Free disk space, then fix the account-refresh race and verify genuine
   cross-device saves, conflicting edits, approval/revocation and failure states.
2. Reproduce and fix Windows Edge highlighting and ordinary-link overlays with
   Edge's own selection controls enabled. Check a physical iPhone separately.
3. Harden concurrent sync publication and verify a controlled changed-content
   path without modifying canonical source text just to manufacture a change.
4. Let the existing actors finish publisher discovery and the bounded Gaza
   source batch. Preserve edition identity and human-review/reply ordering.
5. Complete the gaming-PC hardware inventory and eight-case local-model trial
   before any wider semantic run. No local model has yet been run. The remaining
   Minghui historical wording and Albanian national/medicine evidence gaps are
   explicit unresolved research, not candidates for automatic correctness flags.

R2 hosting for retained PDFs, a focused reader performance/maintainability audit
and updating stale README/AGENTS status text follow these reliability checks.

This report and its coordination breadcrumbs are local and unpublished.
