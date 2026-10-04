// What a report's page says about the PDF of the edition shown. The Home Office publishes each edition as
// a web page and as a PDF, and the two are not always the same text (docs/methods/pdf-and-web.md). The
// words on this site are the web version's; where the PDF really differs, the page says so and lists the
// places. The data is the export's `pdf_compare` for the edition (src/cpin/webpdf.py: every difference
// there was confirmed against the PDF's own text). Nothing here changes the text of the note.
//
//   differsChip(cmp)              what the chip says, or null when there is nothing to say
//   differsPanel(cmp, { esc })    the panel it opens, as HTML

const SHOWN = 8;                 // differences listed in the panel, largest first (the rest are counted)
const QUOTED = 220;              // characters of each difference's words shown in the panel

const words = (n) => `${n.toLocaleString("en-GB")} ${n === 1 ? "word" : "words"}`;
const places = (n) => `${n.toLocaleString("en-GB")} ${n === 1 ? "place" : "places"}`;
const cut = (s) => (s.length <= QUOTED ? s : `${s.slice(0, QUOTED).trimEnd()} …`);

/** The paragraphs the PDF numbers differently or not at all, as a count. */
export const renumbered = (cmp) => Object.keys(cmp?.numbering?.different || {}).length + (cmp?.numbering?.pdf_unnumbered || []).length;

/**
 * What the chip in the report's head says: { label, count, flagged, title }, or null when the web version and
 * the PDF do not differ in wording, numbering or any sign of being different drafts.
 * flagged: a note to read (wording differs by 0.5% or more, or a passage differs in the Executive summary
 * or Assessment).
 */
export function differsChip(cmp) {
  if (!cmp) return null;
  const n = cmp.wording?.differences || 0, renum = renumbered(cmp), drafts = cmp.drafts?.length || 0;
  if (!n && !renum && !drafts) return null;
  const label = n || drafts ? "PDF differs" : "PDF numbered differently";
  const count = n || renum;
  const title = n
    ? `The PDF of this edition differs from the web version in ${places(n)}: ${words(cmp.wording.web_words)} only here, ${words(cmp.wording.pdf_words)} only in the PDF`
    : renum ? `The PDF of this edition numbers ${renum.toLocaleString("en-GB")} ${renum === 1 ? "paragraph" : "paragraphs"} differently`
      : "The PDF of this edition shows signs of being a different draft";
  return { label, count, flagged: !!cmp.flagged, title };
}

/** One side's words, in bold, with the few words round them that both versions share: a single word means
 *  little out of its sentence. A side that lacks the words shows the join. */
function around(d, text, esc, lead = d.before) {
  const tidy = (s) => String(s || "").replace(/\s+/g, " ").trim();
  const before = tidy(lead).split(" ").slice(-6).join(" "), after = tidy(d.after).split(" ").slice(0, 6).join(" ");
  return `<span class="pd-ctx">${before ? `… ${esc(before)} ` : ""}</span>${text ? `<b>${esc(cut(text))}</b>` : `<b class="pd-none">[nothing here]</b>`}<span class="pd-ctx">${after ? ` ${esc(after)} …` : ""}</span>`;
}

/** Where a difference is, in words: "Assessment · para 4.3.4 · PDF page 11". */
export function placeOf(d) {
  const w = d.where || {};
  return [w.section, w.paragraph ? `para ${w.paragraph}` : "", w.page ? `PDF page ${w.page}` : ""].filter(Boolean).join(" · ");
}

/** Which side has the words: "only in the PDF", "only here" or "worded differently". */
export function sideOf(d) {
  if (d.web_words && d.pdf_words) return "worded differently";
  return d.pdf_words ? `${words(d.pdf_words)} only in the PDF` : `${words(d.web_words)} only here`;
}

/**
 * The panel, as HTML: what differs and by how much, any signs of different drafts, the numbering, and the
 * largest differences, each a button that goes to its place in the text (data-pdf-diff: its index in
 * cmp.differences).
 */
export function differsPanel(cmp, { esc }) {
  const w = cmp.wording || { differences: 0, web_words: 0, pdf_words: 0 };
  const renum = renumbered(cmp), twice = (cmp.numbering?.repeated || []).length;
  const list = (cmp.differences || []).slice(0, SHOWN);
  const more = (w.differences || 0) - list.length;
  const pdfAt = (d) => (d.where?.page ? `${cmp.pdf_url}#page=${d.where.page}` : cmp.pdf_url);
  return `<p class="hpop-head"><span class="tag tag--outline">PDF</span><span>Where the PDF of this edition differs</span></p>
    <p>The Home Office publishes this edition as a web page and as a PDF. The words on this page are the web version’s, word for word.${
      w.differences ? ` The PDF differs in <b>${places(w.differences)}</b>: ${words(w.web_words)} only here, ${words(w.pdf_words)} only in the PDF.` : " Their wording is the same."}</p>
    ${cmp.drafts?.length ? `<p class="hpop-kv"><span class="eyebrow">Signs of different drafts</span><span>${cmp.drafts.map(esc).join("; ")}</span></p>` : ""}
    ${renum ? `<p>${renum.toLocaleString("en-GB")} ${renum === 1 ? "paragraph is" : "paragraphs are"} numbered differently in the PDF. A citation made here gives the web version’s number, and the PDF’s beside it where they differ.</p>` : ""}
    ${twice ? `<p>The web version uses ${twice.toLocaleString("en-GB")} paragraph ${twice === 1 ? "number" : "numbers"} more than once. A citation to one of those gives the number as printed here and no PDF number: check the PDF.</p>` : ""}
    ${list.length ? `<ol class="pd-list">${list.map((d, i) => `<li><button type="button" class="pd-go" data-pdf-diff="${i}"><span class="pd-where">${esc(placeOf(d))}</span><span class="pd-side">${esc(sideOf(d))}</span></button>
      <p class="pd-words"><span class="eyebrow">Here</span><span>${around(d, d.web, esc)}</span></p>
      <p class="pd-words pd-words--pdf"><span class="eyebrow">PDF</span><span>${around(d, d.pdf, esc, d.before_pdf ?? d.before)} <a href="${esc(pdfAt(d))}" target="_blank" rel="noopener">open ↗</a></span></p></li>`).join("")}</ol>` : ""}
    ${more > 0 ? `<p class="hpop-note">And ${more.toLocaleString("en-GB")} smaller ${more === 1 ? "difference" : "differences"}.</p>` : ""}
    <p class="hpop-note">Each difference was confirmed against the PDF’s own text. Neither version is the authoritative one: check both where it matters. <a href="${esc(cmp.pdf_url)}" target="_blank" rel="noopener">Open the PDF ↗</a></p>`;
}
