// ============================================================
// المنصّة الموحّدة — Auth Worker  (النسخة 2: متعدّد المشاريع)
// قاعدة البيانات: D1 (studyzone-db) — مربوطة باسم  DB
// سر الإعداد الأولي: متغيّر سرّي اسمه  SETUP_SECRET
// التغييرات عن النسخة 1:
//   - قراءة project_id لكل مستخدم وإرجاعه في /login و /me مع بيانات المشروع
//   - owner و comms: وصول شامل لكل المشاريع | admin و user: مقيّدون بمشروعهم
//   - مسارات جديدة (Owner فقط): /projects , /projects/add , /projects/update
//   - الإشعار يذكر اسم المشروع
//   - توافق مؤقت: عند وجود مشروع واحد فقط تعمل الواجهة الحالية بلا تعديل
// ============================================================

const ROLES = ["owner", "admin", "comms", "user"];

// حدود محاولات الدخول (جدول login_attempts)
const LOGIN_WINDOW_MIN = 15;   // نافذة الحساب بالدقائق
const LOGIN_MAX_EMAIL  = 5;    // فشل متتالٍ لنفس الإيميل قبل الحجب
const LOGIN_MAX_IP     = 20;   // فشل من نفس الـIP عبر أي حساب (يمنع العدّ على الحسابات)

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
    "SELECT s.token, s.expires_at, u.email, u.role, u.project_id, u.photo FROM sessions s JOIN users u ON u.email=s.email WHERE s.token=?1"
  ).bind(token).first();
  if (!row) return null;
  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
    await env.DB.prepare("DELETE FROM sessions WHERE token=?1").bind(token).run();
    return null;
  }
  return { email: row.email, role: row.role, project_id: row.project_id, photo: row.photo || null, token: token };
}

/* ---------- المشاريع ---------- */
// جلب مشروع واحد بصيغة جاهزة للواجهة (مع تحليل brand_json)
async function getProject(env, projectId) {
  if (projectId === null || projectId === undefined) return null;
  var p = await env.DB.prepare(
    "SELECT id, name, slug, brand_json, template_type, status FROM projects WHERE id=?1"
  ).bind(projectId).first();
  if (!p) return null;
  var brand = {};
  try { brand = JSON.parse(p.brand_json || "{}"); } catch (e) {}
  return { id: p.id, name: p.name, slug: p.slug, template_type: p.template_type, status: p.status, brand: brand };
}

// معرّفات مشاريع مستخدم من جدول الربط
async function getUserProjectIds(env, email) {
  var rows = await env.DB.prepare("SELECT project_id FROM user_projects WHERE email=?1").bind(email).all();
  return (rows.results || []).map(function (r) { return r.project_id; });
}
// المشاريع المتاحة لمستخدم (owner/comms=الكل | admin/user=مجموعته)، بصيغة كاملة
async function getAccessibleProjects(env, email, role) {
  var rows;
  if (isGlobalRole(role)) {
    rows = await env.DB.prepare("SELECT id,name,slug,brand_json,template_type,status FROM projects ORDER BY id").all();
  } else {
    rows = await env.DB.prepare("SELECT p.id,p.name,p.slug,p.brand_json,p.template_type,p.status FROM projects p JOIN user_projects up ON up.project_id=p.id WHERE up.email=?1 ORDER BY p.id").bind(email).all();
  }
  return (rows.results || []).map(function (p) {
    var br = {}; try { br = JSON.parse(p.brand_json || "{}"); } catch (e) {}
    return { id: p.id, name: p.name, slug: p.slug, template_type: p.template_type, status: p.status, brand: br };
  });
}
// أسماء مشاريع مستخدم (مختصرة، لعرض القائمة)
async function getUserProjectsBrief(env, email, role) {
  if (isGlobalRole(role)) return [];
  var rows = await env.DB.prepare("SELECT p.id,p.name FROM projects p JOIN user_projects up ON up.project_id=p.id WHERE up.email=?1 ORDER BY p.id").bind(email).all();
  return (rows.results || []).map(function (p) { return { id: p.id, name: p.name }; });
}

/* ---------- قواعد الصلاحيات ---------- */
function canManage(role) { return role === "owner" || role === "admin" || role === "comms"; }
function isGlobalRole(role) { return role === "owner" || role === "comms"; } // وصول شامل لكل المشاريع
function rolesVisibleTo(role) {
  if (role === "owner") return ROLES;                        // يرى الجميع
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
        return json({ ok: true, service: "studyzone-auth", version: 4 });
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
        // المالك بلا مشروع (project_id = NULL) = وصول شامل
        await env.DB.prepare("INSERT INTO users (email,password,role,project_id) VALUES (?1,?2,'owner',NULL)").bind(email, ph).run();
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
        var ip = request.headers.get("CF-Connecting-IP") || "";

        // تحديد المحاولات: يُفحص قبل التحقق من كلمة السر، فلا يُستهلك أي عمل
        // تشفيري على المحاولات المحجوبة. النافذة 15 دقيقة.
        var since = new Date(Date.now() - LOGIN_WINDOW_MIN * 60000).toISOString().replace("T", " ").slice(0, 19);
        var att = await env.DB.prepare(
          "SELECT (SELECT COUNT(*) FROM login_attempts WHERE email=?1 AND at>?3) AS by_email," +
          "       (SELECT COUNT(*) FROM login_attempts WHERE ip=?2 AND ip!='' AND at>?3) AS by_ip"
        ).bind(em, ip, since).first();
        if (att && (att.by_email >= LOGIN_MAX_EMAIL || att.by_ip >= LOGIN_MAX_IP)) {
          return json({ error: "محاولات كثيرة. حاول بعد " + LOGIN_WINDOW_MIN + " دقيقة." }, 429);
        }

        var u = await env.DB.prepare("SELECT email,password,role,project_id,photo FROM users WHERE email=?1").bind(em).first();
        if (!u || !(await verifyPassword(b.password || "", u.password))) {
          await env.DB.prepare("INSERT INTO login_attempts (email,ip) VALUES (?1,?2)").bind(em, ip).run();
          return json({ error: "الإيميل أو كلمة السر غير صحيحة" }, 401);
        }
        // نجاح: امسح سجل المحاولات لهذا الحساب، ونظّف القديم
        await env.DB.prepare("DELETE FROM login_attempts WHERE email=?1").bind(em).run();
        await env.DB.prepare("DELETE FROM login_attempts WHERE at < datetime('now','-1 day')").run();

        var token = makeToken();
        var days = b.remember ? 30 : 1;
        var exp = new Date(Date.now() + days * 86400000).toISOString();
        await env.DB.prepare("INSERT INTO sessions (token,email,expires_at) VALUES (?1,?2,?3)").bind(token, u.email, exp).run();
        var accProjs = await getAccessibleProjects(env, u.email, u.role);
        return json({ ok: true, token: token, user: { email: u.email, role: u.role, project_id: u.project_id, photo: u.photo || null }, projects: accProjs, project: accProjs[0] || null });
      }

      /* ---- 3) الجلسة الحالية ---- */
      if (request.method === "GET" && path === "/me") {
        var me = await getSessionUser(env, request);
        if (!me) return json({ error: "غير مسجّل دخول" }, 401);
        var meProjs = await getAccessibleProjects(env, me.email, me.role);
        return json({ ok: true, user: { email: me.email, role: me.role, project_id: me.project_id, photo: me.photo }, projects: meProjs, project: meProjs[0] || null });
      }

      /* ---- 3ب) الصورة الشخصية ----
         الإيميل يُؤخذ من الجلسة لا من جسم الطلب، فلا يمكن لمستخدم تعديل صورة غيره.
         الواجهة تصغّر الصورة إلى 256×256 (~8KB)؛ الحد هنا حماية من طلب مباشر. */
      if (request.method === "POST" && path === "/me/photo") {
        var pu = await getSessionUser(env, request);
        if (!pu) return json({ error: "غير مسجّل دخول" }, 401);
        var pb = await request.json();
        var photo = String((pb && pb.photo) || "");
        if (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(photo)) {
          return json({ error: "صيغة الصورة غير مدعومة" }, 400);
        }
        if (photo.length > 300 * 1024) return json({ error: "حجم الصورة كبير جداً" }, 413);
        await env.DB.prepare("UPDATE users SET photo=?1 WHERE email=?2").bind(photo, pu.email).run();
        return json({ ok: true, photo: photo });
      }

      // POST وليس DELETE لأن cors() يسمح بـ GET/POST/OPTIONS فقط
      if (request.method === "POST" && path === "/me/photo/delete") {
        var pd = await getSessionUser(env, request);
        if (!pd) return json({ error: "غير مسجّل دخول" }, 401);
        await env.DB.prepare("UPDATE users SET photo=NULL WHERE email=?1").bind(pd.email).run();
        return json({ ok: true });
      }

      /* ---- 4) تسجيل خروج ---- */
      if (request.method === "POST" && path === "/logout") {
        var me2 = await getSessionUser(env, request);
        if (me2) await env.DB.prepare("DELETE FROM sessions WHERE token=?1").bind(me2.token).run();
        return json({ ok: true });
      }

      /* ---- 5) قائمة المستخدمين (مفلترة حسب الدور + المشروع) ---- */
      if (request.method === "GET" && path === "/users") {
        var actor = await getSessionUser(env, request);
        if (!actor) return json({ error: "غير مسجّل دخول" }, 401);
        if (!canManage(actor.role)) return json({ error: "لا صلاحية" }, 403);
        var vis = rolesVisibleTo(actor.role);
        if (vis.length === 0) return json({ ok: true, users: [] });
        var placeholders = vis.map(function (_, i) { return "?" + (i + 1); }).join(",");
        var sql = "SELECT email, role, created_at, project_id FROM users WHERE role IN (" + placeholders + ") ORDER BY created_at";
        var rows = await env.DB.prepare(sql).bind(...vis).all();
        var usersOut = [];
        for (var ui = 0; ui < (rows.results || []).length; ui++) {
          var uu = rows.results[ui];
          var uprojs = await getUserProjectsBrief(env, uu.email, uu.role);
          usersOut.push({ email: uu.email, role: uu.role, created_at: uu.created_at, projects: uprojs });
        }
        return json({ ok: true, users: usersOut });
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

        // مشاريع المستخدم الجديد (قائمة)
        var pids = Array.isArray(nb.project_ids) ? nb.project_ids.slice()
                 : (nb.project_id !== null && nb.project_id !== undefined ? [nb.project_id] : []);
        pids = pids.map(function (x) { return parseInt(x, 10); }).filter(function (x) { return !isNaN(x); });
        if (nrole === "comms") {
          pids = []; // comms عالمي بلا مشاريع محدّدة
        } else {
          if (pids.length === 0) return json({ error: "يجب اختيار مشروع واحد على الأقل" }, 400);
          for (var pi = 0; pi < pids.length; pi++) {
            var chk = await env.DB.prepare("SELECT id FROM projects WHERE id=?1").bind(pids[pi]).first();
            if (!chk) return json({ error: "مشروع غير موجود (" + pids[pi] + ")" }, 404);
          }
          // admin يمنح فقط من ضمن مشاريعه
          if (!isGlobalRole(actor2.role)) {
            var mine = await getUserProjectIds(env, actor2.email);
            for (var pj = 0; pj < pids.length; pj++) {
              if (mine.indexOf(pids[pj]) < 0) return json({ error: "لا صلاحية على أحد المشاريع المحدّدة" }, 403);
            }
          }
        }

        var dup = await env.DB.prepare("SELECT email FROM users WHERE email=?1").bind(nemail).first();
        if (dup) return json({ error: "هذا الإيميل موجود مسبقاً" }, 409);
        var nph = await hashPassword(nb.password);
        var firstPid = pids.length ? pids[0] : null;
        await env.DB.prepare("INSERT INTO users (email,password,role,project_id) VALUES (?1,?2,?3,?4)")
          .bind(nemail, nph, nrole, firstPid).run();
        for (var pk = 0; pk < pids.length; pk++) {
          await env.DB.prepare("INSERT OR IGNORE INTO user_projects (email,project_id) VALUES (?1,?2)").bind(nemail, pids[pk]).run();
        }
        return json({ ok: true });
      }

      /* ---- 7) حذف مستخدم ---- */
      if (request.method === "POST" && path === "/users/delete") {
        var actor3 = await getSessionUser(env, request);
        if (!actor3) return json({ error: "غير مسجّل دخول" }, 401);
        if (!canManage(actor3.role)) return json({ error: "لا صلاحية" }, 403);
        var db = await request.json();
        var temail = (db.email || "").trim().toLowerCase();
        var target = await env.DB.prepare("SELECT email,role,project_id FROM users WHERE email=?1").bind(temail).first();
        if (!target) return json({ error: "المستخدم غير موجود" }, 404);
        if (target.role === "owner") return json({ error: "لا يمكن حذف الـ Owner" }, 403);
        if (target.email === actor3.email) return json({ error: "لا يمكنك حذف حسابك" }, 403);
        if ((target.role === "admin" || target.role === "comms") && actor3.role !== "owner") {
          return json({ error: "فقط الـ Owner يحذف هذا الدور" }, 403);
        }
        await env.DB.prepare("DELETE FROM users WHERE email=?1").bind(temail).run();
        await env.DB.prepare("DELETE FROM sessions WHERE email=?1").bind(temail).run();
        await env.DB.prepare("DELETE FROM user_projects WHERE email=?1").bind(temail).run();
        return json({ ok: true });
      }

      /* ---- 7ب) تعديل مشاريع مستخدم (صلاحيات) ---- */
      if (request.method === "POST" && path === "/users/set-projects") {
        var spActor = await getSessionUser(env, request);
        if (!spActor) return json({ error: "غير مسجّل دخول" }, 401);
        if (!canManage(spActor.role)) return json({ error: "لا صلاحية" }, 403);
        var spb = await request.json();
        var spEmail = (spb.email || "").trim().toLowerCase();
        var spPids = Array.isArray(spb.project_ids) ? spb.project_ids.map(function (x) { return parseInt(x, 10); }).filter(function (x) { return !isNaN(x); }) : [];
        var spTarget = await env.DB.prepare("SELECT email,role FROM users WHERE email=?1").bind(spEmail).first();
        if (!spTarget) return json({ error: "المستخدم غير موجود" }, 404);
        if (spTarget.role === "owner" || spTarget.role === "comms") return json({ error: "هذا الدور وصوله شامل ولا يُخصّص" }, 400);
        if (spActor.role !== "owner" && spTarget.role !== "user") return json({ error: "فقط الـ Owner" }, 403);
        if (spPids.length === 0) return json({ error: "يجب اختيار مشروع واحد على الأقل" }, 400);
        for (var si = 0; si < spPids.length; si++) {
          var spChk = await env.DB.prepare("SELECT id FROM projects WHERE id=?1").bind(spPids[si]).first();
          if (!spChk) return json({ error: "مشروع غير موجود (" + spPids[si] + ")" }, 404);
        }
        if (!isGlobalRole(spActor.role)) {
          var spMine = await getUserProjectIds(env, spActor.email);
          for (var sj = 0; sj < spPids.length; sj++) if (spMine.indexOf(spPids[sj]) < 0) return json({ error: "لا صلاحية على أحد المشاريع" }, 403);
        }
        await env.DB.prepare("DELETE FROM user_projects WHERE email=?1").bind(spEmail).run();
        for (var sk = 0; sk < spPids.length; sk++) await env.DB.prepare("INSERT OR IGNORE INTO user_projects (email,project_id) VALUES (?1,?2)").bind(spEmail, spPids[sk]).run();
        await env.DB.prepare("UPDATE users SET project_id=?1 WHERE email=?2").bind(spPids[0], spEmail).run();
        return json({ ok: true });
      }

      /* ---- 7b) تعيين كلمة سر لمستخدم ---- */
      if (request.method === "POST" && path === "/users/set-password") {
        var pwActor = await getSessionUser(env, request);
        if (!pwActor) return json({ error: "غير مسجّل دخول" }, 401);
        if (!canManage(pwActor.role)) return json({ error: "لا صلاحية" }, 403);
        var pwb = await request.json();
        var pwEmail = (pwb.email || "").trim().toLowerCase();
        var pwPass = (pwb.password || "") + "";
        var pwTarget = await env.DB.prepare("SELECT email,role FROM users WHERE email=?1").bind(pwEmail).first();
        if (!pwTarget) return json({ error: "المستخدم غير موجود" }, 404);
        if (pwActor.role !== "owner" && pwTarget.role !== "user") return json({ error: "فقط الـ Owner" }, 403);
        if (pwPass.length < 4) return json({ error: "كلمة السر 4 أحرف على الأقل" }, 400);
        var pwHash = await hashPassword(pwPass);
        await env.DB.prepare("UPDATE users SET password=?1 WHERE email=?2").bind(pwHash, pwEmail).run();
        return json({ ok: true });
      }

      /* ---- 7c) تدقيق إملائي/نحوي عبر Gemini (يعيد نصًّا مصحَّحًا لكل حقل) ---- */
      if (request.method === "POST" && path === "/proofread") {
        var prUser = await getSessionUser(env, request);
        if (!prUser) return json({ error: "غير مسجّل دخول" }, 401);
        if (!env.GEMINI_API_KEY) return json({ error: "مفتاح التدقيق غير مضبوط" }, 500);
        var prb = await request.json();
        var prFields = Array.isArray(prb.fields) ? prb.fields : [];
        prFields = prFields.map(function (f) { return { id: String(f && f.id != null ? f.id : ""), text: String(f && f.text != null ? f.text : "") }; })
                           .filter(function (f) { return f.id && f.text.replace(/\s/g, "") !== ""; });
        if (!prFields.length) return json({ error: "لا يوجد نص للتدقيق" }, 400);

        var sys =
"You are a professional Arabic/English proofreader and grammar editor. You correct spelling, punctuation, spacing, and obvious grammar, and improve wording lightly.\n" +
"You will receive a JSON object {\"fields\":[{\"id\",\"text\"}]}. Return ONLY a JSON object with the SAME shape {\"fields\":[{\"id\",\"text\"}]}, same ids, where each text is the CORRECTED version.\n" +
"HARD RULES:\n" +
"- Preserve EXACTLY the bold markers written as double asterisks **...** (do not add, remove, or move them).\n" +
"- Preserve line breaks (\\n) and the number of lines exactly; correct within each line.\n" +
"- Do NOT change proper nouns, names, places, or organisations (e.g. دير المخلص، أكاديمية الأطفال).\n" +
"- Do NOT change numbers or dates; keep only Western (Arabic) numerals 0-9 — convert any Indic numerals ٠-٩ to Western.\n" +
"- Keep a consistent, respectful tone; avoid mixing direct and indirect address.\n" +
"- If a text is already correct, return it unchanged. Do not add commentary or explanations.";

        var payload = {
          system_instruction: { parts: [{ text: sys }] },
          contents: [{ role: "user", parts: [{ text: JSON.stringify({ fields: prFields }) }] }],
          generationConfig: {
            temperature: 0.2,
            thinkingConfig: { thinkingBudget: 0 },
            responseMimeType: "application/json",
            responseSchema: {
              type: "OBJECT",
              properties: { fields: { type: "ARRAY", items: {
                type: "OBJECT", properties: { id: { type: "STRING" }, text: { type: "STRING" } }, required: ["id", "text"]
              } } },
              required: ["fields"]
            }
          }
        };
        var gr, gd;
        try {
          gr = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=" + env.GEMINI_API_KEY,
            { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
          gd = await gr.json();
        } catch (e) { return json({ error: "تعذّر الاتصال بخدمة التدقيق" }, 502); }
        if (!gr.ok) return json({ error: (gd && gd.error && gd.error.message) || "فشل التدقيق" }, 502);
        var outTxt = "";
        try { outTxt = gd.candidates[0].content.parts[0].text || ""; } catch (e) {}
        var parsed;
        try { parsed = JSON.parse(outTxt); } catch (e) { return json({ error: "ردّ التدقيق غير صالح" }, 502); }
        return json({ ok: true, fields: (parsed && parsed.fields) || [] });
      }

      /* ---- 8) قائمة المشاريع ---- */
      if (request.method === "GET" && path === "/projects") {
        var pa = await getSessionUser(env, request);
        if (!pa) return json({ error: "غير مسجّل دخول" }, 401);
        var list = await getAccessibleProjects(env, pa.email, pa.role);
        return json({ ok: true, projects: list });
      }

      /* ---- 9) إضافة مشروع (Owner فقط) ---- */
      if (request.method === "POST" && path === "/projects/add") {
        var oa = await getSessionUser(env, request);
        if (!oa) return json({ error: "غير مسجّل دخول" }, 401);
        if (oa.role !== "owner") return json({ error: "فقط الـ Owner ينشئ مشاريع" }, 403);
        var pb = await request.json();
        var pname = (pb.name || "").trim();
        var pslug = (pb.slug || "").trim().toLowerCase();
        var ptype = (pb.template_type || "studyzone_v1").trim();
        var pbrand = pb.brand || {};
        if (!pname || !pslug) return json({ error: "الاسم والمعرّف (slug) مطلوبان" }, 400);
        if (!/^[a-z0-9-]+$/.test(pslug)) return json({ error: "المعرّف: أحرف إنجليزية صغيرة وأرقام وشرطات فقط" }, 400);
        var pdup = await env.DB.prepare("SELECT id FROM projects WHERE slug=?1").bind(pslug).first();
        if (pdup) return json({ error: "هذا المعرّف مستخدم مسبقاً" }, 409);
        await env.DB.prepare("INSERT INTO projects (name,slug,brand_json,template_type) VALUES (?1,?2,?3,?4)")
          .bind(pname, pslug, JSON.stringify(pbrand), ptype).run();
        return json({ ok: true });
      }

      /* ---- 10) تعديل مشروع (Owner فقط) ---- */
      if (request.method === "POST" && path === "/projects/update") {
        var ua = await getSessionUser(env, request);
        if (!ua) return json({ error: "غير مسجّل دخول" }, 401);
        if (ua.role !== "owner") return json({ error: "فقط الـ Owner يعدّل المشاريع" }, 403);
        var ub = await request.json();
        var uslug = (ub.slug || "").trim().toLowerCase();
        if (!uslug) return json({ error: "المعرّف (slug) مطلوب" }, 400);
        var existingP = await env.DB.prepare("SELECT id,name,brand_json,template_type FROM projects WHERE slug=?1").bind(uslug).first();
        if (!existingP) return json({ error: "المشروع غير موجود" }, 404);
        var newName = (ub.name !== null && ub.name !== undefined) ? String(ub.name).trim() : existingP.name;
        var newType = (ub.template_type !== null && ub.template_type !== undefined) ? String(ub.template_type).trim() : existingP.template_type;
        var newBrand = (ub.brand !== null && ub.brand !== undefined) ? JSON.stringify(ub.brand) : existingP.brand_json;
        await env.DB.prepare("UPDATE projects SET name=?1, brand_json=?2, template_type=?3 WHERE slug=?4")
          .bind(newName, newBrand, newType, uslug).run();
        return json({ ok: true });
      }

      /* ---- 11) إشعار عند تحميل مشروع: إيميل بمرفقات للـ Owner و Comms ---- */
      if (request.method === "POST" && path === "/notify") {
        var sender = await getSessionUser(env, request);
        if (!sender) return json({ error: "غير مسجّل دخول" }, 401);
        if (!env.MAIL_ENDPOINT || !env.MAIL_SECRET) return json({ error: "خدمة البريد غير مضبوطة (MAIL_ENDPOINT / MAIL_SECRET)" }, 500);

        var nb2 = await request.json();
        var atts = Array.isArray(nb2.attachments) ? nb2.attachments : [];
        var title = (nb2.title || "مشروع بدون عنوان").toString().slice(0, 120);

        // اسم المشروع: من الطلب (المشروع النشط) وإلا من جلسة المُرسِل
        var projName = (nb2.project_name && String(nb2.project_name).trim()) ? String(nb2.project_name).trim() : "";
        if (!projName) { var senderProj = await getProject(env, sender.project_id); projName = senderProj ? senderProj.name : "STUDY ZONE"; }

        // المستلمون ديناميكياً: كل Owner و Comms
        var rcptRows = await env.DB.prepare("SELECT email FROM users WHERE role IN ('owner','comms')").all();
        var recipients = (rcptRows.results || []).map(function (r) { return r.email; });
        if (recipients.length === 0) return json({ error: "لا يوجد مستلمون (Owner/Comms)" }, 400);

        var when = new Date().toISOString().replace("T", " ").slice(0, 19) + " UTC";
        var safeTitle = title.replace(/[<>&]/g, "");
        var safeProj = projName.replace(/[<>&]/g, "");
        var html =
          "<div style='font-family:Arial,sans-serif;direction:rtl;text-align:right'>" +
          "<h2 style='color:#003c54'>مشروع جديد من " + safeProj + "</h2>" +
          "<p><b>المشروع:</b> " + safeProj + "</p>" +
          "<p><b>العنوان:</b> " + safeTitle + "</p>" +
          "<p><b>أنشأه:</b> " + sender.email + "</p>" +
          "<p><b>التوقيت:</b> " + when + "</p>" +
          "<p>الملفات مرفقة بهذا الإيميل (البوستر، الستوري، ملف المشروع).</p>" +
          "</div>";

        var attachments = atts.map(function (a) {
          return { filename: a.filename, content: a.b64 };
        });

        // يُرسَل عبر خدمة التحويل على mail.hcsyria.org لأن Workers لا تتكلم SMTP.
        // اسم المُرسِل يأتي من إعدادات الخدمة، لا من هنا.
        var payload = {
          to: recipients,
          subject: "مشروع جديد: " + safeTitle + " — " + safeProj + " — " + sender.email,
          html: html,
          attachments: attachments,
        };

        var rr = await fetch(env.MAIL_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Auth": env.MAIL_SECRET },
          body: JSON.stringify(payload),
        });
        var rd = {}; try { rd = await rr.json(); } catch (e) {}
        if (!rr.ok) return json({ error: (rd && rd.error) || ("Mailer HTTP " + rr.status) }, 502);
        return json({ ok: true, recipients: recipients.length });
      }

      return json({ error: "Not found" }, 404);
    } catch (e) {
      return json({ error: String((e && e.message) || e) }, 500);
    }
  },
};