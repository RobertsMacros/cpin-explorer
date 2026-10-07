// Feedback identifies the complete AI record, including its edition/hash scope.
// It never changes canonical text, a published reviewer, or the original AI record.
export const FEEDBACK_REASONS = {
  quotation: "Quotation or wording", numbers: "Numbers or units", citation: "Source or date",
  context: "Missing context", scope: "Wrong edition or scope", other: "Something else",
};
export async function reviewFingerprint(record) {
  const bytes = new TextEncoder().encode(JSON.stringify(record));
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(n => n.toString(16).padStart(2, "0")).join("");
}
export function applicationReviewRecord(application, review) {
  return { ...application, reviewTitle: review.title, reviewUrl: review.url,
    publication: application.publication || { url: review.url, title: review.title } };
}
export function aiReviewCatalogue(annotations, published, directory) {
  const records = [...annotations, ...published,
    ...directory.flatMap(review => (review.applications || []).filter(r => r.kind === "ai").map(r => applicationReviewRecord(r, review)))
  ].filter(r => r.kind === "ai");
  const seen = new Map();
  for (const record of records) {
    if (seen.has(record.id) && JSON.stringify(seen.get(record.id)) !== JSON.stringify(record)) throw new Error("Conflicting AI review identity: " + record.id);
    seen.set(record.id, record);
  }
  return [...seen.values()];
}
export const reviewTargets = record => record.targets || (record.target ? [record.target] : []);
function sources(record) {
  return new Set([record.sourceCopyUrl, record.publication?.url, record.evidence?.url, record.target?.sourceUrl,
    ...(record.evidenceLinks || []).map(e => e.url), ...reviewTargets(record).flatMap(t => (t.anchors || []).map(a => a.sourceUrl))
  ].filter(Boolean).map(url => { try { const u = new URL(url); u.hash = ""; return u.href; } catch { return ""; } }).filter(Boolean));
}
function families(record) {
  const text = [record.summary, record.scope, record.sourceLocation].filter(Boolean).join(" ").toLowerCase();
  return new Set([
    [/quot|wording|typ(?:o|ograph)|spelling|ellipsis/, "quotation"],
    [/number|figure|percent|ratio|population|prevalence|unit|statistic/, "numbers"],
    [/citation|footnote|bibliograph|date|accessed|source identity|attribution/, "citation"],
    [/context|infer|interpret|coverage|limitation/, "context"],
    [/edition|historical|scope|applicability/, "scope"],
  ].filter(([pattern]) => pattern.test(text)).map(([, name]) => name));
}
export function relatedUnconfirmed(record, records, totals, reason = "other") {
  const originalSources = sources(record), originalFamilies = families(record);
  const reviews = new Set(record.reviewOf || []);
  const result = [];
  for (const candidate of records) {
    if (candidate.kind !== "ai" || candidate.id === record.id || (totals.get(candidate.id)?.approvals || 0) > 0) continue;
    const relations = [];
    if ([...sources(candidate)].some(source => originalSources.has(source))) relations.push("same source");
    if ((candidate.reviewOf || []).some(id => reviews.has(id))) relations.push("same published review");
    const candidateFamilies = families(candidate);
    if (reason !== "other" ? candidateFamilies.has(reason) : [...candidateFamilies].some(f => originalFamilies.has(f))) relations.push("similar check type");
    if (reviewTargets(candidate).some(t => reviewTargets(record).some(x => x.country === t.country && x.series === t.series))) relations.push("same report series");
    result.push({ id: candidate.id, reasons: relations, rank: relations.includes("same source") ? 0 : relations.includes("same published review") ? 1 : relations.length ? 2 : 3 });
  }
  return result.sort((a, b) => a.rank - b.rank || a.id.localeCompare(b.id));
}
