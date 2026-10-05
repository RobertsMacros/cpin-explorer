# PDF extraction review, 4 October 2026

`pdftext-3` removes withdrawn/archived cover material and watermarks from derived reading views without
changing stored source bodies or PDF files. The complete extraction, figure and comparison pipeline passed.
The 164 paired extraction checks retained their wording scores. Text read from a PDF remains labelled
“From the PDF”; it is a reconstruction of the text layer, with no OCR or language model.

## Change and verification

Some withdrawn PDFs have a withdrawal sheet before the original cover. The extractor now locates the actual
cover from its heading and bookmarks, excludes the cover and any earlier front matter, and excludes pictures
before the first bookmark. It also excludes large diagonal text whose entire wording is “Archived” or
“Withdrawn”. Horizontal occurrences remain content. Synthetic PDFs test both cases; `EXTRACTOR` changed
from `pdftext-2` to `pdftext-3`.

The standing method in `docs/methods/pdf-and-web.md` was followed in this order:

1. `./cpin pdftext --check` before edits: 164 pairs, no failures; output retained in `/tmp/cpin-pdftext-before.log`
   and `/tmp/cpin-pdftext-before.json`.
2. Synthetic tests, then `./cpin pdftext --force`: 395 extractions, comprising 11 current PDF-only editions,
   17 withdrawn editions and 367 recovered archive jobs; none without extracted text.
3. `./cpin pdftext --figures`: 164 pairs, 184 retained pictures, one unplaced picture and no failed pairs.
4. `./cpin compare`: all 164 pairs recomputed, no failures, 298 seconds, method `webpdf-8`.
5. `./cpin pdftext --check`: 164 pairs, no failures.
6. `./cpin pdftext --sheets /tmp/cpin-sheets`: all seven generated contact sheets inspected.

The archive job count precedes display deduplication: the exported histories contain 364 archived PDF
editions. Cached records and every retained PDF retain their content identity and provenance.

## Before and after extraction scores

These are five-word-phrase extraction scores, not differences between the publications. Each figure below
is unchanged by the edit; the percentages are rounded from the per-pair results.

| Score | Median before / after | Worst tenth before / after | Worst before / after |
|---|---:|---:|---:|
| Web wording found in extraction | 99.625% / 99.625% | 98.89% / 98.89% | 93.34% / 93.34% |
| Extracted wording found on web | 99.645% / 99.645% | 99.05% / 99.05% | 91.71% / 91.71% |

All wording and structure results are unchanged. Two figure counts changed from one to zero: Albania's
January 2023 blood-feuds fact-finding report and the Philippines' February 2023 domestic-violence
fact-finding report. The excluded pictures were front-matter emblems; the check JSON is therefore not
byte-identical to the earlier result.

The contact sheets contain maps, charts and legitimate native bitmap material, including whole table or
email images. No departmental cover logo, stamp, handwritten signature or clipped table fragment was seen.
This is a check of pictures actually carried over, not a claim that every image contains no words. Source
images can have text embedded in their pixels; quotations continue to exclude them.

## Publication comparison

The comparison covers 3,858,279 web words and 3,849,172 PDF words. Differences of wording are confirmed
against raw PDF text and put to Poppler's independent `pdftotext` reader. Other kinds are counted separately.

| Position | Real wording difference | Words on the two sides combined |
|---|---:|---:|
| Best | 0% | 0 |
| Median | 0.009% | 7 |
| Worst tenth | 0.151% | 69 |
| Worst | 4.424% | 2,059 |

53 notes have no recorded wording difference; three reach 0.5%, and two reach 1%. Seventeen meet the review
threshold of 0.5% or at least four differing words in an Assessment or Executive summary. They remain listed
in the generated comparison report, with contexts and PDF page links.

| Kind of confirmed difference | Web-only words | PDF-only words | Notes affected |
|---|---:|---:|---:|
| Wording | 2,653 | 3,694 | 111 |
| Numbering | 592 | 2,168 | 74 |
| Picture-related | 12,755 | 16 | 64 |
| Withheld notices | 53 | 2,668 | 35 |
| Addresses shown as text | 337 | 524 | 60 |
| Form | 387 | 631 | 77 |
| Furniture | 28 | 108 | 30 |

There are 856 extraction artefacts totalling 3,720 words, 30 moved passages and 38 unresolved cases totalling
225 words. These are not counted as real wording differences. The second reader agrees with 421 wording
differences, cannot settle 195 and disputes 13; disputed cases remain unresolved.

## Three worst cases inspected

Each was checked against raw source text and a rendered source PDF page, following the standing method:

- Vietnam, unaccompanied children, July 2024: 4.424%, 654 web-only and 1,405 PDF-only words. PDF page 39's
  UNICEF passage differs from the web wording; this corroborates the earlier review's finding that the
  web page retains an older draft under the later version number.
- Iraq, religious minorities, September 2024: 1.12%, 822 web-only and 17 PDF-only words. The web repeats
  paragraphs 3.1.9–3.1.14; PDF page 9 gives them once. The repeated passage accounts for 811 web words.
- Iraq, blood feuds, honour crimes and tribal violence, July 2024: 0.51%, 20 web-only and 263 PDF-only
  words. PDF pages 11–12 include paragraphs 4.3.4–4.3.8 that the web omits.

The owner still needs to choose which publication to quote where the two differ. Neither is presented as
authoritative. A shared defect in a PDF's text layer can affect both readers, and table layout and image text
remain limitations; the comparison and extraction scores do not establish an exact transcription.
