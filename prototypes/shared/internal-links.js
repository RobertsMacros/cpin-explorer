// Making a note's internal links work in the reader. Display only: the stored text never changes.
//
// 1. In-page links whose target is missing. About 0.4% of in-page links point at Word bookmarks
//    that did not survive the Home Office's conversion to GOV.UK ('#_About_the_assessment'), so
//    they are broken on GOV.UK too. Most can be matched to the heading they mean.
// 2. Links to other notes (and country pages) we hold open here instead of on GOV.UK.

export const slug = (text) => text.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** headings: Map(slug -> id). Returns the id a broken '#target' with link text `text` most likely means. */
export function resolveAnchor(target, text, headings) {
  const bookmark = target.replace(/^_+/, "").replace(/_\d+$/, "").replace(/_/g, " ");
  const candidates = [slug(text), slug(bookmark), slug(target.replace(/^_+/, "").replace(/_/g, " "))].filter(Boolean);
  for (const c of candidates) if (headings.has(c)) return headings.get(c);
  // Word truncates long bookmark names ('_Role_of_Non-governmental'): accept a heading that starts with it.
  for (const c of candidates) {
    if (c.length < 6) continue;
    for (const [key, id] of headings) if (key.startsWith(c)) return id;
  }
  return null;
}

export function headingIndex(root) {
  const headings = new Map();
  for (const h of root.querySelectorAll("h1[id],h2[id],h3[id],h4[id],h5[id],h6[id]")) {
    const text = h.textContent.trim();
    for (const key of [slug(text), slug(text.replace(/^\s*[\d.]+\s*/, ""))]) {
      if (key && !headings.has(key)) headings.set(key, h.id);
    }
  }
  return headings;
}

export function repairAnchors(root) {
  const ids = new Set([...root.querySelectorAll("[id], a[name]")].map((el) => el.id || el.getAttribute("name")));
  const headings = headingIndex(root);
  const result = { repaired: 0, unresolved: 0 };
  for (const a of root.querySelectorAll('a[href^="#"]')) {
    let target = a.getAttribute("href").slice(1);
    try { target = decodeURIComponent(target); } catch {}
    if (!target || ids.has(target)) continue;
    const id = resolveAnchor(target, a.textContent.trim(), headings);
    if (id) {
      a.setAttribute("href", `#${id}`);
      a.dataset.anchorRepaired = target;
      a.title = `${a.title ? `${a.title} · ` : ""}Link repaired: the original pointed to a missing bookmark (#${target})`;
      result.repaired += 1;
    } else {
      a.dataset.anchorMissing = target;
      result.unresolved += 1;
    }
  }
  return result;
}

/**
 * notePaths: data.json's note_paths, { '/government/publications/...': { country, series, note, status } }.
 * countryPaths: { '/government/publications/iran-country-policy-and-information-notes': 'iran' }.
 * makeNoteUrl(held, hash) and makeCountryUrl(slug) build the in-app addresses.
 */
export function linkToHeldNotes(root, { notePaths, countryPaths = {}, makeNoteUrl, makeCountryUrl }) {
  let count = 0;
  for (const a of root.querySelectorAll("a[href]")) {
    const raw = a.getAttribute("href");
    if (raw.startsWith("#")) continue;
    let url;
    try { url = new URL(raw, "https://www.gov.uk"); } catch { continue; }
    if (!/(^|\.)gov\.uk$/.test(url.hostname)) continue;
    const path = url.pathname.replace(/\/$/, "");
    const held = notePaths[path];
    const country = countryPaths[path];
    if (!held && !country) continue;
    a.dataset.govukHref = url.href;
    a.setAttribute("href", held ? makeNoteUrl(held, url.hash) : makeCountryUrl(country));
    a.removeAttribute("target");
    a.title = `Opens in CPIN Explorer${held && held.status !== "live" ? " (archived copy)" : ""} · on GOV.UK: ${path}`;
    count += 1;
  }
  return count;
}
