// A review belongs to one edition and one use of a source. Never put private
// records in the site export: human notes use a separate private browser or approved-account store.
import { escHtml as esc } from "./citation.js";
import { savedStorage, accountReady, accountStore } from "./account-state.js";
await accountReady;

export const STORAGE_KEY = "cpin-source-reviews-v1";
const TARGET_FIELDS = ["country", "series", "editionId", "textSha", "footnote", "paragraph", "section", "sourceUrl"];
export function httpUrl(value) {
  try { const u = new URL(value); return /^(https?:)$/.test(u.protocol) ? u.href : ""; } catch { return ""; }
}
const canonical = (url) => { const u = httpUrl(url); return u ? u.split("#")[0] : ""; };
export const targetKey = (t) => JSON.stringify(TARGET_FIELDS.map((k) => k === "sourceUrl" ? canonical(t[k]) : String(t[k] ?? "")));
const validTarget = (t) => t && /^[a-f0-9]{16,64}$/.test(t.editionId || "") && /^[a-f0-9]{64}$/.test(t.textSha || "")
  && t.country && t.series && Number.isInteger(t.footnote) && t.footnote > 0 && t.paragraph && t.section;
export function matches(record, target) {
  return validTarget(record?.target) && validTarget(target) && targetKey(record.target) === targetKey(target);
}
export function forTarget(records, target) { return records.filter((r) => matches(r, target)); }
export function reportReviews(reviews, target) {
  // A report-level review provides context; it cannot assess every footnote.
  return reviews.filter((r) => r.kind === "direct-review" && (r.reviewedProduct === "uk-cpin" || r.reviewedProducts?.includes("uk-cpin"))
    && r.targets?.some((t) => t.scope === "whole-report" && t.mapping === "edition-declaration-checked"
      && ["country", "series", "editionId", "textSha"].every((key) => t[key] && t[key] === target[key])));
}
export function backgroundReviews(reviews, target) {
  const exact = new Set(reportReviews(reviews, target).map((r) => r.id));
  return reviews.filter((r) => r.countries?.includes(target.country) && !exact.has(r.id));
}
export function applicationChecks(reviews, target) {
  // A fresh follow-up on a later edition is our AI assessment, not evidence
  // that the original reviewer audited that edition or every citation in it.
  return reviews.flatMap((r) => (Array.isArray(r.applications) ? r.applications : []).filter((a) => a?.kind === "ai"
    && /^[a-f0-9]{16,64}$/.test(a.target?.editionId || "") && /^[a-f0-9]{64}$/.test(a.target?.textSha || "")
    && ["country", "series", "editionId", "textSha"].every((key) => a.target[key] && a.target[key] === target[key]))
    .map((a) => ({ ...a, reviewTitle: r.title, reviewUrl: r.url })));
}
export function sourceCopies(copies, target) {
  return copies.filter((r) => /^[a-f0-9]{64}$/.test(r.sha256 || "") && httpUrl(r.url)
    && r.targets?.some((t) => ["country", "series", "editionId", "textSha", "footnote"].every((key) => t[key] === target[key])
      && canonical(t.sourceUrl) === canonical(target.sourceUrl)));
}
export function activeRecords(records) {
  // Human edits append to the journal; only the most recent local decision is
  // current. Independent published and AI findings remain visible alongside it.
  const manual = records.filter((r) => r.kind === "manual").at(-1);
  return records.filter((r) => r.kind !== "manual" || r === manual);
}
export function reviewStatus(records) {
  const active = activeRecords(records);
  const issues = active.filter((r) => (["manual", "external"].includes(r.kind) && ["issue", "criticism"].includes(r.status))
    || (r.kind === "ai" && r.status === "possible-issue"));
  for (const [severity, tone] of [["major", "red"], ["minor", "yellow"]]) {
    const finding = issues.find((r) => r.severity === severity);
    if (finding) {
      const by = { ai: "AI review", external: "Published reviewer’s finding", manual: "Private reviewer’s finding" }[finding.kind];
      return { tone, symbol: "⚑", label: `${severity === "major" ? "Major" : "Minor"} ${finding.status === "criticism" ? "concern" : "error"} · ${by}` };
    }
  }
  // Older private entries have no severity. Keep the issue visible without
  // inventing an impact assessment or allowing a checked tick to hide it.
  if (issues.length) return { tone: "grey", symbol: "⚑", label: "Issue recorded · severity not assigned" };
  if (active.some((r) => r.kind === "manual" && r.status === "checked" && r.author?.trim())) return { tone: "green", symbol: "✓", label: "Marked checked · private review" };
  return { tone: "grey", symbol: "○", label: active.some((r) => r.kind === "ai" && r.status === "no-issue") ? "AI review · no issue found in this check" : active.length ? "Review context recorded" : "No review recorded" };
}
export function badgeHtml(records) {
  const s = reviewStatus(records);
  return `<span class="source-review-badge sr-${s.tone}" role="img" aria-label="${esc(s.label)}" title="${esc(s.label)}"><span aria-hidden="true">${s.symbol}</span></span>`;
}

export function createPrivateStore(getStorage = savedStorage) {
  let journal = null;
  let persistFailed = false;
  function load() {
    // Re-read so another tab's entries aren't overwritten by a stale snapshot.
    if (persistFailed) return journal || [];
    try {
      const data = JSON.parse(getStorage()?.getItem(STORAGE_KEY) || "[]");
      if (Array.isArray(data)) journal = data.filter((r) => r?.kind === "manual" && validTarget(r.target));
    } catch {}
    return journal || [];
  }
  return {
    load,
    save(target, { status, severity, author, organisation = "", comment = "", excerpt = "" }, now = new Date().toISOString()) {
      if (["minor-issue", "major-issue"].includes(status)) { severity = status.split("-")[0]; status = "issue"; }
      if (!validTarget(target)) throw new Error("This citation cannot be anchored reliably; review it in the original document.");
      if (!["note", "checked", "issue"].includes(status)) throw new Error("Choose a review status.");
      if (status === "issue" && !["minor", "major"].includes(severity)) throw new Error("Choose minor or major error.");
      if (!author.trim()) throw new Error("Enter the reviewer's name.");
      if (!comment.trim()) throw new Error("Add a note describing what you checked or found.");
      const record = { id: globalThis.crypto.randomUUID(), kind: "manual", target: { ...target }, status,
        author: author.trim().slice(0, 120), organisation: organisation.trim().slice(0, 120),
        comment: comment.trim().slice(0, 4000), excerpt: excerpt.trim().slice(0, 4000), reviewedAt: now };
      if (status === "issue") record.severity = severity;
      journal = [...load(), record];
      try {
        const storage = getStorage();
        if (!storage) { persistFailed = true; return { record, persisted: false }; }
        storage.setItem(STORAGE_KEY, JSON.stringify(journal));
        persistFailed = false;
        return { record, persisted: true };
      } catch { persistFailed = true; return { record, persisted: false }; }
    },
  };
}

const link = (url, label) => httpUrl(url) ? `<a href="${esc(httpUrl(url))}" target="_blank" rel="noopener noreferrer">${esc(label)} ↗</a>` : "";
const date = (s) => { const d = new Date(s); return Number.isFinite(d.getTime()) ? d.toLocaleDateString("en-GB", { timeZone: "Europe/London", ...(/^\d{4}-\d{2}$/.test(s) ? { month: "long", year: "numeric" } : {}) }) : "Date not recorded"; };
function evidenceHtml(r) {
  if (r.kind === "manual" && r.excerpt) return `<div class="sr-evidence"><p class="field-label">Source passage · pasted by reviewer</p><blockquote>${esc(r.excerpt)}</blockquote>${link(r.target.sourceUrl, "Read full source")}</div>`;
  const e = r.evidence;
  // Public excerpts need an explicit rights decision in the published record.
  if (!e?.quote || e.publicDisplayApproved !== true || typeof e.rightsBasis !== "string" || !e.rightsBasis.trim() || !httpUrl(e.url)) return "";
  return `<div class="sr-evidence"><p class="field-label">${esc(e.title || "Source passage")}</p><blockquote>${esc(e.quote)}</blockquote><p>${esc([e.author, e.location].filter(Boolean).join(" · "))}</p>${link(e.url, "Read full source")}</div>`;
}
export function recordHtml(r, previous = false, followups = []) {
  const kind = { ai: "AI review", external: "Published review", manual: "Private human review · self-reported" }[r.kind] || "Review";
  const impact = ["issue", "possible-issue", "criticism"].includes(r.status) ? ({ major: " · Major", minor: " · Minor" }[r.severity] || " · Severity not assigned") + (r.status === "criticism" ? " concern" : " error") : "";
  const body = `<p class="sr-meta">${esc(kind)}${impact}${previous ? " · previous entry" : ""}</p>
    <p>${esc(r.comment || r.summary || "")}</p>
    ${r.kind === "external" ? '<p class="sr-meta">Attributed to the published reviewer; any AI assessment is separate.</p>' : ""}
    ${r.status === "context" ? `<p class="sr-meta">${r.kind === "ai" ? "Scoped context comparison" : "Attributed review context"} · no independent factual verdict.</p>` : ""}
    ${r.summaryDetail ? `<p>${esc(r.summaryDetail)}</p>` : ""}
    <p class="sr-meta">${esc([r.author, r.organisation, date(r.reviewedAt || r.publishedAt)].filter(Boolean).join(" · "))}</p>
    ${r.publication ? `<p>${link(r.publication.url, r.publication.title || "Read published review")}${r.publication.location ? ` · ${esc(r.publication.location)}` : ""}</p>` : ""}
    ${r.sourceCopyUrl ? `<p class="sr-meta">${link(r.sourceCopyUrl, "Source checked")}${r.sourceLocation ? ` · ${esc(r.sourceLocation)}` : ""}</p>` : ""}
    ${Array.isArray(r.reviewPages) ? `<nav class="sr-page-links" aria-label="Pages in this review section">${r.reviewPages.map((p) => link(p.url, `Page ${p.page}`)).filter(Boolean).join(" · ")}</nav>` : ""}
    ${evidenceHtml(r)}
    ${r.response ? `<section class="sr-response" data-review-kind="home-office"><p><strong>Home Office response${r.responseIsExcerpt ? " · extract" : ""}</strong></p><p>${esc(r.response)}</p><p class="sr-meta">Published reply; this does not settle the reviewer's criticism.</p>${r.publication ? link(r.publication.url, "Read response in the published review") : ""}</section>` : ""}
    ${followups.length ? `<section class="sr-review-followups" data-review-kind="ai"><p class="field-label">AI assessment of this review</p><p class="sr-meta">The published review above is retained unchanged.</p>${followups.map((a) => recordHtml(a)).join("")}</section>` : ""}
    ${r.reviewOf?.length ? '<p class="sr-meta">Separate AI follow-up on the published review; it does not replace the reviewer’s words.</p>' : ""}
    ${(r.evidenceLinks || []).length ? `<p>${r.evidenceLinks.map((e) => link(e.url, e.title || "Evidence")).join(" · ")}</p>` : ""}
    ${r.responseSearch ? `<p class="sr-meta">${esc(r.responseSearch)}</p>` : ""}`;
  return r.collapsible === true ? `<details class="sr-record sr-comment"><summary>${esc(r.summary || "Published comment")}</summary>${body}</details>` : `<article class="sr-record">${body}</article>`;
}
export function linkedReviewAssessments(records, target) {
  const keys = ["country", "series", "editionId", "textSha"];
  const scoped = (r) => (r.targets || (r.target ? [r.target] : [])).some((t) =>
    /^[a-f0-9]{16,64}$/.test(t.editionId || "") && /^[a-f0-9]{64}$/.test(t.textSha || "")
    && keys.every((key) => t[key] && t[key] === target[key]));
  const published = records.filter((r) => r.kind === "external" && scoped(r));
  const byReview = new Map(published.map((r) => [r.id, []]));
  const linked = new Set();
  for (const r of records.filter((r) => r.kind === "ai" && scoped(r))) {
    for (const id of Array.isArray(r.reviewOf) ? r.reviewOf : []) {
      if (!byReview.has(id)) continue;
      byReview.get(id).push(r); linked.add(r);
    }
  }
  return { byReview, linked };
}
export function reportPanelHtml(target, records, reviews, { unavailable = false, loading = false, passage = false } = {}) {
  const exact = reportReviews(reviews, target), background = backgroundReviews(reviews, target);
  const { byReview, linked } = linkedReviewAssessments(records, target);
  const ai = records.filter((r) => r.kind === "ai" && !linked.has(r)), followups = applicationChecks(reviews, target);
  const directory = (rs) => rs.map((r) => `<article class="sr-record"><p>${link(r.url, r.title)}</p><p class="sr-meta">${esc((r.publishers || []).join(" / "))} · ${esc(r.publishedAt || "Date not recorded")}${r.reviewedEdition?.label ? " · " + esc(r.reviewedEdition.label) : ""}</p>${r.summary ? `<p>${esc(r.summary)}</p>` : ""}${(r.relatedUrls || []).map((u) => link(u, "Related publication / response")).join(" · ")}</article>`).join("");
  return `<div class="source-reviews sr-report-panel">
    <p class="sr-scope">${passage ? "This passage in this exact edition only." : "This exact edition only."} Published criticism and AI assessment are separate; neither is a verdict on the whole report.</p>
    ${loading ? '<p role="status">Loading reviews…</p>' : ""}${unavailable ? '<p role="status">Some review records could not be loaded.</p>' : ""}
    <section class="sr-review-group" data-review-kind="external"><h3>Published reviews</h3>
      ${records.filter((r) => r.kind === "external").map((r) => recordHtml(r, false, byReview.get(r.id) || [])).join("")}
      ${exact.length ? `<details open><summary>Reviews of this edition (${exact.length})</summary>${directory(exact)}</details>` : passage ? "" : '<p class="sr-meta">No whole-report review mapped to this edition.</p>'}
      ${background.length ? `<details><summary>Other country reviews (${background.length})</summary><p class="sr-meta">Different editions or contextual publications; applicability to this edition is not established.</p>${directory(background)}</details>` : ""}
    </section>
    <section class="sr-review-group" data-review-kind="ai"><h3>AI review</h3>
      ${ai.map((r) => recordHtml(r)).join("")}
      ${followups.map((r) => recordHtml({ ...r, summary: r.summary, publication: r.publication || { url: r.reviewUrl, title: r.reviewTitle } })).join("")}
      ${linked.size ? '<p class="sr-meta">AI assessments of published reviews appear beneath the reviewer and any published Home Office response above.</p>' : ""}
      ${ai.length || linked.size || followups.length || loading || unavailable ? "" : `<p class="sr-meta">No AI review recorded for this ${passage ? "passage" : "edition"}.</p>`}
    </section>
    <section class="sr-review-group" data-review-kind="manual"><h3>Manual additions</h3><p class="sr-meta">Independent human notes can be added in a footnote overlay and are kept ${accountStore.state.user?.approved ? "privately in your account" : "in this browser"}. They are optional and do not approve or replace AI findings.</p></section>
  </div>`;
}
export function panelHtml(target, records, { publicUnavailable = false, publicLoading = false, editionReviews = [], countryReviews = [], matchingCopies = [], directoryUnavailable = false } = {}) {
  const active = activeRecords(records), old = records.filter((r) => r.kind === "manual" && !active.includes(r));
  const manual = active.find((r) => r.kind === "manual");
  const { byReview, linked } = linkedReviewAssessments(active, target);
  const published = active.filter((r) => r.kind === "external"), ai = active.filter((r) => r.kind === "ai" && !linked.has(r));
  const followups = applicationChecks([...editionReviews, ...countryReviews], target);
  const states = { note: "Private note", checked: "Checked this citation", "minor-issue": "Minor error · yellow flag", "major-issue": "Major error · red flag" };
  const editorStatus = manual?.status === "issue" ? (manual.severity ? `${manual.severity}-issue` : "issue") : manual?.status;
  if (editorStatus === "issue") states.issue = "Issue recorded · choose severity";
  const scope = target.paragraph ? `Paragraph ${target.paragraph} · ${target.section}` : "This footnote";
  return `<section class="sr-source" data-source-url="${esc(target.sourceUrl || "")}">
    <p class="sr-scope">${esc(scope)}</p>${badgeHtml(records)}
    ${!active.some((r) => r.excerpt || r.evidence?.publicDisplayApproved) ? `<p class="sr-meta">Source text is not held inline yet. ${link(target.sourceUrl, "Open source to review")}</p>` : ""}
    ${matchingCopies.map((r) => `<p class="sr-meta">${link(r.url, "Matching report PDF")} · ${esc(r.title)} · ${esc(r.publishedMonth)}. Report identity checked against the PDF cover; this citation’s claim has not been assessed.</p>`).join("")}
    <section class="sr-review-group" data-review-kind="external"><h3 class="sr-group-heading">Published reviews</h3>
      ${publicLoading ? '<p class="sr-meta">Loading published reviews…</p>' : ""}
      ${publicUnavailable ? '<p class="sr-meta">Published reviews could not be loaded.</p>' : ""}
      ${published.length ? published.map((r) => recordHtml(r, false, byReview.get(r.id) || [])).join("") : !publicLoading && !publicUnavailable ? '<p class="sr-meta">No published review recorded for this citation.</p>' : ""}
      ${directoryUnavailable ? '<p class="sr-meta">The published-review directory could not be loaded.</p>' : ""}
      ${editionReviews.length ? `<details class="sr-report-reviews"><summary>Reviews of this report edition (${editionReviews.length})</summary>
        <p class="sr-meta">These reviews concern the whole report. Their arguments have not been independently assessed here, or mapped to this citation.</p>
        ${editionReviews.map((r) => `<article class="sr-record"><p>${link(r.url, r.title)}</p><p>${esc(r.summary || "")}</p>
          <p class="sr-meta">${esc((r.publishers || []).join(" / "))} · ${esc(r.publishedAt || "Date not recorded")} · ${esc(r.reviewedEdition?.label || "")}</p></article>`).join("")}</details>` : ""}
      ${countryReviews.length ? `<details class="sr-background-reviews"><summary>Other reviews found for this country (${countryReviews.length})</summary>
        <p class="sr-meta">Background only. These may concern a different report, older edition or another publisher’s country information. Applicability to this edition and citation has not been established; their arguments remain unassessed.</p>
        ${countryReviews.map((r) => `<article class="sr-record"><p>${link(r.url, r.title)}</p><p>${esc(r.summary || "")}</p>
          <p class="sr-meta">${esc([...(r.publishers || []), ...(r.coAuthors || [])].join(" / "))} · ${esc(r.publishedAt || "Date not recorded")} · ${esc(({ "uk-cpin": "UK CPIN review/context", "uk-cig": "Historical UK guidance review", "easo-coi": "EASO source-report review", "usdos-human-rights": "US State Department source-report review" })[r.reviewedProduct] || r.reviewedProduct || "Review context")}</p>
          ${r.reviewedEdition?.label ? `<p class="sr-meta">Reviewed edition: ${esc(r.reviewedEdition.label)}</p>` : ""}
          ${(r.relatedUrls || []).length ? `<p>${r.relatedUrls.map((u) => link(u, /\.pdf(?:#|$)/i.test(u) ? "Related document / response" : "Publication context / repository")).join(" · ")}</p>` : ""}</article>`).join("")}</details>` : ""}
    </section>
    <section class="sr-review-group" data-review-kind="ai"><h3 class="sr-group-heading">AI review</h3>
      ${publicLoading ? '<p class="sr-meta">Loading AI review records…</p>' : ""}
      ${publicUnavailable ? '<p class="sr-meta">AI review records could not be loaded.</p>' : ""}
      ${ai.map((r) => recordHtml(r)).join("")}
      ${linked.size ? '<p class="sr-meta">AI assessments of published reviews appear beneath the reviewer and any published Home Office response above.</p>' : ""}
      ${ai.length || linked.size || followups.length || publicLoading || publicUnavailable ? "" : '<p class="sr-meta">No AI review recorded for this citation.</p>'}
      ${followups.length ? `<details class="sr-review-followups"><summary>Published-review follow-up for this edition (${followups.length})</summary>
        <p class="sr-meta">Scoped AI comparisons with published reviews. These do not check every citation.</p>
        ${followups.map((a) => `<article class="sr-record"><p class="sr-meta">${["major", "minor"].includes(a.severity) ? badgeHtml([{kind:"ai",status:"possible-issue",severity:a.severity}]) + " " : ""}${esc(a.assessment)} · ${esc(a.scope)}</p>
          <p><strong>Published criticism:</strong> ${esc(a.reviewFinding)}</p>
          ${a.response ? `<p><strong>Home Office response:</strong> ${esc(a.response)}</p>` : ""}
          <p><strong>AI follow-up:</strong> ${esc(a.summary)}</p>
          <p class="sr-meta">${esc(a.author)} · ${esc(a.reviewedAt)} · ${esc((a.paragraphs || []).join(", "))}</p>
          ${(a.evidenceLinks || []).length ? `<p>${a.evidenceLinks.map((e) => link(e.url, e.title || "Evidence")).join(" · ")}</p>` : ""}
          <p>${link(a.publication?.url || a.reviewUrl, a.reviewTitle)}${a.publication?.location ? ` · ${esc(a.publication.location)}` : ""}</p>
          </article>`).join("")}</details>` : ""}
    </section>
    <section class="sr-review-group" data-review-kind="manual"><h3 class="sr-group-heading">Manual additions</h3>
    ${manual ? recordHtml(manual) : '<p class="sr-meta">No manual additions yet.</p>'}
    ${old.length ? `<details><summary>Previous human entries (${old.length})</summary>${old.map((r) => recordHtml(r, true)).join("")}</details>` : ""}
    ${validTarget(target) ? `<details class="sr-editor"><summary>${manual ? "Update private review" : "Add private human review"}</summary>
    <form class="sr-form" data-review-source="${esc(target.sourceUrl || "")}">
      <p class="sr-meta">Kept ${accountStore.state.user?.approved ? "privately in your account" : "in this browser"}. Names and organisations are self-reported; this is not a team sign-off.</p>
      <label>Your name<input name="author" required maxlength="120" autocomplete="name" value="${esc(manual?.author || "")}"></label>
      <label>Organisation (optional)<input name="organisation" maxlength="120" value="${esc(manual?.organisation || "")}"></label>
      <label>Status<select name="status" aria-label="Status">${Object.entries(states).map(([v, label]) => `<option value="${v}"${editorStatus === v ? " selected" : ""}>${esc(label)}</option>`).join("")}</select></label>
      <label>What you checked or found<textarea name="comment" required maxlength="4000" rows="3">${esc(manual?.comment || "")}</textarea></label>
      <label>Source passage (optional)<textarea name="excerpt" maxlength="4000" rows="4" placeholder="Paste the relevant passage for comparison here">${esc(manual?.excerpt || "")}</textarea></label>
      <button type="submit" class="btn">Save private review</button><p class="sr-form-result" role="status"></p>
    </form></details>` : '<p class="sr-meta">This citation cannot be anchored reliably for a private review.</p>'}
    </section>
    </section>`;
}
