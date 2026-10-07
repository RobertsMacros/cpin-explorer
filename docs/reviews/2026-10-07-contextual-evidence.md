# Contextual evidence and reviewer preservation, 7 October 2026

The owner authorised continuing the contextual AI checks and evidence gaps, while
preserving published human reviews. A published Home Office response takes
precedence in presentation over an AI follow-up; neither replaces the reviewer.

## Preservation and presentation

All 529 previous public records are unchanged. The whitelist now has 534 records:
486 published-review records and 48 AI records. The preservation manifest in
`config/published-review-preservation.json` pins the complete JSON of all 486
published records. Tests reject alteration, deletion and cross-edition AI links.
The reader shows original reviewer words, then the published Home Office reply,
then a separately labelled AI assessment. Existing 251 reply extracts remain;
one further recommendation/reply has been added. Private human notes remain
separate. Human-review flags are never silently changed by an AI disagreement.

## New scoped evidence

- Albania's January 2025 mental-health CIN paragraph 7.1.2 makes an unqualified
  free-of-charge assertion. Its linked 2024 List II contains patient prices,
  including for Fluoxetine Vir and Faverin. Original table cells, visible headers
  and independent Poppler text agree. A major AI source-use finding supports the
  reviewer's objection to the blanket wording. This does not establish every
  patient's payment: exemptions, eligibility and treatment protocols matter.
  The dated source was retrieved now; historical byte identity remains unproved.
- The recovered Gabrani study concerns a mixed-condition regional sample from
  2018. It supports an out-of-pocket-cost concern, but does not alone disprove the
  WHO mental-health profile. Its Figure 1 shows expenditure, rather than the
  claimed percentage paying for medication/consultations. The original MiCLU
  criticism stays intact, followed by a separate AI comparison. WHO reporting
  basis, mental-health subgroup and exemptions remain open. No specific Home
  Office reply was found in the bounded publisher/GOV.UK search; that is a search
  limit, not proof of absence.
- The Colombia reviewer recommends reattributing a High Commissioner report to
  the UN Verification Mission, and the Home Office accepts that recommendation.
  Both extracts are retained. A separate AI assessment disputes application to
  A/HRC/55/23: the original document's cover identifies the High Commissioner,
  while the CIN separately identifies a Verification Mission report. An ecoi.net
  mirror of the original UN document was checked; the official-document URL was
  unavailable to collection. This does not adjudicate every UN citation.
- Albania's July 2025 unaccompanied-children CPIN paragraph 13.5.5 duplicates
  "and" in a quotation. The original physical page 82 (printed 69) and Poppler
  have one instance. A minor transcription finding is edition-bound; the quoted
  administrative attribution and substance are unchanged.

Exact edition IDs, text hashes, anchors, source locations and limitations are in
the public records. Original raw bytes, hashes, independent readings and page
images remain private under `data/source-evidence/contextual-next-2026-10-07`.

## Seven further mechanical questions

Seven priority-2 questions, comprising seven exact occurrences, received bounded
original-source comparisons. Five resolve the shown discrepancy as source
reference markers, a source spelling correction or extraction line-breaks; one
is a grammar-only aligned fragment, and one is the minor duplicated-word finding
above. The grammar check does not approve the longer CPIN quotation or its
reporting-year completeness. These are scoped dispositions, not approval of the
sources' substantive claims or a new whole-corpus accuracy count.

The initial v3 reconciliation's 273 direct/aligned questions without fully
reusable dispositions remain a baseline. Separate samples must be reconciled by
question ID before deriving a new pending count. The frozen inventory's 49,681
unavailable source-use receipts are not reduced by this small source batch.

## Retrieval and remaining gaps

The existing guarded collector made seven selected source attempts: four held
downloads, two robots refusals and one HTTP 202 without a held document. Retained
original bytes total 2,005,761. The pass used a 100 MiB cache ceiling, 25 MiB
per-file ceiling and 2 GiB free-disk floor. No refusal workaround, archive fetch,
paid call, duplicate mechanical run or canonical CPIN change occurred.

One ARC/UWE full review file, two exact Rwanda editions, Colombia's cited
executive-summary URL, historical source versions and wider contextual merits
remain open. Ambiguous reviewer layouts retain page indexes. The private source
plan keeps both Next and Evidence gap open.

## Validation

The combined main passes 414 Python, 356 JavaScript and 56 ephemeral workerd/D1
checks, retaining the separately published account features. An initial Python run had seven mocked
collector failures because free disk space fell below the 2 GiB guard; retained
fixture receipts establish the stop reason. All 43 collector tests and then the
complete suite passed on rerun without changing the production guard. Canonical
integrity verification reports zero problems. The site builds to 7,895 files,
454 MB. Desktop and 390px Chromium checks verify review/reply/AI ordering and
footnote overlay fit; these do not establish native Edge or physical iPhone
behaviour. Publication evidence is recorded separately after deployment.
