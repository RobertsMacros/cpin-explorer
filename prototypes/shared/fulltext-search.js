// Full-text search of the reports: every section of every live note, word for word as stored.
// The index is Pagefind's (MIT, https://pagefind.app), built by `cd web && npm run search-index` into
// prototypes/search/pagefind/ and run in the browser: a query fetches only the index chunks it needs.
// One record per section, with meta { title, country, slug, note, kind, version, month, iso_a2,
// section, anchor, type } and filters { country, kind, type: "text" | "title" }.
//
// Used by the dashboard's search (the one search of the site). A passage opens the report page at
// its section, with the words carried over to "Find in this report" (&q=).

import { escHtml as escapeHtml } from "./citation.js";

const INDEX_URL = new URL("../search/pagefind/pagefind.js", import.meta.url).href;
const ENTITIES = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&#x27;": "'", "&apos;": "'", "&nbsp;": " " };
const decode = (s) => s.replace(/&(?:amp|lt|gt|quot|apos|nbsp|#39|#x27);/g, (e) => ENTITIES[e]);

let indexP = null, filtersP = null;
/** The Pagefind module, loaded and initialised once; null if it could not be loaded (the next call tries
 *  again: a dropped connection must not switch the search off for the rest of the visit). */
export function loadIndex({ excerptLength = 26 } = {}) {
  indexP ??= import(INDEX_URL)
    .then(async (pf) => { await pf.options({ excerptLength }); await pf.init(); return pf; })
    .catch((error) => { console.warn("Full-text index not available:", error); indexP = null; filtersP = null; return null; });
  return indexP;
}

/** Pagefind filters for passages: sections of the text only, in these countries (names) and kinds. */
export function passageFilters({ countries = [], kinds = [] } = {}) {
  const f = { type: "text" };
  if (countries.length) f.country = countries.length === 1 ? countries[0] : { any: [...countries] };
  if (kinds.length) f.kind = kinds.length === 1 ? kinds[0] : { any: [...kinds] };
  return f;
}

/**
 * Search the text. Returns { results, total, counts } (results: Pagefind handles, each with .data()),
 * null when a later keystroke superseded this one (debounce > 0), or throws "no index".
 * counts: with `facets`, how many passages each country and kind would give, each counted with the
 * other filter applied, so a number says what ticking that box adds.
 */
export async function searchPassages(text, { countries = [], kinds = [], debounce = 0, facets = false } = {}) {
  const pf = await loadIndex();
  if (!pf) throw new Error("no index");
  const filters = passageFilters({ countries, kinds });
  if (facets) await (filtersP ??= pf.filters().catch((error) => { filtersP = null; throw error; }));   // counts come back empty until the filter chunks are in
  const main = debounce ? await pf.debouncedSearch(text, { filters }, debounce) : await pf.search(text, { filters });
  if (!main) return null;
  let counts = null;
  if (facets) {
    const [forCountries, forKinds] = await Promise.all([
      countries.length ? pf.search(text, { filters: passageFilters({ kinds }) }) : main,
      kinds.length ? pf.search(text, { filters: passageFilters({ countries }) }) : main,
    ]);
    counts = { country: forCountries.filters?.country || {}, kind: forKinds.filters?.kind || {} };
  }
  return { results: main.results, total: main.results.length, counts };
}

/**
 * A Pagefind excerpt made safe to insert: the text escaped, only the <mark>s around matched words
 * kept (rebuilt, so nothing else in the excerpt can become markup). Pure.
 */
export function excerptHtml(html) {
  return String(html ?? "").split(/(<mark>[\s\S]*?<\/mark>)/i).map((part) => {
    const mark = /^<mark>([\s\S]*?)<\/mark>$/i.exec(part);
    const text = decode((mark ? mark[1] : part).replace(/<[^>]*>/g, ""));
    return mark ? `<mark>${escapeHtml(text)}</mark>` : escapeHtml(text);
  }).join("");
}

/** The report page at a passage: its section, with the query filled into "Find in this report". Pure. */
export function readerHref(meta, q, base = "../reader/index.html") {
  return `${base}?country=${encodeURIComponent(meta.slug)}&note=${encodeURIComponent(meta.note)}`
    + `${q ? `&q=${encodeURIComponent(q)}` : ""}${meta.anchor ? `#${encodeURIComponent(meta.anchor)}` : ""}`;
}
