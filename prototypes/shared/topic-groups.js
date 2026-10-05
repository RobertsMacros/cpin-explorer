// Which reports are "the same subject" for the grouped search list (e.g. Humanitarian situation · 9
// countries). GOV.UK titles the same subject many ways ("sexual orientation and gender identity",
// "… or expression", "… and expression"; "humanitarian situation in Gaza"), so matching by wording
// either misses them or merges lookalikes. This is therefore a reviewed table, not a similarity guess:
// a topic joins a group only if it is listed here, or is a listed topic plus a place ("… in Gaza") or
// a bracketed note. Anything else is its own group, so a new, unseen title can never be merged wrongly.
// Reviewed against all 116 topics held on 3 October 2026 (docs/reviews/2026-10-03-topic-groups.md).
// Titles shown elsewhere stay verbatim; this only decides headings and row labels in the search list.

/**
 * label -> the topics (as parsed from GOV.UK titles, any case) that belong under it. Each member is
 *   "topic"            the same subject in other words: its row needs no extra label
 *   ["topic", "Gaza"]  the same subject for a place: the row shows the place
 *   ["topic", OWN]     a wider, narrower or combined report: the row shows the report's own topic
 */
const OWN = Symbol("show the report's own topic");
const GROUPS = {
  "Humanitarian situation": [
    "humanitarian situation", ["humanitarian situation in Gaza", "Gaza"], ["humanitarian situation in Mogadishu", "Mogadishu"],
    ["security and humanitarian situation in Mogadishu", OWN],
  ],
  "Security situation": [
    "security situation", ["security situation in Gaza", "Gaza"], ["security and humanitarian situation in Mogadishu", OWN],
    ["Mogadishu: Al Shabab and the security situation", OWN],
  ],
  "Sexual orientation and gender identity or expression": [
    "sexual orientation and gender", "sexual orientation and gender identity",
    "sexual orientation and gender identity / expression", "sexual orientation and gender identity and expression",
    "sexual orientation and gender identity or expression", "sexual orientation, gender identity and expression",
    ["sexual orientation, gender identity and expression, and sex characteristics", OWN],
  ],
  "Medical treatment and healthcare": [
    "medical treatment and healthcare", "healthcare and medical treatment", "medical and healthcare issues",
    "medical and healthcare provision",
  ],
  "Internal relocation": [
    "internal relocation", ["internal relocation, civil documentation and returns", OWN],
    ["internal relocation, civil documentation and returns (update following setting aside of country guidance)", OWN],
  ],
  "Women fearing gender-based violence": ["women fearing gender-based violence", "gender-based violence"],
  "Domestic violence": ["domestic violence", "women fearing domestic violence", "domestic abuse and violence against women"],
  "Human trafficking": ["human trafficking", "trafficking", ["trafficking of women", OWN], ["modern slavery", OWN]],
  "Religious minorities": [
    "religious minorities", "minority religious groups", ["religious minorities (excluding Alawites)", "Excluding Alawites"],
    ["religious minorities and atheists", OWN], ["religious minorities and scheduled castes and tribes", OWN],
  ],
  "Christians": ["Christians", ["Christians and Christian converts", OWN]],
  "Muslims": ["Muslims", ["Muslims (including Uyghurs in Xinjiang)", "Including Uyghurs in Xinjiang"]],
  "Kurds": ["Kurds", ["Kurds and Kurdish areas", OWN], ["Kurds and Kurdish political groups", OWN]],
  // Owner's decisions (3 Oct 2026), all five judgement calls merged: the "critics …" reports join
  // opposition; gangs, OCGs and Colombia's report are one list; modern slavery joins trafficking;
  // Eritrea's national service report is also under military service; unsuccessful asylum seekers join returnees.
  "Opposition to the state or government": [
    "opposition to the state", "opposition to the government",
    ["opposition to the government in the Kurdistan Region of Iraq (KRI)", "Kurdistan Region of Iraq (KRI)"],
    "critics and opponents of the government", "criticism of the government", "critics of the government",
    ["critics of the military regime", OWN], ["critics of the state, Chechnya", "Chechnya"],
  ],
  "Political parties and affiliation": ["political parties and affiliation", "political affiliation"],
  "Gangs and organised criminal groups": [
    "gangs", "fear of gangs", "organised criminal groups (OCGs)", "organised criminal groups",
    "fear of organised criminal groups (OCGs)", ["armed groups and criminal gangs", OWN],
  ],
  "Blood feuds": ["blood feuds", ["Iraq Blood feuds, honour crimes and tribal violence", OWN]],
  "Returnees": ["returnees", ["returnees after fall of Al-Assad regime", OWN], ["unsuccessful asylum seekers", OWN]],
  "Tigrayans": ["situation of the Tigrayans", ["Tigrayans and the Tigrayan People’s Liberation Front", OWN]],
  "Illegal exit": ["illegal exit", ["national service and illegal exit", OWN]],
  "Military service": ["military service", ["national service and illegal exit", OWN]],
};

/** Row labels for topics whose parsed form carries a glitch from the GOV.UK title (the title itself is kept verbatim). */
const DISPLAY = {
  "iraq blood feuds, honour crimes and tribal violence": "Blood feuds, honour crimes and tribal violence",
};

/** Fold case, quotes, dashes and spacing; drop a dangling "in" left when a title ended "… in <country>". */
export function normTopic(topic) {
  return String(topic ?? "").normalize("NFKC").toLowerCase()
    .replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[‐-―]/g, "-")
    .replace(/\s+/g, " ").trim().replace(/ in$/, "").replace(/[.,;:]+$/, "");
}

const slug = (s) => normTopic(s).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const capFirst = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const clean = (topic) => String(topic ?? "").replace(/\s+/g, " ").trim().replace(/ in$/, "");

const INDEX = new Map();                 // normalised member -> [{ label, q }], q: "" | place/note | OWN
for (const [label, members] of Object.entries(GROUPS)) {
  for (const m of members) {
    const [topic, q] = Array.isArray(m) ? m : [m, ""];
    const k = normTopic(topic);
    INDEX.set(k, [...(INDEX.get(k) || []), { label, q }]);
  }
}

const ownLabel = (topic) => DISPLAY[normTopic(topic)] || capFirst(clean(topic));

/** A report's own topic, tidied for display (first letter capitalised, title glitches cleaned): what a
 *  row shows when a search matched the report's own wording rather than the group heading. */
export const topicLabel = (topic) => ownLabel(topic);

/**
 * The group(s) a report's topic belongs to: [{ key, label, qualifier }], always at least one.
 * qualifier is what to show on that report's row when its title says more than the heading ("" if not).
 * A compound topic can sit in two groups ("Security and humanitarian situation in Mogadishu").
 */
export function topicGroups(topic) {
  const own = normTopic(topic);
  const listed = INDEX.get(own);
  if (listed) return listed.map(({ label, q }) => ({ key: slug(label), label, qualifier: q === OWN ? ownLabel(topic) : q }));
  // Not listed. Only two safe extensions: a listed plain topic plus a place ("security situation in
  // Hodeidah") or plus a bracketed note ("returnees (2027 update)"). Anything else stands alone.
  const text = clean(topic);
  const plain = (base) => (INDEX.get(normTopic(base)) || []).filter((g) => g.q === "");
  const inPlace = text.match(/^(.+?) in ((?:the )?\p{Lu}.*)$/u);
  if (inPlace && plain(inPlace[1]).length) return plain(inPlace[1]).map(({ label }) => ({ key: slug(label), label, qualifier: inPlace[2] }));
  const bracket = text.match(/^(.+?) \((.+)\)$/);
  if (bracket && plain(bracket[1]).length) return plain(bracket[1]).map(({ label }) => ({ key: slug(label), label, qualifier: capFirst(bracket[2]) }));
  return [{ key: slug(own), label: ownLabel(topic), qualifier: "" }];
}

/** For reviews: every group with the distinct topics that fall in it, from a list of topics. */
export function auditGroups(topics) {
  const out = new Map();
  for (const t of topics) {
    for (const g of topicGroups(t)) {
      if (!out.has(g.key)) out.set(g.key, { label: g.label, topics: new Map() });
      out.get(g.key).topics.set(normTopic(t), { topic: t, qualifier: g.qualifier });
    }
  }
  return out;
}
