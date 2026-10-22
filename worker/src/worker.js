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

// Reels Gen — موسيقى ElevenLabs (جدول ai_usage)
const MUSIC_DAILY_MAX  = 20;   // مقطوعات لكل مستخدم خلال 24 ساعة
const MUSIC_MIN_SEC    = 10;
const MUSIC_MAX_SEC    = 90;
const MUSIC_PROMPT_MAX = 500;  // أحرف وصف الموسيقى
// Reels Gen — صياغة السكريبت (Gemini) والتعليق الصوتي (ElevenLabs) لكل من يملك الأداة
const SCRIPT_DAILY_MAX = 60;   // صياغات لكل مستخدم خلال 24 ساعة
const SCRIPT_MAX_CHARS = 4000; // سكريبت المستخدم
const VOICE_DAILY_MAX  = 40;   // تعليقات صوتية لكل مستخدم خلال 24 ساعة
const VOICE_MAX_CHARS  = 1200; // نص التعليق كاملاً (ريل 45 ث ≈ 500–700 حرف)
const VOICE_NAME       = "mazen";            // يُبحث عنه في أصوات الحساب ثم في مكتبة ElevenLabs
const VOICE_NAME_FULL  = "mazen lawand";
const VOICE_MODEL      = "eleven_multilingual_v2";
// Reels Gen — تلخيص الكلام: Gemini يسمع صوت الفيديو ويختار أفكاراً كاملة
const MOMENTS_DAILY_MAX = 30;                 // تحليلات لكل مستخدم خلال 24 ساعة
const MOMENTS_MAX_BYTES = 40 * 1048576;       // صوت Opus ≈ 11 MB للساعة
const MOMENTS_MAX_SEGS  = 3000;
const CRITIQUE_DAILY_MAX = 90;                 // جولات نقد لكل مستخدم خلال 24 ساعة (حتى 3 لكل ريل)
// Text Transcription — تفريغ الصور بـ Gemini (تفريغ الجهاز لا يمرّ من هنا)
const TRANSCRIBE_DAILY_MAX  = 60;               // طلبات لكل مستخدم خلال 24 ساعة (حتى 6 صور لكل طلب)
const TRANSCRIBE_MAX_IMAGES = 6;
const TRANSCRIBE_MAX_BYTES  = 30 * 1048576;
// أهداف الريل وبنية كل هدف — Gemini يختار واحداً من المحتوى ويرتّب الأفكار حسبه
const MOMENTS_GOALS = {
  "تعريف بمشروع":  "what the project is, then who it serves, then what they do there, then how to join or learn more",
  "قصة نجاح":      "the person and the challenge before, then the turning point, then the change and the result now",
  "دعوة للتسجيل":  "the need or the chance, then what is offered, then who it is for, then how and when to register",
  "أثر ونتائج":    "the need, then what was done, then the results and numbers, then what comes next",
  "تغطية فعالية":  "what the event is, then its key moments and statements, then the takeaway",
  "توعية ونصائح":  "the issue, then the key advice, then a closing message"
};
var voiceIdCache = null;       // يبقى طوال عمر نسخة الـWorker

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

// هل يملك المستخدم مشروعاً بهذا الـslug (جاهزاً)؟ — نفس قاعدة ظهور الأدوات بالواجهة
async function hasProjectSlug(env, user, slug) {
  var list = await getAccessibleProjects(env, user.email, user.role);
  return list.some(function (p) { return p.slug === slug && p.status === "ready"; });
}
async function usedToday(env, email, kind) {
  var since = new Date(Date.now() - 86400000).toISOString().replace("T", " ").slice(0, 19);
  var row = await env.DB.prepare("SELECT COUNT(*) AS c FROM ai_usage WHERE email=?1 AND kind=?2 AND at>?3").bind(email, kind, since).first();
  return (row && row.c) || 0;
}

/* ---------- ElevenLabs: صوت مازن لاوند ----------
   ELEVENLABS_VOICE_ID (اختياري) يتجاوز البحث. وإلا: أصوات الحساب أولاً، ثم مكتبة
   الأصوات المشتركة — وإن وُجد هناك يُضاف إلى أصوات الحساب مرة واحدة (شرط ElevenLabs
   لاستعماله عبر الـAPI). */
function pickVoice(list, nameOf) {
  var hits = (list || []).filter(function (v) { return String(nameOf(v) || "").toLowerCase().indexOf(VOICE_NAME) >= 0; });
  return hits.filter(function (v) { return String(nameOf(v)).toLowerCase().indexOf(VOICE_NAME_FULL) >= 0; })[0] || hits[0] || null;
}
async function findVoiceId(env) {
  if (env.ELEVENLABS_VOICE_ID) return env.ELEVENLABS_VOICE_ID;
  if (voiceIdCache) return voiceIdCache;
  var h = { "xi-api-key": env.ELEVENLABS_API_KEY };
  var mine = await fetch("https://api.elevenlabs.io/v2/voices?page_size=100&search=" + encodeURIComponent(VOICE_NAME), { headers: h });
  if (mine.ok) {
    var md = await mine.json(), mv = pickVoice(md.voices, function (v) { return v.name; });
    if (mv) return (voiceIdCache = mv.voice_id);
  }
  var shared = await fetch("https://api.elevenlabs.io/v1/shared-voices?page_size=50&search=" + encodeURIComponent(VOICE_NAME_FULL), { headers: h });
  if (!shared.ok) return null;
  var sd = await shared.json(), sv = pickVoice(sd.voices, function (v) { return v.name; });
  if (!sv) return null;
  var add = await fetch("https://api.elevenlabs.io/v1/voices/add/" + encodeURIComponent(sv.public_owner_id) + "/" + encodeURIComponent(sv.voice_id), {
    method: "POST", headers: { ...h, "Content-Type": "application/json" }, body: JSON.stringify({ new_name: sv.name })
  });
  if (!add.ok) return null;
  var ad = await add.json();
  return (voiceIdCache = ad.voice_id || sv.voice_id);
}

/* ---------- قواعد الصلاحيات ---------- */
/* ---------- Gemini: one JSON answer ----------
   Reels Gen calls Gemini on a key of its own (REELS_GEMINI_KEY, a separate
   free Google project, so its daily quota is not shared with the other tools),
   and on GEMINI_API_KEY until that secret is set. */
function reelsKey(env) { return env.REELS_GEMINI_KEY || env.GEMINI_API_KEY; }
// Text Transcription: a key of its own when TRANSCRIBE_GEMINI_KEY is set, else the Reels one.
function transcribeKey(env) { return env.TRANSCRIBE_GEMINI_KEY || reelsKey(env); }
/* Retries when Gemini is busy and falls back along the given models. A model
   that rejects the request outright (400) is asked again with less: first
   without the thinking and output-length settings, then without the strict
   schema (written into the instructions instead) — the lighter models refuse
   some of these. What a model needed is remembered for the Worker's lifetime,
   so later calls do not spend a request finding out again. Returns {data}
   (the parsed JSON) or {error} (a message for the user). */
var geminiLenient = {};   // model → 1 (no thinking / output settings) or 2 (no schema either)
function geminiSoften(body, level) {
  if (!level || !body.generationConfig) return body;
  var gc = Object.assign({}, body.generationConfig), sys = body.system_instruction;
  delete gc.thinkingConfig; delete gc.maxOutputTokens;
  if (level >= 2 && gc.responseSchema) {
    var schema = gc.responseSchema; delete gc.responseSchema;
    sys = { parts: [{ text: (sys ? sys.parts[0].text : "") + "\nThe JSON must follow this schema exactly: " + JSON.stringify(schema) }] };
  }
  return Object.assign({}, body, { generationConfig: gc, system_instruction: sys });
}
async function geminiJSON(key, models, body, label) {
  var r = null, d = null, overQuota = false;
  async function call(model) {
    var level = geminiLenient[model] || 0, t0 = Date.now();
    r = await fetch("https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent?key=" + key,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(geminiSoften(body, level)) });
    d = await r.json();
    console.log("gemini " + (label || "") + " " + model + (level ? " (lenient " + level + ")" : "") + " " + r.status + " " + (Date.now() - t0) + "ms" + (r.ok ? "" : ": " + JSON.stringify(d && d.error || d).slice(0, 300)));
    if (r.status === 429) overQuota = true;
    if (r.status === 400 && level < 2 && body.generationConfig) { geminiLenient[model] = level + 1; return call(model); }
  }
  for (var i = 0; i < models.length; i++) {
    if (i) await new Promise(function (res) { setTimeout(res, 1500 * i); });
    try { await call(models[i]); } catch (e) { r = null; d = null; continue; }
    if (r.ok || r.status === 401 || r.status === 403 || r.status === 404) break;   // anything else (busy, over quota, rejected) tries the next model
  }
  if (!r) return { error: "تعذّر الاتصال بـ Gemini" };
  if (!r.ok) return { error: overQuota && r.status !== 400 ? "خلص الحد اليومي المجاني لـ Gemini، والنموذج البديل مضغوط — جرّب بعد شوي أو بكرا"
                           : r.status === 503 ? "Gemini مضغوط حالياً — جرّب بعد دقيقة"
                           : ((d && d.error && d.error.message) || "فشل طلب Gemini") };
  var out = ""; try { out = d.candidates[0].content.parts[0].text || ""; } catch (e) {}
  out = out.replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "");   // a lenient answer may come fenced
  try { return { data: JSON.parse(out) }; } catch (e) { return { error: "ردّ Gemini غير صالح" }; }
}
/* A long answer (a minute or two of Gemini) as a stream: the response starts
   at once and a space goes out every few seconds until the JSON follows, so
   nothing on the way gives up on the request and sends it again (which would
   run it — and spend the quota — twice). Errors travel in the JSON, with 200. */
function slowJSON(work) {
  var ts = new TransformStream(), w = ts.writable.getWriter(), enc = new TextEncoder();
  w.write(enc.encode(" ")).catch(function () {});
  var tick = setInterval(function () { w.write(enc.encode(" ")).catch(function () {}); }, 4000);
  (async function () {
    var out; try { out = await work(); } catch (e) { out = { error: "خطأ بالخادم: " + (e && e.message || e) }; }
    clearInterval(tick);
    try { await w.write(enc.encode(JSON.stringify(out))); await w.close(); } catch (e) {}
  })();
  return new Response(ts.readable, { status: 200, headers: { ...cors(), "Content-Type": "application/json", "Cache-Control": "no-store" } });
}

/* ---------- Reels Gen: speech summaries (shared by /reels/moments and /reels/critique) ---------- */
// Upload audio to Gemini's Files API and wait until it can be read. Returns {file} or {error};
// the caller deletes the file (geminiDelete) as soon as it is done with it.
async function geminiUpload(key, bytes, mime, name) {
  var gk = "?key=" + key, gBase = "https://generativelanguage.googleapis.com";
  var st = await fetch(gBase + "/upload/v1beta/files" + gk, { method: "POST",
    headers: { "X-Goog-Upload-Protocol": "resumable", "X-Goog-Upload-Command": "start", "X-Goog-Upload-Header-Content-Length": String(bytes.byteLength),
               "X-Goog-Upload-Header-Content-Type": mime, "Content-Type": "application/json" },
    body: JSON.stringify({ file: { display_name: name } }) });
  var url = st.ok && st.headers.get("x-goog-upload-url");
  if (!url) return { error: "تعذّر رفع الصوت لـ Gemini" };
  var fr = await fetch(url, { method: "POST", headers: { "X-Goog-Upload-Offset": "0", "X-Goog-Upload-Command": "upload, finalize" }, body: bytes });
  var file = fr.ok ? ((await fr.json()).file || null) : null;
  if (!file || !file.name) return { error: "تعذّر رفع الصوت لـ Gemini" };
  for (var i = 0; i < 40 && file.state === "PROCESSING"; i++) {   // audio is usually ready at once
    await new Promise(function (r) { setTimeout(r, 1500); });
    file = await (await fetch(gBase + "/v1beta/" + file.name + gk)).json();
  }
  if (file.state !== "ACTIVE") return { error: "Gemini ما قدر يقرأ الصوت", file: file };
  return { file: file };
}
function geminiDelete(key, ctx, file) {   // the audio does not stay with Google
  if (file && file.name) ctx.waitUntil(fetch("https://generativelanguage.googleapis.com/v1beta/" + file.name + "?key=" + key, { method: "DELETE" }).catch(function () {}));
}
// Body: [4-byte JSON length][JSON][Ogg Opus audio]
function splitAudioBody(buf) {
  if (buf.byteLength < 8 || buf.byteLength > MOMENTS_MAX_BYTES) return null;
  var len = new DataView(buf).getUint32(0), meta;
  try { meta = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, len))); } catch (e) { return null; }
  return { meta: meta, audio: buf.slice(4 + len) };
}
function momentsSegs(meta) {
  return (Array.isArray(meta.segments) ? meta.segments : []).slice(0, MOMENTS_MAX_SEGS).map(function (s) { return [Number(s[0]) || 0, Number(s[1]) || 0]; });
}
// The transcript as the editor reads it: number [start-end, length] words
function momentsLines(segs, text) {
  return text.map(function (t, i) { return t ? (i + 1) + " [" + segs[i][0].toFixed(1) + "-" + segs[i][1].toFixed(1) + ", " + (segs[i][1] - segs[i][0]).toFixed(1) + "s] " + t : ""; }).filter(Boolean);
}
function momentsRuns(list, segs, text) {
  return (list || []).map(function (m) {
    return { from: Math.round(Number(m && m.from)), to: Math.round(Number(m && m.to)), why: String(m && m.why || "").trim().slice(0, 60) };
  }).filter(function (m) { return m.from >= 1 && m.to >= m.from && m.to <= segs.length && text[m.from - 1] && text[m.to - 1]; }).slice(0, 20);
}
function momentsSecs(runs, segs) { return runs.reduce(function (s, m) { return s + segs[m.to - 1][1] - segs[m.from - 1][0]; }, 0); }
function momentsRules(lo, room) {
  return "RULES for moments:\n" +
"- Each run is ONE COMPLETE, CLEAR THOUGHT that makes sense on its own. It starts where a sentence starts and ends where a sentence ends: never cut a sentence, never leave a thought unfinished. If a sentence spans several segments, include all of them.\n" +
"- A run must not lean on words outside it: if it opens with a word that points back (them, this, that, so, and, also, هم، هاد، هيك، لأنو، و…), start the run earlier so the listener knows what it refers to — or choose another run.\n" +
"- Usually 3 to 6 runs, each 3 to 20 seconds (start of 'from' to end of 'to'). Together they last between " + lo + " and " + room + " seconds: fill that time, never go over " + room + ".\n" +
"- Follow the goal's structure; the order may differ from the video's. The first run is a strong, self-contained opening that makes people keep watching. If the video ends with a call to action (how to join or register), the reel ends with it.\n" +
"- Leave out greetings, thanks, self-introductions (unless they are the point), filler (um, so, okay), checks of the microphone, repeated ideas and false starts — do not keep them inside a run either: end the run before them or start it after them.\n" +
"- 'why' is 2 to 6 Arabic words on the run's role in the structure (like «افتتاحية قوية» or «النتيجة»).\n" +
"- Use only numbers from the transcript, and choose from what is written there.\n";
}
var MOMENTS_RUNS_SCHEMA = { type: "ARRAY", items: { type: "OBJECT", required: ["from", "to", "why"], propertyOrdering: ["from", "to", "why"],
  properties: { from: { type: "INTEGER" }, to: { type: "INTEGER" }, why: { type: "STRING" } } } };
var CRITIC_KINDS = ["cut_start", "cut_end", "missing_context", "unclear", "weak", "filler", "order", "off_topic"];

function canManage(role) { return role === "owner" || role === "admin" || role === "comms"; }
function isGlobalRole(role) { return role === "owner" || role === "comms"; } // وصول شامل لكل المشاريع
function rolesVisibleTo(role) {
  if (role === "owner") return ROLES;                 // يرى الجميع
  if (role === "comms") return ["user", "admin"];     // Comms يدير الـ users والـ admins
  if (role === "admin") return ["user"];              // Admin يرى الـ users فقط
  return [];
}
// هل يملك هذا الدور صلاحية إدارة (تعديل/حذف) دور الهدف؟
// owner: الكل عدا owner | comms: user + admin | admin: user
function canTarget(actorRole, targetRole) {
  if (targetRole === "owner") return false;
  if (targetRole === "comms") return actorRole === "owner";
  if (targetRole === "admin") return actorRole === "owner" || actorRole === "comms";
  if (targetRole === "user")  return actorRole === "owner" || actorRole === "admin" || actorRole === "comms";
  return false;
}
function canAssign(actorRole, targetRole) {
  if (actorRole === "owner") return ["user", "admin", "comms"].indexOf(targetRole) >= 0;
  if (actorRole === "admin" || actorRole === "comms") return targetRole === "user";
  return false;
}

export default {
  async fetch(request, env, ctx) {
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
        if (!canTarget(actor3.role, target.role)) return json({ error: "لا صلاحية على هذا الدور" }, 403);
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
        if (!canTarget(spActor.role, spTarget.role)) return json({ error: "لا صلاحية على هذا الدور" }, 403);
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
        if (!canTarget(pwActor.role, pwTarget.role)) return json({ error: "لا صلاحية على هذا الدور" }, 403);
        if (pwPass.length < 4) return json({ error: "كلمة السر 4 أحرف على الأقل" }, 400);
        var pwHash = await hashPassword(pwPass);
        await env.DB.prepare("UPDATE users SET password=?1 WHERE email=?2").bind(pwHash, pwEmail).run();
        return json({ ok: true });
      }

      /* ---- 7b2) Reels Gen: موسيقى خلفية عبر ElevenLabs Music ----
         المفتاح سرّ بالـ Worker (ELEVENLABS_API_KEY) ولا يصل للمتصفح. مرحلة التجربة:
         owner و comms فقط، وحد يومي لكل مستخدم (جدول ai_usage). يعيد ملف mp3. */
      if (request.method === "POST" && path === "/reels/music") {
        var muUser = await getSessionUser(env, request);
        if (!muUser) return json({ error: "غير مسجّل دخول" }, 401);
        if (!isGlobalRole(muUser.role)) return json({ error: "لا صلاحية" }, 403);
        if (!env.ELEVENLABS_API_KEY) return json({ error: "مفتاح ElevenLabs غير مضبوط" }, 500);
        var mub = await request.json();
        var muPrompt = String(mub.prompt || "").trim().slice(0, MUSIC_PROMPT_MAX);
        var muSecs = Math.round(Number(mub.seconds) || 0);
        if (!muPrompt) return json({ error: "اكتب وصف الموسيقى" }, 400);
        if (muSecs < MUSIC_MIN_SEC || muSecs > MUSIC_MAX_SEC) return json({ error: "المدة بين " + MUSIC_MIN_SEC + " و" + MUSIC_MAX_SEC + " ثانية" }, 400);
        var muSince = new Date(Date.now() - 86400000).toISOString().replace("T", " ").slice(0, 19);
        var muUsed = await env.DB.prepare("SELECT COUNT(*) AS c FROM ai_usage WHERE email=?1 AND kind='music' AND at>?2").bind(muUser.email, muSince).first();
        if (muUsed && muUsed.c >= MUSIC_DAILY_MAX) return json({ error: "وصلت للحد اليومي (" + MUSIC_DAILY_MAX + " مقطوعة). جرّب بكرا." }, 429);
        var muRes = await fetch("https://api.elevenlabs.io/v1/music?output_format=mp3_44100_128", {
          method: "POST",
          headers: { "xi-api-key": env.ELEVENLABS_API_KEY, "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: muPrompt, music_length_ms: muSecs * 1000, force_instrumental: mub.instrumental !== false })
        });
        if (!muRes.ok) {
          var muErr = ""; try { var mue = await muRes.json(); muErr = (mue.detail && (mue.detail.message || mue.detail)) || ""; } catch (e) {}
          return json({ error: "تعذّر توليد الموسيقى" + (muErr ? ": " + (typeof muErr === "string" ? muErr : JSON.stringify(muErr)) : "") }, 502);
        }
        await env.DB.prepare("INSERT INTO ai_usage (email, kind, at) VALUES (?1, 'music', datetime('now'))").bind(muUser.email).run();
        return new Response(muRes.body, { status: 200, headers: { ...cors(), "Content-Type": "audio/mpeg", "Cache-Control": "no-store" } });
      }

      /* ---- 7b3) Reels Gen: سكريبت المستخدم ← جمل التعليق الصوتي + نصوص الكروت (Gemini) ----
         لكل من يملك أداة reels-gen. يعيد {lines:[{voice, card}]}: كل جملة تُقرأ بالتعليق،
         و card نص قصير لكرت يظهر معها (فارغ لمعظم الجمل). */
      if (request.method === "POST" && path === "/reels/script") {
        var scUser = await getSessionUser(env, request);
        if (!scUser) return json({ error: "غير مسجّل دخول" }, 401);
        if (!(await hasProjectSlug(env, scUser, "reels-gen"))) return json({ error: "لا صلاحية" }, 403);
        if (!reelsKey(env)) return json({ error: "مفتاح Gemini غير مضبوط" }, 500);
        var scb = await request.json();
        var scText = String(scb.script || "").trim().slice(0, SCRIPT_MAX_CHARS);
        var scSecs = Math.max(15, Math.min(80, Math.round(Number(scb.seconds) || 40)));
        if (!scText) return json({ error: "اكتب السكريبت أولاً" }, 400);
        if ((await usedToday(env, scUser.email, "script")) >= SCRIPT_DAILY_MAX) return json({ error: "وصلت للحد اليومي للصياغة. جرّب بكرا." }, 429);
        var scWords = Math.round(scSecs * 2.1);
        var scSys =
"You write the voiceover and on-screen text cards for a short vertical social-media reel (Instagram/Facebook) for an NGO's education and community projects in Syria.\n" +
"The user gives a rough script or notes. Rewrite it into a voiceover read by a male narrator, plus a few short text cards.\n" +
"LANGUAGE: simple, warm Syrian colloquial Arabic — a neutral 'white' Syrian dialect that any Syrian understands. NOT heavy Modern Standard Arabic, and NOT the marked accent of any one city or region (avoid strongly Aleppine, Damascene, coastal or rural markers). Natural spoken phrasing, e.g. «شو»، «هيك»، «كتير»، «لأنو»، «عم».\n" +
"LENGTH: the whole voiceover must be read in about " + scSecs + " seconds — about " + Math.round(scWords * 0.9) + " to " + scWords + " words in total. Never exceed " + scWords + " words.\n" +
"LINES: split the voiceover into 7 to 12 short sentences (one breath each, 4–14 words). The last line is a short closing/call-to-action.\n" +
"CARDS: a card is on-screen text shown ALONE, in silence, just BEFORE its line is spoken — the narrator NEVER reads it. Give a card on the FIRST line (the hook: a question or striking statement that makes people stop scrolling) and on each line where the reel moves to a NEW idea — 3 cards in total (4 at most); every other line has card \"\". A card is at most 7 words, in the same dialect, punchy, and may be split over two lines with \\n at a natural break (like «شو نفع الشهادة\\nاذا ما عم تعرف تستخدمها؟»).\n" +
"NO REPETITION: the voice line after a card must NOT repeat, paraphrase or re-ask the card — the viewer has just read it. The line picks up from the card and moves the thought forward (answers the question, gives the example, adds the next fact).\n" +
"Keep names of people, places, projects and organisations exactly as given. Use Western digits 0-9. No emojis, no hashtags, no stage directions.\n" +
"Return ONLY JSON: {\"lines\":[{\"voice\":\"...\",\"card\":\"...\"}]}";
        // Gemini answers 503/429 ("high demand") at busy times: retry, then fall back to the lighter model
        var scBody = JSON.stringify({
          system_instruction: { parts: [{ text: scSys }] },
          contents: [{ role: "user", parts: [{ text: scText }] }],
          generationConfig: { temperature: 0.7, responseMimeType: "application/json" }
        });
        var scTries = ["gemini-flash-latest", "gemini-flash-latest", "gemini-flash-lite-latest", "gemini-flash-lite-latest"];
        var scR = null, scD = null;
        for (var sci = 0; sci < scTries.length; sci++) {
          if (sci) await new Promise(function (r) { setTimeout(r, 800 * sci); });
          try {
            scR = await fetch("https://generativelanguage.googleapis.com/v1beta/models/" + scTries[sci] + ":generateContent?key=" + reelsKey(env),
              { method: "POST", headers: { "Content-Type": "application/json" }, body: scBody });
            scD = await scR.json();
          } catch (e) { scR = null; scD = null; continue; }
          if (scR.ok || (scR.status !== 503 && scR.status !== 429 && scR.status !== 500)) break;
        }
        if (!scR) return json({ error: "تعذّر الاتصال بخدمة الصياغة" }, 502);
        if (!scR.ok) {
          var scBusy = scR.status === 503 || scR.status === 429;
          return json({ error: scBusy ? "خدمة الصياغة (Gemini) مضغوطة حالياً — جرّب بعد دقيقة" : ((scD && scD.error && scD.error.message) || "فشلت الصياغة") }, 502);
        }
        var scOut = ""; try { scOut = scD.candidates[0].content.parts[0].text || ""; } catch (e) {}
        var scParsed; try { scParsed = JSON.parse(scOut); } catch (e) { return json({ error: "ردّ الصياغة غير صالح" }, 502); }
        var scLines = (Array.isArray(scParsed && scParsed.lines) ? scParsed.lines : [])
          .map(function (l) { return { voice: String(l && l.voice || "").trim(), card: String(l && l.card || "").trim() }; })
          .filter(function (l) { return l.voice; }).slice(0, 14);
        if (!scLines.length) return json({ error: "لم تُرجع الصياغة أي جملة" }, 502);
        await env.DB.prepare("INSERT INTO ai_usage (email, kind, at) VALUES (?1, 'script', datetime('now'))").bind(scUser.email).run();
        return json({ ok: true, lines: scLines });
      }

      /* ---- 7b4) Reels Gen: تعليق صوتي بصوت مازن لاوند (ElevenLabs، مع توقيت كل جملة) ----
         يستقبل {lines:[نص]} ويقرؤها دفعة واحدة (أداء متصل)، ثم يحسب من محاذاة الأحرف
         بداية ونهاية كل جملة. يعيد {audio: mp3 base64, lines:[{start,end}], duration}. */
      if (request.method === "POST" && path === "/reels/voice") {
        var vcUser = await getSessionUser(env, request);
        if (!vcUser) return json({ error: "غير مسجّل دخول" }, 401);
        if (!(await hasProjectSlug(env, vcUser, "reels-gen"))) return json({ error: "لا صلاحية" }, 403);
        if (!env.ELEVENLABS_API_KEY) return json({ error: "مفتاح ElevenLabs غير مضبوط" }, 500);
        var vcb = await request.json();
        var vcLines = (Array.isArray(vcb.lines) ? vcb.lines : []).map(function (l) { return String(l || "").replace(/\s+/g, " ").trim(); }).filter(Boolean);
        if (!vcLines.length) return json({ error: "لا يوجد نص للتعليق" }, 400);
        var vcText = vcLines.join("\n");
        if (vcText.length > VOICE_MAX_CHARS) return json({ error: "نص التعليق طويل (" + vcText.length + " حرف، الحد " + VOICE_MAX_CHARS + ")" }, 400);
        if ((await usedToday(env, vcUser.email, "voice")) >= VOICE_DAILY_MAX) return json({ error: "وصلت للحد اليومي (" + VOICE_DAILY_MAX + " تعليق). جرّب بكرا." }, 429);
        var vcId = await findVoiceId(env);
        if (!vcId) return json({ error: "لم أجد صوت «Mazen Lawand» في حساب ElevenLabs ولا في مكتبة الأصوات" }, 502);
        var vcR = await fetch("https://api.elevenlabs.io/v1/text-to-speech/" + encodeURIComponent(vcId) + "/with-timestamps?output_format=mp3_44100_128", {
          method: "POST",
          headers: { "xi-api-key": env.ELEVENLABS_API_KEY, "Content-Type": "application/json" },
          body: JSON.stringify({ text: vcText, model_id: VOICE_MODEL,
                                 voice_settings: { stability: 0.5, similarity_boost: 0.8, style: 0.15, use_speaker_boost: true } })
        });
        if (!vcR.ok) {
          var vcErr = ""; try { var vce = await vcR.json(); vcErr = (vce.detail && (vce.detail.message || vce.detail)) || ""; } catch (e) {}
          if (vcR.status === 404 || vcR.status === 400) voiceIdCache = null;   // صوت محذوف/مُستبدل: ابحث من جديد بالمرة الجاية
          return json({ error: "تعذّر توليد التعليق" + (vcErr ? ": " + (typeof vcErr === "string" ? vcErr : JSON.stringify(vcErr)) : "") }, 502);
        }
        var vcD = await vcR.json(), al = vcD.alignment || vcD.normalized_alignment || {};
        var chars = al.characters || [], cs = al.character_start_times_seconds || [], ce = al.character_end_times_seconds || [];
        // حدود كل جملة بمواقع أحرفها داخل النص المجمّع (الجمل مفصولة بسطر جديد)
        var vcTimes = [], off = 0;
        vcLines.forEach(function (l) {
          var a = off, b = off + l.length - 1, s = null, e = null;
          for (var i = a; i <= b && i < chars.length; i++) { if (!/\s/.test(chars[i])) { if (s === null) s = cs[i]; e = ce[i]; } }
          vcTimes.push({ start: s === null ? 0 : s, end: e === null ? 0 : e });
          off += l.length + 1;
        });
        await env.DB.prepare("INSERT INTO ai_usage (email, kind, at) VALUES (?1, 'voice', datetime('now'))").bind(vcUser.email).run();
        return json({ ok: true, audio: vcD.audio_base64, lines: vcTimes, duration: ce.length ? ce[ce.length - 1] : 0 });
      }

      /* ---- 7b5) Reels Gen: تلخيص فيديو بالكلام — أفكار كاملة (Gemini، خطوتان) ----
         الجسم: [4 بايت طول JSON][JSON {seconds, segments:[[start,end]], transcript?}][صوت Ogg Opus].
         المقاطع حدودها سكتات اكتشفها المتصفح. الخطوة 1: Gemini يسمع الصوت ويفرّغ كل مقطع
         برقمه فقط (يُرفع عبر Files API ويُحذف بعدها مباشرة) — وتُتخطّى إن أرسل المتصفح
         التفريغ من مرة سابقة (بلا صوت). الخطوة 2: نص فقط — يحدّد هدف الريل من قائمة ثابتة
         ويختار سلاسل متتالية (from..to) كل منها فكرة كاملة، مرتّبة حسب بنية الهدف.
         الرد يتدفّق (slowJSON): {goal, topic, transcript, moments:[{from,to,why}]} أو {error}. */
      if (request.method === "POST" && path === "/reels/moments") {
        var moUser = await getSessionUser(env, request);
        if (!moUser) return json({ error: "غير مسجّل دخول" }, 401);
        if (!(await hasProjectSlug(env, moUser, "reels-gen"))) return json({ error: "لا صلاحية" }, 403);
        var moKey = reelsKey(env);
        if (!moKey) return json({ error: "مفتاح Gemini غير مضبوط" }, 500);
        if (Number(request.headers.get("Content-Length") || 0) > MOMENTS_MAX_BYTES) return json({ error: "صوت الفيديو أكبر من المسموح" }, 413);
        if ((await usedToday(env, moUser.email, "moments")) >= MOMENTS_DAILY_MAX) return json({ error: "وصلت للحد اليومي لتحليل الكلام. جرّب بكرا." }, 429);
        var moIn = splitAudioBody(await request.arrayBuffer());
        if (!moIn) return json({ error: "طلب غير صالح" }, 400);
        var moSegs = momentsSegs(moIn.meta), moRoom = Math.max(8, Math.min(90, Number(moIn.meta.seconds) || 40));
        var moKnown = Array.isArray(moIn.meta.transcript) && moIn.meta.transcript.length === moSegs.length;
        if (!moSegs.length || (!moKnown && moIn.audio.byteLength < 100)) return json({ error: "ما في كلام بالفيديو" }, 400);
        var moModels = ["gemini-flash-latest", "gemini-flash-latest", "gemini-flash-lite-latest", "gemini-flash-lite-latest"];
        return slowJSON(async function () {
          var moText = moSegs.map(function (s, i) { return moKnown ? String(moIn.meta.transcript[i] || "").slice(0, 400) : ""; });
          if (!moKnown) {
            // 1) transcribe each numbered segment from the audio — nothing else
            var moUp = await geminiUpload(moKey, moIn.audio, "audio/ogg", "reels-gen-moments");
            if (moUp.error) { geminiDelete(moKey, ctx, moUp.file); return { error: moUp.error }; }
            var moT;
            try {
              var moList = moSegs.map(function (s, i) { return (i + 1) + ": " + s[0].toFixed(1) + "-" + s[1].toFixed(1); }).join("\n");
              moT = await geminiJSON(moKey, moModels, {
                system_instruction: { parts: [{ text:
"You transcribe speech. You get a soundtrack and a numbered list of segments, each with its start and end in seconds from the start of the audio.\n" +
"For EVERY number in the list, in order, write exactly the words spoken inside that time span, as spoken: the speaker's own dialect (mostly Syrian Arabic, in Arabic script), and English or other words as they are said. No translation, no correction, no summary.\n" +
"The list marks where there is SOUND, not where there are words. If a segment has no clear words (music, applause, laughter, noise, tones, unclear voices), its text is \"\".\n" +
"NEVER invent or guess words. Write only what you actually hear.\n" +
"Return ONLY JSON: {\"segments\":[{\"n\":1,\"text\":\"...\"}, ...]}, one entry per number, covering all " + moSegs.length + " numbers." }] },
                contents: [{ role: "user", parts: [{ file_data: { mime_type: "audio/ogg", file_uri: moUp.file.uri } }, { text: "Segments (number: start-end seconds):\n" + moList }] }],
                generationConfig: { temperature: 0, maxOutputTokens: 65536, thinkingConfig: { thinkingBudget: 0 }, responseMimeType: "application/json", responseSchema: {
                  type: "OBJECT", required: ["segments"], properties: { segments: { type: "ARRAY", items: { type: "OBJECT", required: ["n", "text"],
                    properties: { n: { type: "INTEGER" }, text: { type: "STRING" } } } } } } }
              }, "transcribe");
            } finally { geminiDelete(moKey, ctx, moUp.file); }
            if (moT.error) return { error: moT.error };
            ((moT.data && moT.data.segments) || []).forEach(function (x) {
              var n = Math.round(Number(x && x.n)); if (n >= 1 && n <= moSegs.length) moText[n - 1] = String(x.text || "").replace(/\s+/g, " ").trim().slice(0, 400);
            });
          }
          await env.DB.prepare("INSERT INTO ai_usage (email, kind, at) VALUES (?1, 'moments', datetime('now'))").bind(moUser.email).run();
          var moSaid = momentsLines(moSegs, moText);
          if (!moSaid.length) return { ok: true, goal: "", topic: "", transcript: moText, moments: [] };

          // 2) from the text alone: the reel's goal, a plan, then whole thoughts in that goal's shape
          var moGoals = Object.keys(MOMENTS_GOALS), moLo = Math.max(5, moRoom - 6);
          var moAsk = [{ role: "user", parts: [{ text: "Transcript:\n" + moSaid.join("\n") }] }];
          var moSel = {
            system_instruction: { parts: [{ text:
"You are a video editor making a short vertical summary reel from a long video about an NGO's education and community projects in Syria.\n" +
"You get the video's transcript as numbered segments: number [start-end seconds, length] words. Segments are split at pauses, so one sentence often runs over several segments. Missing numbers had no words.\n" +
"1) 'goal': decide from the content what this reel is for, exactly one of: " + moGoals.map(function (g) { return "«" + g + "» (" + MOMENTS_GOALS[g] + ")"; }).join("; ") + ".\n" +
"2) 'topic': one short Arabic sentence, the video's main idea.\n" +
"3) 'plan': a few short lines. Walk through the goal's structure step by step and, for each step, name the segment numbers that say it best, with their seconds. Add up the seconds.\n" +
"4) 'moments': the RUNS of consecutive segments (from..to) from your plan, in the order the reel plays them, so that someone who sees only the reel understands the idea clearly, in the speakers' own voices.\n" +
momentsRules(moLo, moRoom) + "Return ONLY JSON." }] },
            contents: moAsk,
            generationConfig: { temperature: 0.2, responseMimeType: "application/json", responseSchema: {
              type: "OBJECT", required: ["goal", "topic", "plan", "moments"], propertyOrdering: ["goal", "topic", "plan", "moments"], properties: {
                goal: { type: "STRING", enum: moGoals }, topic: { type: "STRING" }, plan: { type: "STRING" }, moments: MOMENTS_RUNS_SCHEMA } } }
          };
          var moS = await geminiJSON(moKey, moModels, moSel, "select");
          if (moS.error) return { error: moS.error, transcript: moText };
          var moMoments = momentsRuns(moS.data.moments, moSegs, moText), moSpoken = moText.reduce(function (s, t, i) { return s + (t ? moSegs[i][1] - moSegs[i][0] : 0); }, 0);
          if (momentsSecs(moMoments, moSegs) < moLo - 4 && moSpoken > moRoom * 1.3) {   // far too short while there is enough to say: ask once more
            moAsk.push({ role: "model", parts: [{ text: JSON.stringify(moS.data) }] },
                       { role: "user", parts: [{ text: "Your runs last " + Math.round(momentsSecs(moMoments, moSegs)) + " seconds; the reel needs " + moLo + " to " + moRoom + ". Keep what works and add more complete, self-contained thoughts that fit the goal's structure." }] });
            var moS2 = await geminiJSON(moKey, moModels, moSel, "select-again");
            var moM2 = moS2.error ? [] : momentsRuns(moS2.data.moments, moSegs, moText);
            if (momentsSecs(moM2, moSegs) > momentsSecs(moMoments, moSegs)) { moS = moS2; moMoments = moM2; }
          }
          var moGoal = String(moS.data.goal || ""); if (!MOMENTS_GOALS[moGoal]) moGoal = "";
          return { ok: true, goal: moGoal, topic: String(moS.data.topic || "").trim().slice(0, 200), transcript: moText, moments: moMoments };
        });
      }

      /* ---- 7b6) Reels Gen: ناقد يسمع الريل كمشاهد عادي، ومحرّر يعدّل حسب نقده ----
         الجسم كـ /reels/moments، والصوت هنا صوت الريل نفسه (اللحظات المختارة بالتتابع).
         JSON: {seconds, goal, topic, segments, transcript, moments:[{from,to,why}], starts:[ث],
         revise}. الناقد «أعمى»: يسمع الصوت فقط ويعرف أين يبدأ كل مقطع، لا أكثر — لا
         التفريغ ولا الهدف. يقول ما فهمه، ويقيّم ويحدّد المشاكل بأرقام اللحظات. إن كانت
         العلامة دون 8 وطُلب التعديل، يعدّل المحرّر (نص فقط) الاختيار على ضوء النقد.
         الرد يتدفّق: {critique:{understood, scores, issues, overall}, moments|null, plan} أو {error}. */
      if (request.method === "POST" && path === "/reels/critique") {
        var crUser = await getSessionUser(env, request);
        if (!crUser) return json({ error: "غير مسجّل دخول" }, 401);
        if (!(await hasProjectSlug(env, crUser, "reels-gen"))) return json({ error: "لا صلاحية" }, 403);
        var crKey = reelsKey(env);
        if (!crKey) return json({ error: "مفتاح Gemini غير مضبوط" }, 500);
        if ((await usedToday(env, crUser.email, "critique")) >= CRITIQUE_DAILY_MAX) return json({ error: "وصلت للحد اليومي للنقد. جرّب بكرا." }, 429);
        var crIn = splitAudioBody(await request.arrayBuffer());
        if (!crIn) return json({ error: "طلب غير صالح" }, 400);
        var crM = crIn.meta, crSegs = momentsSegs(crM), crRoom = Math.max(8, Math.min(90, Number(crM.seconds) || 40)), crLo = Math.max(5, crRoom - 6);
        var crText = crSegs.map(function (s, i) { return String((crM.transcript || [])[i] || "").slice(0, 400); });
        var crRuns = momentsRuns(crM.moments, crSegs, crText), crStarts = (Array.isArray(crM.starts) ? crM.starts : []).map(Number);
        if (!crRuns.length || crStarts.length !== crRuns.length || crIn.audio.byteLength < 100) return json({ error: "طلب غير صالح" }, 400);
        var crModels = ["gemini-flash-latest", "gemini-flash-latest", "gemini-flash-lite-latest", "gemini-flash-lite-latest"];
        return slowJSON(async function () {
          // the critic: a viewer who only hears the reel
          var crUp = await geminiUpload(crKey, crIn.audio, "audio/ogg", "reels-gen-critique");
          if (crUp.error) { geminiDelete(crKey, ctx, crUp.file); return { error: crUp.error }; }
          var crC;
          try {
            crC = await geminiJSON(crKey, crModels, {
              system_instruction: { parts: [{ text:
"You are an ordinary viewer in Syria scrolling Instagram and Facebook reels. You hear this short reel once, with no picture, and you know nothing about it beforehand.\n" +
"The reel is made of separate moments cut from a longer video and played one after another. You are told only when each moment starts.\n" +
"Listen as a real viewer would, and judge honestly whether the reel gets a clear idea across to you. Do not guess what the makers meant: judge only what you hear.\n" +
"- 'understood': in Arabic, one or two sentences: what this reel told you. If you did not get a clear idea, say so.\n" +
"- 'scores' from 1 to 10: clarity (one clear idea comes across), completeness (no word or sentence cut at the start or end of a moment, no thought left hanging), context (nothing refers to someone or something you never heard about), opening (the first seconds make you want to keep listening), ending (it ends on a complete closing note), flow (the moments connect naturally).\n" +
"- 'issues': each concrete problem, with the moment's number, a kind (" + CRITIC_KINDS.join(", ") + ") and in Arabic what exactly is wrong — quote the words you heard where it helps.\n" +
"- 'overall' from 1 to 10: would this reel get its idea across to people like you. 8 or more only when it truly works.\n" +
"Return ONLY JSON." }] },
              contents: [{ role: "user", parts: [{ file_data: { mime_type: "audio/ogg", file_uri: crUp.file.uri } },
                { text: "Moments start at (seconds): " + crStarts.map(function (t, i) { return (i + 1) + ": " + t.toFixed(1); }).join(", ") }] }],
              generationConfig: { temperature: 0.3, responseMimeType: "application/json", responseSchema: {
                type: "OBJECT", required: ["understood", "scores", "issues", "overall"], propertyOrdering: ["understood", "scores", "issues", "overall"], properties: {
                  understood: { type: "STRING" },
                  scores: { type: "OBJECT", required: ["clarity", "completeness", "context", "opening", "ending", "flow"], properties: {
                    clarity: { type: "INTEGER" }, completeness: { type: "INTEGER" }, context: { type: "INTEGER" }, opening: { type: "INTEGER" }, ending: { type: "INTEGER" }, flow: { type: "INTEGER" } } },
                  issues: { type: "ARRAY", items: { type: "OBJECT", required: ["moment", "kind", "problem"], properties: {
                    moment: { type: "INTEGER" }, kind: { type: "STRING", enum: CRITIC_KINDS }, problem: { type: "STRING" } } } },
                  overall: { type: "INTEGER" } } } }
            }, "critic");
          } finally { geminiDelete(crKey, ctx, crUp.file); }
          if (crC.error) return { error: crC.error };
          await env.DB.prepare("INSERT INTO ai_usage (email, kind, at) VALUES (?1, 'critique', datetime('now'))").bind(crUser.email).run();
          var crSc = crC.data.scores || {}, clamp10 = function (x) { return Math.max(1, Math.min(10, Math.round(Number(x) || 1))); };
          var critique = {
            understood: String(crC.data.understood || "").trim().slice(0, 400),
            scores: { clarity: clamp10(crSc.clarity), completeness: clamp10(crSc.completeness), context: clamp10(crSc.context), opening: clamp10(crSc.opening), ending: clamp10(crSc.ending), flow: clamp10(crSc.flow) },
            issues: (Array.isArray(crC.data.issues) ? crC.data.issues : []).slice(0, 12).map(function (x) {
              return { moment: Math.round(Number(x && x.moment)) || 0, kind: CRITIC_KINDS.indexOf(x && x.kind) >= 0 ? x.kind : "unclear", problem: String(x && x.problem || "").trim().slice(0, 300) };
            }),
            overall: clamp10(crC.data.overall)
          };
          if (critique.overall >= 8 || !crM.revise) return { ok: true, critique: critique, moments: null };

          // the editor revises from the text, with the critique in hand
          var crNow = crRuns.map(function (m, i) {
            return "moment " + (i + 1) + " = segments " + m.from + "-" + m.to + " (" + m.why + "): " + crText.slice(m.from - 1, m.to).filter(Boolean).join(" ");
          }).join("\n");
          var crE = await geminiJSON(crKey, crModels, {
            system_instruction: { parts: [{ text:
"You are the video editor of a short vertical summary reel from a long video about an NGO's education and community projects in Syria. The reel's goal is «" + String(crM.goal || "") + "» (" + (MOMENTS_GOALS[crM.goal] || "a clear structure") + "); the idea it must get across: " + String(crM.topic || "").slice(0, 200) + "\n" +
"A viewer who knew nothing about the video heard your current cut and told you what they understood and what went wrong. Revise the cut so that the idea comes across clearly to such a viewer.\n" +
"Compare what the viewer understood with the idea: whatever did not come across needs a clearer or added moment. Fix every issue: a cut word or sentence means widening the run to the sentence's real start or end; missing context means adding the sentence that introduces it, or dropping the moment; weak or unclear moments are replaced by stronger ones from the transcript; fix the order when the flow breaks. Keep the moments that work.\n" +
"You get the full transcript as numbered segments: number [start-end seconds, length] words.\n" +
"'plan': a few short lines on what you change and why, with segment numbers and seconds; add up the seconds. 'moments': the revised runs, in the order the reel plays them.\n" +
momentsRules(crLo, crRoom) + "Return ONLY JSON." }] },
            contents: [{ role: "user", parts: [{ text: "Transcript:\n" + momentsLines(crSegs, crText).join("\n") + "\n\nCurrent cut:\n" + crNow +
              "\n\nThe viewer understood: " + critique.understood + "\nScores: " + JSON.stringify(critique.scores) + ", overall " + critique.overall + "/10\nIssues:\n" +
              critique.issues.map(function (x) { return "- moment " + x.moment + " [" + x.kind + "]: " + x.problem; }).join("\n") }] }],
            generationConfig: { temperature: 0.2, responseMimeType: "application/json", responseSchema: {
              type: "OBJECT", required: ["plan", "moments"], propertyOrdering: ["plan", "moments"], properties: { plan: { type: "STRING" }, moments: MOMENTS_RUNS_SCHEMA } } }
          }, "revise");
          var crNew = crE.error ? [] : momentsRuns(crE.data.moments, crSegs, crText);
          return { ok: true, critique: critique, moments: crNew.length ? crNew : null, plan: crE.error ? "" : String(crE.data.plan || "").slice(0, 1200) };
        });
      }

      /* ---- 7b7) Text Transcription: نص الصور عبر Gemini ----
         لكل من يملك أداة text-transcription. الجسم: [4 بايت طول JSON][JSON {lang, sizes, mode}][الصور JPEG متتالية].
         تُرفع الصور كما هي إلى Files API، يقرؤها Gemini بطلب واحد ويعيد نص كل صورة، ثم تُحذف.
         mode: text (نص فقط) | doc (كل صورة وثيقة: بطاقة، جواز…) | auto (Gemini يقرّر لكل صورة).
         للوثيقة يعيد خاناتها {label, value} بترتيبها على الوثيقة. لا يُحفظ شيء من المحتوى هنا.
         الرد يتدفّق (slowJSON): {images:[{text, kind, docType, fields}]} أو {error}. */
      if (request.method === "POST" && path === "/transcribe/images") {
        var txUser = await getSessionUser(env, request);
        if (!txUser) return json({ error: "غير مسجّل دخول" }, 401);
        if (!(await hasProjectSlug(env, txUser, "text-transcription"))) return json({ error: "لا صلاحية" }, 403);
        var txKey = transcribeKey(env);
        if (!txKey) return json({ error: "مفتاح Gemini غير مضبوط" }, 500);
        if (Number(request.headers.get("Content-Length") || 0) > TRANSCRIBE_MAX_BYTES) return json({ error: "الصور أكبر من المسموح" }, 413);
        if ((await usedToday(env, txUser.email, "transcribe")) >= TRANSCRIBE_DAILY_MAX) return json({ error: "وصلت للحد اليومي لتفريغ الصور بـ Gemini. جرّب بكرا، أو استعمل «تفريغ على الجهاز»." }, 429);
        var txIn = splitAudioBody(await request.arrayBuffer());
        if (!txIn) return json({ error: "طلب غير صالح" }, 400);
        var txSizes = (Array.isArray(txIn.meta.sizes) ? txIn.meta.sizes : []).map(function (n) { return Math.max(0, Math.floor(Number(n) || 0)); });
        if (!txSizes.length || txSizes.length > TRANSCRIBE_MAX_IMAGES || txSizes.reduce(function (s, n) { return s + n; }, 0) !== txIn.audio.byteLength) return json({ error: "طلب غير صالح" }, 400);
        var txLang = { "ara+eng": "Arabic and English", ara: "Arabic", eng: "English" }[txIn.meta.lang] || "Arabic and English";
        var txMode = ["text", "doc", "auto"].indexOf(txIn.meta.mode) >= 0 ? txIn.meta.mode : "text";
        var txDocRules = txMode === "text" ? "" :
          (txMode === "doc" ? "EVERY image is an identity card or official document (national ID front or back, passport, family booklet, student or work card, certificate, form): its kind is \"document\".\n"
                            : "Decide for each image: an identity card or official document (national ID front or back, passport, family booklet, student or work card, certificate, filled form) is kind \"document\"; anything else is kind \"text\".\n") +
"For a document: 'doc_type' names it in Arabic (like «بطاقة شخصية سورية — الوجه» or «جواز سفر»). 'fields' lists every labelled item on it, in the order it appears: 'label' is the field's name as printed (Arabic when the document has it, e.g. «الاسم», «اسم الأب», «اسم الأم», «تاريخ الولادة», «مكان الولادة», «الرقم الوطني»), or a short Arabic name when the value has no printed label; 'value' is exactly what is written there — names, dates and numbers digit for digit, never reformatted or guessed. Unreadable: […]. Leave out the document's title, emblems and printed headings. 'text' still holds the full transcription.\n" +
"For kind \"text\": 'fields' is [] and 'doc_type' is \"\".\n";
        return slowJSON(async function () {
          var off = 0, parts = txSizes.map(function (n) { var b = txIn.audio.slice(off, off + n); off += n; return b; });
          var ups = await Promise.all(parts.map(function (b, i) { return geminiUpload(txKey, b, "image/jpeg", "text-transcription-" + (i + 1)); }));
          var txR;
          try {
            var bad = ups.filter(function (u) { return u.error; })[0];
            if (bad) return { error: bad.error.replace("الصوت", "الصورة") };
            var txParts = [];
            ups.forEach(function (u, i) { txParts.push({ text: "Image " + (i + 1) + ":" }, { file_data: { mime_type: "image/jpeg", file_uri: u.file.uri } }); });
            txR = await geminiJSON(txKey, ["gemini-flash-latest", "gemini-flash-latest", "gemini-flash-lite-latest", "gemini-flash-lite-latest"], {
              system_instruction: { parts: [{ text:
"You transcribe the text in images. For EACH image, in order, write all the text it contains exactly as written: the same language and spelling, no translation, no correction, no summary, nothing added. The text is mostly in " + txLang + ".\n" +
"Keep the reading order (Arabic right to left, then top to bottom; columns one after another), the line breaks and the paragraphs. Headings and list items go on their own lines. A table is one line per row, its cells separated by ' | '.\n" +
"Keep Arabic letters, diacritics and digits as they appear. Mark a word you cannot read as […]. If an image has no text, its text is \"\".\n" +
txDocRules +
"Return ONLY JSON: one entry per image in 'images', covering all " + parts.length + " images." }] },
              contents: [{ role: "user", parts: txParts }],
              generationConfig: { temperature: 0, maxOutputTokens: 32768, responseMimeType: "application/json", responseSchema: {
                type: "OBJECT", required: ["images"], properties: { images: { type: "ARRAY", items: txMode === "text"
                  ? { type: "OBJECT", required: ["n", "text"], properties: { n: { type: "INTEGER" }, text: { type: "STRING" } } }
                  : { type: "OBJECT", required: ["n", "kind", "doc_type", "fields", "text"], propertyOrdering: ["n", "kind", "doc_type", "fields", "text"], properties: {
                      n: { type: "INTEGER" }, kind: { type: "STRING", enum: ["text", "document"] }, doc_type: { type: "STRING" },
                      fields: { type: "ARRAY", items: { type: "OBJECT", required: ["label", "value"], properties: { label: { type: "STRING" }, value: { type: "STRING" } } } },
                      text: { type: "STRING" } } } } } } }
            }, "transcribe-images-" + txMode);
          } finally { ups.forEach(function (u) { geminiDelete(txKey, ctx, u.file); }); }
          if (txR.error) return { error: txR.error };
          await env.DB.prepare("INSERT INTO ai_usage (email, kind, at) VALUES (?1, 'transcribe', datetime('now'))").bind(txUser.email).run();
          var images = parts.map(function () { return { text: "", kind: "text", docType: "", fields: [] }; });
          ((txR.data && txR.data.images) || []).forEach(function (x) {
            var n = Math.round(Number(x && x.n)); if (!(n >= 1 && n <= images.length)) return;
            var fields = (Array.isArray(x.fields) ? x.fields : []).slice(0, 60).map(function (f) {
              return { label: String(f && f.label || "").trim().slice(0, 80), value: String(f && f.value || "").trim().slice(0, 400) };
            }).filter(function (f) { return f.label || f.value; });
            var doc = txMode !== "text" && x.kind === "document" && fields.length > 0;
            images[n - 1] = { text: String(x.text || "").slice(0, 60000), kind: doc ? "document" : "text", docType: doc ? String(x.doc_type || "").trim().slice(0, 80) : "", fields: doc ? fields : [] };
          });
          return { ok: true, images: images, texts: images.map(function (im) { return im.text; }) };
        });
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
            responseMimeType: "application/json"
          }
        };
        var gr, gd;
        try {
          gr = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-lite-latest:generateContent?key=" + env.GEMINI_API_KEY,
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

      /* ---- 7d) Guidelines Assistant: تدقيق + تصنيف (خادم-لخادم بسرّ مشترك) ----
         تُنادى من api/process.php لأنّ Gemini محظور جغرافيًّا على سيرفر سوريا؛
         الـWorker على شبكة Cloudflare فيتجاوز الحظر. */
      if (request.method === "POST" && (path === "/ga/process" || path === "/ga/vision")) {
        if (!env.GA_SHARED_SECRET || request.headers.get("x-ga-secret") !== env.GA_SHARED_SECRET) {
          return json({ error: "forbidden" }, 403);
        }
        if (!env.GEMINI_API_KEY) return json({ error: "مفتاح المعالجة غير مضبوط" }, 500);
        var gaBody = await request.json();
        var gaPayload;
        if (path === "/ga/process") {
          var gaItems = (Array.isArray(gaBody.items) ? gaBody.items : [])
            .map(function (x) { return { i: x && x.i, text: String(x && x.text != null ? x.text : "") }; })
            .filter(function (x) { return x.text.replace(/\s/g, "") !== ""; });
          if (!gaItems.length) return json({ ok: true, items: [] });
          gaPayload = {
            system_instruction: { parts: [{ text:
"You format Arabic documents into the Hope Center house style.\n" +
"Input: JSON {\"items\":[{\"i\",\"text\"}]}.\n" +
"For EACH item: (1) lightly correct spelling, punctuation, spacing and obvious grammar WITHOUT changing meaning; keep proper nouns, places and organisations unchanged; keep numbers and dates EXACTLY as written — same digits, same order, same separators (do NOT reorder day/month/year) — only converting Indic numerals ٠-٩ to Western 0-9.\n" +
"(2) assign exactly ONE role from this CLOSED set: عنوان_رئيسي = main title; عنوان_فرعي = section heading; نص = body paragraph; تعداد_ناعم = plain list item; تعداد_خشن = emphasized list item.\n" +
"Return ONLY JSON {\"items\":[{\"i\",\"role\",\"text\"}]} with the SAME i values. No commentary." }] },
            contents: [{ role: "user", parts: [{ text: JSON.stringify({ items: gaItems }) }] }],
            generationConfig: { temperature: 0.2, responseMimeType: "application/json" }
          };
        } else {
          var gaMime = String(gaBody.mime || ""), gaData = String(gaBody.data || "");
          if (!gaMime || !gaData) return json({ error: "لا يوجد ملف" }, 400);
          gaPayload = {
            system_instruction: { parts: [{ text:
"You read an Arabic document (image or PDF) and return its CONTENT as structured blocks.\n" +
"Extract the visible text ONLY (ignore logos, page decoration, letterhead headers/footers).\n" +
"Correct obvious spelling/spacing lightly WITHOUT changing meaning; keep proper nouns; keep numbers and dates EXACTLY as written (same order and separators), only converting Indic numerals ٠-٩ to Western 0-9.\n" +
"Return ONLY JSON {\"blocks\":[...]} where each block is either {\"type\":\"para\",\"role\":ROLE,\"text\":\"...\"} with ROLE in {عنوان_رئيسي,عنوان_فرعي,نص,تعداد_ناعم,تعداد_خشن} or {\"type\":\"table\",\"rows\":[[\"cell\",...],...]} (text cells only). Preserve reading order. No commentary." }] },
            contents: [{ role: "user", parts: [ { inline_data: { mime_type: gaMime, data: gaData } }, { text: "Extract the content per the instructions." } ] }],
            generationConfig: { temperature: 0.2, responseMimeType: "application/json" }
          };
        }
        var gaR, gaD;
        try {
          gaR = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-lite-latest:generateContent?key=" + env.GEMINI_API_KEY,
            { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(gaPayload) });
          gaD = await gaR.json();
        } catch (e) { return json({ error: "تعذّر الاتصال بخدمة المعالجة" }, 502); }
        if (!gaR.ok) return json({ error: (gaD && gaD.error && gaD.error.message) || "فشل المعالجة" }, 502);
        var gaTxt = ""; try { gaTxt = gaD.candidates[0].content.parts[0].text || ""; } catch (e) {}
        var gaParsed; try { gaParsed = JSON.parse(gaTxt); } catch (e) { return json({ error: "ردّ غير صالح" }, 502); }
        return json({ ok: true, items: (gaParsed && gaParsed.items) || [], blocks: (gaParsed && gaParsed.blocks) || [] });
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