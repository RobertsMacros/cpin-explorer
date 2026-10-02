import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  addHighlight, checkHighlight, citeContext, exportJson, exportMarkdown, groupHighlights, loadHighlights, locateQuote,
  makeSelector, normalizeWithMap, removeHighlight, restoreHighlight, saveHighlights, snapToWords, STORAGE_KEY,
  updateHighlight, useStorage,
} from "../../prototypes/shared/highlights.js";
import { editionSource, latestCapture, pickEdition } from "../../prototypes/shared/note-source.js";
import { formatCitation } from "../../prototypes/shared/citation.js";
import { decodeEntities } from "../../prototypes/shared/redline-diff.js";

const ROOT = new URL("../../", import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), "utf8");
const NOTES = "data/countries/iran/notes";
const MIL = "country-policy-and-information-note-military-service-iran-august-2026-accessible";
const EXIT = "country-policy-and-information-note-illegal-exit-iran-may-2022-accessible";
const ARCH = "country-policy-and-information-note-military-service-iran-november-2022-accessible";
// Close enough to the browser's textContent for these tests: tags out, entities decoded.
const textOf = (html) => decodeEntities(html.replace(/<[^>]+>/g, ""));
const milText = textOf(read(`${NOTES}/${MIL}/83755408bda958a3.html`));

class MemoryStorage {
  constructor() { this.m = new Map(); }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) { this.m.set(k, String(v)); }
}

test("selectors: snap to words, then find the passage again", () => {
  const i = milText.indexOf("the Supreme Leader has ultimate command");
  // A sloppy selection, starting and ending mid-word.
  const [s, e] = snapToWords(milText, i + 6, i + 30);
  assert.equal(milText.slice(s, e), "Supreme Leader has ultimate");
  const sel = makeSelector(milText, s, e);
  assert.equal(sel.prefix.length, 32);
  assert.equal(sel.suffix.length, 32);
  assert.deepEqual(locateQuote(milText, sel), { start: s, end: e, how: "position" });
  // Positions shifted (e.g. text added earlier): the exact words are found again.
  const shifted = "NEW PARAGRAPH. " + milText;
  assert.deepEqual(locateQuote(shifted, sel), { start: s + 15, end: e + 15, how: "exact" });
  // Whitespace reflowed: normalised match maps back to raw offsets.
  const quote = "Supreme Leader has\n   ultimate command";
  const ws = milText.slice(0, s) + quote + milText.slice(s + "Supreme Leader has ultimate command".length);
  const hit = locateQuote(ws, { quote: "Supreme Leader has ultimate command", prefix: sel.prefix, suffix: "" });
  assert.equal(hit.how, "normalised");
  assert.equal(ws.slice(hit.start, hit.end), quote);
  assert.equal(locateQuote(milText, { quote: "words that are not in the note at all" }), null);
});

test("selectors: prefix and suffix pick the right one of repeated words", () => {
  const text = "alpha beta gamma. The person must. delta epsilon. The person must. zeta eta.";
  const second = text.lastIndexOf("The person must");
  const sel = makeSelector(text, second, second + "The person must".length, 12);
  const hit = locateQuote("PREPENDED " + text, { ...sel, pos: undefined });
  assert.equal(hit.start, second + 10);
  // Real note: "Each case must be considered on its individual facts." occurs more than once.
  const phrase = "Each case must be considered on its individual facts.";
  const all = [...milText.matchAll(new RegExp(phrase.replace(/\./g, "\\."), "g"))].map((m) => m.index);
  assert.ok(all.length >= 2);
  const sel2 = makeSelector(milText, all[1], all[1] + phrase.length);
  assert.equal(locateQuote("x" + milText, { ...sel2, pos: undefined }).start, all[1] + 1);
});

test("normalizeWithMap collapses whitespace and keeps raw offsets", () => {
  const { norm, map } = normalizeWithMap("  a \n\n b\tc  ");
  assert.equal(norm, "a b c");
  assert.deepEqual(map.slice(0, norm.length), [2, 3, 7, 8, 9]);
});

test("staleness: same edition, still there, changed", () => {
  const i = milText.indexOf("Military service is compulsory");
  const rec = { ...makeSelector(milText, i, i + 60), editionSha: "aaa", version: "3.0" };
  assert.equal(checkHighlight(rec, { sha: "aaa", version: "3.0", text: milText }).status, "current");
  const still = checkHighlight(rec, { sha: "bbb", version: "4.0", text: "Intro. " + milText });
  assert.equal(still.status, "still");
  assert.equal(still.match.start, i + 7);
  const changed = checkHighlight(rec, { sha: "bbb", version: "4.0", text: milText.replaceAll("compulsory", "mandatory") });
  assert.deepEqual([changed.status, changed.from, changed.to], ["changed", "3.0", "4.0"]);
});

test("staleness against two real editions of the illegal exit note", () => {
  const index = JSON.parse(read(`${NOTES}/${EXIT}/index.json`));
  const [oldV, , liveV] = index.versions;
  const oldText = textOf(read(`${NOTES}/${EXIT}/${oldV.sha256.slice(0, 16)}.html`));
  const liveText = textOf(read(`${NOTES}/${EXIT}/${liveV.sha256.slice(0, 16)}.html`));
  // A paragraph the new edition rewrote has changed...
  const flat = (s) => s.replace(/\s+/g, " ");
  const gone = oldText.split("\n").map((l) => l.trim()).find((l) => l.length > 120 && !flat(liveText).includes(flat(l)));
  assert.ok(gone, "the editions differ somewhere");
  const i = oldText.indexOf(gone);
  const recGone = { ...makeSelector(oldText, i, i + gone.length), editionSha: oldV.sha256, version: oldV.version_banner };
  const c = checkHighlight(recGone, { sha: liveV.sha256, version: liveV.version_banner, text: liveText });
  assert.deepEqual([c.status, c.from, c.to], ["changed", "6.0", "7.0"]);
  // ...while a paragraph kept word for word is still there, at a new position.
  const kept = oldText.split("\n").map((l) => l.trim()).find((l) => l.length > 120 && liveText.includes(l) && oldText.indexOf(l) !== liveText.indexOf(l));
  assert.ok(kept, "the editions share a paragraph");
  const j = oldText.indexOf(kept);
  const recKept = { ...makeSelector(oldText, j, j + kept.length), editionSha: oldV.sha256, version: oldV.version_banner };
  const r = checkHighlight(recKept, { sha: liveV.sha256, version: liveV.version_banner, text: liveText });
  assert.equal(r.status, "still");
  assert.equal(liveText.slice(r.match.start, r.match.end), kept);
});

test("editions: live note, archived note, and the URL to cite", () => {
  const live = JSON.parse(read(`${NOTES}/${MIL}/index.json`));
  const e = pickEdition(live);
  assert.equal(e.sha256, live.current_sha256);
  assert.deepEqual(editionSource(e, { index: live, note: { govuk_url: "https://www.gov.uk/x" } }),
    { url: "https://www.gov.uk/x", archived: false, capturedAt: null });
  const arch = JSON.parse(read(`${NOTES}/${ARCH}/index.json`));
  assert.equal(arch.current_sha256, null);
  const a = pickEdition(arch);
  assert.equal(a.sha256.slice(0, 16), "2904b4bce22df31a", "the newest held edition");
  const src = editionSource(a, { index: arch, note: {} });
  assert.equal(src.archived, true);
  assert.equal(src.capturedAt, latestCapture(a).captured_at);
  assert.match(src.url, /^https:\/\/web\.archive\.org\/web\/\d{14}\//);
  // An older edition of a live note is cited from its archived copy.
  const exit = JSON.parse(read(`${NOTES}/${EXIT}/index.json`));
  assert.equal(editionSource(exit.versions[0], { index: exit, note: { govuk_url: "https://www.gov.uk/y" } }).archived, true);
});

test("storage: add, update, delete and undo; survives blocked storage", () => {
  const store = new MemoryStorage();
  useStorage(store);
  assert.deepEqual(loadHighlights(), []);
  const a = addHighlight({ country: "iran", note: MIL, quote: "one", title: "T", countryName: "Iran", pos: { start: 50, end: 53 } });
  const b = addHighlight({ country: "iran", note: MIL, quote: "two", title: "T", countryName: "Iran", pos: { start: 10, end: 13 } });
  assert.match(a.id, /^h[\w]+$/);
  assert.notEqual(a.id, b.id);
  assert.equal(JSON.parse(store.getItem(STORAGE_KEY)).length, 2);
  updateHighlight(a.id, { comment: "check para 9.1.2 too" });
  assert.equal(loadHighlights().find((r) => r.id === a.id).comment, "check para 9.1.2 too");
  const removed = removeHighlight(a.id);
  assert.equal(loadHighlights().length, 1);
  restoreHighlight(removed);
  assert.deepEqual(loadHighlights().map((r) => r.id), [a.id, b.id]);
  // Corrupt data is ignored rather than crashing the page.
  store.setItem(STORAGE_KEY, "{not json");
  assert.ok(Array.isArray(loadHighlights()));
  // Storage that throws: the session still works from memory.
  useStorage({ getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } });
  assert.equal(saveHighlights([{ id: "hx", quote: "q" }]), false);
  assert.deepEqual(loadHighlights().map((r) => r.id), ["hx"]);
  useStorage(null);
});

test("grouping and export", () => {
  const base = { kind: "CPIN", version: "4.0", month: "2026-08", editionSha: "s", url: "https://www.gov.uk/n", sources: [] };
  const recs = [
    { ...base, id: "h1", country: "iran", countryName: "Iran", note: MIL, topic: "military service",
      title: "Country policy and information note: military service, Iran, August 2026 (accessible)",
      quote: "9.1.1 Under articles 107 and 110[footnote 12]", para: "9.1.1", pos: { start: 900 },
      sources: [{ n: 12, text: "Iran Data Portal, Constitution, no date", url: "https://example.org" }], comment: "Key point" },
    { ...base, id: "h2", country: "iran", countryName: "Iran", note: MIL, topic: "military service",
      title: "Country policy and information note: military service, Iran, August 2026 (accessible)",
      quote: "Military service is compulsory", para: null, section: "Executive summary", pos: { start: 10 },
      check: "changed", current: { version: "5.0" } },
    { ...base, id: "h3", country: "afghanistan", countryName: "Afghanistan", note: "n2", topic: "humanitarian situation",
      title: "Country policy and information note: humanitarian situation, Afghanistan, April 2026 (accessible)",
      quote: "food insecurity", para: "8.1.6", pos: { start: 5 } },
  ];
  const g = groupHighlights(recs);
  assert.deepEqual(g.map((c) => c.country), ["afghanistan", "iran"]);
  assert.deepEqual(g[1].notes[0].items.map((r) => r.id), ["h2", "h1"], "in reading order");
  const md = exportMarkdown(recs, { style: "oscola", accessed: new Date(2026, 9, 2) });
  assert.match(md, /^# Saved highlights/);
  assert.match(md, /## Afghanistan[\s\S]*## Iran/);
  assert.match(md, /> Under articles 107 and 110\n/);
  assert.match(md, /Home Office, \*Country Policy and Information Note: Military Service, Iran\* \(version 4\.0, August 2026\) para 9\.1\.1 <https:\/\/www\.gov\.uk\/n#:~:text=/);
  assert.match(md, /- \[12\] Iran Data Portal, Constitution, no date <https:\/\/example\.org>/);
  assert.match(md, /_Changed since you saved it \(v4\.0 → v5\.0\)_/);
  assert.match(md, /Note: Key point/);
  assert.equal(JSON.parse(exportJson(recs)).highlights.length, 3);
  // A highlight still present in a newer edition cites where it is now.
  const moved = { ...recs[0], check: "still", current: { version: "5.0", month: "2026-11", title: "Country policy and information note: military service, Iran, November 2026 (accessible)", para: "9.2.1", section: "9. Armed forces", url: "https://www.gov.uk/n", archived: false } };
  assert.match(formatCitation(citeContext(moved), "tribunal").text, /\(v5\.0, Nov 2026\) at \[9\.2\.1\]$/);
});
