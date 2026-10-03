// The forgiving search, against the real exported data (prototypes/dashboard/data.json).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { buildGroups, groupReports, matchCountries, matchReports, norm, parseQuery, rowNote } from "../../prototypes/dashboard/search-query.js";

const data = JSON.parse(readFileSync(new URL("../../prototypes/dashboard/data.json", import.meta.url), "utf8"));
const countries = data.countries;
const kinds = [...new Set(countries.flatMap((c) => (c.reports || []).map((r) => r.kind)))];
const parse = (q) => parseQuery(q, { countries, kinds });
const reports = (q, opts) => matchReports(parse(q), countries, opts);
const allReports = countries.reduce((n, c) => n + (c.reports || []).length, 0);
const slugs = (list) => list.map((c) => c.slug);

test("normalising: case, accents, punctuation, hyphens and possessives do not matter", () => {
  assert.equal(norm("  Gender-based   VIOLENCE "), "gender based violence");
  assert.equal(norm("Iran’s notes"), "iran notes");
  assert.equal(norm("Türkiye"), "turkiye");
  assert.equal(norm("women - early and forced marriage"), "women early and forced marriage");
});

test("what people call the notes matches every report: 'country report', 'CPINs', 'notes', 'guidance'", () => {
  for (const q of ["country report", "country reports", "Country Reports", "cpin", "CPINs", "notes", "guidance", "country policy and information notes", "the country reports"]) {
    const p = parse(q);
    assert.ok(p.generic && p.matchAll && !p.empty, q);
    assert.equal(p.kinds, null, `${q}: no kind filter`);
    assert.equal(reports(q).length, allReports, `${q}: nothing filtered out`);
    assert.equal(p.text, "", `${q}: nothing to look for inside the text`);
  }
});

test("the owner's case: 'country report' with a country or a topic narrows, it does not dead-end", () => {
  const iran = countries.find((c) => c.slug === "iran");
  assert.equal(reports("country report iran").length, iran.reports.length);
  assert.deepEqual(parse("Iran country reports").countries, ["iran"]);
  const hits = reports("country report internal relocation");
  assert.ok(hits.length >= 5);
  assert.ok(hits.every((x) => /internal relocation/i.test(x.r.topic)));
  assert.equal(parse("country report internal relocation").text, "internal relocation");
});

test("kind words pick a kind: fact-finding / FFM / mission, bulletin", () => {
  for (const q of ["fact-finding", "fact finding mission", "FFM", "missions", "report of a fact-finding mission"]) {
    const p = parse(q);
    assert.deepEqual([...p.kinds], ["Report of a fact-finding mission"], q);
    const hits = reports(q);
    assert.ok(hits.length >= 3 && hits.every((x) => x.r.kind === "Report of a fact-finding mission"), q);
  }
  for (const q of ["bulletin", "country bulletins"]) {
    assert.deepEqual([...parse(q).kinds], ["Country bulletin"], q);
    assert.ok(reports(q).length >= 5 && reports(q).every((x) => x.r.kind === "Country bulletin"), q);
  }
  const brazil = reports("FFM Brazil");
  assert.equal(brazil.length, 1);
  assert.equal(brazil[0].c.slug, "brazil");
  assert.ok(reports("iran bulletin").length >= 2 && reports("iran bulletin").every((x) => x.c.slug === "iran" && x.r.kind === "Country bulletin"));
});

test("small words are ignored; the words that are left must each start a word of the title", () => {
  assert.deepEqual(parse("the latest report on blood feuds in Albania").terms.map((t) => t.t), ["blood", "feuds"]);
  assert.deepEqual(parse("the latest report on blood feuds in Albania").countries, ["albania"]);
  const feuds = reports("the latest report on blood feuds in Albania");
  assert.ok(feuds.length >= 1 && feuds.every((x) => x.c.slug === "albania" && /blood feud/i.test(x.r.topic)));
  assert.ok(reports("feud").length >= 2, "a word's start is enough");
  assert.ok(reports("relocat").length >= 5);
  assert.ok(reports("men").every((x) => !/^women/i.test(x.r.topic) || /\bmen/i.test(x.r.topic)), "'men' is not found inside 'women'");
  assert.equal(reports("zzzz").length, 0);
  assert.ok(parse("the").empty && reports("the").length === 0, "nothing but small words: nothing to search");
});

test("shorthand for common topics", () => {
  assert.ok(reports("lgbt").length >= 10 && reports("lgbt").every((x) => /sexual orientation/i.test(x.r.topic)));
  assert.ok(reports("FGM").every((x) => /female genital mutilation/i.test(x.r.topic)) && reports("FGM").length >= 2);
  assert.ok(reports("women's").length >= 6);
});

test("countries: full names, other names and partial typing", () => {
  assert.deepEqual(slugs(matchCountries(parse("ira"), countries)), ["iran", "iraq"]);
  assert.deepEqual(slugs(matchCountries(parse("iran"), countries)), ["iran"]);
  assert.deepEqual(slugs(matchCountries(parse("DRC"), countries)), ["democratic-republic-of-the-congo"]);
  assert.deepEqual(slugs(matchCountries(parse("congo"), countries)), ["democratic-republic-of-the-congo"]);
  assert.deepEqual(slugs(matchCountries(parse("Myanmar"), countries)), ["burma"]);
  assert.deepEqual(slugs(matchCountries(parse("sri lanka"), countries)), ["sri-lanka"]);
  assert.deepEqual(slugs(matchCountries(parse("Türkiye"), countries)), ["turkey"]);
  assert.deepEqual(slugs(matchCountries(parse("iran iraq"), countries)), ["iran", "iraq"]);
  assert.deepEqual(matchCountries(parse("country report"), countries), [], "a generic query names no country");
  assert.deepEqual(matchCountries(parse("actors of protection"), countries), []);
});

test("a country named in the query filters by country, and is not searched for in the text", () => {
  const p = parse("kurds iraq");
  assert.deepEqual(p.countries, ["iraq"]);
  assert.equal(p.text, "kurds");
  assert.ok(reports("kurds iraq").every((x) => x.c.slug === "iraq"));
  assert.equal(parse("Iran").text, "", "only a country: nothing to look for inside the text");
  assert.equal(parse("\"internal relocation\" Kabul").text, "\"internal relocation\" kabul", "phrases stay in quotes");
  assert.equal(parse("freedom of movement").text, "freedom of movement", "small words stay inside a phrase for the text");
  assert.equal(parse("cpin on blood feuds in albania").text, "blood feuds", "but not at its ends");
});

test("when the named country has no such report, the same topic elsewhere is still found", () => {
  const p = parse("Iran actors of protection");
  assert.deepEqual(p.countries, ["iran"]);
  assert.equal(matchReports(p, countries).length, 0, "Iran has no report with that title");
  const elsewhere = matchReports(p, countries, { anyCountry: true });
  assert.ok(elsewhere.length >= 10 && elsewhere.every((x) => /actors of protection/i.test(x.r.topic)));
});

test("soft words ('country', 'policy') count if they match a title, and are dropped if they would leave nothing", () => {
  const safe = reports("safe third country");
  assert.ok(safe.length >= 1 && safe.every((x) => /safe third country/i.test(x.r.topic)));
  assert.equal(reports("iran country information").length, countries.find((c) => c.slug === "iran").reports.length);
});

test("one country's box: its own reports only", () => {
  const hits = reports("security", { only: "iran" });
  assert.ok(hits.length >= 1 && hits.every((x) => x.c.slug === "iran" && /security/i.test(x.r.topic)));
  assert.equal(reports("country reports", { only: "brazil" }).length, countries.find((c) => c.slug === "brazil").reports.length);
});

// --- grouping. Which topics belong together is the parent's reviewed table (topic-groups.js, with its
// own tests); here a small stand-in shows what the list does with whatever table it is given.
const groupsOf = (topic) => {
  const t = norm(topic);
  if (t === "security and humanitarian situation in mogadishu") {
    return [{ key: "humanitarian", label: "Humanitarian situation", qualifier: "Security and humanitarian situation in Mogadishu" },
      { key: "security", label: "Security situation", qualifier: "Security and humanitarian situation in Mogadishu" }];
  }
  const m = /^(humanitarian|security) situation(?: in (.+))?$/.exec(t);
  if (m) return [{ key: m[1], label: `${m[1][0].toUpperCase()}${m[1].slice(1)} situation`, qualifier: m[2] ? topic.split(" in ")[1] : "" }];
  if (/^critic|^opposition to/.test(t)) return [{ key: "opposition", label: "Opposition to the state or government", qualifier: /^opposition to the state$/.test(t) ? "" : `${topic[0].toUpperCase()}${topic.slice(1)}` }];
  return [{ key: t, label: `${topic[0].toUpperCase()}${topic.slice(1)}`, qualifier: "" }];
};
const R = (topic, key, status = "live") => ({ topic, key, status, kind: "CPIN" });
const world = [
  { slug: "burma", name: "Myanmar (Burma)", reports: [R("critics of the military regime", "b1")] },
  { slug: "palestine", name: "Palestine", reports: [R("humanitarian situation in Gaza", "g1", "archived"), R("security situation in Gaza", "g2")] },
  { slug: "russia", name: "Russia", reports: [R("critics and opponents of the government", "r1"), R("critics of the state, Chechnya", "r2", "archived"), R("military service", "r3")] },
  { slug: "somalia", name: "Somalia", reports: [R("humanitarian situation in Mogadishu", "so1"), R("security and humanitarian situation in Mogadishu", "so2", "archived")] },
  { slug: "sudan", name: "Sudan", reports: [R("humanitarian situation", "s1"), R("security situation", "s2"), R("opposition to the state", "s3")] },
  { slug: "turkey", name: "Turkey", reports: [R("PKK", "t1"), R("opposition to the state", "t2")] },
  { slug: "yemen", name: "Yemen", reports: [R("humanitarian situation", "y1"), R("security situation", "y2")] },
];
const groups = buildGroups(world, groupsOf);
const list = (q) => { const parsed = parseQuery(q, { countries: world, kinds: ["CPIN"] }); return groupReports(matchReports(parsed, world, { groupsOf }), groups, { groupsOf, parsed }); };
const show = (out) => out.map((e) => (e.rows ? `${e.label} [${e.rows.map((x) => x.r.key)}] +${e.rest.length}` : `single ${e.r.key}`));

test("the groups of the whole data set: every report of a subject, in country order, counted honestly", () => {
  const hum = groups.get("humanitarian");
  assert.deepEqual(hum.rows.map((x) => `${x.c.name}${x.qualifier ? ` · ${x.qualifier}` : ""}`),
    ["Palestine · Gaza", "Somalia · Mogadishu", "Somalia · Security and humanitarian situation in Mogadishu", "Sudan", "Yemen"]);
  assert.deepEqual([hum.countries, hum.reports], [4, 5], "Somalia is there twice: 4 countries, 5 reports");
  assert.deepEqual([groups.get("pkk").reports, groups.get("military service").reports], [1, 1]);
});

test("every matching report comes under its group's heading, even when it is the only one that matched", () => {
  assert.deepEqual(show(list("gaza")), ["Humanitarian situation [g1] +4", "Security situation [g2] +3"], "one match each, the rest behind 'Show all'");
  const sec = list("gaza").find((e) => e.key === "security");
  assert.deepEqual([sec.countries, sec.reports], [4, 4], "the heading's counts are the whole group's, whatever was typed");
  assert.deepEqual(sec.rest.map((x) => x.r.key), ["so2", "s2", "y2"]);
});

test("a search on the reports' own wording brings up the group: 'critics' -> Opposition to the state or government", () => {
  const out = list("critics");
  assert.deepEqual(show(out), ["Opposition to the state or government [b1,r1,r2] +2"]);
  assert.deepEqual([out[0].countries, out[0].reports], [4, 5]);
});

test("a query that names the heading lists the whole group, nothing held back", () => {
  assert.deepEqual(show(list("opposition")), ["Opposition to the state or government [b1,r1,r2,s3,t2] +0"]);
  assert.deepEqual(show(list("humanitarian situation")), ["Humanitarian situation [g1,so1,so2,s1,y1] +0"]);
});

test("a report in two groups: under each heading the query brings up; under the one it names, only that one", () => {
  assert.deepEqual(show(list("mogadishu")), ["Humanitarian situation [so1,so2] +3", "Security situation [so2] +3"]);
  assert.deepEqual(show(list("humanitarian")), ["Humanitarian situation [g1,so1,so2,s1,y1] +0"], "not also under Security situation");
  assert.deepEqual(show(list("security")), ["Security situation [g2,so2,s2,y2] +0"]);
  const all = list("country reports");
  assert.equal(all.find((e) => e.key === "security").rows.length, 4);
  assert.equal(all.find((e) => e.key === "humanitarian").rows.length, 5, "with no words to go on, it is under both");
});

test("a subject with one report in all the data has no heading: the report stands on its own", () => {
  assert.deepEqual(show(list("pkk")), ["single t1"]);
  assert.deepEqual(show(list("turkey")), ["Opposition to the state or government [t2] +4", "single t1"], "groups first, then standalone reports");
  assert.deepEqual(show(list("russia")), ["Opposition to the state or government [r1,r2] +3", "single r3"]);
});

test("groups with the most matches come first; equal ones in the order found", () => {
  assert.deepEqual(show(list("country report")).slice(0, 3), [
    "Opposition to the state or government [b1,r1,r2,s3,t2] +0", "Humanitarian situation [g1,so1,so2,s1,y1] +0", "Security situation [g2,so2,s2,y2] +0",
  ]);
  assert.deepEqual(show(list("somalia")), ["Humanitarian situation [so1,so2] +3", "Security situation [so2] +3"]);
});

test("why a row matched: the report's own wording is shown when that, not the heading, is what matched", () => {
  const p = (q) => parseQuery(q, { countries: world, kinds: ["CPIN"] });
  const label = "Opposition to the state or government";
  assert.equal(rowNote(p("critics"), { label, qualifier: "", own: "Critics and opponents of the government" }), "Critics and opponents of the government");
  assert.equal(rowNote(p("critics"), { label, qualifier: "Chechnya", own: "Critics of the state, Chechnya" }), "Critics of the state, Chechnya", "the qualifier alone would hide the match");
  assert.equal(rowNote(p("chechnya"), { label, qualifier: "Chechnya", own: "Critics of the state, Chechnya" }), "Chechnya", "the qualifier already shows it");
  assert.equal(rowNote(p("opposition"), { label, qualifier: "", own: "Opposition to the state" }), "", "the heading says it: just the country");
  assert.equal(rowNote(p("opposition"), { label, qualifier: "Critics of the military regime", own: "Critics of the military regime" }), "Critics of the military regime");
  assert.equal(rowNote(p("gaza"), { label: "Security situation", qualifier: "Gaza", own: "Security situation in Gaza" }), "Gaza");
  assert.equal(rowNote(p("russia"), { label, qualifier: "", own: "Opposition to the state" }), "", "matched by country: nothing to add");
  assert.equal(rowNote(p("country reports"), { label, qualifier: "Mogadishu", own: "x" }), "Mogadishu");
  assert.equal(rowNote(null, { label, qualifier: "Gaza", own: "x" }), "Gaza", "rows shown by 'Show all': the plain qualifier");
});

test("without a table, only identical titles group (case and punctuation aside)", () => {
  const data = [{ slug: "aa", name: "Aaland", reports: [R("security  situation", "2"), R("security situation in Gaza", "3"), R("Documentation", "4")] },
    { slug: "bb", name: "Bbland", reports: [R("Security situation", "1")] }];
  const plain = buildGroups(data);
  const hits = data.flatMap((c) => c.reports.map((r) => ({ c, r })));
  assert.deepEqual(groupReports(hits, plain).map((e) => (e.rows ? `${e.label} [${e.rows.map((x) => x.c.slug)}]` : e.r.key)), ["security  situation [aa,bb]", "3", "4"]);
});

test("a report is found by the heading it is listed under, and by its row label there, as well as by its own title", () => {
  const countriesWith = [{ slug: "so", name: "Somalia", reports: [R("Mogadishu: Al Shabab", "1")] }];
  const table = () => [{ key: "security", label: "Security situation", qualifier: "Mogadishu (Al Shabab)" }];
  assert.equal(matchReports(parseQuery("security situation"), countriesWith).length, 0, "not by its own words");
  assert.equal(matchReports(parseQuery("security situation"), countriesWith, { groupsOf: table }).length, 1, "but under its group's heading");
  assert.equal(matchReports(parseQuery("shabab"), countriesWith, { groupsOf: table }).length, 1);
});

test("the real data through the reviewed table: the owner's queries", async () => {
  const { topicGroups } = await import("../../prototypes/shared/topic-groups.js");
  const real = buildGroups(countries, topicGroups);
  const run = (q) => { const parsed = parse(q); const hits = matchReports(parsed, countries, { groupsOf: topicGroups }); return { hits, out: groupReports(hits, real, { groupsOf: topicGroups, parsed }) }; };
  const names = (g) => g.rows.map((x) => `${x.c.name}${x.qualifier ? ` · ${x.qualifier}` : ""}`);

  const hum = run("humanitarian");
  assert.equal(hum.out.length, 1, "everything in one list: nothing left over as a separate result");
  assert.equal(hum.out[0].label, "Humanitarian situation");
  assert.equal(hum.out[0].rest.length, 0);
  assert.ok(names(hum.out[0]).includes("Somalia · Mogadishu") && names(hum.out[0]).includes("Palestine · Gaza"), names(hum.out[0]).join("; "));
  assert.ok(names(hum.out[0]).some((l) => /^Somalia · Security and humanitarian situation in Mogadishu$/.test(l)));

  const critics = run("critics");
  assert.equal(critics.out.length, 1);
  assert.match(critics.out[0].label, /^Opposition to/);
  assert.ok(critics.out[0].rows.length >= 3 && critics.out[0].rest.length >= 1, "the critics reports first, the rest of the group behind 'Show all'");
  assert.ok(critics.out[0].rows.every((x) => /critic/i.test(x.r.topic)));
  assert.equal(critics.out[0].reports, critics.out[0].rows.length + critics.out[0].rest.length);

  const gaza = run("gaza").out;
  assert.deepEqual(gaza.map((e) => e.label).sort(), ["Humanitarian situation", "Security situation"]);
  assert.ok(gaza.every((e) => e.rows.every((x) => x.c.slug === "palestine") && e.rest.length > 0));

  const mog = run("mogadishu").out;
  assert.deepEqual(mog.map((e) => e.label).sort(), ["Humanitarian situation", "Security situation"]);
  assert.ok(mog.every((e) => e.rows.every((x) => x.c.slug === "somalia")));

  assert.match(run("modern slavery").out[0].label, /trafficking/i);
  assert.match(run("gangs").out[0].label, /^Gangs/);
  assert.equal(run("actors of protection").out[0].rest.length, 0);
  const pkk = run("PKK").out;
  assert.ok(pkk.length === 1 && !pkk[0].rows && pkk[0].r.topic === "PKK", "a standalone subject: no heading");

  // Every report is listed at least once whatever the query, and a standalone report is never also in a group.
  const all = run("country report").out;
  const inGroups = new Set(all.filter((e) => e.rows).flatMap((e) => e.rows.map((x) => x.r)));
  const singles = all.filter((e) => !e.rows).map((e) => e.r);
  assert.equal(new Set([...inGroups, ...singles]).size, allReports);
  assert.ok(singles.every((r) => !inGroups.has(r)));
  assert.ok(all.filter((e) => e.rows).every((e) => e.rest.length === 0 && e.rows.length === e.reports));
});

test("live reports come before ones no longer on GOV.UK", () => {
  const hits = reports("actors of protection");
  const firstGone = hits.findIndex((x) => x.r.status !== "live");
  if (firstGone >= 0) assert.ok(hits.slice(firstGone).every((x) => x.r.status !== "live"));
});
