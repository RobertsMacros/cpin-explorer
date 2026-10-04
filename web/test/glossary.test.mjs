import assert from "node:assert/strict";
import { test } from "node:test";
import { GLOSSARY, GROUPS, glossaryEntry, glossaryHref, searchGlossary } from "../../prototypes/shared/glossary.js";

const ids = (q, o) => searchGlossary(q, o).map((e) => e.id);

test("every entry is complete, with a unique id and a known group", () => {
  const seen = new Set();
  for (const e of GLOSSARY) {
    assert.match(e.id, /^[a-z0-9-]+$/);
    assert.ok(!seen.has(e.id), `duplicate id ${e.id}`);
    seen.add(e.id);
    assert.ok(e.term && e.def.length > 40 && e.def.endsWith("."), e.id);
    assert.ok(GROUPS[e.group], `${e.id}: group ${e.group}`);
  }
});

test("CPIN is spelled out", () => {
  const e = glossaryEntry("cpin");
  assert.equal(e.full, "Country Policy and Information Note");
  assert.equal(glossaryHref("cpin"), "../guide/index.html#term-cpin");
});

test("the site search finds a term by its name, what it stands for, or another word for it", () => {
  assert.equal(ids("cpin")[0], "cpin");
  assert.equal(ids("country policy and information note")[0], "cpin");
  assert.equal(ids("country report")[0], "cpin");
  assert.equal(ids("15c")[0], "article-15c");
  assert.equal(ids("oscola")[0], "citation-styles");
  assert.equal(ids("wayback")[0], "archived-copy");
  assert.equal(ids("internal relocation")[0], "internal-relocation");
  assert.equal(ids("fact finding")[0], "ffm");
  assert.equal(ids("iagc")[0], "iagci", "the start of a word is enough");
});

test("the site search does not match on explanations: no noise under ordinary searches", () => {
  assert.deepEqual(ids("treaty"), []);                                 // only inside the Refugee Convention's explanation
  assert.deepEqual(ids("iran"), []);
  assert.deepEqual(ids(""), []);
  assert.deepEqual(ids("treaty", { definitions: true }), ["refugee-convention"], "the glossary's own filter does look inside explanations");
  assert.deepEqual(ids("government"), ["ogl"], "a word of a term's name is a match: Open Government Licence");
});

test("exact names come first, and the list can be capped", () => {
  assert.equal(ids("protection")[0], "actors-of-protection");          // "protection" is another word for it
  assert.ok(ids("protection").includes("sufficiency-of-protection") && ids("protection").includes("humanitarian-protection"));
  assert.equal(searchGlossary("protection", { limit: 2 }).length, 2);
});
