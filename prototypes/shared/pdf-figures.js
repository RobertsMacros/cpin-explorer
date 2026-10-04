// CPIN Explorer · pictures that a note's PDF has and GOV.UK's web version of the same edition leaves out
// (maps, charts), shown where they belong in the web text. Display only: each is a <figure class="pdf-fig">
// set beside the published text, marked "From the PDF" and linked to its page of the PDF. The reader's text
// index skips it (reader.js: SKIP_UI) and its caption cannot be selected, so the text a reader selects,
// saves or cites is still GOV.UK's own, character for character.
//
// Where each picture goes is worked out when the data is built (src/cpin/pdftext.py:
// figures_missing_from_web): after the n-th element of a tag in the body, with the start of that element's
// text as a check (`key`). A picture whose place cannot be confirmed here is not shown: none is better than
// one beside the wrong paragraph.
//
//   figureKey(text)                        a block's text as the key is made: lower case, letters and digits only
//   anchorIndex(keyAt, count, figure)      which element a picture goes after, or -1 (pure; tested)
//   placePdfFigures(root, spec, images)    adds the figures to a parsed body; returns how many were placed

export const figureKey = (text) => String(text ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");

const NEAR = 40;          // how far from its recorded place a picture's block is looked for
const SURE = 16;          // ... and how long a key must be to be trusted away from that place

/**
 * Which of a tag's elements a picture goes after.
 *   keyAt(i)   the key of the i-th element of the tag (figureKey of its own text), or "" when there is none
 *   count      how many elements of the tag there are
 *   figure     { index, key } as recorded
 * The recorded element when its text opens with the key. Else (the browser read the markup a little
 * differently from the builder) the nearest element that does, if the key is long enough to tell blocks
 * apart. Else -1.
 */
export function anchorIndex(keyAt, count, { index, key }) {
  if (!key || !(index >= 0)) return -1;
  const fits = (i) => i >= 0 && i < count && keyAt(i).startsWith(key);
  if (fits(index)) return index;
  if (key.length < SURE) return -1;
  for (let d = 1; d <= NEAR; d++) {
    if (fits(index - d)) return index - d;
    if (fits(index + d)) return index + d;
  }
  return -1;
}

/** A block's own text as the builder reads it: footnote marks left out, and for a list item its nested lists. */
function ownText(el) {
  const copy = el.cloneNode(true);
  copy.querySelectorAll(`sup[id^="fnref"]${el.tagName === "LI" ? ", ul, ol" : ""}`).forEach((x) => x.remove());
  return copy.textContent;
}

/**
 * Add an edition's PDF-only pictures to its parsed body, before any other presentation.
 *   root     the body (an element holding GOV.UK's markup as published)
 *   spec     the edition's `pdf_figures`: { pdf_url, figures: [{ src, tag, index, key, page }] }
 *   images   the series' image map (`pdf-image:<name>` -> where the picture is)
 * Returns the number placed.
 */
export function placePdfFigures(root, spec, images = {}) {
  const figures = spec?.figures || [];
  if (!figures.length) return 0;
  const doc = root.ownerDocument, lists = new Map(), keys = new Map();
  const all = (tag) => lists.get(tag) || lists.set(tag, [...root.querySelectorAll(tag)]).get(tag);
  const keyAt = (tag) => (i) => {
    const id = `${tag}:${i}`;
    if (!keys.has(id)) keys.set(id, figureKey(ownText(all(tag)[i])));
    return keys.get(id);
  };
  // Every place is found on the body as published; only then is anything added.
  const plan = [];
  for (const f of figures) {
    if (!/^(p|li|h[2-5])$/.test(f.tag || "") || !images[f.src]) continue;
    const at = anchorIndex(keyAt(f.tag), all(f.tag).length, f);
    if (at >= 0) plan.push({ f, anchor: all(f.tag)[at] });
  }
  const last = new Map();                    // several pictures after one block keep the PDF's order
  for (const { f, anchor } of plan) {
    const fig = doc.createElement("figure");
    fig.className = "pdf-fig";
    const img = doc.createElement("img");
    img.setAttribute("src", images[f.src]);
    img.setAttribute("alt", f.page ? `Picture from page ${f.page} of the PDF` : "Picture from the PDF");
    img.dataset.pdfImage = f.src;
    const cap = doc.createElement("figcaption");
    const tag = doc.createElement("span");
    tag.className = "tag tag--outline";
    tag.textContent = "From the PDF";
    tag.title = "GOV.UK's web version of this edition leaves this picture out. It is taken from the PDF of the same edition; the text around it is the web version's.";
    cap.append(tag);
    if (spec.pdf_url) {
      const a = doc.createElement("a");
      a.href = f.page ? `${spec.pdf_url}#page=${f.page}` : spec.pdf_url;
      a.textContent = f.page ? `Page ${f.page} of the PDF` : "Open the PDF";
      cap.append(" ", a);
    }
    fig.append(img, cap);
    const before = last.get(anchor);
    if (before) before.after(fig);
    else if (anchor.tagName === "LI") {
      const nested = [...anchor.children].find((c) => c.tagName === "UL" || c.tagName === "OL");
      if (nested) anchor.insertBefore(fig, nested); else anchor.append(fig);
    } else anchor.after(fig);
    last.set(anchor, fig);
  }
  return plan.length;
}
