# Mechanical source checks

The owner requested an inventory of deterministic checks on 5 October 2026,
with archive recovery deferred on the first pass. Use held source captures first;
original-address retrieval can fill gaps under the existing polite collector.
Do not start new archive searches for this pass. Existing archived captures may
be screened with their provenance intact. This catalogue is a proposed extension
to the existing title/date screen, not a record that all checks have run.

## Result vocabulary

Every result names a particular check, its input hashes, source location and
evidence. **Mechanical check passed** means the stated comparison passed, such as
"quotation matches at the cited paragraph". It does not approve the wider claim.
**Mechanical discrepancy** requires an established source identity and a direct,
unambiguous comparison. **Possible discrepancy** needs disambiguation or stronger
evidence. **Unable to check** covers missing evidence, ambiguous mappings and
unsupported extraction. Failed retrieval is an availability result, not a claim
error. A checksum failure is our evidence-integrity problem, not a CPIN mistake.

Do not translate match percentages or title similarity into an accuracy score.
Until the comparison set is validated, a bundle of successful tests is described
as mechanically consistent rather than "correct". Public red/yellow findings
require inspection of the discrepancy and its impact. Minor/major reflects that
impact, not the algorithm's confidence. Green remains a named human review.

## Check catalogue

| Check | Mechanical comparison | What can be established, and the boundary |
| --- | --- | --- |
| Footnote mapping | Compare raw CPIN reference markers, footnote IDs and bibliography references with the derived index. Check duplicates, missing targets, unreferenced entries and link attribution. | A broken reference can be established against the actual source body. An index-only anomaly may be our parser and is not automatically a CPIN error. |
| Reachability and redirects | Use retained HTTP receipts, final destinations, error/challenge-page detection and document type. | Whether the recorded fetch produced a document, error, homepage or refusal. Today's broken link does not establish a historical citation error. A redirect alone is not a mismatch. |
| Evidence integrity/readability | Hash held bytes; check PDF/HTML content type, encryption, scans, missing pages and extraction status. | Whether our copy is intact and usable. A scan or corrupt cache is an evidence gap, not a judgement on the report. |
| Document identity | Compare publisher, full title, edition/year and available stable identifiers such as DOI, ISBN, report code, case identifier or statute identifier. | A linked document with positively incompatible identifiers can be a citation mismatch. Filename, domain, similar title or metadata alone is insufficient identity proof. Publisher aliases and mirrors need an explicit mapping. |
| Bibliography reconciliation | Join each footnote to the bibliography by document identity; compare title, version, date, URL and source pinpoint where supplied. | Direct conflicts or ambiguous document attribution. Sources consulted but not cited are not treated as broken references. A bibliography source is checked once and reused at its substantive claim uses. |
| Publication and chronology | Keep publication, modification, access, capture and CPIN edition dates separate; compare authoritative source dates where available. | Matching explicit dates or an apparent chronology conflict. Website preparation dates and later modifications can mislead. Month precision is an interval, not an invented day. Without historical evidence, historical applicability stays unresolved. |
| Source pinpoint | Resolve HTML fragments, source paragraph IDs, PDF named destinations, printed page labels and physical-page links; retain source page/paragraph differences. | Whether the named location exists and where it points. Printed page 12 is not necessarily physical page 12. A document shorter than the cited printed page is not sufficient proof without resolving its numbering scheme. |
| Literal quotations | Locate complete quoted spans in the identified source and cited location. Permit conservative whitespace/typography handling while preserving words, numbers, negation, mathematical signs and units. | Wording fidelity at a known location. A quote found elsewhere may reveal a pinpoint problem, not a wrong quote. Failure to locate text is not proof it is absent. PDF discrepancies require the standing independent reading check. |
| Ellipses and quotation boundaries | Locate every retained segment in order; record intervening omitted text and boundaries. | Whether the segments occur in order and what was omitted. Their presence does not establish that the omissions preserve the source's meaning. Highlight omitted qualifications for review. |
| Figures, dates and units | Compare values only after establishing a unique source field or labelled passage with the same time, geography, population and measure. | Direct value/unit/transcription discrepancies. Matching the same number somewhere in a document is not evidence. Ranges, lower bounds, estimates and denominators remain part of the comparison. |
| Arithmetic | Recalculate stated totals, percentages, ratios and conversions from explicit inputs on the same basis, with stated rounding tolerance. | Whether the arithmetic follows from those inputs. This does not verify the inputs or permit combining incompatible populations, dates or currencies. |
| Tables and lists | Compare uniquely identified rows, columns, headings and list entries with the cited representation. | Transposed cells, missing items, changed ordering where it matters or incorrect counts. Reading order and table extraction must first be reliable; particularly difficult PDF layouts stay unresolved. |
| Qualifier preservation | Within an already aligned passage, detect changes to explicit negation, estimate/range wording, "at least", dates and population/geography labels. | A precise wording difference and a candidate omitted qualification. The rule does not decide whether a paraphrase elsewhere preserves the meaning or whether an omission is material. |
| Cases and legislation | Resolve exact instrument/case identifiers, provisions and paragraph references; compare direct quotations and the version named in the citation. | Identifier, locator and quotation accuracy. Holdings, legal effect and applicability remain contextual review. Do not use the newest available statute text as proof of the text applicable to an older CPIN. |
| Internal consistency | Compare repeated quotations, source metadata and explicitly equivalent labelled values within an edition. | Direct inconsistent copies or arithmetic on the same defined basis. Differently dated figures or differently scoped populations are not contradictions. |
| Reuse eligibility | Compare the claim, source bytes, source pinpoint, relevant surrounding context and check-method version. Ignore only CPIN paragraph numbering and harmless whitespace. | Which existing narrow checks can be reused across reports/editions. Very similar wording is a grouping proposal. Different source pinpoints must trigger comparison. Every occurrence retains its edition target and provenance. |

## Execution order

1. Resolve CPIN mappings and source integrity/readability; group repeated uses.
2. Establish document identity and bibliography attribution. Extend the existing
   title/date triage with publisher/identifier checks; strengthen dates beyond
   metadata observations before treating them as established.
3. Resolve source locations; run quotation, figure and arithmetic comparisons
   where prerequisites are satisfied. Keep missing prerequisites explicit.
4. Screen ellipses, qualifiers and internal inconsistencies for inspection.
5. Assemble evidence packets and inspect proposed flags and a varied sample of
   passes, including known errors. Measure mistakes per check type before bulk
   classification or publishing findings. Keep unresolved contextual questions
   for later human/local-model review.

No paid model service is needed for these deterministic comparisons. Source
text remains private. A resumable result key includes the method version and
all relevant inputs; a change in a source, source pinpoint or relevant context
invalidates the affected check. Reusing computation does not automatically
extend a published external criticism to another edition.

## Implemented versus proposed

The collector already records mapping diagnostics, reachability, redirects,
source types, extraction status and immutable hashes. The first citation screen
has run on all 84,612 indexed since-2020 footnotes, with title/date comparisons
possible for 32,621 uses and 10,764 source objects hash-checked. It does not yet
establish publisher identity, source pinpoint accuracy or contextual support.
Quotation, numeric/arithmetic, qualifier and other comparisons in this catalogue
are proposed and have not run across the collection. Their eligible counts and
error rates are not yet measured. See the
[first screen record](../reviews/2026-10-05-citation-identity-screen.md) and
[batch review method](source-review-batches.md).
