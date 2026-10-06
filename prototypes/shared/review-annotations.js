// Display annotations are separate from the canonical article. An edition and
// its body hash must match; an ambiguous passage stays in the report panel.
import { httpUrl, reviewStatus } from "./source-reviews.js";
import { SITE_TAGS } from "./highlights.js";
import { describePassage } from "./note-source.js";
const identity = ["country", "series", "editionId", "textSha"];
export const normalise = (s) => String(s || "").replace(/\s+/g, " ").trim();
const urlKey = (s) => httpUrl(s).split("#")[0];
export function sameEdition(a, b) {
  return /^[a-f0-9]{16,64}$/.test(a?.editionId || "") && /^[a-f0-9]{64}$/.test(a?.textSha || "")
    && identity.every((k) => a[k] && a[k] === b?.[k]);
}
export function editionRecords(records, edition) {
  return records.filter((r) => ["ai", "external"].includes(r?.kind)
    && (r.targets || (r.target ? [r.target] : [])).some((t) => sameEdition(t, edition)));
}
export function anchorsFor(record, edition) {
  return (record.targets || (record.target ? [record.target] : []))
    .filter((t) => sameEdition(t, edition)).flatMap((t) => t.anchors || (t.anchor ? [t.anchor] : t.footnote ? [{
      type: "footnote", footnote: t.footnote, paragraph: t.paragraph, section: t.section, sourceUrl: t.sourceUrl,
    }] : []));
}
export function resolveAnchor(anchor, candidates) {
  if (!["paragraph", "sentence", "section", "footnote", "link"].includes(anchor?.type)) return null;
  // Verbatim contextual text is compulsory except for a fully scoped legacy
  // footnote record. Never anchor on a paragraph number alone.
  const quote = normalise(anchor.quote);
  if (!quote && !(anchor.type === "footnote" && anchor.paragraph && anchor.section && httpUrl(anchor.sourceUrl))) return null;
  const found = candidates.filter((c) => c.type === anchor.type
    && (!anchor.paragraph || c.paragraph === anchor.paragraph)
    && (!anchor.section || normalise(c.section) === normalise(anchor.section))
    && (!anchor.footnote || c.footnote === anchor.footnote)
    && (!anchor.sourceUrl || (c.sourceUrls || []).some((u) => urlKey(u) === urlKey(anchor.sourceUrl)))
    && (!quote || normalise(c.text).includes(quote)));
  return found.length === 1 ? found[0] : null;
}
export function markerLabel(records) {
  return `${reviewStatus(records).label} · ${records.length} review ${records.length === 1 ? "entry" : "entries"}`;
}

export function decorateAnnotations(root, analysis, edition, records, document = root.ownerDocument) {
  root.querySelectorAll(".review-marker").forEach((el) => el.remove());
  const scoped = editionRecords(records, edition).filter((r) => anchorsFor(r, edition).length);
  if (!scoped.length) return new Map();
  const textOf = (el) => {
    const walker = document.createTreeWalker(el, 5, { acceptNode: (n) => n.nodeType === 3 ? 1
      : SITE_TAGS.some((c) => n.classList.contains(c)) ? 2 : 3 });
    let text = ""; for (let n = walker.nextNode(); n; n = walker.nextNode()) text += n.data;
    return text;
  };
  const sectionOf = (el) => {
    let section = "";
    for (const s of analysis.sections) {
      if (s.el === el || (s.el.compareDocumentPosition(el) & 4)) section = s.title;
    }
    return section;
  };
  const paragraphOf = (el) => analysis.paras.find((p) => p.el === el || p.el.contains(el))?.num || "";
  const candidates = analysis.paras.map((p) => ({ type: "paragraph", el: p.el, paragraph: p.num, section: sectionOf(p.el), text: textOf(p.el) }));
  for (const el of root.querySelectorAll("p")) candidates.push({ type: "sentence", el, paragraph: paragraphOf(el), section: sectionOf(el), text: textOf(el) });
  for (const el of root.querySelectorAll("h2, h3, h4")) candidates.push({ type: "section", el, section: textOf(el), text: textOf(el) });
  for (const ref of analysis.refs) {
    const p = ref.a.closest("p, li") || ref.a.parentElement;
    const context = describePassage(analysis, ref.at, ref.at + 1);
    const start = analysis.anchors.filter((a) => a.at <= ref.at && a.para === context.para).at(-1);
    const end = analysis.anchors.find((a) => a.at > ref.at)?.at ?? analysis.text.length;
    const fn = analysis.fns.get(ref.n);
    const t = document.createElement("template"); t.innerHTML = fn?.html || "";
    candidates.push({ type: "footnote", el: ref.a.closest("sup") || ref.a, paragraph: context.para, section: context.section,
      footnote: ref.n, text: start ? analysis.text.slice(start.at, end) : textOf(p), sourceUrls: [...t.content.querySelectorAll("a[href]")].map((a) => a.href) });
  }
  for (const el of root.querySelectorAll("a[href]")) {
    const url = el.dataset.govukHref || el.getAttribute("href");
    if (!httpUrl(url) || el.closest(".linkstatus")) continue;
    const p = el.closest("p, li") || el.parentElement;
    const footnote = Number(p.closest('[id^="fn:"]')?.id.split(":")[1]) || null;
    candidates.push({ type: "link", el, paragraph: paragraphOf(p), section: sectionOf(p), footnote, text: textOf(p), sourceUrls: [url] });
  }
  const groups = new Map(), resolved = new Map();
  for (const record of scoped) {
    for (const anchor of anchorsFor(record, edition)) {
      const c = resolveAnchor(anchor, candidates);
      if (!c) continue;
      const group = groups.get(c.el) || new Map(); group.set(record.id, record); groups.set(c.el, group);
      const locations = resolved.get(record.id) || []; locations.push(c); resolved.set(record.id, locations);
    }
  }
  for (const [el, group] of groups) {
    const rs = [...group.values()], s = reviewStatus(rs);
    const marker = document.createElement("button"); marker.type = "button";
    marker.className = `review-marker sr-${s.tone}`;
    marker.dataset.reviewIds = rs.map((r) => r.id).join(" "); marker.dataset.symbol = s.symbol;
    marker.setAttribute("aria-label", markerLabel(rs)); marker.title = markerLabel(rs);
    marker.setAttribute("aria-haspopup", "dialog"); marker.setAttribute("aria-controls", "pop");
    // No text node: neither textContent nor the quotation index gains UI words.
    if (["A", "SUP"].includes(el.tagName)) el.after(marker); else el.append(marker);
  }
  return resolved;
}
