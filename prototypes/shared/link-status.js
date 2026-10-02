// Shows whether each source a note cites still works (from `./cpin links`), and where it leads.
//
//   const status = await loadLinkStatus("iran");          // url -> {status, code, final_url, archived_url, ...}
//   const summary = decorateLinks(noteElement, status);   // marks the links, returns counts + the dead ones
//
// Display only: the note's own markup and words are never changed, apart from small tags added after
// links whose target has moved, died or could not be checked.
import { fetchJson } from "./fetch-json.js";

const DATA = new URL("../data/links/", import.meta.url);

const LABEL = {
  ok: null,
  moved: "Moved",
  broken: "Dead",
  "server-error": "Down",
  unreachable: "Down",
  restricted: "Can't verify",
  robots: "Not checked",
  other: "Can't verify",
};
const EXPLAIN = {
  ok: "Works",
  moved: "Works, but now redirects elsewhere",
  broken: "No longer available",
  "server-error": "The site returned a server error",
  unreachable: "The site could not be reached",
  restricted: "The site refuses automated checks, so it could not be verified",
  robots: "Not checked: the site asks automated tools not to visit this page",
  other: "Unexpected response",
};
export const DEAD = new Set(["broken", "server-error", "unreachable"]);

export async function loadLinkStatus(country) {
  try {
    return await fetchJson(new URL(`${country}.json`, DATA));
  } catch {
    return {};                          // not checked yet: links simply show no status
  }
}

const strip = (url) => url.split("#")[0];
const host = (url) => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; } };
const day = (iso) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "");

/** One line describing a link's state, for tooltips and lists. */
export function describe(url, entry) {
  if (!entry) return `${host(url)} · not checked yet`;
  const parts = [host(url), EXPLAIN[entry.status] || entry.status];
  if (entry.code && entry.status !== "ok") parts.push(`HTTP ${entry.code}`);
  if (entry.reason) parts.push(entry.reason);
  if (entry.final_url && entry.status === "moved") parts.push(`now at ${host(entry.final_url)}`);
  if (entry.checked_at) parts.push(`checked ${day(entry.checked_at)}`);
  return parts.join(" · ");
}

export function decorateLinks(root, statusMap) {
  const counts = { total: 0, ok: 0, moved: 0, dead: 0, archived: 0, unverified: 0, unchecked: 0 };
  const dead = [];
  for (const a of root.querySelectorAll("a[href^='http']")) {
    if (a.closest(".linkstatus")) continue;
    const url = strip(a.href);
    const entry = statusMap[url] ?? statusMap[url.replace(/^https:/, "http:")];
    counts.total += 1;
    a.title = describe(url, entry);
    if (!entry) { counts.unchecked += 1; continue; }
    a.dataset.linkStatus = entry.status;
    if (entry.status === "ok") { counts.ok += 1; continue; }
    if (entry.status === "moved") counts.moved += 1;
    else if (DEAD.has(entry.status)) counts.dead += 1;
    else counts.unverified += 1;
    const tag = document.createElement("span");
    tag.className = `linkstatus linkstatus--${DEAD.has(entry.status) ? "dead" : entry.status === "moved" ? "moved" : "unverified"}`;
    tag.textContent = LABEL[entry.status] || "Can't verify";
    if (entry.status === "moved" && entry.final_url) {
      const to = Object.assign(document.createElement("a"), { href: entry.final_url, target: "_blank", rel: "noopener",
        className: "linkstatus-alt", textContent: `now at ${host(entry.final_url)} ↗` });
      tag.append(" ", to);
    }
    if (DEAD.has(entry.status) && entry.archived_url) {
      counts.archived += 1;
      const archived = Object.assign(document.createElement("a"), { href: entry.archived_url, target: "_blank", rel: "noopener",
        className: "linkstatus-alt", textContent: `archived ${day(entry.archived_at)} ↗`,
        title: "Internet Archive copy closest to when the Home Office cited this source" });
      tag.append(" ", archived);
    }
    if (DEAD.has(entry.status)) dead.push({ url, entry, anchor: a, text: a.textContent.trim() });
    a.after(tag);
  }
  return { counts, dead };
}

/** 'Sources: 312 links · 291 work · 9 moved · 8 dead (6 archived) · 4 can't verify' */
export function summaryLine({ counts }) {
  const bits = [`${counts.total} links`, `${counts.ok} work`];
  if (counts.moved) bits.push(`${counts.moved} moved`);
  if (counts.dead) bits.push(`${counts.dead} dead${counts.archived ? ` (${counts.archived} archived)` : ""}`);
  if (counts.unverified) bits.push(`${counts.unverified} can't verify`);
  if (counts.unchecked) bits.push(`${counts.unchecked} not checked yet`);
  return bits.join(" · ");
}
