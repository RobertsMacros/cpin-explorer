import { api, accountReady, accountStore } from "./account-state.js";
import { escHtml as esc } from "./citation.js";
import { FEEDBACK_REASONS, reviewFingerprint } from "./review-feedback-core.js";

const thumb = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 10v10H3V10h5Zm0 0 5-7h2v7h5l1 2-3 8H8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>';
export const feedbackPlaceholder = record => record.kind === "ai" && record.id
  ? `<section class="ai-feedback" data-ai-feedback="${esc(record.id)}" aria-label="Human feedback on this AI review"><p class="sr-meta" role="status">Loading human feedback…</p></section>` : "";
function feedbackHtml(row, user, options) {
  const { error = "", busy = false, editing = false, draftVote = "disagree", note = "", reason = "other" } = options;
  const permitted = user?.approved && row.mine !== null, own = row.mine, result = row.result;
  return `<p class="sr-meta ai-feedback-counts">${row.approvals} human approval${row.approvals === 1 ? "" : "s"} · ${row.disagreements} disagreement${row.disagreements === 1 ? "" : "s"}${row.disagreements ? row.recheck === "queued" ? " · Needs recheck" : " · Recheck recorded" : ""}</p>
    <p class="sr-meta">Approval applies to this AI assessment, not the whole source or report.</p>
    ${permitted ? `<div class="ai-feedback-buttons">
      <button type="button" class="btn" data-feedback-act="approve" aria-pressed="${own.vote === "approve"}" ${busy || error ? "disabled" : ""}>${thumb}Approve</button>
      <button type="button" class="btn" data-feedback-act="disagree" aria-pressed="${own.vote === "disagree"}" aria-expanded="${editing && draftVote === "disagree"}" ${busy || error ? "disabled" : ""}><span class="ai-thumb-down">${thumb}</span>Disagree</button>
      ${own.vote ? `<button type="button" class="linklike" data-feedback-act="edit" ${busy || error ? "disabled" : ""}>Edit note</button><button type="button" class="linklike" data-feedback-act="clear" ${busy || error ? "disabled" : ""}>Clear my feedback</button>` : ""}
    </div>` : `<p class="sr-meta"><a href="../account/">Sign in with an approved account</a> to approve or disagree.</p>`}
    ${editing && permitted ? `<form class="ai-feedback-form">
      <p class="field-label">${draftVote === "disagree" ? "Send for AI recheck" : "Note on your approval"}</p>
      ${draftVote === "disagree" ? `<label>What needs checking?<select name="reason">${Object.entries(FEEDBACK_REASONS).map(([value, label]) => `<option value="${value}" ${reason === value ? "selected" : ""}>${esc(label)}</option>`).join("")}</select></label>` : '<input type="hidden" name="reason" value="other">'}
      <label>Explanation (optional)<textarea name="note" maxlength="2000" rows="3" placeholder="Which part is wrong, and why? A source or pinpoint helps.">${esc(note)}</textarea></label>
      <p class="sr-meta">Your note is shared with the owner and AI recheck process, separately from your private saved notes. Avoid personal details. Related unconfirmed reviews will be considered; they are not automatically flagged.</p>
      <div class="ai-feedback-buttons"><button type="submit" class="btn btn--primary" ${busy || error ? "disabled" : ""}>${draftVote === "disagree" ? "Send for AI recheck" : "Save note"}</button><button type="button" class="btn" data-feedback-act="cancel" ${busy ? "disabled" : ""}>Cancel</button></div>
    </form>` : own?.note ? `<p class="sr-meta">Your note: ${esc(own.note)}</p>` : ""}
    <p class="ai-feedback-message" role="status">${busy ? "Saving feedback…" : esc(error) || (own?.vote === "approve" ? "You approved this AI review." : own?.vote === "disagree" ? "Your disagreement is saved." : "")}</p>
    ${row.recheck === "queued" ? '<p class="sr-meta">Queued for AI recheck. It has not been rechecked yet.</p>' : ""}
    ${result ? `<details class="ai-recheck-result"><summary>${row.recheck === "queued" ? "Previous AI recheck" : "AI recheck"} · ${esc({ supported: "original assessment supported", "correction-supported": "correction supported", unresolved: "unresolved" }[result.outcome] || result.outcome)}</summary>
      <p>${esc(result.explanation)}</p>${result.failurePattern ? `<p class="sr-meta">Recurring error to check: ${esc(result.failurePattern)}</p>` : ""}<p class="sr-meta">${result.peersChecked} of ${result.peerPool} unconfirmed assessments checked. The original assessment is retained${result.outcome === "correction-supported" ? " pending publication of a validated correction" : ""}.</p>
      ${result.evidenceLinks.map(url => `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">Recheck evidence ↗</a>`).join(" · ")}
      ${result.peerChecks?.length ? `<details><summary>Other assessments checked (${result.peerChecks.length})</summary>${result.peerChecks.map(peer => `<article class="sr-record"><p class="sr-meta">${esc(peer.outcome)}</p><p>${esc(peer.explanation)}</p>${peer.failurePattern ? `<p>${esc(peer.failurePattern)}</p>` : ""}<p>${(peer.targets || []).map(target => `<a href="../reader/?${esc(new URLSearchParams({ country: target.country, series: target.series, edition: target.editionId }).toString())}">Open ${esc(target.country)} edition</a>`).join(" · ")}</p>${peer.evidenceLinks.map(url => `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">Peer evidence ↗</a>`).join(" · ")}</article>`).join("")}</details>` : ""}</details>` : ""}
    <button type="button" class="linklike" data-feedback-act="reload" ${busy ? "disabled" : ""}>Refresh feedback</button>`;
}
export async function mountReviewFeedback(root, records, request = api) {
  const recordsById = new Map(records.filter(r => r.kind === "ai").map(r => [r.id, r]));
  const placeholders = [...root.querySelectorAll("[data-ai-feedback]")].filter(el => recordsById.has(el.dataset.aiFeedback) && !el.dataset.feedbackMounted);
  if (!placeholders.length) return;
  placeholders.forEach(el => { el.dataset.feedbackMounted = "true"; });
  await accountReady;
  const ids = [...new Set(placeholders.map(el => el.dataset.aiFeedback))], states = new Map();
  try {
    for (let start = 0; start < ids.length; start += 40) {
      const data = await request("/api/review-feedback?ids=" + ids.slice(start, start + 40).map(encodeURIComponent).join(","));
      for (const row of data.records) states.set(row.id, row);
    }
  } catch (error) {
    for (const el of placeholders) if (el.isConnected) {
      el.innerHTML = `<p class="sr-meta" role="status">Human feedback unavailable. ${esc(error.message)}</p><button type="button" class="linklike">Retry feedback</button>`;
      el.querySelector("button").addEventListener("click", () => { delete el.dataset.feedbackMounted; void mountReviewFeedback(root, records, request); }, { once: true });
    }
    return;
  }
  for (const el of placeholders) {
    if (!el.isConnected) continue;
    const record = recordsById.get(el.dataset.aiFeedback), fingerprint = await reviewFingerprint(record);
    let row = states.get(record.id), options = {};
    if (!row || row.recordSha !== fingerprint) options.error = "This AI assessment changed. Reload the page before reviewing.";
    row ||= { id: record.id, recordSha: "", approvals: 0, disagreements: 0, mine: null, recheck: "none", result: null };
    const render = () => { if (el.isConnected) el.innerHTML = feedbackHtml(row, accountStore.state.user, options); };
    render();
    const save = async (vote, reason = "other", note = "") => {
      if (options.busy || options.error || !row.mine || !accountStore.state.user?.approved) return;
      options.busy = true; render();
      try {
        row = await request(`/api/review-feedback/${encodeURIComponent(record.id)}`, { recordSha: fingerprint, vote, reason, note, revision: row.mine.revision }, "PUT");
        options = {};
      } catch (error) { options.busy = false; options.error = error.message; }
      render();
    };
    el.addEventListener("click", async e => {
      const button = e.target.closest("[data-feedback-act]");
      if (!button || options.busy) return;
      const action = button.dataset.feedbackAct;
      if (action === "approve") await save("approve", "other", row.mine?.note || "");
      if (action === "clear") await save(null);
      if (action === "disagree" || action === "edit") {
        options = { editing: true, draftVote: action === "disagree" ? "disagree" : row.mine.vote, note: row.mine.note, reason: row.mine.reason };
        render(); el.querySelector("textarea")?.focus();
      }
      if (action === "cancel") { options = {}; render(); }
      if (action === "reload") {
        try {
          const data = await request("/api/review-feedback?ids=" + encodeURIComponent(record.id)), updated = data.records[0];
          if (updated.recordSha !== fingerprint) throw new Error("This AI assessment changed. Reload the page before reviewing.");
          row = updated; options = {}; render();
        } catch (error) { options.error = error.message; render(); }
      }
    });
    el.addEventListener("submit", e => {
      const form = e.target.closest(".ai-feedback-form"); if (!form) return;
      e.preventDefault(); const values = Object.fromEntries(new FormData(form));
      options.note = values.note; options.reason = values.reason;
      void save(options.draftVote, values.reason, values.note);
    });
  }
}
