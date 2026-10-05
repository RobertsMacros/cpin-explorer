# Decision: Resumable local mechanical citation screening over held source documents

Evidence assessed by the research agent. Structural checks confirm required records; they do not independently certify source truth or operational reliability.

## Choice

Extend existing project evidence code with SQLite checkpoints and bounded standard-library comparisons.

## Rationale

Avoid another scraper, model or dependency. Generic durable state is cheaper and safer through SQLite; existing raw/independent PDF reading is already available. New logic only covers project-specific alignment and narrowly labelled comparisons.

## Own work checked

Current CPIN schemas, prior title/date script, webpdf independent reader, local rmfile journal and owned Fuzzy-List-Comparison README inspected; broad local discovery timed out.

## Stop reason

Bounded scan about 4 minutes; owned VBA clearly unsuitable and current dependencies cover uncertain parts. Further repository searching unlikely to change decision.

## Next check

Adversarial fixtures, interruption/resume and changed-source invalidation; mixed real-source pilot before full run.

## Limitations

No candidate claimed operational in new scope. Local discovery timeout recorded. SQLite probe only proves basic transaction behaviour; source-context accuracy/throughput must be tested separately.

## existing-cpin-evidence

Evidence state: **tested**

**Fit:** Exact project schemas, immutable sources, honest retrieval and private review targets already available.

**Scope:** Source collector, citation title/date screen and independent PDF reader.

**Limits:** Single collection/screen run; no sustained operation or semantic accuracy established.

**Licence:** Owned repository; reuse in place, not a new third-party adoption.

**Maintenance:** Current main ff3ae29; local Python tests passed on prior commit.

**Adaptation:** Reuse collector records, inventory_paths and atomic store; add contained deterministic checks without changing canonical extraction or site dependencies.

**Transfer:** Identity by bytes, private evidence, scoped states; use existing independent PDF reader.

**Recommendation:** Extend locally.

- [source inspection](/Users/robertnew/Developer/cpin-explorer/src/cpin/source_collect.py) (read 2026-10-05): Retains hashes/receipts, extraction and inventory mappings; no source-claim judgement.

- [direct observation](/Users/robertnew/Developer/cpin-explorer/docs/reviews/2026-10-05-citation-identity-screen.md) (read 2026-10-05): First 84,612-footnote screen and 328 Python tests; title/date metadata has false-positive limits.

- [source inspection](/Users/robertnew/Documents/GitHub/file-to-icloud/rmfile/journal.py) (read 2026-10-05): Owned code retains intent/done states separately; borrow durable journalling principle, not move/undo implementation.

## sqlite-and-standard-library

Evidence state: **tested**

**Fit:** Serverless transaction journal and bounded sequence comparisons, no extra dependency installation.

**Scope:** Local SQLite result/input cache; difflib only on bounded candidate windows, never entire documents.

**Limits:** Local transaction uniqueness/rollback probe passes; no measured overnight throughput or error rates yet.

**Licence:** SQLite public domain; Python standard library PSF terms.

**Maintenance:** SQLite 3.53.4 available in project Python; maintained through runtime.

**Adaptation:** Small SQL schema with unique occurrence IDs and separately keyed reusable comparisons, parameterised SQL, commit per batch and process lock; bounded LRU source cache. Future migrations keyed by method version.

**Transfer:** Transactional checkpoints survive interruptions; exact matches first, bounded near matches remain candidates.

**Recommendation:** Reuse SQLite and standard library; no FTS/index subsystem needed for first pass.

- [maintainer documentation](https://docs.python.org/3/library/sqlite3.html) (read 2026-10-05): SQLite transactions, commits and parameter binding; context managers do not close connections automatically.

- [maintainer documentation](https://www.sqlite.org/atomiccommit.html) (read 2026-10-05): Atomic commit/recovery documented with filesystem and hardware assumptions; no project-specific sustained operation demonstrated.

- [maintainer documentation](https://docs.python.org/3/library/difflib.html) (read 2026-10-05): SequenceMatcher can be quadratic and similarity is asymmetric; bound inputs and do not equate scores with factual correctness.

- [maintainer documentation](https://www.sqlite.org/copyright.html) (read 2026-10-05): SQLite code is public domain.

- [direct observation](/Users/robertnew/Developer/cpin-explorer/data/research/mechanical-source-checks/DISCOVERY.md) (read 2026-10-05): Local SQLite commit/rollback/key uniqueness probe passed on 5 October; discovery local scan timed out, targeted owned source inspection substituted.

## owned-fuzzy-list-comparison

Evidence state: **unknown**

**Fit:** Adjacent string grouping, but Excel VBA tool does not supply source verification or a Python batch runner.

**Scope:** Borrow distinction between insignificant numbering and important years only.

**Limits:** No sustained-use evidence found; word-order-insensitive similarity and punctuation stripping inappropriate for quotations/negation.

**Licence:** No declared repository licence observed; no code copied.

**Maintenance:** Small owned VBA repository with README; operating history unassessed.

**Adaptation:** Porting UI/scoring would cost more than a contained Python comparison and introduce unsafe normalisation.

**Transfer:** Keep years and source pinpoint numbers; ignore only explicitly identified CPIN paragraph prefixes.

**Recommendation:** Reject implementation reuse.

- [source inspection](https://github.com/RobertsMacros/Fuzzy-List-Comparison) (read 2026-10-05): README describes VBA list comparison, bigram scoring and punctuation/list numbering normalisation; no operational record established.
