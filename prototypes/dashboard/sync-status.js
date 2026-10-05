// "How current is this copy?" in one place, in one clock (UK time). The scraper fetches GOV.UK once a
// day; each visit the page also asks GOV.UK directly whether any country page has been updated since.
// These are the pure parts: comparing the two, and the words for the header and the pop-up. Tested
// in web/test/sync-status.test.mjs.
import { ukDateTime, ukTime } from "../shared/uk-time.js";

export const CHECK_TTL_MS = 30 * 60_000;                    // a check is reused for half an hour
const TOLERANCE_MS = 60_000;                                // GOV.UK's stamp and ours can differ by seconds

/**
 * Compare GOV.UK's list of country pages with our copy.
 * ours: [{ slug, name, govuk_url, updated }]; docs: GOV.UK's [{ base_path, title, public_updated_at }].
 * Returns { at, pages, newer: [{ base_path, title, updated, slug, name, gone? }] }: `newer` are pages
 * GOV.UK has updated since our copy, that we do not hold at all (slug: null), or that GOV.UK no longer
 * lists (gone: true). The caller must not pass an empty list: no pages listed is no answer.
 */
export function compareWithGovuk(ours, docs, at) {
  const byPath = new Map(ours.filter((c) => !c.dropped_from_collection).map((c) => [String(c.govuk_url || "").replace(/^https:\/\/www\.gov\.uk/, ""), c]));
  const newer = [];
  const listed = new Set();
  for (const d of docs || []) {
    listed.add(d.base_path);
    const c = byPath.get(d.base_path);
    if (c && !(Date.parse(d.public_updated_at) > Date.parse(c.updated) + TOLERANCE_MS)) continue;
    newer.push({ base_path: d.base_path, title: d.title, updated: d.public_updated_at, slug: c?.slug ?? null, name: c?.name ?? d.title });
  }
  // A page we hold that GOV.UK no longer lists is a change too (updated: null, gone: true).
  for (const [path, c] of byPath) {
    if (path && !listed.has(path)) newer.push({ base_path: path, title: c.name, updated: null, slug: c.slug ?? null, name: c.name, gone: true });
  }
  return { at: new Date(at).toISOString(), pages: (docs || []).length, newer };
}

/** A stored check is good while it is younger than the limit (and not from the future). */
export function isFresh(check, now, ttl = CHECK_TTL_MS) {
  const at = Date.parse(check?.at);
  return Number.isFinite(at) && Array.isArray(check.newer) && now - at >= 0 && now - at < ttl;
}

const updates = (n) => `${n} NEWER UPDATE${n === 1 ? "" : "S"}`;

/**
 * The header's status line. fetchedAt: when our copy was last fetched; check: the result of
 * compareWithGovuk, or null when GOV.UK has not been asked yet or could not be reached.
 * Returns { state: "accurate" | "newer" | "fetched", text, title }.
 */
export function syncStatus({ fetchedAt, check = null }) {
  const fetched = ukDateTime(fetchedAt);
  if (!check) {
    return { state: "fetched", text: `COPY FETCHED ${fetched}`,
      title: `Our copy was fetched ${fetched}. It has not been checked against GOV.UK on this visit.` };
  }
  const n = check.newer.length;
  if (n) {
    return { state: "newer", text: `GOV.UK HAS ${updates(n)}`,
      title: `Checked against GOV.UK's update dates at ${ukTime(check.at)}. Our copy was fetched ${fetched}; the next sync will mirror ${n === 1 ? "it" : "them"}.` };
  }
  return { state: "accurate", text: `ACCURATE AS OF ${ukDateTime(check.at)}`,
    title: `Checked against GOV.UK's update dates at ${ukTime(check.at)}: nothing newer. Our copy was fetched ${fetched}.` };
}

/**
 * The pop-up's words: what was compared, said plainly. Returns { heading, body, foot }; with newer
 * updates the list of them goes between body and foot.
 */
export function checkSummary({ fetchedAt, check = null }) {
  const fetched = ukDateTime(fetchedAt);
  if (!check) {
    return { heading: "Couldn’t reach GOV.UK", body: `Try again in a moment. Our copy was fetched ${fetched}.`, foot: "" };
  }
  const n = check.newer.length, pages = check.pages === 1 ? "the 1 country page" : `all ${check.pages} country pages`;
  if (!n) {
    return { heading: "Up to date", body: `GOV.UK’s last-updated dates for ${pages} match our copy.`,
      foot: `Checked ${ukTime(check.at)}. Our copy was fetched ${fetched}.` };
  }
  return { heading: `GOV.UK has ${updates(n)}`, body: `${n === 1 ? "This page has" : "These pages have"} changed on GOV.UK since our copy was fetched.`,
    foot: `The next daily sync will mirror ${n === 1 ? "it" : "them"}. Checked ${ukTime(check.at)}. Our copy was fetched ${fetched}.` };
}
