# Mechanical source checks

The owner requested an inventory of deterministic checks on 5 October 2026,
with archive recovery deferred on the first pass. Use held source captures first;
original-address retrieval can fill gaps under the existing polite collector.
Do not start new archive searches for this pass. Existing archived captures may
be screened with their provenance intact. The private runner now implements 56
rule types, including eligibility/gap routes as well as comparisons. Implementation
is not proof that every rule applies to every passage or that any claim is correct.

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

## Running the expanded screen

```sh
.venv/bin/python scripts/run_mechanical_checks.py \
  --inventory data/source-evidence/since-2020 \
  --out data/source-evidence/mechanical-overnight-2026-10-05 \
  --cache data/source-evidence --max-hours 10 --max-gb 6
```

The active inventory contains 116,125 blocks with at least one HTTP source URL.
The 4,012 other blocks remain outside this linked-source pass; their absence of a
usable link is an evidence gap. Bibliography lines remain included and classified
separately. Every occurrence retains its country, report, edition, full CPIN text
hash, original citation, source capture and surrounding paragraphs.

SQLite stores each occurrence, result history and shared comparisons. Only
identical relevant context/citation/source inputs share computation. CPIN
paragraph numbering and reference-marker changes can be ignored for source
comparisons; mapping checks and dates remain occurrence-specific. Original href
fragments survive the collector's fragment-free fetch URLs and invalidate reuse
when the source pinpoint changes. Source bytes, extraction fingerprints, evaluator
code and independent-reader changes invalidate affected cached work.

Outputs remain private: `results.sqlite3`, `job.json`, `summary.json`,
`candidates.csv`, `candidate-sample.json`, `ranked-review-queue.json`, `REPORT.md` and compressed hash-keyed
source readings. Summary/candidate exports are written at the end or a budget
stop. The job checkpoints continuously, has a process lock, a 6 GiB derived-output
budget and a 2 GiB free-space floor. It makes no requests or model calls and
publishes no flags. An interrupted job resumes with the same command. Time/disk
limits and processing errors are surfaced, not described as a completed review.

The overnight LaunchAgent wraps the command in `caffeinate -i -s`, keeping idle
sleep inhibited while it runs without keeping the display on. The Mac still needs
to remain powered and operational; closing its lid can interrupt it. The task's
follow-up checks completion and cleans up this one-off agent. It does not start
another source collector or archive recovery.

## Implemented rules and remaining boundaries

The v2 cleanup preserves original source text while making separate comparison
readings. Raised PDF numeric spans are excluded only with matching bottom-of-page
notes and anchored text on both sides; bare numbers remain. HTML headings require
structural markup, with raw matches attempted first. Uncovered PDF page-label
intervals remain gaps rather than causing an exception or being inferred from
physical page counts. Units require adjacent numerical values; grouped numbers
are parsed whole; coarse small-denominator ratios and relative growth percentages
stay observations where their interpretation is ambiguous. All comparison
adjustments are recorded and do not approve the broader claim.
Explicit HTML footnotes need retained targets and anchored surrounding text.
Unproven marker-shaped differences remain furniture gaps, with no match approval
or number-error candidate. DOI terminal citation punctuation is normalised only
for identifier comparison; source text and balanced internal parentheses survive.

For a controlled rerun use `--receipt-snapshot` with the baseline's frozen JSON.
`--reading-cache` can reuse its compatible independent PDF readings after source
and extraction hashes and reader fingerprints match. Review questions retain
every edition target: repeated metadata questions group separately, while
wording questions also require exact source/context grouping. Priority 1 routes
direct number/negation/unit, arithmetic and locator checks; priority 2 routes
aligned wording and identity candidates; priority 3 routes metadata, mapping and
ellipsis questions. These ranks are evidence types, not probabilities or public
verdicts. See [the v2 run record](../reviews/2026-10-06-mechanical-cleanup.md).

The existing collector provides the URL receipts and raw source text. The new
runner adds conservative quote/ellipsis location, bounded near-quote alignment,
changed number/negation/qualifier/unit candidates, independent PDF corroboration,
printed-label/physical-page and retained-fragment checks, document year and stable
identifier signals, ISBN checksums, date/citation consistency and narrowly
specified arithmetic. Typography-only differences remain observations. Metadata
mismatches remain candidates, not established errors.

Structured table-row interpretation, general paraphrase verification, legislation
version applicability, legal holdings, publisher-alias authentication and historical
source version selection remain unassessed. Rules explicitly route those cases to
appropriate gaps. Numbers are compared within aligned quotations, never by finding
the same number somewhere in a document. Numerical changes in PDFs do not become
candidates without independent agreement. Ellipsis qualification flags identify
words in omitted spans; they do not judge the omissions' materiality.

Near-quote alignment runs whenever a quotation's exact wording is not located:

- An ellipsis is written "…", "..." or either of those in round or square
  brackets. At the start or end it marks where the quotation was cut, and is
  ignored. Inside, it divides the quotation into segments; each segment whose
  exact wording is absent is aligned on its own, and a candidate records both
  the whole quotation and the segment concerned.
- Square brackets are the quoting author's. A bracketed capital at the start of
  a word (`[T]he`) is restored; every other bracket (`[2026]`, `[sic]`,
  `[the areas]`, `village[s]`) is set aside before alignment and listed with
  the result. If the quotation is then in the source word for word, nothing is
  raised. Numbers, negations, qualifiers and units are judged on the remaining
  words exactly as they would be without the bracket, so a bracket cannot hide
  a change in any of them; where the author's bracket itself replaces a figure
  or unit, that is reported too and a reviewer decides. Wording that differs
  only directly beside a bracket, with none of those changed, is recorded as
  `unable`: it is neither a wording candidate nor a formatting-only result.
- When the first or last four words are themselves changed, the window is
  anchored on the other end alone. At the unanchored end only as many source
  words are compared as the quotation has there, so text beyond the quoted
  span is not read as a difference. Two exceptions at the end of a quotation:
  a percentage written out in the source (below); and, where the quotation
  closes with its own full stop while the source's sentence runs on
  ("… the total was 4." against "4 million.", "did." against "did not."),
  the source is read to its own full stop, because the words cut off are what
  is being looked for; the result records the words cut off (`sentenceRunsOn`),
  so a reviewer can tell an early full stop from a changed quotation. In generated
  faithful quotations ending this way roughly half raised a candidate, which is
  the cost of not missing the other kind. A quotation that stops without a full stop claims
  nothing about what follows. The 0.90 similarity floor and the requirement
  for one clearly best alignment are unchanged.
- "84 percent", "84 per cent" and "84%" are the same unit. A figure that loses
  its percentage altogether is still a unit question.
- Quoted wording is located only as whole words and whole numbers: "65 per
  cent" is not found inside "165 per cent", nor "4." inside "4.5 million", nor
  "000 people" inside "4,000 people" or "4 000 people", nor "in 2025" inside
  "in 2025-26". Such a quotation is then aligned like any other unlocated one,
  and the difference in the figure is a candidate. A letter beside a digit is
  not a longer word, because sources run footnote numbers on to words
  ("residents16"); a year with a footnote number run on to it ("201916") is an
  unproven marker shape and stays `unable`. A figure quoted without the unit
  that follows it ("65" from "65%") is still located.
- A paragraph that opens with a quotation mark is one quotation only when it
  also ends with the closing mark and no second quotation opens inside it.
  Otherwise each quotation in it is picked out and checked separately; before,
  such a paragraph was read as one run from its first mark to its last and was
  never located.
- A single-quoted quotation is not ended by an apostrophe inside it
  ("the territory's population"): where the supposed closing mark is followed
  directly by a letter, the longer reading is taken if it closes, on a mark not
  itself followed by a letter, before any other quotation mark opens.

Still not aligned, and therefore left `unable` with no candidate: a quotation or
segment of fewer than twelve words; a quotation of more than 300 words; a
segment whose first and last four words are both changed; a plural possessive
("families' homes") inside a single-quoted quotation, which still ends it
early; and any source with no held, readable copy. Paraphrase is not examined
at all. Results stored before 10 October 2026 predate these rules; they are
unchanged until a separately authorised run, which would raise candidates the
earlier runs could not. Every rule above was checked against generated cases
for unchanged behaviour on plain quotations: apart from the percentage
equivalence, a quotation with no ellipsis and no brackets whose first and last
four words are found gives the same result as before.

The 450-block Syria/Afghanistan source-format pilots completed without processing
errors. All 345 Python tests pass, including interrupted/resumed result reuse,
changed-byte invalidation, paragraph versus source-pinpoint changes, ambiguous
alignment, rounding, page numbering, negation preservation and independent-reader
artefacts. This establishes tested runs, not an accuracy/error-rate benchmark or
sustained unattended operation. See the [run record](../reviews/2026-10-05-mechanical-overnight.md)
and [reuse decision](../research/mechanical-source-checks/REPORT.md).

| Rule ID | Comparison or explicit route |
| --- | --- |
| `reference-target` | Footnote reference resolves in the retained index |
| `duplicate-reference` | Duplicate footnote IDs/markers |
| `source-url-boundary` | Possible punctuation or line-wrap in source URL |
| `bibliography-link` | Source URL also occurs in the edition bibliography |
| `bibliography-date` | Footnote and bibliography explicit publication dates |
| `source-retrieval` | Recorded source retrieval outcome |
| `source-redirect` | Recorded redirect destination |
| `source-integrity` | Retained source bytes match their SHA256 |
| `source-extraction-recovery` | Missing inline glossary text restored only where the original HTML has one uniquely matching local context; observation, never factual approval |
| `source-readable` | Usable source text rather than error/challenge response |
| `source-scan-limit` | Whole source text fits the bounded first-pass scan |
| `citation-title` | Candidate cited title in source front matter |
| `document-edition-year` | Highly similar document titles name different years |
| `identifier-conflict` | Different unique stable identifiers in front matter; UKUT case-number zero padding is equivalent, changed case numbers are not |
| `citation-title-truncation` | Citation title contains ellipsis |
| `citation-publisher` | Cited publisher name observed in front matter |
| `publication-date` | Citation date versus explicit HTML publication metadata |
| `source-future-date` | Source citation date later than known CPIN edition date |
| `access-before-publication` | Explicit citation access date before publication |
| `capture-applicability` | Held source capture versus historical CPIN edition |
| `doi` | Cited DOI observed in source front matter |
| `isbn` | Cited ISBN observed in source front matter |
| `isbn-checksum` | Cited ISBN mathematical checksum |
| `invalid-calendar-date` | Impossible explicit citation calendar date |
| `case-identifier` | Neutral case citation/ECLI observed in source |
| `source-html-fragment` | Cited HTML ID/name fragment exists |
| `source-text-fragment` | Browser text-fragment excerpt located |
| `source-physical-page` | Explicit PDF #page target within physical pages |
| `source-printed-page` | Cited printed page resolved using declared PDF labels |
| `source-paragraph` | Cited source paragraph number located |
| `quotation-exact` | Complete candidate quotation located |
| `quotation-ellipsis` | Quoted segments located in order and gaps retained |
| `quotation-repetition` | Repeated quotation locations remain ambiguous |
| `quotation-pinpoint` | Quotation occurs at the resolved source location |
| `quotation-independent-reader` | PDF text match checked with independent reader |
| `quotation-near-match` | Bounded comparison with uniquely aligned similar text |
| `near-match-independent-reader` | Independent PDF reader supports the same aligned differences |
| `changed-number` | Numbers differ in a bounded near-matching quotation |
| `changed-negation` | Negation differs in a bounded near-matching quotation |
| `changed-qualifier` | Bound/estimate wording differs in aligned text |
| `changed-unit` | Units differ in aligned text |
| `editorial-insertion` | Square-bracket additions in quoted wording |
| `figure-context` | Numbers belong to a located quotation, not a global number search |
| `percentage-arithmetic` | Explicit n out of N percentage within rounding tolerance |
| `impossible-percentage` | Explicit percentages outside 0–100, excluding intact URL escapes and preserving range signs; denominator/context review remains required |
| `reversed-range` | Explicit from X to Y ranges ordered where labelled as a range |
| `duplicate-url-citation-date` | Same source URL given different citation dates in edition |
| `source-pinpoint-present` | Source pinpoint preserved in comparison inputs |
| `source-content-type` | PDF-looking address versus retained document type |
| `table-scope` | Table/cell claims routed away from plain-text approval |
| `legal-scope` | Legal meaning/version applicability remains contextual |
| `contextual-support` | Contextual assessment is outside mechanical screening |
| `source-furniture` | Structurally evidenced source markers/headings excluded from derived comparison |
| `quotation-number-format` | Aligned numeral formatting differs without changing values |
| `quotation-attribution` | Omitted source attribution remains a contextual question |
| `quotation-unit-scope` | Missing percentage notation needs contextual interpretation |

Method v3 and its bounded regression replay are described in
[the repair record](../reviews/2026-10-06-mechanical-cleanup.md).
Literal quotations remain separate from derived quantity-format observations;
source-version and contextual gaps never become an overall approval.
