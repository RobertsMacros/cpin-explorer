// A small card by a link in the report's text, saying where it leads before it is followed: the site
// and address of a source and whether it still works (from the link check), the report a link opens
// here, or the section a link within the page goes to. Nothing is fetched: it says only what the page
// already knows. Display only: the card lives outside the text and the text is never changed.
//
//   linkFacts({ link, status, held, target })   what to say (pure; tested in web/test/link-card.test.mjs)
//   mountLinkCards({ scope, describe })          shows it when the pointer rests on a link, or a link is focused
import { DEAD, EXPLAIN, LABEL } from "../shared/link-status.js";

const host = (url) => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; } };
const day = (iso) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/London" }) : "");
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : "");

/** An address without its scheme, shortened in the middle so both the site and the end of the path show. */
export function shortAddress(url, max = 58) {
  let u;
  try { u = new URL(url); } catch { return String(url || ""); }
  const full = `${u.hostname.replace(/^www\./, "")}${u.pathname.replace(/\/$/, "")}${u.search}`;
  if (full.length <= max) return full;
  const tail = Math.max(12, Math.floor(max * 0.4)), headLen = max - tail - 1;
  return `${full.slice(0, headLen)}…${full.slice(-tail)}`;
}

/**
 * What is known about where a link leads. Exactly one of status / held / target describes it:
 *   link    { href, govukHref }       its address (and, for a link that opens here, its GOV.UK address)
 *   status  the link check's entry for a source ({ status, code, final_url, archived_url, archived_at, checked_at }), or null if unchecked
 *   held    a link that opens in this site: { country: { name, reports }, report: { topic, kind, status, latest } | null }
 *   target  a link within the page: { heading, text }
 * Returns { kind, eyebrow, tag, tone ("ok" | "warn" | "dead" | ""), title, lines: [text], more: [{ label, href }] }.
 */
export function linkFacts({ link, status = null, held = null, target = null }) {
  if (target) {
    return { kind: "in-page", eyebrow: "In this report", tag: "", tone: "", title: target.heading || "Further down this report",
      lines: target.text ? [target.text] : [], more: [] };
  }
  if (held) {
    const r = held.report, L = r?.latest || {};
    if (!r) {
      const n = held.country.reports?.length || 0;
      return { kind: "country", eyebrow: "Opens here", tag: "", tone: "", title: held.country.name,
        lines: [n ? `${n} ${n === 1 ? "report" : "reports"} held` : "Its reports, on the start page"], more: link.govukHref ? [{ label: "On GOV.UK ↗", href: link.govukHref }] : [] };
    }
    const when = L.published ? (L.published_precision === "month" ? new Date(L.published).toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "Europe/London" }) : day(L.published)) : "";
    const live = r.status === "live";
    return { kind: "report", eyebrow: "Opens here", tag: live ? "" : "No longer on GOV.UK", tone: live ? "" : "warn", title: cap(r.topic),
      lines: [[held.country.name, r.kind].filter(Boolean).join(" · "), [L.version ? `v${L.version}` : "", when].filter(Boolean).join(" · ")].filter(Boolean),
      more: link.govukHref ? [{ label: "On GOV.UK ↗", href: link.govukHref }] : [] };
  }
  const url = link.href, s = status?.status;
  const tone = !s ? "" : s === "ok" ? "ok" : DEAD.has(s) ? "dead" : "warn";
  const lines = [shortAddress(url)];
  if (!status) lines.push("Not checked yet");
  else {
    const said = [EXPLAIN[s] || s, status.code && s !== "ok" ? `HTTP ${status.code}` : "", status.reason || ""].filter(Boolean).join(" · ");
    lines.push(status.checked_at ? `${said} · checked ${day(status.checked_at)}` : said);
  }
  const more = [];
  if (s === "moved" && status.final_url) more.push({ label: `Now at ${host(status.final_url)} ↗`, href: status.final_url });
  if (DEAD.has(s) && status.archived_url) more.push({ label: `Archived copy${status.archived_at ? `, ${day(status.archived_at)}` : ""} ↗`, href: status.archived_url });
  return { kind: "source", eyebrow: "Source", tag: !s ? "" : s === "ok" ? "Works" : LABEL[s] || "Can't verify", tone, title: host(url) || url, lines, more };
}

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/**
 * Show a card for links inside `scope`.
 *   describe(a)   what to say about a link (linkFacts' result), or null for none (footnote marks have their own panel)
 * A mouse gets it after the pointer has rested on the link (`rest` ms), and it stays while the pointer
 * is on the link or the card; the keyboard gets it on focus. A finger does not: a tap follows the link.
 * Escape, a press, or starting to select text puts it away. One at a time; it eases in and out.
 */
export function mountLinkCards({ scope, describe, rest = 250, grace = 180, topInset = () => 0 }) {
  let card = null, owner = null, restTimer = 0, leaveTimer = 0, heldTitle = null;
  const selecting = () => { const sel = getSelection(); return !!sel && !sel.isCollapsed; };

  function close() {
    clearTimeout(restTimer); clearTimeout(leaveTimer);
    if (owner && heldTitle != null) owner.setAttribute("title", heldTitle);      // the browser's own tooltip, given back
    const el = card;
    card = owner = heldTitle = null;
    if (!el) return;
    el.classList.remove("is-on");
    setTimeout(() => el.remove(), 200);
  }
  function open(a, at) {
    const facts = describe(a);
    if (!facts || !a.isConnected) return;
    close();
    owner = a;
    heldTitle = a.getAttribute("title");                                           // or two tooltips would show
    if (heldTitle != null) a.removeAttribute("title");
    const el = document.createElement("div");
    el.className = "link-card";
    el.setAttribute("role", "tooltip");
    el.innerHTML = `<p class="lk-top"><span class="eyebrow">${esc(facts.eyebrow)}</span>${facts.tag ? `<span class="tag lk-tag lk-tag--${esc(facts.tone || "plain")}">${esc(facts.tag)}</span>` : ""}</p>
      <p class="lk-title">${esc(facts.title)}</p>${facts.lines.map((l) => `<p class="lk-line">${esc(l)}</p>`).join("")}${
      facts.more.length ? `<p class="lk-more">${facts.more.map((m) => `<a href="${esc(m.href)}" target="_blank" rel="noopener">${esc(m.label)}</a>`).join("")}</p>` : ""}`;
    document.body.append(el);
    // By the line of the link the pointer is on (a link may wrap), below it if there is room, else above; kept on screen.
    const rects = [...a.getClientRects()];
    const r = (at && rects.find((q) => at.y >= q.top - 2 && at.y <= q.bottom + 2)) || rects[0] || a.getBoundingClientRect();
    const w = el.offsetWidth, h = el.offsetHeight, gap = 8;
    const below = r.bottom + gap + h <= innerHeight - 12 || r.top - gap - h < topInset() + 8;
    const left = Math.max(12, Math.min(innerWidth - w - 12, at ? at.x - 24 : r.left));
    el.style.left = `${left + scrollX}px`;
    el.style.top = `${(below ? r.bottom + gap : r.top - gap - h) + scrollY}px`;
    el.dataset.side = below ? "below" : "above";
    void el.offsetWidth;                                                            // so it eases in from its start
    el.classList.add("is-on");
    el.addEventListener("pointerenter", () => clearTimeout(leaveTimer));
    el.addEventListener("pointerleave", () => { leaveTimer = setTimeout(close, grace); });
    card = el;
  }
  const linkOf = (e) => {
    const a = e.target instanceof Element ? e.target.closest("a[href]") : null;
    return a && scope.contains(a) ? a : null;
  };

  scope.addEventListener("pointerover", (e) => {
    if (e.pointerType !== "mouse") return;
    const a = linkOf(e);
    if (!a) return;
    clearTimeout(leaveTimer);
    if (a === owner) return;
    clearTimeout(restTimer);
    if (e.buttons || selecting()) return;                                           // dragging out a selection: not now
    const at = { x: e.clientX, y: e.clientY };
    restTimer = setTimeout(() => { if (!selecting()) open(a, at); }, rest);
  });
  scope.addEventListener("pointerout", (e) => {
    const a = linkOf(e);
    if (!a || (e.relatedTarget instanceof Node && a.contains(e.relatedTarget))) return;
    clearTimeout(restTimer);
    if (a === owner) leaveTimer = setTimeout(close, grace);
  });
  scope.addEventListener("focusin", (e) => { const a = linkOf(e); if (a?.matches(":focus-visible")) open(a, null); });
  scope.addEventListener("focusout", (e) => { if (linkOf(e) === owner && !(card && e.relatedTarget instanceof Node && card.contains(e.relatedTarget))) close(); });
  addEventListener("pointerdown", (e) => { if (!(card && e.target instanceof Node && card.contains(e.target))) close(); }, true);
  addEventListener("keydown", (e) => { if (e.key === "Escape" && card) close(); });
  document.addEventListener("selectionchange", () => { if (card && selecting()) close(); });
  return { close, get open() { return !!card; } };
}
