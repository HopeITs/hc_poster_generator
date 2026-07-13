// ============================================================
// STUDY ZONE — Auth Worker  (تسجيل دخول + إدارة مستخدمين + أدوار)
// قاعدة البيانات: D1 (studyzone-db) — مربوطة باسم  DB
// أسرار: SETUP_SECRET, RESEND_API_KEY, ALLOWED_ORIGINS (مطلوب للإنتاج)
// ============================================================

const ROLES = ["owner", "admin", "comms", "user"];
const MIN_PASSWORD_LEN = 8;
const LOGIN_MAX_ATTEMPTS = 10;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const NOTIFY_MAX_PER_HOUR = 10;
const NOTIFY_MAX_ATTACHMENTS = 6;
const NOTIFY_MAX_TOTAL_B64 = 12 * 1024 * 1024;
const SESSION_COOKIE = "sz_auth";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function isValidEmail(email) {
  return EMAIL_RE.test(email || "");
}

function validatePassword(password) {
  if ((password || "").length < MIN_PASSWORD_LEN) {
    return "كلمة السر " + MIN_PASSWORD_LEN + " أحرف على الأقل";
  }
  return null;
}

function getAllowedOrigins(env) {
  return (env.ALLOWED_ORIGINS || "")
    .split(",")
    .map(function (s) { return s.trim(); })
    .filter(Boolean);
}

function corsHeaders(request, env) {
  var origin = request.headers.get("Origin");
  var allowed = getAllowedOrigins(env);
  var headers = {
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
  if (allowed.length === 0) return headers;
  if (origin && allowed.indexOf(origin) >= 0) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Credentials"] = "true";
    headers["Vary"] = "Origin";
  }
  return headers;
}

function json(request, env, obj, status, extraHeaders) {
  var headers = Object.assign(
    { "Content-Type": "application/json" },
    corsHeaders(request, env),
    extraHeaders || {}
  );
  return new Response(JSON.stringify(obj), { status: status || 200, headers: headers });
}

function sessionCookie(token, remember) {
  var maxAge = remember ? 2592000 : 86400;
  return SESSION_COOKIE + "=" + token + "; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=" + maxAge;
}

function clearSessionCookie() {
  return SESSION_COOKIE + "=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0";
}

function parseCookies(req) {
  var header = req.headers.get("Cookie") || "";
  var out = {};
  header.split(";").forEach(function (part) {
    var i = part.indexOf("=");
    if (i < 0) return;
    var k = part.slice(0, i).trim();
    var v = part.slice(i + 1).trim();
    if (k) out[k] = v;
  });
  return out;
}

function clientIp(request) {
  return request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For") || "unknown";
}

function escapeHtml(s) {
  return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function safeFilename(name) {
  var base = String(name || "file").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
  return base || "file";
}

function validateAttachments(atts) {
  if (atts.length > NOTIFY_MAX_ATTACHMENTS) return "عدد المرفقات كبير جداً";
  var total = 0;
  for (var i = 0; i < atts.length; i++) {
    var b64 = String(atts[i].b64 || "");
    total += b64.length;
    if (b64 && !/^[A-Za-z0-9+/=\r\n]+$/.test(b64)) return "ترميز مرفق غير صالح";
  }
  if (total > NOTIFY_MAX_TOTAL_B64) return "حجم المرفقات كبير جداً";
  return null;
}

/* ---------- تشفير كلمات السر (PBKDF2 / Web Crypto) ---------- */
function buf2hex(buf) {
  return Array.from(new Uint8Array(buf)).map(function (b) { return b.toString(16).padStart(2, "0"); }).join("");
}
function hex2buf(hex) {
  var a = new Uint8Array(hex.length / 2);
  for (var i = 0; i < a.length; i++) a[i] = parseInt(hex.substr(i * 2, 2), 16);
  return a;
}
async function hashPassword(password, saltHex) {
  var enc = new TextEncoder();
  var salt = saltHex ? hex2buf(saltHex) : crypto.getRandomValues(new Uint8Array(16));
  var keyMaterial = await crypto.subtle.importKey("raw", enc.encode(password), { name: "PBKDF2" }, false, ["deriveBits"]);
  var bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: salt, iterations: 100000, hash: "SHA-256" }, keyMaterial, 256);
  return buf2hex(salt) + ":" + buf2hex(bits);
}
async function verifyPassword(password, stored) {
  var parts = (stored || "").split(":");
  if (parts.length !== 2) return false;
  var check = await hashPassword(password, parts[0]);
  var a = check, b = parts[0] + ":" + parts[1];
  if (a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* ---------- محاولات الدخول / الإشعارات (يتطلب schema.sql) ---------- */
async function isLoginBlocked(env, key) {
  try {
    var now = Date.now();
    var row = await env.DB.prepare("SELECT attempts, reset_at FROM login_attempts WHERE id=?1").bind(key).first();
    if (!row) return false;
    if (row.reset_at <= now) {
      await env.DB.prepare("DELETE FROM login_attempts WHERE id=?1").bind(key).run();
      return false;
    }
    return row.attempts >= LOGIN_MAX_ATTEMPTS;
  } catch (e) {
    return false;
  }
}

async function recordLoginFailure(env, key) {
  try {
    var now = Date.now();
    var resetAt = now + LOGIN_WINDOW_MS;
    var row = await env.DB.prepare("SELECT attempts, reset_at FROM login_attempts WHERE id=?1").bind(key).first();
    if (!row || row.reset_at <= now) {
      await env.DB.prepare(
        "INSERT INTO login_attempts (id, attempts, reset_at) VALUES (?1, 1, ?2) ON CONFLICT(id) DO UPDATE SET attempts=1, reset_at=?2"
      ).bind(key, resetAt).run();
      return;
    }
    await env.DB.prepare("UPDATE login_attempts SET attempts=?1 WHERE id=?2").bind(row.attempts + 1, key).run();
  } catch (e) {}
}

async function clearLoginFailures(env, key) {
  try {
    await env.DB.prepare("DELETE FROM login_attempts WHERE id=?1").bind(key).run();
  } catch (e) {}
}

async function isNotifyBlocked(env, email) {
  try {
    var now = Date.now();
    var hourAgo = now - 3600000;
    var row = await env.DB.prepare("SELECT COUNT(*) AS c FROM notify_log WHERE email=?1 AND created_at>?2").bind(email, hourAgo).first();
    return row && row.c >= NOTIFY_MAX_PER_HOUR;
  } catch (e) {
    return false;
  }
}

async function recordNotify(env, email) {
  try {
    await env.DB.prepare("INSERT INTO notify_log (email, created_at) VALUES (?1, ?2)").bind(email, Date.now()).run();
    await env.DB.prepare("DELETE FROM notify_log WHERE created_at<?1").bind(Date.now() - 86400000).run();
  } catch (e) {}
}

/* ---------- الجلسات ---------- */
function makeToken() {
  return buf2hex(crypto.getRandomValues(new Uint8Array(32)));
}
async function getSessionUser(env, req) {
  var auth = req.headers.get("Authorization") || "";
  var token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) token = parseCookies(req)[SESSION_COOKIE] || "";
  if (!token) return null;
  var row = await env.DB.prepare(
    "SELECT s.token, s.expires_at, u.email, u.role FROM sessions s JOIN users u ON u.email=s.email WHERE s.token=?1"
  ).bind(token).first();
  if (!row) return null;
  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
    await env.DB.prepare("DELETE FROM sessions WHERE token=?1").bind(token).run();
    return null;
  }
  return { email: row.email, role: row.role, token: token };
}

/* ---------- قواعد الصلاحيات ---------- */
function canManage(role) { return role === "owner" || role === "admin" || role === "comms"; }
function canNotify(role) { return ROLES.indexOf(role) >= 0; }
function rolesVisibleTo(role) {
  if (role === "owner") return ROLES;
  if (role === "admin" || role === "comms") return ["user"];
  return [];
}
function canAssign(actorRole, targetRole) {
  if (actorRole === "owner") return ["user", "admin", "comms"].indexOf(targetRole) >= 0;
  if (actorRole === "admin" || actorRole === "comms") return targetRole === "user";
  return false;
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders(request, env) });
    }
    var url = new URL(request.url);
    var path = url.pathname.replace(/\/+$/, "");

    try {
      if (request.method === "GET" && (path === "" || path === "/health")) {
        return json(request, env, { ok: true, service: "studyzone-auth" });
      }

      if (request.method === "POST" && path === "/setup-owner") {
        var s = await request.json();
        if (!env.SETUP_SECRET || s.secret !== env.SETUP_SECRET) return json(request, env, { error: "سر الإعداد غير صحيح" }, 403);
        var existing = await env.DB.prepare("SELECT COUNT(*) AS c FROM users WHERE role='owner'").first();
        if (existing && existing.c > 0) return json(request, env, { error: "يوجد Owner مسبقاً" }, 409);
        var email = (s.email || "").trim().toLowerCase();
        if (!isValidEmail(email)) return json(request, env, { error: "إيميل غير صالح" }, 400);
        var pwErr = validatePassword(s.password);
        if (pwErr) return json(request, env, { error: pwErr }, 400);
        var ph = await hashPassword(s.password);
        await env.DB.prepare("INSERT INTO users (email,password,role) VALUES (?1,?2,'owner')").bind(email, ph).run();
        return json(request, env, { ok: true, message: "تم إنشاء حساب المالك" });
      }

      if (request.method === "POST" && path === "/change-owner-email") {
        var ce = await request.json();
        if (!env.SETUP_SECRET || ce.secret !== env.SETUP_SECRET) return json(request, env, { error: "سر الإعداد غير صحيح" }, 403);
        var newEmail = (ce.new_email || "").trim().toLowerCase();
        if (!isValidEmail(newEmail)) return json(request, env, { error: "إيميل غير صالح" }, 400);
        var owner = await env.DB.prepare("SELECT email FROM users WHERE role='owner' LIMIT 1").first();
        if (!owner) return json(request, env, { error: "لا يوجد Owner" }, 404);
        var clash = await env.DB.prepare("SELECT email FROM users WHERE email=?1 AND role!='owner'").bind(newEmail).first();
        if (clash) return json(request, env, { error: "هذا الإيميل مستخدم لحساب آخر" }, 409);
        await env.DB.prepare("UPDATE users SET email=?1 WHERE role='owner'").bind(newEmail).run();
        await env.DB.prepare("DELETE FROM sessions WHERE email=?1").bind(owner.email).run();
        return json(request, env, { ok: true, message: "تم تغيير إيميل المالك", new_email: newEmail });
      }

      if (request.method === "POST" && path === "/login") {
        var b = await request.json();
        var em = (b.email || "").trim().toLowerCase();
        var rateKey = clientIp(request) + ":" + em;
        if (await isLoginBlocked(env, rateKey)) {
          return json(request, env, { error: "محاولات كثيرة. حاول لاحقاً." }, 429);
        }
        var u = await env.DB.prepare("SELECT email,password,role FROM users WHERE email=?1").bind(em).first();
        if (!u || !(await verifyPassword(b.password || "", u.password))) {
          await recordLoginFailure(env, rateKey);
          return json(request, env, { error: "الإيميل أو كلمة السر غير صحيحة" }, 401);
        }
        await clearLoginFailures(env, rateKey);
        var token = makeToken();
        var days = b.remember ? 30 : 1;
        var exp = new Date(Date.now() + days * 86400000).toISOString();
        await env.DB.prepare("INSERT INTO sessions (token,email,expires_at) VALUES (?1,?2,?3)").bind(token, u.email, exp).run();
        return json(request, env, { ok: true, user: { email: u.email, role: u.role } }, 200, {
          "Set-Cookie": sessionCookie(token, !!b.remember),
        });
      }

      if (request.method === "GET" && path === "/me") {
        var me = await getSessionUser(env, request);
        if (!me) return json(request, env, { error: "غير مسجّل دخول" }, 401);
        return json(request, env, { ok: true, user: { email: me.email, role: me.role } });
      }

      if (request.method === "POST" && path === "/logout") {
        var me2 = await getSessionUser(env, request);
        if (me2) await env.DB.prepare("DELETE FROM sessions WHERE token=?1").bind(me2.token).run();
        return json(request, env, { ok: true }, 200, { "Set-Cookie": clearSessionCookie() });
      }

      if (request.method === "GET" && path === "/users") {
        var actor = await getSessionUser(env, request);
        if (!actor) return json(request, env, { error: "غير مسجّل دخول" }, 401);
        if (!canManage(actor.role)) return json(request, env, { error: "لا صلاحية" }, 403);
        var vis = rolesVisibleTo(actor.role);
        if (vis.length === 0) return json(request, env, { ok: true, users: [] });
        var placeholders = vis.map(function (_, i) { return "?" + (i + 1); }).join(",");
        var query = env.DB.prepare(
          "SELECT email, role, created_at FROM users WHERE role IN (" + placeholders + ") ORDER BY created_at"
        );
        var rows = await query.bind(...vis).all();
        return json(request, env, { ok: true, users: rows.results || [] });
      }

      if (request.method === "POST" && path === "/users/add") {
        var actor2 = await getSessionUser(env, request);
        if (!actor2) return json(request, env, { error: "غير مسجّل دخول" }, 401);
        if (!canManage(actor2.role)) return json(request, env, { error: "لا صلاحية" }, 403);
        var nb = await request.json();
        var nemail = (nb.email || "").trim().toLowerCase();
        var nrole = nb.role || "user";
        if (!isValidEmail(nemail)) return json(request, env, { error: "إيميل غير صالح" }, 400);
        var addPwErr = validatePassword(nb.password);
        if (addPwErr) return json(request, env, { error: addPwErr }, 400);
        if (!canAssign(actor2.role, nrole)) return json(request, env, { error: "لا يمكنك تعيين هذا الدور" }, 403);
        var dup = await env.DB.prepare("SELECT email FROM users WHERE email=?1").bind(nemail).first();
        if (dup) return json(request, env, { error: "هذا الإيميل موجود مسبقاً" }, 409);
        var nph = await hashPassword(nb.password);
        await env.DB.prepare("INSERT INTO users (email,password,role) VALUES (?1,?2,?3)").bind(nemail, nph, nrole).run();
        return json(request, env, { ok: true });
      }

      if (request.method === "POST" && path === "/users/delete") {
        var actor3 = await getSessionUser(env, request);
        if (!actor3) return json(request, env, { error: "غير مسجّل دخول" }, 401);
        if (!canManage(actor3.role)) return json(request, env, { error: "لا صلاحية" }, 403);
        var db = await request.json();
        var temail = (db.email || "").trim().toLowerCase();
        var target = await env.DB.prepare("SELECT email,role FROM users WHERE email=?1").bind(temail).first();
        if (!target) return json(request, env, { error: "المستخدم غير موجود" }, 404);
        if (target.role === "owner") return json(request, env, { error: "لا يمكن حذف الـ Owner" }, 403);
        if (target.email === actor3.email) return json(request, env, { error: "لا يمكنك حذف حسابك" }, 403);
        if ((target.role === "admin" || target.role === "comms") && actor3.role !== "owner") {
          return json(request, env, { error: "فقط الـ Owner يحذف هذا الدور" }, 403);
        }
        await env.DB.prepare("DELETE FROM users WHERE email=?1").bind(temail).run();
        await env.DB.prepare("DELETE FROM sessions WHERE email=?1").bind(temail).run();
        return json(request, env, { ok: true });
      }

      if (request.method === "POST" && path === "/notify") {
        var sender = await getSessionUser(env, request);
        if (!sender) return json(request, env, { error: "غير مسجّل دخول" }, 401);
        if (!canNotify(sender.role)) return json(request, env, { error: "لا صلاحية" }, 403);
        if (await isNotifyBlocked(env, sender.email)) {
          return json(request, env, { error: "تجاوزت حد الإشعارات. حاول لاحقاً." }, 429);
        }
        if (!env.RESEND_API_KEY) return json(request, env, { error: "مفتاح Resend غير مضبوط (RESEND_API_KEY)" }, 500);

        var nb2 = await request.json();
        var atts = Array.isArray(nb2.attachments) ? nb2.attachments : [];
        var attErr = validateAttachments(atts);
        if (attErr) return json(request, env, { error: attErr }, 400);

        var title = (nb2.title || "مشروع بدون عنوان").toString().slice(0, 120);
        var rcptRows = await env.DB.prepare("SELECT email FROM users WHERE role IN ('owner','comms')").all();
        var recipients = (rcptRows.results || []).map(function (r) { return r.email; });
        if (recipients.length === 0) return json(request, env, { error: "لا يوجد مستلمون (Owner/Comms)" }, 400);

        var when = new Date().toISOString().replace("T", " ").slice(0, 19) + " UTC";
        var safeTitle = escapeHtml(title);
        var safeSender = escapeHtml(sender.email);
        var html =
          "<div style='font-family:Arial,sans-serif;direction:rtl;text-align:right'>" +
          "<h2 style='color:#003c54'>مشروع جديد من STUDY ZONE</h2>" +
          "<p><b>العنوان:</b> " + safeTitle + "</p>" +
          "<p><b>أنشأه:</b> " + safeSender + "</p>" +
          "<p><b>التوقيت:</b> " + when + "</p>" +
          "<p>الملفات مرفقة بهذا الإيميل (البوستر، الستوري، ملف المشروع).</p>" +
          "</div>";

        var attachments = atts.map(function (a) {
          return { filename: safeFilename(a.filename), content: a.b64 };
        });

        var payload = {
          from: "STUDY ZONE <onboarding@resend.dev>",
          to: recipients,
          subject: "مشروع جديد: " + title.replace(/[\r\n]/g, " ") + " — " + sender.email,
          html: html,
          attachments: attachments,
        };

        var rr = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { "Authorization": "Bearer " + env.RESEND_API_KEY, "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        var rd = {}; try { rd = await rr.json(); } catch (e) {}
        if (!rr.ok) return json(request, env, { error: (rd && (rd.message || rd.name)) || ("Resend HTTP " + rr.status) }, 502);
        await recordNotify(env, sender.email);
        return json(request, env, { ok: true, recipients: recipients.length });
      }

      return json(request, env, { error: "Not found" }, 404);
    } catch (e) {
      console.error("auth_worker error:", e);
      return json(request, env, { error: "خطأ داخلي في الخادم" }, 500);
    }
  },
};
