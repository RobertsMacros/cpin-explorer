// The dashboard's one search box, made forgiving. People call these notes "country reports", "CPINs",
// "notes" or "guidance"; those words mean "any report" and must not filter everything out. Kind words
// ("fact-finding", "bulletin") pick a kind, a country's name picks the country, small words are
// ignored, and what is left has to match the report's title. Pure functions: no DOM, tested in
// web/test/search-query.test.mjs.

/** Lower case, no accents, possessives or punctuation, single spaces: "Gender-based  violence" -> "gender based violence". */
export const norm = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/[’'`]s\b/g, "").replace(/[’'`]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

// Words that mean "a report of any kind": they match everything. Longest phrases first.
const GENERIC = [
  "country policy and information notes", "country policy and information note", "country policy information notes",
  "country policy information note", "policy and information notes", "policy and information note",
  "country policy notes", "country policy note", "country of origin information", "country reports", "country report",
  "country notes", "country note", "country guidance", "home office", "cpins", "cpin", "reports", "report",
  "notes", "note", "guidance", "coi",
].map((p) => p.split(" "));

// Words that pick a kind of report. `kind` is tested against the kind labels in the data.
const KIND_WORDS = [
  { kind: /fact.finding/i, phrases: ["report of a fact finding mission", "fact finding missions", "fact finding mission", "fact finding", "factfinding", "ffms", "ffm", "missions", "mission"] },
  { kind: /bulletin/i, phrases: ["country bulletins", "country bulletin", "bulletins", "bulletin"] },
  { kind: /^country information note/i, phrases: ["country information notes", "country information note", "information notes", "information note", "cins", "cin"] },
  { kind: /information and guidance/i, phrases: ["country information and guidance", "information and guidance", "cigs", "cig", "legacy"] },
].map((k) => ({ kind: k.kind, phrases: k.phrases.map((p) => p.split(" ")) }));

// Small words that carry no meaning in a title search.
const FILLER = new Set(["a", "an", "the", "of", "in", "on", "for", "to", "and", "or", "with", "about", "from", "by", "at",
  "is", "are", "what", "which", "show", "me", "find", "list", "all", "any", "latest", "current", "newest", "recent"]);
// Dropped only if keeping them finds nothing ("safe third country" is a title; "country" alone means any).
const SOFT = new Set(["country", "countries", "policy", "information", "new", "uk", "asylum", "claims", "claim"]);

// Other names people use, by slug.
export const COUNTRY_ALIASES = {
  "democratic-republic-of-the-congo": ["drc", "dr congo", "congo kinshasa"],
  burma: ["myanmar", "burma"],
  turkey: ["turkiye"],
  palestine: ["occupied palestinian territories", "opts", "palestinian territories"],
  "trinidad-and-tobago": ["trinidad", "tobago"],
};
// Shorthand for common topics: any of the alternatives may match.
const SYNONYMS = {
  lgbt: ["sexual orientation"], lgbti: ["sexual orientation"], lgbtq: ["sexual orientation"], lgbtqi: ["sexual orientation"],
  gay: ["sexual orientation"], lesbian: ["sexual orientation"], homosexual: ["sexual orientation"], homosexuality: ["sexual orientation"],
  sogi: ["sexual orientation"], sogie: ["sexual orientation"], gbv: ["gender based violence"], fgm: ["female genital mutilation"],
  health: ["healthcare", "medical"], medical: ["medical", "healthcare"], healthcare: ["healthcare", "medical"],
  ocg: ["organised criminal"], ocgs: ["organised criminal"], trafficking: ["trafficking", "modern slavery"],
  minors: ["children"], child: ["children", "child"], conscription: ["military service"], draft: ["military service"],
};

const startsAt = (tokens, i, phrase) => phrase.every((w, k) => tokens[i + k]?.t === w && !tokens[i + k].quoted && !tokens[i + k].role);
/** A word of the query against a normalised haystack: it has to start a word ("men" is not in "women"). */
function wordIn(hay, word) {
  const h = ` ${hay} `;
  const forms = new Set([word, word.replace(/ies$/, "y"), word.length > 3 ? word.replace(/s$/, "") : word]);
  for (const f of forms) if (f && h.includes(` ${f}`)) return true;
  return false;
}
const termIn = (hay, term) => term.alts.some((alt) => (alt.includes(" ") ? ` ${hay} `.includes(` ${alt}`) : wordIn(hay, alt)));

/**
 * Read a query. countries: [{ slug, name }]; kinds: the kind labels in the data.
 * Returns { raw, terms, soft, kinds, countries, generic, text, empty, matchAll }:
 *   terms      what must match a title (each { t, alts })
 *   soft       terms dropped if they match nothing
 *   kinds      Set of kind labels, or null for any kind
 *   countries  slugs named in full
 *   generic    it said "country report", "CPIN", "notes" or the like
 *   text       what to look for inside the text of the reports ("" for nothing)
 *   matchAll   no terms, but a kind, a country or a generic word: every report of that kind/country
 *   empty      nothing to search for at all
 */
export function parseQuery(raw, { countries = [], kinds = [] } = {}) {
  const tokens = [];
  for (const m of String(raw ?? "").matchAll(/"([^"]*)"?|(\S+)/g)) {
    if (m[1] != null) { const t = norm(m[1]); if (t) tokens.push({ t, quoted: true }); }
    else for (const t of norm(m[2]).split(" ")) if (t) tokens.push({ t });
  }
  const mark = (i, n, role, value) => { for (let k = 0; k < n; k++) { tokens[i + k].role = role; tokens[i + k].value = value; } };

  // Countries named in full (the longest name first, so "Democratic Republic of the Congo" wins).
  const names = countries.flatMap((c) => [norm(c.name), ...(COUNTRY_ALIASES[c.slug] || [])].map((n) => ({ slug: c.slug, words: n.split(" ") })))
    .sort((a, b) => b.words.length - a.words.length);
  const named = new Set();
  for (let i = 0; i < tokens.length; i++) {
    const hit = names.find((n) => startsAt(tokens, i, n.words));
    if (hit) { mark(i, hit.words.length, "country", hit.slug); named.add(hit.slug); i += hit.words.length - 1; }
  }
  // The notes' own long name first ("country policy and information notes" is every report, not the
  // kind "Country information note"), then kind words, then the other generic words.
  let kindSet = null, generic = false;
  for (let i = 0; i < tokens.length; i++) {
    const phrase = GENERIC.find((p) => p.includes("policy") && startsAt(tokens, i, p));
    if (phrase) { mark(i, phrase.length, "generic"); generic = true; }
  }
  for (let i = 0; i < tokens.length; i++) {
    for (const k of KIND_WORDS) {
      const phrase = k.phrases.find((p) => startsAt(tokens, i, p));
      if (!phrase) continue;
      const labels = kinds.filter((label) => k.kind.test(label));
      if (!labels.length) continue;
      mark(i, phrase.length, "kind");
      kindSet ??= new Set();
      for (const label of labels) kindSet.add(label);
      break;
    }
  }
  for (let i = 0; i < tokens.length; i++) {
    const phrase = GENERIC.find((p) => startsAt(tokens, i, p));
    if (phrase) { mark(i, phrase.length, "generic"); generic = true; }
  }
  const terms = [], soft = [];
  for (const tok of tokens) {
    if (tok.role) continue;
    if (!tok.quoted && FILLER.has(tok.t)) { tok.role = "filler"; continue; }
    const term = { t: tok.t, alts: tok.quoted ? [tok.t] : [tok.t, ...(SYNONYMS[tok.t] || [])] };
    if (!tok.quoted && SOFT.has(tok.t)) { tok.role = "soft"; soft.push(term); } else { tok.role = "term"; terms.push(term); }
  }
  // Inside the text: the words that carry meaning, phrases still in quotes. Small words stay if there
  // are others around them ("freedom of movement"); alone they find nothing useful.
  const textTokens = tokens.filter((tok) => tok.role === "term" || tok.role === "soft" || tok.role === "filler");
  const carries = (tok) => tok.role === "term" || (tok.role === "soft" && !generic);
  const first = textTokens.findIndex(carries), last = textTokens.findLastIndex(carries);
  const text = first < 0 ? "" : textTokens.slice(first, last + 1).map((tok) => (tok.quoted ? `"${tok.t}"` : tok.t)).join(" ");
  const matchAll = !terms.length && !soft.length && (generic || !!kindSet || named.size > 0);
  return { raw: String(raw ?? ""), terms, soft, kinds: kindSet, countries: [...named], generic, text,
    matchAll, empty: !terms.length && !soft.length && !matchAll };
}

// Titles are matched on the topic, the heading of the group it is listed under (and its row label
// there) and the country; the
// kind is picked by kind words, not by the title words ("country" must not match every "Country bulletin").
const ownGroup = (topic) => [{ key: norm(topic), label: topic, qualifier: "" }];
const haystack = (c, r, groupsOf) => norm(`${r.topic || r.title || ""} ${groupsOf(r.topic).map((g) => `${g.label} ${g.qualifier || ""}`).join(" ")} ${c.name} ${(COUNTRY_ALIASES[c.slug] || []).join(" ")}`);
const countryHay = (c) => norm(`${c.name} ${(COUNTRY_ALIASES[c.slug] || []).join(" ")}`);

/** Countries the query points at: named in full, or every word starting a word of the name. */
export function matchCountries(parsed, countries) {
  const named = new Set(parsed.countries);
  const words = [...parsed.terms, ...parsed.soft];
  return countries.filter((c) => named.has(c.slug)
    || (!named.size && words.length > 0 && !parsed.kinds && words.every((term) => termIn(countryHay(c), term))));
}

/**
 * Reports whose title matches: [{ c, r }], live ones first. `only` restricts to one country (its slug);
 * `anyCountry` ignores a country named in the query (the same topic elsewhere); `groupsOf` is
 * topicGroups from ../shared/topic-groups.js, so a report is also found by its group's heading.
 * Soft words ("country", "policy") must match too unless that leaves nothing.
 */
export function matchReports(parsed, countries, { only = null, anyCountry = false, groupsOf = ownGroup } = {}) {
  if (parsed.empty) return [];
  const named = new Set(only ? [only] : anyCountry ? [] : parsed.countries);
  const pool = [];
  for (const c of countries) {
    if (named.size && !named.has(c.slug)) continue;
    for (const r of c.reports || []) {
      if (parsed.kinds && !parsed.kinds.has(r.kind)) continue;
      pool.push({ c, r, hay: haystack(c, r, groupsOf) });
    }
  }
  const pick = (terms) => pool.filter((x) => terms.every((term) => termIn(x.hay, term)));
  let hits = pick([...parsed.terms, ...parsed.soft]);
  if (!hits.length && parsed.soft.length && (parsed.terms.length || parsed.generic || parsed.kinds || named.size)) hits = pick(parsed.terms);
  const live = (x) => (x.r.status === "live" ? 0 : 1);
  return hits.map(({ c, r }) => ({ c, r })).sort((a, b) => live(a) - live(b));
}

const liveFirst = (x) => (x.r.status === "live" ? 0 : 1);
const allIn = (parsed, text) => {
  const words = [...parsed.terms, ...parsed.soft], hay = norm(text);
  return words.length > 0 && words.every((term) => termIn(hay, term));
};

/**
 * Every group in the data: Map key -> { key, label, rows: [{ c, r, qualifier }], countries, reports },
 * rows in country order with live reports first. Which topics belong together is decided by
 * `groupsOf(topic)` -> [{ key, label, qualifier }] (the reviewed table in ../shared/topic-groups.js;
 * a topic can be in two groups), never guessed here.
 */
export function buildGroups(countries, groupsOf = ownGroup) {
  const groups = new Map();
  let order = 0;
  for (const c of countries) {
    for (const r of c.reports || []) {
      for (const g of groupsOf(r.topic)) {
        if (!groups.has(g.key)) groups.set(g.key, { key: g.key, label: g.label, rows: [] });
        groups.get(g.key).rows.push({ c, r, qualifier: g.qualifier || "", order: order++ });
      }
    }
  }
  for (const g of groups.values()) {
    g.rows = g.rows.sort((a, z) => a.c.name.localeCompare(z.c.name, "en-GB") || liveFirst(a) - liveFirst(z) || a.order - z.order).map(({ order: _, ...row }) => row);
    g.countries = new Set(g.rows.map((x) => x.c.slug)).size;
    g.reports = g.rows.length;
  }
  return groups;
}

/**
 * The results as a list. Every matching report is shown under the heading of its group, always, even
 * if it is the only one of the group that matched; the heading and its counts are the whole group's,
 * so they read the same whatever was typed. Only a subject with a single report in all the data has no
 * heading. Returns, in order, groups (most matches first) then those standalone reports (as found):
 *   { key, label, countries, reports, rows: [matching rows], rest: [the group's other rows] }
 *   { c, r }
 * A report in two groups is listed under each, unless the query names one of the headings ("humanitarian"),
 * in which case under that one. `groups` is buildGroups(); `parsed` the query (parseQuery).
 */
export function groupReports(hits, groups, { groupsOf = ownGroup, parsed = null } = {}) {
  const under = new Map();                                       // report -> the group keys it is listed under
  const wanted = new Map();                                      // group key -> index of the first hit that brought it up
  const singles = [];
  hits.forEach((hit, i) => {
    const own = groupsOf(hit.r.topic);
    const named = parsed ? own.filter((g) => allIn(parsed, g.label)) : [];
    const keys = (named.length ? named : own).map((g) => g.key).filter((key) => (groups.get(key)?.reports ?? 0) > 1);
    if (!keys.length) { singles.push(hit); return; }
    under.set(hit.r, new Set(keys));
    for (const key of keys) if (!wanted.has(key)) wanted.set(key, i);
  });
  const out = [...wanted].map(([key, first]) => {
    const g = groups.get(key);
    const here = (row) => under.get(row.r)?.has(key) ?? false;
    return { key, label: g.label, countries: g.countries, reports: g.reports, first,
      rows: g.rows.filter(here), rest: g.rows.filter((row) => !here(row)) };
  }).sort((a, z) => z.rows.length - a.rows.length || z.reports - a.reports || a.first - z.first).map(({ first, ...g }) => g);
  return [...out, ...singles];
}

/**
 * What a group's row says quietly beside the country. Usually how the report's title differs from the
 * heading (`qualifier`: "Mogadishu", or nothing). But when it was the report's own wording that the
 * query matched, not the heading, the row shows that wording (`own`: topicLabel(topic)), so it is
 * plain why the row is there: "critics" -> "Russia · Critics and opponents of the government".
 */
export function rowNote(parsed, { label, qualifier = "", own = "" }) {
  if (!parsed || !(parsed.terms.length + parsed.soft.length) || allIn(parsed, label)) return qualifier;
  if (qualifier && allIn(parsed, qualifier)) return qualifier;
  const words = [...parsed.terms, ...parsed.soft], hay = norm(own);
  return words.some((term) => termIn(hay, term)) ? own : qualifier;
}

// The glossary entry (../shared/glossary.js, by id) that explains each kind of report, so a small
// "CPIN" tag can say what it stands for. A kind with no entry (a one-off "GOV.UK notice") has none.
const KIND_TERMS = [
  [/^cpin$/i, "cpin"], [/fact.finding/i, "ffm"], [/bulletin/i, "country-bulletin"],
  [/^country information note/i, "cin"], [/information and guidance/i, "cig"],
];
/** The id of the glossary entry for a kind label ("CPIN" -> "cpin"), or null. */
export const kindTermId = (kind) => KIND_TERMS.find(([re]) => re.test(String(kind ?? "")))?.[1] ?? null;
/**
 * A kind tag's tooltip, from its glossary entry { term, full? }: what the tag does not already say.
 * "CPIN" -> "Country Policy and Information Note"; a kind that is already spelled out gains its
 * abbreviation, "Report of a fact-finding mission (FFM)"; with nothing to add, "".
 */
export function kindTitle(kind, entry) {
  if (!entry?.full) return "";
  return entry.full.length > entry.term.length ? entry.full : `${entry.term} (${entry.full})`;
}

/**
 * Glossary terms for the search's last group. The words are taken as typed, not through parseQuery:
 * "cpin" and "country report" mean "any report" to the title search, and are exactly what someone
 * looking for the meaning of CPIN types. `search` is searchGlossary from ../shared/glossary.js (names
 * only, every word starting a word of a name). One or two letters match too much that way ("c" starts
 * 27 names), so until there are three only a name typed in full counts ("cg", "hp").
 * Returns { entries: the first `limit`, total, more: whether there are others }.
 */
export function glossaryHits(raw, search, limit = 3) {
  const q = norm(raw);
  let all = q ? search(raw) : [];
  if (q.length < 3) all = all.filter((e) => [e.term, e.full, ...(e.aka || [])].some((name) => name && norm(name) === q));
  return { entries: all.slice(0, limit), total: all.length, more: all.length > limit };
}

/** The words of a query as typed (lower case, no punctuation), for marking them in a glossary term. */
export const rawWords = (raw) => norm(raw).split(" ").filter(Boolean);
