# Source checks, published reviews and internal notes

Proposed on 5 October 2026 following the owner's feedback. The first local
implementation now displays edition-bound published reviews and private human
entries in the existing footnote overlay. It includes one published-review pilot
mapped to two citations, with a short source excerpt for one citation. It has not
been deployed. No automatic AI checks or scheduled collection have run.

The later [publisher directory and collector](../methods/published-reviews.md)
backfill published reviews separately from the source scrape. Editorially scoped
report-level review links now appear under Published reviews in the footnote
overlay; they do not assess a citation or assign a source flag. Exact-edition and
background review metadata are supplied separately for subsequent analysis.
All imported merits remain unassessed. The owner asked to prioritise backfill and
consider daily collection later; scheduling remains off.

## Intended behaviour

The owner refined the design: use the existing **footnote overlay** as the main
place to show checks. Put a small status symbol beside each cited source, with its
meaning in the hover title and accessible label, and allow the evidence passage to expand beneath it. The owner's later feedback removed
the long visible status labels throughout the overlay. A secondary
review queue can collect findings across the report. Keep three kinds of record
distinct:

The overlay groups records into three permanent sections, in this order:
**Published reviews**, **AI review**, and **Manual additions**. Each section has
its own empty/loading/unavailable state. The private editor and its edit history
belong under Manual additions; published findings and AI output cannot appear
there. Source excerpts stay beside the review they support.

| Kind | What the reader sees | Who can confirm it |
| --- | --- | --- |
| AI source check | Possible contradiction, missing qualification or unsupported claim; the CPIN passage and source evidence side by side | A human reviewer |
| Published review | The reviewer's finding, publication, affected edition and paragraph, and any Home Office response | Attributed to the published reviewer; applicability to a later edition requires a fresh check |
| Internal note | A comment or scoped check, with author, organisation, date and status | An authorised staff member |

The original Home Office text and stored edition bodies remain untouched. AI
assessment is a separate, labelled process and dataset, outside the mirror and
PDF extraction pipeline.

### Footnote interaction and scale

- Grey: not checked, checking or unable to check, with the precise state labelled.
- Yellow: AI has flagged a possible issue, awaiting review.
- Red: an internal or published reviewer has identified an issue, with attribution.
- Green tick: a human has checked this use of the source, with the reviewer,
  date and scope shown. An AI run finding no issue is labelled separately and
  does not receive this human-check status.

These states concern the **CPIN claim's use of the source**, not the source's
general credibility. The same source can support one passage and conflict with
another. Link reachability remains a separate status.

Fetch and extract sources through a background process; serve cached evidence
in the overlay when it opens. Browser-side requests cannot reliably read other
sites because of cross-origin restrictions. The owner chose automatic checks of
every citation, with pending/unavailable states while background work completes.
Start by processing a pilot report, then prioritise current editions and newly
changed citations. Do not retrieve all documents again on each report view.

Deduplicate document retrieval across footnotes and reports, but assess each
distinct claim against its relevant source passages. Use a cache key containing
the CPIN edition hash, claim anchor, source content hash and check revision.
Keep old snapshots and findings when either document changes.

Local count on 5 October 2026: the February 2026 Afghanistan Taliban note has
444 footnotes with 156 distinct source URLs; the March 2021 Hindus and Sikhs
note has 237 footnotes with 58 distinct source URLs. These are URL counts after
removing fragments, not verified counts of distinct underlying documents.
Read each source once per captured version; retrieve relevant passages for
individual checks rather than supplying a whole long report for every citation.

## Source checks

1. Map each passage to its footnotes and all cited HTTP links, including multiple
   links within a footnote. Retain section context where numbers repeat.
2. Retrieve cited HTML and PDFs, following ordinary document links where needed
   to reach the cited document. Limit traversal; do not crawl whole sites.
   Respect the existing robots, delay and blocked-request rules.
3. Store provenance, retrieval date, content hash and readable text. Prefer the
   source version available when the CPIN was written; clearly identify a later
   source version where an earlier one cannot be obtained.
4. Compare the claim with relevant source passages and their surrounding
   context. Ask the model to distinguish a contradictory claim, an omitted
   qualification, a claim it cannot substantiate, and an inconclusive check.
   Preserve dates, populations and geographical scope in that comparison.
5. Require exact evidence excerpts and source locations. Verify every excerpt
   against the captured text before accepting the finding into the review queue.
   Treat downloaded text as evidence, never as instructions to the model.
6. Display candidate findings for human review, including dismissal reasons.
   Failed retrieval, ambiguous footnote mapping and unreliable PDF extraction
   are **unable to check**, not contradictions. A check with no detected issue
   does not mean that the whole CPIN has been verified.

Deduplicate downloads and checks by hashes. Record the model, prompt revision,
scope and run date. Start with a bounded pilot before choosing a model provider,
budget or programme of checks across the catalogue. Internal notes are excluded
from model inputs by default.

## Published reviews

Periodically collect new IAGCI/ICIBI country-information reviews and Home Office
responses from their publication collections. Allow other published reviews to
be added with attribution. Keep review documents, findings and responses linked.
Do not assume every CPIN has a published review.

Attach findings to the exact edition reviewed, using its content hash and a
paragraph/section plus exact-text anchor. A revised CPIN can trigger a fresh
applicability check, but cannot silently inherit the old finding as current.
An accepted recommendation or promised revision is not evidence that the
wording has actually changed.

### Verified pilot candidate

The [Afghanistan and Colombia review published on 2 June 2026](https://www.gov.uk/government/publications/inspection-report-on-home-office-country-of-origin-information-on-afghanistan-and-colombia-december-2025)
flags inconsistent passages in paragraphs 16.2.6 and 16.2.7 of the August 2025
Afghanistan **fear of the Taliban** note. The Home Office accepted the finding
and said it would revise the next edition. This is an expert finding about an
internal inconsistency, not an AI finding about a retrieved external source.

The review's printed page 43 is physical PDF page 49 in the
[standard PDF](https://assets.publishing.service.gov.uk/media/6a2016cedbcb60fc6ccb29b0/Inspection_report_on_Home_Office_country_of_origin_information_on_Afghanistan_and_Colombia__December_2025_.pdf#page=49).
The corresponding mirrored edition is `a7c78fef364ac1e2`, with both paragraph
numbers confirmed in its stored body. The current February 2026 edition is
`2c5e35429f512dbf`; applicability to that edition has **not** been assessed.

Use this as a first published-review fixture, then add source-contradiction and
non-contradiction examples to assess the source-checking process separately.

## Internal notes

Support passage and whole-edition notes, with explicitly recorded scope. A
status such as **Checked by Asylum Aid** needs an identified reviewer, date,
organisation and statement of what was checked. A comment alone must not imply
organisational approval or a review of the entire report.

The first implementation stores an append-only journal in
`cpin-source-reviews-v1` in localStorage. It labels reviewer identities and
organisations as self-reported; a green tick means **Marked checked locally**.
It can hold a privately pasted source passage. Previous entries remain visible;
the latest local decision cannot erase an independent published or AI finding.
If browser storage fails, it reports that the entry lasts only for this session.
Source changes cannot yet be detected automatically; a local check records its
date and must not be described as continuously reverified.

Keep edit history. When an edition changes, retain the old note with that
edition and mark any proposed carry-forward as needing recheck.

The owner has been asked whether these notes should be private to one person,
shared within a signed-in team, or public. Until decided, the design assumes
private access. Explorer currently stores highlight comments in browser storage;
it has no team identity or shared notes service. Shared notes require an
authenticated service and private storage outside public site assets, with
membership and edit permissions enforced on the server.

## Inline source text and copyright

Use attributed evidence passages in the overlay, with an original-document link
and source/page/date context. Full text can be offered where a suitable licence
or permission covers it. Do not infer a licence from a source being online or
cited in a CPIN; the Open Government Licence excludes third-party rights that
the provider cannot license.

The [IPO's copyright guidance](https://www.gov.uk/guidance/exceptions-to-copyright)
describes fair dealing for criticism, review and quotation, with sufficient
acknowledgement. The necessary amount, purpose and effect on the original market
matter; there is no universal safe word count. Treat aggregate excerpts from a
publication as well as individual footnotes when assessing public display.

Keep the rights assessment for downloading/retaining full source documents and
sending them to a model separate from the assessment for displaying excerpts.
The IPO describes the text-and-data-mining exception as applying to computational
analysis for non-commercial research with lawful access; it is not a blanket
permission for any AI service or republication. Restrict automated ingestion to
sources covered by an assessed licence, permission or applicable exception.

The public review renderer refuses to display an evidence quotation without an
explicit `publicDisplayApproved` decision and `rightsBasis` in the record. The
pilot contains an 11-word quotation from the RFE/RL article for the specific
criticism, with author, title, location and original link. Its assessment does
not approve whole-article reproduction or automatic model ingestion. Private
human notes and pasted passages are never written into the public build.

Embedding a whole source website is an optional convenience, not a dependable
default: sites can block frames through X-Frame-Options or CSP frame-ancestors.
An extracted evidence passage and full-source link are the baseline.

## Next implementation steps

Complete the bounded prior-art assessment for source retrieval, evidence-backed
model output and team authentication before substantial implementation. Reuse
the existing HTML/PDF tooling and edition anchors where suitable.

Build and test the edition-bound review records and published-review pilot
first. Then add the source-check pilot and evidence display. Implement internal
notes against the chosen access model. Choose collection/check schedules and
budgets before enabling background runs; none have been enabled by this design.
