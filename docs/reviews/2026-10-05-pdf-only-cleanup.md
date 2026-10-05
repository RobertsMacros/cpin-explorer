# PDF-only reading-text review, 5 October 2026

`pdftext-6` cleans the derived reading view of editions for which Explorer has no corresponding web
publication. Original PDFs, their hashes and stored GOV.UK bodies are unchanged. This is deterministic
text-layer extraction, with no OCR or language model; the reader continues to say “From the PDF” and
links to the source edition.

## Changes checked against the source

The cleanup removes short dated running headers repeated in the top margin, inset “Page X of Y” footers,
linked “Back to Contents” suffixes, and old contents lists with paragraph references rather than page
numbers. Broken Word bookmark messages are removed only within a proven contents list. Source quotations,
form fields, ordinary footnote errors, prefaces and substantive publication-scope footers remain content.
The actual body below an OGN's same-page contents table is retained.

Two layout faults were also corrected. Some Word PDFs aggregate several physical baselines into one raw
line; these are split using character coordinates. A malformed invisible whitespace glyph in Sri Lanka's
July 2020 medical note stretched a line's bounds across neighbouring sentences. Bounds now use visible
characters, restoring the source order on physical page 16. Rotated table headings remain whole. A bordered
table of institutions and training in Rwanda annex 1 remains readable table text when its typeface differs
from the main report; the font difference alone no longer makes long prose a picture.

Source pages were rendered and inspected for South Africa OGN March 2013 (same-page contents and
introduction), Kenya OGN December 2013, Palestine COI May 2012 (alternating dated headers), Kenya COI May
2013 (preface and headers), Nigeria FGM February 2017 (inset footer), Afghanistan women March 2020 (final
contents row), and Rwanda annex 3 (embedded contents and bookmark errors). Their substantive wording was
retained. Sri Lanka medical July 2020, Albania background August 2015 and Rwanda annex 1 were inspected
for sentence order, raised parenthesised footnotes and prose tables.

The audit caught dropped rotated labels in four representative documents during development: Iran
military service April 2020, Albania blood feuds January 2023, Iraq humanitarian situation August 2016,
and Albania's February 2018 fact-finding report. Keeping rotated runs intact resolved every unexplained
word loss in those examples before the final extraction.

## Repeatable audit and validation

`scripts/review_pdf_only.py` checks the original SHA256 and reads the source with PyMuPDF three ways and
independently with Poppler `pdftotext -layout`. It records source phrase coverage, each furniture omission's
page and coordinates, warnings, layout counts, before/after word counts, and words removed outside recorded
furniture. Evidence is in `data/pdf-only-review.json` (method `pdf-only-source-audit-3`).

The scope is 535 distinct pipeline files. Before snapshots exist for 533, including every one of the 532
previously exported PDF editions. Two Afghan pipeline files had already been re-extracted before their
baseline was identified; the report explicitly marks their before readings unavailable. Those two files
are grouped with corresponding web editions rather than exported as separate PDF-only editions.

The final benchmark covers all 164 web/PDF pairs, with zero failures. Neither wording score falls for any
individual pair; four pairs improve slightly. The median, worst tenth and worst values remain unchanged
at the printed precision:

| Extraction diagnostic | Median before / after | Worst tenth before / after | Worst before / after |
|---|---:|---:|---:|
| Web wording found in extraction | 99.63% / 99.63% | 98.89% / 98.89% | 93.34% / 93.34% |
| Extracted wording found on web | 99.65% / 99.65% | 99.05% / 99.05% | 91.71% / 91.71% |

Synthetic regression tests cover same-page contents/body separation, navigation with and without links,
repeated margins, malformed whitespace bounds, multiple physical baselines, rotated labels and bordered
prose tables. The final Python suite passes 276 tests; the unchanged JavaScript suite passes 322 tests.

All 535 original PDF hashes match. The audit reads 9,679,675 derived words; 67 pipeline reading views
change, of which 66 are displayed PDF editions. All 532 previously exported edition identities remain
reachable, including identities retained as aliases when copies are grouped. The final cache check reports
535 files with text and zero without (11 current, 17 withdrawn, 507 recovered).

For the 533 comparable snapshots, source phrase coverage is:

| Source diagnostic | Before | After |
|---|---:|---:|
| Median | 99.6809% | 99.6847% |
| Worst tenth | 99.3391% | 99.3531% |
| Worst | 95.6850% | 95.7350% |
| Best | 99.9781% | 99.9769% |

The lowest three final scores are Sri Lanka medical July 2020 (95.7350%, 42,017 words), Rwanda annex 2
(97.4556%, 92,692 words) and Rwanda annex 1 (97.5696%, 17,148 words). Source pages and relevant passages were
inspected. Annex 2's repeated footnote numbers are discussed below. The Gambia COI January 2014 also loses
839 words of contents and margin furniture: physical page 2 visibly confirms a contents list with paragraph
references, while the substantive scope footer is retained. Its diagnostic falls from 99.3218% to 98.3402%
when matching contents phrases leave the reading view; this is not evidence of a publication change.

Both readers confirm 16,739 navigation omissions, 23,671 page-number omissions, 22,717 contents omissions
and 795 short dated header omissions. For 199 contents lines, their words agree but their column reading
order differs. Three omissions remain automatically unsettled and were checked visually below.

The token-loss check separately records 32 previously plain raised marks rebuilt as references. It only
normalises numeric superscripts whose number has a reconstructed source footnote; other raised words and
unmatched numbers remain text. One automated token-loss flag remains: the numeric label 82 in Yemen's April
2016 security/humanitarian note. Physical page 35 confirms it labels the WFP source footnote. The improved
line bounds separate that note from footnote 81 and reconstruct its reference properly; its complete wording
remains in the reader. No token-loss flag remains unexplained after these
checks. The automated numeric flag is retained rather than silently waived.

The 164 figure extractions finish with 184 retained pictures, one unplaced picture and zero failures.
All seven final contact sheets are byte-identical to the seven sheets visually inspected earlier in this
review. They contain legitimate maps, charts and whole native bitmap material, with no cover logo, stamp,
signature or clipped table fragment. The 164 publication comparisons were recomputed (`webpdf-8`), with
zero failures in 349 seconds; genuine web/PDF differences remain distinct from extraction diagnostics.

Three omissions not confirmed by Poppler were checked visually: Malawi physical page 56 (“Back to
Contents”), Mali SOGI physical page 3 (contents row “3. Policy summary … 7”), and Mali Bellah physical page
3 (contents row “5. Treatment … 8”). Diagonal archive stamps disrupt the independent text reading; all
three visible source passages are furniture. Their automated flags remain in the report, alongside this
manual confirmation.

## Limits

Five-word-phrase coverage diagnoses extraction; it is not a measure of real differences between
publications or proof of an exact transcription. Both readers can share a fault in the embedded text
layer. Source typos, unlocated bookmarks and footnote warnings remain visible. Rwanda annex 2 (UNHCR
evidence) also repeats footnote numbers across its embedded documents: number 60 on physical pages 17
and 58 has distinct source notes, which the existing footnote reconstruction groups under one number.
This remains a known limitation, not a confirmed exact transcription of those notes. The source PDF remains
the authority for quotations, tables and any uncertain passage. The archive catalogue's completeness
claim remains 829/829 listed editions held, not every historical publication ever issued.

The final export, search index and site build complete: 7,905 files, 452 MB. `./cpin verify` confirms
405 stored bodies, 707 PDFs and 682 images match their hashes, with zero integrity/completeness problems.
All 47 current countries, 164 current notes, 175 current PDFs and 408 used web images remain present.
`git diff --check` passes.

The rebuilt reader was checked in Chromium at 1440×900 and 390×844. South Africa's March 2013 edition
retains its introduction, drops the repeated header/contents furniture and links to the correct National
Archives capture. The source panel still explains reconstruction and offers the original PDF. Sri Lanka's
notification/penalty quotation and subsequent immunisation paragraph now remain separate in the actual
reader. Rwanda annex 1's institution/training table renders as text, including the National Human Right
Commission cell. There is no document-width overflow or relevant console error. Screenshots are saved in
`~/Documents/GitHub/outputs/CPIN PDF-only cleanup - desktop.jpg` and the corresponding `mobile.jpg`.
These new changes have not been checked in native Safari or on a physical iPhone. The preview server and
QA tab were closed and scratch output removed after the review.

This work is local on `handover-2026-10-04`. It has not been committed, pushed or deployed.
