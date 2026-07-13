// ============================================================
// STUDY ZONE — Auth Worker  (تسجيل دخول + إدارة مستخدمين + أدوار)
// قاعدة البيانات: D1 (studyzone-db) — مربوطة باسم  DB
// سر الإعداد الأولي: متغيّر سرّي اسمه  SETUP_SECRET
// ============================================================

const ROLES = ["owner", "admin", "comms", "user"];

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}
function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { ...cors(), "Content-Type": "application/json" },
  });
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
  // مقارنة ثابتة الزمن
  var a = check, b = parts[0] + ":" + parts[1];
  if (a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* ---------- الجلسات ---------- */
function makeToken() {
  return buf2hex(crypto.getRandomValues(new Uint8Array(32)));
}
async function getSessionUser(env, req) {
  var auth = req.headers.get("Authorization") || "";
  var token = auth.replace(/^Bearer\s+/i, "").trim();
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
function rolesVisibleTo(role) {
  if (role === "owner") return ROLES;            // يرى الجميع
  if (role === "admin" || role === "comms") return ["user"]; // يرى الـ users فقط
  return [];
}
function canAssign(actorRole, targetRole) {
  if (actorRole === "owner") return ["user", "admin", "comms"].indexOf(targetRole) >= 0;
  if (actorRole === "admin" || actorRole === "comms") return targetRole === "user";
  return false;
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { headers: cors() });
    var url = new URL(request.url);
    var path = url.pathname.replace(/\/+$/, "");

    try {
      /* ---- 0) فحص صحة ---- */
      if (request.method === "GET" && (path === "" || path === "/health")) {
        return json({ ok: true, service: "studyzone-auth" });
      }

      /* ---- 1) إنشاء أول Owner (مرة واحدة، محمي بسر) ---- */
      if (request.method === "POST" && path === "/setup-owner") {
        var s = await request.json();
        if (!env.SETUP_SECRET || s.secret !== env.SETUP_SECRET) return json({ error: "سر الإعداد غير صحيح" }, 403);
        var existing = await env.DB.prepare("SELECT COUNT(*) AS c FROM users WHERE role='owner'").first();
        if (existing && existing.c > 0) return json({ error: "يوجد Owner مسبقاً" }, 409);
        var email = (s.email || "").trim().toLowerCase();
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: "إيميل غير صالح" }, 400);
        if ((s.password || "").length < 6) return json({ error: "كلمة السر 6 أحرف على الأقل" }, 400);
        var ph = await hashPassword(s.password);
        await env.DB.prepare("INSERT INTO users (email,password,role) VALUES (?1,?2,'owner')").bind(email, ph).run();
        return json({ ok: true, message: "تم إنشاء حساب المالك" });
      }

      /* ---- 1ب) تغيير إيميل المالك (محمي بسر الإعداد) ---- */
      if (request.method === "POST" && path === "/change-owner-email") {
        var ce = await request.json();
        if (!env.SETUP_SECRET || ce.secret !== env.SETUP_SECRET) return json({ error: "سر الإعداد غير صحيح" }, 403);
        var newEmail = (ce.new_email || "").trim().toLowerCase();
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(newEmail)) return json({ error: "إيميل غير صالح" }, 400);
        var owner = await env.DB.prepare("SELECT email FROM users WHERE role='owner' LIMIT 1").first();
        if (!owner) return json({ error: "لا يوجد Owner" }, 404);
        var clash = await env.DB.prepare("SELECT email FROM users WHERE email=?1 AND role!='owner'").bind(newEmail).first();
        if (clash) return json({ error: "هذا الإيميل مستخدم لحساب آخر" }, 409);
        await env.DB.prepare("UPDATE users SET email=?1 WHERE role='owner'").bind(newEmail).run();
        await env.DB.prepare("DELETE FROM sessions WHERE email=?1").bind(owner.email).run();
        return json({ ok: true, message: "تم تغيير إيميل المالك", new_email: newEmail });
      }

      /* ---- 2) تسجيل الدخول ---- */
      if (request.method === "POST" && path === "/login") {
        var b = await request.json();
        var em = (b.email || "").trim().toLowerCase();
        var u = await env.DB.prepare("SELECT email,password,role FROM users WHERE email=?1").bind(em).first();
        if (!u || !(await verifyPassword(b.password || "", u.password))) {
          return json({ error: "الإيميل أو كلمة السر غير صحيحة" }, 401);
        }
        var token = makeToken();
        var days = b.remember ? 30 : 1;
        var exp = new Date(Date.now() + days * 86400000).toISOString();
        await env.DB.prepare("INSERT INTO sessions (token,email,expires_at) VALUES (?1,?2,?3)").bind(token, u.email, exp).run();
        return json({ ok: true, token: token, user: { email: u.email, role: u.role } });
      }

      /* ---- 3) الجلسة الحالية ---- */
      if (request.method === "GET" && path === "/me") {
        var me = await getSessionUser(env, request);
        if (!me) return json({ error: "غير مسجّل دخول" }, 401);
        return json({ ok: true, user: { email: me.email, role: me.role } });
      }

      /* ---- 4) تسجيل خروج ---- */
      if (request.method === "POST" && path === "/logout") {
        var me2 = await getSessionUser(env, request);
        if (me2) await env.DB.prepare("DELETE FROM sessions WHERE token=?1").bind(me2.token).run();
        return json({ ok: true });
      }

      /* ---- 5) قائمة المستخدمين (مفلترة حسب الدور) ---- */
      if (request.method === "GET" && path === "/users") {
        var actor = await getSessionUser(env, request);
        if (!actor) return json({ error: "غير مسجّل دخول" }, 401);
        if (!canManage(actor.role)) return json({ error: "لا صلاحية" }, 403);
        var vis = rolesVisibleTo(actor.role);
        if (vis.length === 0) return json({ ok: true, users: [] });
        var placeholders = vis.map(function (_, i) { return "?" + (i + 1); }).join(",");
        var query = env.DB.prepare(
          "SELECT email, role, created_at FROM users WHERE role IN (" + placeholders + ") ORDER BY created_at"
        );
        var rows = await query.bind(...vis).all();
        return json({ ok: true, users: rows.results || [] });
      }

      /* ---- 6) إضافة مستخدم ---- */
      if (request.method === "POST" && path === "/users/add") {
        var actor2 = await getSessionUser(env, request);
        if (!actor2) return json({ error: "غير مسجّل دخول" }, 401);
        if (!canManage(actor2.role)) return json({ error: "لا صلاحية" }, 403);
        var nb = await request.json();
        var nemail = (nb.email || "").trim().toLowerCase();
        var nrole = nb.role || "user";
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(nemail)) return json({ error: "إيميل غير صالح" }, 400);
        if ((nb.password || "").length < 4) return json({ error: "كلمة السر 4 أحرف على الأقل" }, 400);
        if (!canAssign(actor2.role, nrole)) return json({ error: "لا يمكنك تعيين هذا الدور" }, 403);
        var dup = await env.DB.prepare("SELECT email FROM users WHERE email=?1").bind(nemail).first();
        if (dup) return json({ error: "هذا الإيميل موجود مسبقاً" }, 409);
        var nph = await hashPassword(nb.password);
        await env.DB.prepare("INSERT INTO users (email,password,role) VALUES (?1,?2,?3)").bind(nemail, nph, nrole).run();
        return json({ ok: true });
      }

      /* ---- 7) حذف مستخدم ---- */
      if (request.method === "POST" && path === "/users/delete") {
        var actor3 = await getSessionUser(env, request);
        if (!actor3) return json({ error: "غير مسجّل دخول" }, 401);
        if (!canManage(actor3.role)) return json({ error: "لا صلاحية" }, 403);
        var db = await request.json();
        var temail = (db.email || "").trim().toLowerCase();
        var target = await env.DB.prepare("SELECT email,role FROM users WHERE email=?1").bind(temail).first();
        if (!target) return json({ error: "المستخدم غير موجود" }, 404);
        if (target.role === "owner") return json({ error: "لا يمكن حذف الـ Owner" }, 403);
        if (target.email === actor3.email) return json({ error: "لا يمكنك حذف حسابك" }, 403);
        if ((target.role === "admin" || target.role === "comms") && actor3.role !== "owner") {
          return json({ error: "فقط الـ Owner يحذف هذا الدور" }, 403);
        }
        await env.DB.prepare("DELETE FROM users WHERE email=?1").bind(temail).run();
        await env.DB.prepare("DELETE FROM sessions WHERE email=?1").bind(temail).run();
        return json({ ok: true });
      }

      /* ---- 8) إشعار عند تحميل مشروع: إيميل بمرفقات للـ Owner و Comms ---- */
      if (request.method === "POST" && path === "/notify") {
        var sender = await getSessionUser(env, request);
        if (!sender) return json({ error: "غير مسجّل دخول" }, 401);
        if (!env.RESEND_API_KEY) return json({ error: "مفتاح Resend غير مضبوط (RESEND_API_KEY)" }, 500);

        var nb = await request.json();
        // المرفقات: [{filename, b64}], و title وقت
        var atts = Array.isArray(nb.attachments) ? nb.attachments : [];
        var title = (nb.title || "مشروع بدون عنوان").toString().slice(0, 120);

        // المستلمون ديناميكياً: كل Owner و Comms
        var rcptRows = await env.DB.prepare("SELECT email FROM users WHERE role IN ('owner','comms')").all();
        var recipients = (rcptRows.results || []).map(function (r) { return r.email; });
        if (recipients.length === 0) return json({ error: "لا يوجد مستلمون (Owner/Comms)" }, 400);

        var when = new Date().toISOString().replace("T", " ").slice(0, 19) + " UTC";
        var safeTitle = title.replace(/[<>&]/g, "");
        var html =
          "<div style='font-family:Arial,sans-serif;direction:rtl;text-align:right'>" +
          "<h2 style='color:#003c54'>مشروع جديد من STUDY ZONE</h2>" +
          "<p><b>العنوان:</b> " + safeTitle + "</p>" +
          "<p><b>أنشأه:</b> " + sender.email + "</p>" +
          "<p><b>التوقيت:</b> " + when + "</p>" +
          "<p>الملفات مرفقة بهذا الإيميل (البوستر، الستوري، ملف المشروع).</p>" +
          "</div>";

        var attachments = atts.map(function (a) {
          return { filename: a.filename, content: a.b64 }; // Resend يقبل content كـ base64
        });

        var payload = {
          from: "STUDY ZONE <onboarding@resend.dev>",
          to: recipients,
          subject: "مشروع جديد: " + safeTitle + " — " + sender.email,
          html: html,
          attachments: attachments,
        };

        var rr = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { "Authorization": "Bearer " + env.RESEND_API_KEY, "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        var rd = {}; try { rd = await rr.json(); } catch (e) {}
        if (!rr.ok) return json({ error: (rd && (rd.message || rd.name)) || ("Resend HTTP " + rr.status) }, 502);
        return json({ ok: true, recipients: recipients.length });
      }

      return json({ error: "Not found" }, 404);
    } catch (e) {
      return json({ error: String((e && e.message) || e) }, 500);
    }
  },
};
