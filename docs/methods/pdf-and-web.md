# PDFs and web versions: the standing method

The Home Office publishes each edition of a note twice: a web page and a PDF. This site's text is the web
version, verbatim. The PDF is used for three things: to read an edition that has no web version, to show the
pictures the web version leaves out, and to tell the reader where the two publications say different things.
All three depend on reading PDFs correctly, so each has a check, and the checks are run the same way every time.

This is the procedure. It was worked out on 3 October 2026 (see `docs/reviews/2026-10-03-pdf-text.md` and
`docs/reviews/2026-10-03-pdf-vs-web.md` for the first full run) after a figure of "10% different" turned out to
be our own extraction fault and not a difference between the publications. The rules below exist so that does
not happen again.

## The four commands

| Command | What it does | When |
|---|---|---|
| `./cpin pdftext` | Reads each edition published as a PDF only into `data/pdfs/text/` | every sync (the workflow runs it) |
| `./cpin pdftext --figures` | Finds the pictures a PDF has that the web version of the same edition lacks, and where each belongs | every sync |
| `./cpin compare` | Compares each web version with its PDF and records the real differences | every sync |
| `./cpin pdftext --check` | Measures the extraction against every web version: is our reading of PDFs still good? | before and after any change to `pdftext.py` |
| `./cpin compare --page FILE` | Writes every recorded difference into one page to read through, note by note | when the owner wants to look |

Each keeps a record per PDF, keyed by the PDF's hash, the web body's hash and the version of the method
(`EXTRACTOR` in `pdftext.py`, `METHOD` in `webpdf.py`). A record is redone only when one of those changes, so a
daily run costs nothing unless GOV.UK has published something. `--force` redoes everything.

`./cpin pdftext --sheets DIR` writes every carried-over picture onto numbered contact sheets, for the check by
eye described below.

## Rule 1. Two readings of the PDF, and a difference is real only if both agree

There are two independent readings of a PDF:

- **the extraction** (`pdftext.pdf_to_html`): the PDF laid out like the web version, with headings, paragraphs,
  lists, tables, footnotes and figures;
- **the raw text** (`page.get_text()` straight from PyMuPDF): no layout, no judgement, every character the PDF
  holds, page by page.

The web version is compared with the extraction to *find* places that differ. Each place is then looked up in the
raw text. If the raw text has the web's wording there, the difference is ours (an extraction artefact) and is
not a difference between the publications. Only when the raw text confirms the extraction's wording is it
recorded as real. Nothing is reported to a reader, or to the owner, from the extraction alone.

Each difference gets one of four verdicts (`verdict` in a record): **real** (the raw text confirms it),
**artefact** (ours), **moved** (the same words in another place: a table read across or down), or
**unresolved** (the raw text settles it neither way, or the second reader below disputes it: counted and
listed, never reported as real; 38 small cases on 4 October 2026).

The raw text is read three ways, because one reading alone misleads: as it comes; with raised footnote numbers
taken out; and with the body text run on across page ends (a paragraph cut by a page end has that page's
footnotes sitting in the middle of it).

**And a second reader.** The extraction and the raw text both come from one program (PyMuPDF). Where that program
misreads a PDF, its two readings agree with each other, and a "difference" would be confirmed that is not in the
document. So every difference of wording is also put to a second program that shares no code with the first:
poppler's `pdftotext`. Each gets `second` in its record: `agrees` (it reads the PDF as our extraction does),
`cannot tell`, or `disputes` (it reads the PDF the way the web has it). A disputed difference is left
**unresolved** and is not reported as real. The test needs the words both versions share on *both* sides of the
difference: with one side only, a version that merely lacks the words would always seem to be confirmed. `pdftotext`
must be installed (`brew install poppler`; the workflow installs `poppler-utils`); without it the run says so and
no difference carries a second opinion.

What a second reader cannot settle: a PDF whose own text layer is wrong for every reader. Arabic is the case met:
the letters of a lam-alef come out reversed ("خالل" for "خلال") in both programs. Such text is not compared as
wording (`arabic letters`, under Form).

## Rule 2. Say what kind of difference it is

A number for "how different" means nothing until these are kept apart:

| Kind (`group` in a record) | What it is | Counted as a wording difference? |
|---|---|---|
| Wording (`wording`) | words in one version and not the other, or changed: in the text, a heading, a footnote, the bibliography, a table cell, a "Section updated" line | yes: this is the figure that matters |
| Numbering (`numbering`) | a paragraph or section numbered differently, or not numbered on the web | no; reported on its own (it changes what a citation points at) |
| Picture-related (`picture`) | words the web adds in place of a picture: a table of a chart's numbers, a sentence describing a map, an email typed out, a caption, a name or link after a lead-in ending in a colon | no |
| Withheld sections (`withheld`) | the "information removed" notice, which the PDF repeats per paragraph and the web prints once | no |
| Addresses shown as text (`address`) | a link's address or an email address printed on one side only | no |
| Form (`form`) | list markers, spacing, a lost ligature, how a number is written, stray characters; a label one version repeats (the "Name:" before every entry, a table's heading row set again on each page of the PDF); Arabic letters | no |
| Furniture (`furniture`) | a stray "Back to Contents", GOV.UK's "(PDF, 173KB)" labels, the version line. The PDF's cover, contents list and page numbers never reach the comparison | no: never content |
| Typography | quotation marks, dashes, kinds of space, capital letters: taken out before comparing | no |
| Order (verdict `moved`) | the same words in another place | no |
| Ours (verdict `artefact`) | anything the raw text shows to be an extraction artefact | never: it is a fault to fix |

Signs that the page and the PDF are **different drafts under one version number** are listed for each note
(`summary.drafts`): passages on both sides that the other lacks, a different footnote count, a "Section updated"
date or a year that differs. They are named in every run's output.

**Paragraph numbers.** Each record maps the web version's paragraph numbers to the PDF's
(`paragraphs`): `same` and `web_unnumbered` (counts), `different` (web number to PDF number),
`pdf_unnumbered`, `repeated` and `unconfirmed` (lists of web numbers). A citation gives a PDF number only from `different`, and a pair
is kept there only when the second reader finds the PDF's number straight before the paragraph's opening words.
A web number the web version uses for more than one paragraph (`repeated`: 199 numbers in 63 of 164 notes on
4 October 2026) is never mapped, because the number does not say which paragraph is meant; the citation then
gives the web number as printed, names the section it is under, and gives no PDF number.

## Rule 3. Report a range with real word counts, and look at the outliers

The standard table, which `./cpin compare` prints and every write-up uses:

- genuine wording differences as a share of a note's words: **best, middle note (median), worst tenth, worst**,
  each with its number of words;
- how many notes are at or over 0.5% and 1%;
- every note at or over 0.5%, or with a real difference of four words or more inside the Assessment or Executive
  summary, named, with what the difference is.

Never report a single figure, a mean alone, or a percentage without the words behind it. Before any figure goes
to the owner, the three worst notes are opened and their largest differences read against the PDF itself. On
4 October 2026 (method `webpdf-7`, 164 notes) the result was: best 0, median 0.009% (7 words), worst tenth
0.151% (69 words), worst 4.4% (2,059 words: Vietnam, unaccompanied children, where the web page labelled
version 3.0 still carries version 2.0's text); 53 notes with no difference of wording at all; 3 notes at or
over 0.5%.

**Small differences get the same care as large ones.** A one-word difference is where a misreading of ours is
most likely to pass for a typing slip of the Home Office's. On 4 October 2026 the 408 differences of three words
or fewer were each put to the second reader. 13 were ours (a three-column list read in the wrong order, and the
order of a bibliography) and are no longer counted; about 115 were not wording at all (Arabic letters the PDF's
own text layer holds in the wrong order, a label one version repeats, a name standing in for a picture) and
moved to Form or Picture-related. Of the 292 left, the second reader agrees with 222 and cannot tell for 70,
most of them in or beside tables. `./cpin compare` prints this breakdown on every run.

## Rule 4. Changing the extractor

1. Run `./cpin pdftext --check` first and keep its output.
2. Make the change, with a test in `tests/test_pdftext.py` built from a PDF made on the spot (never a real note).
3. Bump `EXTRACTOR` if the output for the same PDF can change. Stored extractions and records are then redone.
4. Run `./cpin pdftext --force`, `./cpin pdftext --figures`, `./cpin compare` and `./cpin pdftext --check` again.
5. The check must not get worse: the median and the worst tenth of "the web version's wording found in the
   extraction" stay the same or rise, and no pair fails. A drop is explained or the change is undone.
6. Run `./cpin pdftext --sheets DIR` and look at every sheet (rule 5).
7. Write what changed and the before and after figures into a dated file in `docs/reviews/`.

The check's five-word-phrase score is a test of the *extractor*. It cannot tell a real difference from an
artefact and is never quoted as a difference between the publications; that is what `./cpin compare` is for.

### Editions with no corresponding web publication

Run `.venv/bin/python scripts/review_pdf_only.py` after extracting them. It checks every current, withdrawn
and recovered PDF-only file, validates its original SHA256, and compares the derived reader text with the
raw text read three ways and Poppler's independent reading. It requires `pdftotext`, retains page furniture
in that second reading, and writes the per-PDF evidence to `data/pdf-only-review.json`.

Before a cleanup, copy the existing HTML extractions to a separate directory and pass it as `--before DIR`.
The audit then records before/after word counts, phrase coverage, and words removed outside the recorded
furniture. Numeric raised marks with corresponding reconstructed source notes are normalised only for
that token-loss check, with rebuilt marks recorded separately; the stored reading text is not changed by
the audit. An unavailable snapshot is explicitly marked; it never becomes a claim of no change.

`pdftext-6` records each omission's kind, text, page and coordinates in `omitted_furniture`. Contents,
navigation, page numbers and short dated running headers are kept separate. Contents references can be
page numbers, paragraph numbers or Word's broken bookmark messages. References in separate columns require
an explicit contents title, and the actual body below a same-page contents table is retained. An inline
“Back to Contents” suffix is removed only when the PDF links it internally. Source quotations, blank form
fields, ordinary body wording and substantive footer notices remain content.

Raw PDF runs spanning several physical lines are split by the characters' baseline coordinates before
joining adjacent runs. This prevents a tall aggregate bounding box from mixing successive sentences.
Vertical bounds use visible characters: malformed whitespace glyphs can otherwise stretch across several
sentences. Rotated table labels remain whole rather than being split into horizontal baselines.
Long prose inside a bordered table is retained as table text when an annex uses a different typeface;
the font difference alone is not enough to call it a chart. Raised parenthesised footnote marks are
normalised in the audit's no-mark and flowing source readings, while its raw page text stays untouched.

Check every unsettled omission and inspect the largest changes and worst phrase-coverage cases against
rendered source pages. Contents columns can have the same words in a different order: this is recorded
separately, never as confirmation of publication wording. Phrase coverage is a diagnostic of the reader,
not proof of an exact transcription. Footnote and bookmark warnings remain visible; errors in the PDF's own
text layer can affect both programs. The original PDF and any stored web body must remain unchanged.

## Rule 5. Pictures carried over to a web edition

The reader shows a PDF's picture beside the web text only when all of these hold; otherwise it stays in the PDF:

- it is one of the PDF's **surplus**: the number shown for a note is never more than the PDF's pictures minus the
  web version's (the two are aligned block by block, and a web picture set a little earlier or later accounts
  for the PDF's);
- it is not on the **cover** (that picture is the department's logo, which this site never shows) and not before
  the first bookmark (a funder's emblem);
- it is at least 150 pixels (75 points) in each direction (smaller is a logo, a stamp or a signature);
- it holds no more than 250 characters of real text (more is a table or a panel of text drawn with shading,
  which the web version gives as text);
- its place is confirmed twice: when the data is built (after the web block that opens like the paragraph
  introducing it) and again in the page (`shared/pdf-figures.js` checks the block's opening words before placing
  it). A picture whose place cannot be confirmed is not shown.

It is display only: marked "From the PDF", linked to its page of the PDF, outside the text a reader can select,
save or cite. After any change to these rules or to the extractor, look over the contact sheets
(`./cpin pdftext --sheets DIR`): there must be no logo, signature, stamp or piece of a table among them.

## Rule 6. What the reader is told

- An edition read from a PDF is marked "From the PDF", never "Verbatim" (AGENTS.md rule 5).
- A picture from the PDF is marked "From the PDF".
- Where the web version and the PDF really differ, the report says so and lists the places.
- A citation names the publication it is from ("web version" or "PDF version").
- Neither version is presented as the authoritative one: the Home Office has not said which is.

## Where things live

| What | Where | Committed? |
|---|---|---|
| The PDFs | `data/pdfs/files/` | no (R2) |
| Text of PDF-only editions and all rendered pictures | `data/pdfs/text/`, `data/pdfs/text/images/` | yes |
| Which pictures go where in a web edition | `data/pdfs/figures/<pdf sha256>.json` | yes |
| Real differences, web against PDF | `data/pdfs/compare/<pdf sha256>.json` | yes |
| Last run of the extraction check | `data/pdftext-check.json` | no |
| Write-ups, dated | `docs/reviews/` | yes |

## Decided by the owner (3 and 4 October 2026)

- The report page says where its web version and PDF differ: a "PDF differs" chip in the report's head opens the
  list, largest first, each with the words round it and a link to the page of the PDF
  (`prototypes/reader/pdf-differences.js`).
- A citation says which publication it is from, "web version" by default, and gives the PDF's paragraph number
  beside the web's where they differ (`prototypes/shared/citation.js`: `pdfPinpoint`).
- Everything recorded can be read through in one page: `./cpin compare --page FILE`.

## Open question

- Which version to quote from where they differ. Where they do, the PDF is fuller in 65 notes and the web in 36;
  the web is fuller mainly where it repeats itself or spells out a picture.
