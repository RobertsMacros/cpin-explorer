# Published and AI reviews in the reader, 6 October 2026

## Scope and implementation

At the owner's request, AI findings are publishable as AI review. Independent
human additions are optional and separate. This change extends the existing
plain-JavaScript reader, review directory and browser-local note store; it does
not introduce another framework, model service or automatic verdict pipeline.
There were already suitable edition identity, quotation and overlay helpers, so
contained local implementation was cheaper than adopting a generic annotation
system. No new dependency is introduced; sustained operation is not established
by the local checks.

The reader exposes an edition Reviews panel, separate Published reviews, AI
review and Manual additions sections, and small passage/footnote/link markers.
A marker needs the country, series, edition ID and text hash plus a unique
verbatim contextual anchor. Ambiguous anchors remain unmarked. Report-level
context does not create blanket footnote flags. Generated marker buttons contain
no text nodes, are excluded from quotation indexes and do not change stored CPIN
text. Footnote overlays show only findings anchored to that actual source use.
Whole-report and other-edition reviews are available through All edition reviews.

The new public whitelist contains 50 records: eight attributed reviewer excerpts,
32 scoped AI context comparisons and ten narrow minor AI findings. The 12 earlier
records in published.json are retained. There is no new substantive major AI
finding or whole-report correctness judgement. Red and yellow published-review
markers show attributed major/minor concerns. AI results identify their origin;
AI no-issue results stay grey. A green tick still requires a named local human
check. Human notes stay in that browser and are not account-synchronised.

## Original reviewer evidence

MiCLU's blood-feud reviews of January 2023 and September 2022 are anchored to
2.5.3 and 2.5.5 respectively. The September 2023 trafficking corrigendum concerns
the December 2022 edition's 2.4.3. The February 2023 trafficking addendum is
anchored to 6.1.3. Its certification criticism is not moved to a loosely related
risk paragraph. MiCLU's January 2025 healthcare review appears on footnote 74 in
7.1.1 and on unfootnoted 7.1.2, in both held variants of that edition. ARC's July
2021 China Muslim review is anchored to 2.4.22. These are the reviewers' criticisms,
not independently established substantive factual errors.

The ARC July 2020 Sri Lanka review was recovered from
https://www.ecoi.net/en/file/local/2036163/ARC-Foundation-observations-on-HO-Sri-Lanka-FFM_July2020.pdf.
Its 42-page PDF is held with SHA256
`aea46048bb908bcce68e8f9a89747add13695d38d58014195a566c37fbe0776f`.
Physical page 2 explicitly covers the January 2020 FFM and May 2020 Tamil CPIN
version 6.0. The exact held CPIN `1ad495cdba0a2605` therefore receives report-level
context; no individual passage is declared faulty from this scope statement.

Public excerpts retain the reviewer's original wording, author, report and
physical-page link. Non-OGL excerpts are short attributed quotations for criticism
and review, no more than 25 quoted words per work across the new dataset. Full
review texts and private source caches are not republished. The April 2025 MiCLU
trafficking toolkit remains the curated newer contextual publication; its earlier
February revision is a related link rather than a duplicate audit.

The ten minor AI records cover Cameroon access-date arithmetic, a Syria spelling
typo, Nigeria's Biafra year, Iraq/Jamaica/Sudan/Kuwait source-year mismatches,
Vietnam's mismatched source link, Georgia's CIA country label and Colombia's
Amnesty bibliography title/link. They retain original-source evidence and exact
edition scope. Colombia's already correct footnotes 108–110 are not flagged.
Historical source-version limits remain explicit in the relevant AI record.

## Search and remaining evidence

The 60-publication, nine-publisher directory has corrected scope declarations.
ARC/UWE's quantitative-risk review concerns Ghana, Iraq, Bangladesh and Namibia;
previous country assignments were incorrect. Its full original bytes remain
unretrieved. Derek Tonkin's January 2026 Rohingya review is publicly readable
through the web tool, but the ordinary retained-file collector cannot safely
retrieve its address. These are two raw-file retrieval gaps, not evidence that
those reviews do not exist. Two exact Rwanda May 2022 editions are still unheld.

The search checked the known publishers and relevant primary repositories; it
cannot establish a universally exhaustive search. Not every argument in the full
reviews has been mapped to an inline marker. Unmapped evidence remains report
context or a separate gap. No paid calls, bulk semantic run, new recurring task or
National Archives fetch was made.

## Verification and publication

Before merging the latest remote sync, all 400 Python and 344 JavaScript tests
pass. Tests verify every public target against a held body and its recomputed
text hash, uniquely matched passages/links, duplicate paragraph ambiguity,
edition/hash isolation, separate attribution and private-path exclusions.
Browser checks cover the healthcare footnote and unfootnoted sentence, Georgia's
source marker, mobile overlay layout, empty marker text and keyboard dismissal.
These checks do not establish physical iPhone or native Edge behaviour.

Final merged checks, deployment revision and live evidence are recorded below
when completed. Private receipts and test logs are retained in
`data/source-evidence/review-integration-2026-10-06/`; original retrieval attempts
and the Sri Lanka PDF are in `data/review-evidence/integration-2026-10-06/`.

Merged verification: 408 Python and 344 JavaScript tests pass. Integrity checks
confirm 406 bodies, 707 PDFs and 684 images against their retained hashes with
zero problems. Every required publication image is present and hash-valid; no
image recovery request was needed locally. The rebuilt site contains 7,888 files
(453 MB). Browser switching from January 2023 blood feuds to July 2024 removes the
historical marker; redline view contains no markers and returning to the exact
clean edition restores its one grouped marker.
