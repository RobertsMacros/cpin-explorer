import { accountAuth } from "./auth.js";
import { completeRecheck, feedbackRead, feedbackWrite, recheckQueue } from "./review-feedback.js";

const KINDS = new Set(["highlights", "pins", "reviews"]);
const AUTH_PATHS = new Set(["/sign-up/email", "/sign-in/email", "/sign-out", "/get-session", "/reset-password", "/change-password"]);
const MAX_BODY = 96 * 1024, MAX_VALUE = 64 * 1024;
const encoder = new TextEncoder();
function reply(data, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store, private",
    "X-Content-Type-Options": "nosniff", "X-Robots-Tag": "noindex, nofollow, noarchive" } });
}
function fail(message, status) { throw Object.assign(new Error(message), { status }); }
async function body(req) {
  if (!req.headers.get("content-type")?.startsWith("application/json")) fail("Use JSON.", 415);
  const reader = req.body?.getReader();
  if (!reader) fail("Missing request.", 400);
  let size = 0; const chunks = [];
  while (true) { const { value, done } = await reader.read(); if (done) break;
    size += value.length; if (size > MAX_BODY) { await reader.cancel(); fail("This saved item is too large.", 413); } chunks.push(value); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  let parsed;
  try { parsed = JSON.parse(new TextDecoder().decode(bytes)); } catch { fail("Invalid JSON.", 400); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) fail("Use a JSON object.", 400);
  return parsed;
}
function validValue(kind, id, value) {
  if (value === null) return;
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("Invalid saved item.", 400);
  if (kind === "highlights" && (value.id !== id || typeof value.quote !== "string" || !value.country || !value.note)) fail("Invalid highlight.", 400);
  if (kind === "pins") {
    const expected = value.type === "country" ? `country:${value.country}` : `report:${value.country}:${value.series}`;
    if (!["country", "report"].includes(value.type) || !/^[a-z0-9-]+$/.test(value.country || "") || id !== expected) fail("Invalid pin.", 400);
  }
  if (kind === "reviews" && (value.id !== id || value.kind !== "manual" || !value.target || !/^[a-f0-9]{64}$/.test(value.target.textSha || ""))) fail("Invalid private review.", 400);
}
async function signedIn(auth, req, db) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session?.user?.id) fail("Sign in to continue.", 401);
  // Always re-read approval; neither a cached user nor an old session grants access.
  const user = await db.prepare('SELECT id, name, email, role, approved FROM "user" WHERE id = ?').bind(session.user.id).first();
  if (!user) fail("Sign in to continue.", 401);
  return { user: { ...user, approved: !!user.approved }, session: session.session };
}
function approved(user) { if (!user.approved) fail("Your account is awaiting approval.", 403); }
function owner(identity) {
  approved(identity.user);
  if (identity.user.role !== "owner") fail("Owner access required.", 403);
  if (Date.now() - new Date(identity.session.createdAt).getTime() > 30 * 60 * 1000) fail("Sign in again before changing accounts.", 401);
}
async function resetRate(db, req) {
  const ip = req.headers.get("cf-connecting-ip") || "local";
  const key = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(ip)))).map(n=>n.toString(16).padStart(2,"0")).join("");
  const bucket = Math.floor(Date.now() / 3600000);
  const r = await db.prepare(`INSERT INTO account_limits (key, bucket, count) VALUES (?, ?, 1)
    ON CONFLICT(key) DO UPDATE SET bucket=excluded.bucket, count=CASE WHEN account_limits.bucket=excluded.bucket THEN account_limits.count+1 ELSE 1 END
    RETURNING count`).bind(key, bucket).first();
  if (r.count > 5) fail("Please try again later.", 429);
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url), path = url.pathname;
    if (!path.startsWith("/api/")) return env.ASSETS.fetch(req);
    try {
      if (!env.ACCOUNTS || !env.BETTER_AUTH_SECRET || !env.AUTH_ORIGIN) {
        return path === "/api/account" ? reply({ configured: false, user: null }) : reply({ message: "Accounts have not been configured yet." }, 503);
      }
      if (req.headers.get("sec-fetch-site") === "cross-site") fail("This request is not allowed.", 403);
      if (!["GET", "POST", "PUT"].includes(req.method)) fail("Method not allowed.", 405);
      if (req.method !== "GET" && req.headers.get("origin") !== env.AUTH_ORIGIN) fail("This request is not allowed.", 403);
      const auth = accountAuth(env), db = env.ACCOUNTS;
      if (path.startsWith("/api/auth/")) {
        if (!AUTH_PATHS.has(path.slice(9))) fail("Not found.", 404);
        // Enforce a bound before the auth library reads password payloads.
        if (req.method !== "GET") {
          const data = await body(req);
          const bounded = new Request(req.url, { method: req.method, headers: req.headers, body: JSON.stringify(data) });
          const result = await auth.handler(bounded);
          const headers = new Headers(result.headers); headers.set("Cache-Control", "no-store, private");
          headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
          return new Response(result.body, { status: result.status, headers });
        }
        const result = await auth.handler(req); const headers = new Headers(result.headers);
        headers.set("Cache-Control", "no-store, private"); return new Response(result.body, { status: result.status, headers });
      }
      if (path === "/api/password-help" && req.method === "POST") {
        await resetRate(db, req); const data = await body(req);
        const email = String(data.email || "").trim().toLowerCase();
        if (email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          await db.prepare(`INSERT INTO password_requests (user_id, requested_at) SELECT id, ? FROM "user" WHERE email = ?
            ON CONFLICT(user_id) DO UPDATE SET requested_at=excluded.requested_at`).bind(Date.now(), email).run();
        }
        return reply({ message: "If an account matches, the owner can arrange a password reset. Contact the owner to receive your link." });
      }
      if (path === "/api/account" && req.method === "GET") {
        try { const { user } = await signedIn(auth, req, db); return reply({ configured: true, authOrigin:env.AUTH_ORIGIN, user }); }
        catch (e) { if (e.status === 401) return reply({ configured: true, authOrigin:env.AUTH_ORIGIN, user: null }); throw e; }
      }
      if (path === "/api/review-feedback" && req.method === "GET") {
        let reader = null;
        try { reader = (await signedIn(auth, req, db)).user; } catch (e) { if (e.status !== 401) throw e; }
        return reply(await feedbackRead(db, (url.searchParams.get("ids") || "").split(",").filter(Boolean), reader));
      }
      const identity = await signedIn(auth, req, db); const { user } = identity;
      const feedbackPath = path.match(/^\/api\/review-feedback\/([\w.-]{1,180})$/);
      if (feedbackPath && req.method === "PUT") return reply(await feedbackWrite(db, user, feedbackPath[1], await body(req)));
      if (path === "/api/saved" && req.method === "GET") {
        approved(user);
        const rows = await db.prepare("SELECT kind, id, value, revision FROM saved_items WHERE user_id = ? ORDER BY kind, id").bind(user.id).all();
        return reply({ items: rows.results.map(r => ({ ...r, value: r.value === null ? null : JSON.parse(r.value) })) });
      }
      const itemPath = path.match(/^\/api\/saved\/(highlights|pins|reviews)\/([^/]+)$/);
      if (itemPath && req.method === "PUT") {
        approved(user); const kind = itemPath[1]; let id;
        try { id = decodeURIComponent(itemPath[2]); } catch { fail("Invalid saved item ID.", 400); }
        if (!KINDS.has(kind) || !/^[\w:.-]{1,180}$/.test(id)) fail("Invalid saved item ID.", 400);
        const data = await body(req); validValue(kind, id, data.value);
        if (!Number.isSafeInteger(data.revision) || data.revision < 0) fail("Invalid revision.", 400);
        const value = data.value === null ? null : JSON.stringify(data.value), size = value === null ? 0 : encoder.encode(value).length;
        if (size > MAX_VALUE) fail("This saved item is too large.", 413);
        const saved = data.revision === 0
          ? await db.prepare(`INSERT INTO saved_items (user_id,kind,id,value,revision,bytes,updated_at)
              SELECT ?, ?, ?, ?, 1, ?, ? WHERE
                (SELECT COUNT(*) FROM saved_items WHERE user_id=?) < 10000 AND
                (SELECT COALESCE(SUM(bytes),0) FROM saved_items WHERE user_id=?) + ? <= 8388608
              ON CONFLICT(user_id,kind,id) DO NOTHING RETURNING revision`)
              .bind(user.id,kind,id,value,size,Date.now(),user.id,user.id,size).first()
          : await db.prepare(`UPDATE saved_items SET value=?,revision=revision+1,bytes=?,updated_at=?
              WHERE user_id=? AND kind=? AND id=? AND revision=? AND
                (SELECT COALESCE(SUM(bytes),0) FROM saved_items WHERE user_id=?) - bytes + ? <= 8388608
              RETURNING revision`).bind(value,size,Date.now(),user.id,kind,id,data.revision,user.id,size).first();
        if (!saved) {
          const current = await db.prepare("SELECT value,revision FROM saved_items WHERE user_id=? AND kind=? AND id=?").bind(user.id,kind,id).first();
          if (current && current.revision !== data.revision) return reply({ message: "This item changed on another device.", current: { value: current.value === null ? null : JSON.parse(current.value), revision: current.revision } }, 409);
          if (!current && data.revision !== 0) fail("This item changed on another device.", 409);
          fail("Account saving limit reached. Download a copy; remove large saved items or contact the owner.", 413);
        }
        return reply({ revision: saved.revision });
      }
      if (path.startsWith("/api/owner/")) {
        owner(identity);
        if (path === "/api/owner/recheck-queue" && req.method === "GET") return reply(await recheckQueue(db, Number(url.searchParams.get("page") || 0)));
        if (path === "/api/owner/recheck-result" && req.method === "POST") return reply(await completeRecheck(db, await body(req)));
        if (path === "/api/owner/accounts" && req.method === "GET") {
          const page=Number(url.searchParams.get("page") || 0);
          if(!Number.isSafeInteger(page) || page<0 || page>10000) fail("Invalid page.",400);
          const total=await db.prepare('SELECT COUNT(*) AS total FROM "user"').first();
          const result = await db.prepare(`SELECT u.id,u.name,u.email,u.approved,u.role,u.createdAt,p.requested_at AS passwordRequestedAt
            FROM "user" u LEFT JOIN password_requests p ON p.user_id=u.id ORDER BY u.approved,u.createdAt DESC,u.id LIMIT 50 OFFSET ?`).bind(page*50).all();
          return reply({ accounts: result.results, total:total.total, page });
        }
        const data = await body(req);
        const target = await db.prepare('SELECT id,email,role,approved FROM "user" WHERE id=?').bind(String(data.userId || "")).first();
        if (!target) fail("Account not found.", 404);
        if (path === "/api/owner/approval" && req.method === "POST") {
          if (target.role === "owner" || typeof data.approved !== "boolean") fail("Cannot change owner access here.", 400);
          await db.batch([
            db.prepare('UPDATE "user" SET approved=?,updatedAt=? WHERE id=? AND role<>\'owner\'').bind(data.approved ? 1 : 0, Date.now(), target.id),
            db.prepare('DELETE FROM session WHERE userId=?').bind(target.id),
            db.prepare('INSERT INTO approval_events (id,user_id,owner_id,approved,created_at) VALUES (?,?,?,?,?)').bind(crypto.randomUUID(),target.id,user.id,data.approved ? 1 : 0,Date.now()),
            db.prepare('UPDATE review_feedback_epoch SET revision=revision+1 WHERE id=1'),
          ]);
          return reply({ approved: data.approved });
        }
        if (path === "/api/owner/password-link" && req.method === "POST") {
          if (!target.approved) fail("Approve the account before arranging a reset.", 403);
          let link = null;
          const resetAuth = accountAuth(env, async ({ token }) => { link = `${env.AUTH_ORIGIN}/prototypes/account/?view=reset#token=${encodeURIComponent(token)}`; });
          await resetAuth.api.requestPasswordReset({ body: { email: target.email, redirectTo: `${env.AUTH_ORIGIN}/prototypes/account/?view=reset` } });
          if (!link) fail("Could not create a reset link.", 500);
          await db.prepare('DELETE FROM password_requests WHERE user_id=?').bind(target.id).run();
          return reply({ url: link, expiresInMinutes: 30 });
        }
      }
      fail("Not found.", 404);
    } catch (e) {
      return reply({ message: e.status ? e.message : "Account service is temporarily unavailable. Your public reading remains available." }, e.status || 503);
    }
  },
};
