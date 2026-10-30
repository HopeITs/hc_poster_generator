/* «لوحة التحكم» — for the Owner and the Comms Manager, in the account menu.
   From the presence beats (presence.js → /presence) and the AI log: every
   user with a green dot while online and the tool they are on, today's first
   sign-in, last seen and time on the site; per tool its visits, time and top
   user; who spends the most time; and who uses the AI requests most. The
   period (today, the week, the month) applies to the last three. The page
   refreshes itself every 30 seconds while open. Built like «سجل الصلاحيات»,
   with the archive's page styles (arc-*). */
(function () {
  "use strict";
  var WORKER = "https://studyzone-auth.ct-aleppo3.workers.dev", TOKEN_KEY = "sz_auth_token", ONLINE_S = 150;
  var TOOL = { "home": "صفحة المشاريع", "hope-center": "Hope Center", "study-zone": "Study Zone", "children-university": "Children University",
    "disc": "DISC", "leap": "LEAP", "guideline-assistant": "Guidelines Assistant", "thumbnail-gen": "Thumbnail Gen", "reels-gen": "Reels Gen",
    "text-transcription": "Text Transcription", "meeting-transcription": "Meeting Transcription", "booklet-maker": "Booklet Maker", "flipbook": "Flipbook" };
  var AI = { music: "موسيقى Reels Gen", script: "نص Reels Gen", voice: "صوت Reels Gen", moments: "تلخيص فيديو (Reels Gen)", critique: "مراجعة التلخيص (Reels Gen)",
    meeting: "تفريغ اجتماع", transcribe: "تفريغ نص", magnific: "تحويل لستايل DISC" };
  var RANGE = { day: "اليوم", week: "آخر 7 أيام", month: "آخر 30 يوم" };
  var $ = function (id) { return document.getElementById(id); };
  var range = "day", timer = null;

  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function token() { try { return localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY); } catch (e) { return null; } }
  function global() { var u = window.Auth && Auth.current && Auth.current(); return !!(u && (u.role === "owner" || u.role === "comms")); }
  function when(s) { return new Date(String(s).replace(" ", "T") + "Z"); }
  function hm(s) { var d = when(s); if (isNaN(d)) return ""; return (d.getHours() < 10 ? "0" : "") + d.getHours() + ":" + (d.getMinutes() < 10 ? "0" : "") + d.getMinutes(); }
  /* «قبل 5 د», «اليوم 14:20», «أمس 09:05» or the date. */
  function ago(s, now) {
    var d = when(s), sec = (when(now) - d) / 1000; if (isNaN(d)) return "—";
    if (sec < 90) return "هلق";
    if (sec < 3600) return "قبل " + Math.round(sec / 60) + " د";
    var t = new Date(), y = new Date(t.getFullYear(), t.getMonth(), t.getDate() - 1);
    if (d.toDateString() === t.toDateString()) return "اليوم " + hm(s);
    if (d.toDateString() === y.toDateString()) return "أمس " + hm(s);
    return d.getDate() + "/" + (d.getMonth() + 1) + " " + hm(s);
  }
  function dur(sec) {
    sec = Math.round(sec || 0); if (sec < 60) return sec ? "أقل من دقيقة" : "—";
    var h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
    return h ? h + " س" + (m ? " " + m + " د" : "") : m + " د";
  }
  /* The top user of a tool or a request, with their share beside the name: «hekmat… · 61 طلب». */
  function topOf(u, what) { return '<span class="dash-top">' + who(u) + '<span class="dash-of">' + what + "</span></span>"; }
  function who(u) { return '<span class="dash-who">' + (u && u.photo ? '<img src="' + esc(u.photo) + '" alt="">' : '<i></i>') + '<bdi>' + esc(u ? u.email : "") + '</bdi></span>'; }

  /* ---------- the menu item ---------- */
  function decorate() {
    var on = global();
    [].forEach.call(document.querySelectorAll(".acct-menu"), function (m) {
      var b = m.querySelector(".dash-menu");
      if (!on) { if (b) b.remove(); return; }
      if (b) return;
      b = document.createElement("button"); b.type = "button"; b.className = "dash-menu"; b.textContent = "لوحة التحكم"; b.onclick = open;
      m.insertBefore(b, m.querySelector(".acc-menu") || m.querySelector(".arc-menu") || m.lastElementChild);
    });
  }
  setInterval(decorate, 2000);
  if (document.readyState !== "loading") decorate(); else document.addEventListener("DOMContentLoaded", decorate);

  /* ---------- the page ---------- */
  function open() {
    var pg = $("dashPage");
    if (!pg) {
      var st = document.createElement("style");
      st.textContent =
        "#dashPage{position:fixed;inset:0;z-index:9000;background:#eef1f3;overflow:auto;font-family:'Somar Sans',system-ui,sans-serif;direction:rtl;display:none;}" +
        "#dashPage.on{display:block;} #dashPage .arc-card{margin-bottom:16px;} #dashPage h2{margin:0 0 10px;font-size:15px;font-weight:900;color:#414042;}" +
        "#dashPage h2 small{font-size:12px;font-weight:700;color:#9aa8b2;margin-inline-start:6px;}" +
        ".dash-who{display:inline-flex;align-items:center;gap:8px;} .arc-t .dash-who img,.dash-who i{width:28px;height:28px;border-radius:50%;object-fit:cover;background:#e6e9ec;flex:0 0 auto;display:block;}" +
        ".dash-who bdi{direction:ltr;font-weight:700;word-break:break-all;}" +
        ".dash-st{white-space:nowrap;font-weight:700;font-size:12px;} .dash-st b{display:inline-block;width:9px;height:9px;border-radius:50%;margin-inline-end:6px;background:#c3cad0;vertical-align:0;}" +
        ".dash-st.on{color:#1a8a4a;} .dash-st.on b{background:#22b35e;box-shadow:0 0 0 3px rgba(34,179,94,.18);} .dash-st small{display:block;font-weight:600;color:#6f6e71;margin-top:2px;direction:ltr;text-align:right;}" +
        ".dash-top{display:inline-flex;align-items:center;gap:10px;flex-wrap:wrap;} .dash-of{white-space:nowrap;font-size:12px;font-weight:700;color:#6f6e71;background:#f1f2f3;border-radius:999px;padding:2px 9px;}" +
        ".dash-n{white-space:nowrap;font-weight:700;} .dash-rank{color:#9aa8b2;font-weight:800;width:24px;}" +
        ".dash-sum{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-bottom:16px;} @media(max-width:760px){.dash-sum{grid-template-columns:repeat(2,minmax(0,1fr));}}" +
        ".dash-sum div{background:#fff;border-radius:14px;box-shadow:0 10px 40px rgba(0,0,0,.06);padding:12px 14px;} .dash-sum span{display:block;font-size:12px;font-weight:700;color:#6f6e71;} .dash-sum b{font-size:20px;font-weight:900;color:#414042;}";
      document.head.appendChild(st);
      pg = document.createElement("div"); pg.id = "dashPage";
      pg.innerHTML = '<div class="arc-wrap"><div class="arc-top"><h1>لوحة التحكم</h1><div class="arc-tabs" id="dashTabs">' +
        Object.keys(RANGE).map(function (k) { return '<button type="button" class="arc-tab" data-r="' + k + '">' + RANGE[k] + '</button>'; }).join("") +
        '</div><button type="button" class="arc-btn" id="dashClose">← رجوع</button></div>' +
        '<div class="dash-sum" id="dashSum"></div>' +
        '<div class="arc-card"><h2>المستخدمين</h2><table class="arc-t"><thead><tr><th>المستخدم</th><th>الحالة</th><th>أول دخول اليوم</th><th>آخر ظهور</th><th>الوقت اليوم</th></tr></thead><tbody id="dashUsers"></tbody></table></div>' +
        '<div class="arc-card"><h2>الأدوات <small id="dashR1"></small></h2><table class="arc-t"><thead><tr><th>الأداة</th><th>الزيارات</th><th>الوقت</th><th>أكتر واحد عم يستخدمها</th></tr></thead><tbody id="dashTools"></tbody></table></div>' +
        '<div class="arc-card"><h2>الأكتر وقتاً على الموقع <small id="dashR2"></small></h2><table class="arc-t"><thead><tr><th></th><th>المستخدم</th><th>الوقت</th><th style="width:40%"></th></tr></thead><tbody id="dashTop"></tbody></table></div>' +
        '<div class="arc-card"><h2>طلبات الذكاء الاصطناعي <small id="dashR3"></small></h2><table class="arc-t"><thead><tr><th>الطلب</th><th>العدد الكلي للطلبات</th><th>أكتر واحد</th></tr></thead><tbody id="dashAi"></tbody></table></div>' +
        '<div class="arc-empty" id="dashMsg" hidden></div></div>';
      document.body.appendChild(pg);
      $("dashClose").onclick = close;
      document.addEventListener("keydown", function (e) { if (e.key === "Escape" && pg.classList.contains("on")) close(); });
      $("dashTabs").onclick = function (e) { var b = e.target.closest("[data-r]"); if (b) { range = b.dataset.r; load(); } };
    }
    pg.classList.add("on"); load();
    clearInterval(timer); timer = setInterval(function () { if (!document.hidden) load(); }, 30000);
  }
  function close() { $("dashPage").classList.remove("on"); clearInterval(timer); }

  function load() {
    [].forEach.call(document.querySelectorAll("#dashTabs .arc-tab"), function (b) { b.classList.toggle("on", b.dataset.r === range); });
    fetch(WORKER + "/dashboard?range=" + range, { headers: { "Authorization": "Bearer " + token() } })
      .then(function (r) { return r.json(); })
      .then(function (d) { if (!d || !d.ok) throw new Error(d && d.error || ""); render(d); $("dashMsg").hidden = true; })
      .catch(function (e) { $("dashMsg").hidden = false; $("dashMsg").textContent = "تعذّر تحميل اللوحة" + (e.message ? ": " + e.message : ""); });
  }

  function render(d) {
    var byEmail = {}, now = d.now;
    d.users.forEach(function (u) { byEmail[u.email] = u; });
    var live = {}, today = {};
    d.live.forEach(function (x) { live[x.email] = x; });
    d.today.forEach(function (x) { today[x.email] = x; });
    function online(e) { var x = live[e]; return x && !x.ended && (when(now) - when(x.last_seen)) / 1000 < ONLINE_S; }

    // users: online first, then by last seen
    var users = d.users.slice().sort(function (a, b) {
      var oa = online(a.email) ? 1 : 0, ob = online(b.email) ? 1 : 0; if (oa !== ob) return ob - oa;
      return String((live[b.email] || {}).last_seen || "").localeCompare(String((live[a.email] || {}).last_seen || ""));
    });
    $("dashUsers").innerHTML = users.map(function (u) {
      var x = live[u.email], t = today[u.email], on = online(u.email);
      return "<tr><td>" + who(u) + "</td>" +
        '<td><span class="dash-st' + (on ? " on" : "") + '"><b></b>' + (on ? "أونلاين" : "أوفلاين") + (on && x ? "<small>" + esc(TOOL[x.tool] || x.tool) + "</small>" : "") + "</span></td>" +
        '<td class="dt">' + (t ? hm(t.first_in) : "—") + "</td>" +
        '<td class="dt">' + (on ? "هلق" : x ? ago(x.last_seen, now) : "ما دخل بعد") + "</td>" +
        '<td class="dash-n">' + (t ? dur(t.secs) : "—") + "</td></tr>";
    }).join("");

    // per tool and per user over the period
    var tools = {}, people = {};
    d.use.forEach(function (r) {
      var t = tools[r.tool] || (tools[r.tool] = { visits: 0, secs: 0, by: {} });
      t.visits += r.visits; t.secs += r.secs; t.by[r.email] = (t.by[r.email] || 0) + r.secs;
      people[r.email] = (people[r.email] || 0) + r.secs;
    });
    function top(map) { var best = null; Object.keys(map).forEach(function (k) { if (!best || map[k] > map[best]) best = k; }); return best; }
    var tl = Object.keys(tools).sort(function (a, b) { return tools[b].secs - tools[a].secs; });
    $("dashTools").innerHTML = tl.length ? tl.map(function (k) {
      var t = tools[k], b = top(t.by);
      return '<tr><td class="acc-tool" style="font-weight:800">' + esc(TOOL[k] || k) + '</td><td class="dash-n">' + t.visits + '</td><td class="dash-n">' + dur(t.secs) + "</td><td>" +
        (b ? topOf(byEmail[b] || { email: b }, dur(t.by[b])) : "—") + "</td></tr>";
    }).join("") : '<tr><td colspan="4" class="arc-empty">ما في استخدام بهالفترة</td></tr>';

    var pl = Object.keys(people).sort(function (a, b) { return people[b] - people[a]; }), max = pl.length ? people[pl[0]] : 1;
    $("dashTop").innerHTML = pl.length ? pl.map(function (e, i) {
      return '<tr><td class="dash-rank">' + (i + 1) + "</td><td>" + who(byEmail[e] || { email: e }) + '</td><td class="dash-n">' + dur(people[e]) +
        '</td><td><div class="arc-bar"><i style="width:' + Math.max(3, Math.round(people[e] / max * 100)) + '%"></i></div></td></tr>';
    }).join("") : '<tr><td colspan="4" class="arc-empty">ما في استخدام بهالفترة</td></tr>';

    var ai = {};
    d.ai.forEach(function (r) { var a = ai[r.kind] || (ai[r.kind] = { n: 0, by: {} }); a.n += r.n; a.by[r.email] = (a.by[r.email] || 0) + r.n; });
    var al = Object.keys(ai).sort(function (a, b) { return ai[b].n - ai[a].n; });
    $("dashAi").innerHTML = al.length ? al.map(function (k) {
      var a = ai[k], b = top(a.by);
      return "<tr><td style=\"font-weight:800\">" + esc(AI[k] || k) + '</td><td class="dash-n">' + a.n + "</td><td>" + topOf(byEmail[b] || { email: b }, a.by[b] + (a.by[b] === 1 ? " طلب" : a.by[b] <= 10 ? " طلبات" : " طلب")) + "</td></tr>";
    }).join("") : '<tr><td colspan="3" class="arc-empty">ما في طلبات بهالفترة</td></tr>';

    // the summary on top
    var nOn = d.users.filter(function (u) { return online(u.email); }).length;
    var total = pl.reduce(function (s, e) { return s + people[e]; }, 0);
    $("dashSum").innerHTML = '<div><span>أونلاين هلق</span><b>' + nOn + '</b></div><div><span>دخلو اليوم</span><b>' + d.today.length + "</b></div>" +
      "<div><span>الوقت على الموقع · " + RANGE[range] + "</span><b>" + dur(total) + "</b></div><div><span>أكتر أداة · " + RANGE[range] + "</span><b>" + esc(tl.length ? TOOL[tl[0]] || tl[0] : "—") + "</b></div>";
    ["dashR1", "dashR2", "dashR3"].forEach(function (id) { $(id).textContent = "· " + RANGE[range]; });
  }
})();
