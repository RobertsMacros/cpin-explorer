# Review integration and 2020-onwards backfill, 5 October 2026

The owner requested existing published reviews first, improved Syria source
availability, and a backfill from **1 January 2020**, with manageable review batches
and a cost estimate. This is a held-edition backfill, not a claim that every
published edition or every contradiction has been found.

## Review integration

All **44 curated publications** are now reachable in country footnote overlays.
Previously only the 11 exact edition associations were exposed there. Exact
edition contexts remain separate from country background; corrigenda, related
publication and response links are retained. Background arguments have not been
independently assessed or mapped to citations. Displaying a review never assigns
a flag or a human checked tick.

Five further interactive Syria checks compare the March 2025 EUAA *Country Focus*
with current-edition citation uses: Kurds paragraphs 10.1.14/footnote 71,
13.1.5/142 and 17.1.16/328; military-service paragraph 9.1.1/footnotes 22 and 23.
The narrow wording/attribution checks found no issue. Printed pages 50, 46, 89,
26 and 23 are physical PDF pages 51, 47, 90, 27 and 24. Raw PyMuPDF and independent
pdftotext agree on the relevant prose; layout/footer order differ. These do not
establish the truth of underlying reporting, soldiers' actual safety, the scope
of an amnesty or the correctness of the whole assessment. They stay grey.
There are now **seven scoped Syria AI citation checks**, including the earlier
minor citation-link mismatch. Exhaustive Syria/corpus analysis remains pending.

## Syria: comparable access figures

Three exact EUAA report copies were matched to 67 citations: October 2024 (3),
July 2025 (33) and March 2025 (31). Title/date on physical cover page 1 was checked
with two PDF readers; held bytes match their SHA256 hashes. Two copies were already
held; the named official March 2025 PDF was fetched through the existing polite
client. Original publication URLs were not retried through a refusal workaround.

| Held scope | Footnotes | All original linked text | Including checked report copies |
| --- | ---: | ---: | ---: |
| Syria since 2023, same original pilot | 3,055 | 2,149 (70.3%) | 2,216 (72.5%) |
| Syria since 2020 | 3,394 | 2,330 (68.6%) | 2,397 (70.6%) |

The second measure accepts only exact edition/text/footnote/source mappings with
a hash-checked held copy. Neither measure checks claim correctness. The overlay
offers “Matching report PDF” with this distinction; full source text stays private.
The original pilot is preserved so widening the date range cannot inflate its
percentage. Remaining access/mapping gaps remain unresolved.

## Corpus backfill and queues

The inventory covers **52 held countries including former countries, 268 report
series, 485 editions, 84,612 footnotes, 120,137 claim/direct-link blocks and 33,061
distinct primary URLs**. Four 2024 editions lacking metadata dates were included
from their publication lines/covers using exact hash-bound evidence. The Sudan
2018 FFM was excluded by its printed publication date. Two undated notice or
collection records remain excluded, with explicit inventory diagnostics.

Cache reuse needed no network or AI calls and hard-links immutable objects. A
bounded follow-up tried 107 newly discovered source/download addresses, retaining
40 responses and recording 63 robots restrictions, two missing addresses, one
refusal and one unsafe address. One subsequently discovered PDF address also
returned a robots restriction. It did not duplicate addresses pending in the
existing global job. The snapshot has **35,284 primary/explicit download URLs,
22,112 captured responses, 21,181 distinct hash-checked objects and zero hash/storage
issues**. There are **25 pending download outcomes**, reserved for the still
running one-off global job. This is not complete retrieval; inaccessible outcomes
remain gaps even when a request has completed.

At original addresses, 44,063 footnotes have all linked source text (52.1%), 16 have
some, 34,381 have none and 6,152 have no HTTP source address. Some bibliography
entries contain multiple citations; unreferenced entries are not automatically
turned into claims. There are 372 unreferenced footnotes, one duplicate ID,
28 invalid links and 16 uncertain printed URL boundaries. Missing footnote
references: zero. These diagnostics are review work, not silently repaired text.

Private queue: `data/source-evidence/since-2020/analysis-queue.jsonl`; manifest,
CSV/URL lists, receipt journal, quality checks and hash audit are alongside it.
The queue has 24,032 claim blocks with sources available and usable anchors,
19,393 needing source evidence and 76,712 needing reliable citation anchors
(including unnumbered quotations, introductory and bibliography blocks). These
are preparation states; none is a bulk completed review. Exact whole-report
review IDs and separately labelled background IDs accompany each edition.
Five new public checks above remain scoped citation results, not full claim-block
approval. No paid API, AI service, recurring scrape or automatic flags were enabled.

An empty saved HTML response previously interrupted linked-PDF discovery; this is
fixed and covered by a regression fixture. Tests also cover successful cache
retention after refusal, exact-address separation, date/hash mismatch, stale or
corrupt copy rejection and absence of automatic approval. All **322 Python and
338 JavaScript tests** pass; canonical integrity/completeness passes. Desktop
1280px and 390px Chromium checks cover country background and matching-PDF links.
Wrangler dry run passes. Native Edge/iPhone remains unchecked.

See the [batch method and cost illustration](../methods/source-review-batches.md).

## Publication and live verification

Owner-authorised main revision `2f847e8` was pushed and deployed using the existing
local Wrangler login. Cloudflare version `07657e95-d4af-4c78-8e5b-dac95136cf0d`
serves 100% of traffic. Live Chromium at 1280×900 and 390×844 verifies background
reviews, matching-report PDFs, scoped AI comments and physical-page links without
console errors or horizontal overflow. No AI green tick appears. Reader JS,
shared review JS, the directory, source-copy registry and published findings are
byte-identical to the local build. Private source/review evidence URLs return 404.
[GitHub validation](https://github.com/RobertsMacros/cpin-explorer/actions/runs/37357658177)
passed for this code revision, including tests, retained-data verification and the
offline export. Its deploy job was skipped. GitHub's Cloudflare secrets remain
missing; this manual publication does not enable
automatic republishing. No source bodies or private notes were deployed.
