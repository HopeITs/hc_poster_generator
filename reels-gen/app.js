/* Reels Gen (Beta) — vertical reels (1080×1920, 25 fps) from photos and video
   clips, edited and encoded in the browser. Visual language follows the DISC
   reels: raw shots with the logo on top, a few light text cards between them
   (the hook, and each change of idea), soft dissolves, and a navy end card.
   The user's script becomes voiceover lines and card texts (/reels/script,
   Gemini), read by Mazen Lawand (/reels/voice, ElevenLabs); the lines are laid
   over the shots for a one-minute reel (the voice pauses on each text card) and
   the cuts land on the music's beat.
   Media never leaves the device; only text and the music request go to the
   auth Worker. */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };

  var WORKER = "https://studyzone-auth.ct-aleppo3.workers.dev";
  var TOKEN_KEY = "sz_auth_token", SLUG = "reels-gen";
  var W = 1080, H = 1920, FPS = 25, VIDEO_BPS = 14000000;
  var NAVY = "#0a3c55", TINT = "rgba(10,60,85,.45)";
  var CARD_BG = "#ebeaf0", CARD_INK = "#105063", CARD_LEN = 3;   // measured from an approved DISC reel
  var XF = 0.5;   // dissolve length (s), centred on each cut; never changes the reel's length
  var SR = 44100, REEL_LEN = 60;   // every reel is one minute
  var VO_OFFSET = 0.4;             // a voiceover that opens without a card starts this far in
  var VO_GAP = 0.35;               // after a card the voice resumes this long past the cut, once the dissolve is over
  var CARD_MAX = 3.5;   // longest a silent card stays on screen (s)
  var MUSIC_BASE = 0.85, DUCK_VOICE = 0.2, DUCK_SOUND = 0.12, RAMP = 0.3;   // music gain, ducked levels, ramp (s)
  /* Recipes set the defaults for new shots: seconds per shot and the end-card length. */
  var RECIPES = {
    questions: { len: 4, end: 3.5 },
    ad:        { len: 3, end: 3 }
  };
  var MOODS = {
    hopeful: "Uplifting, hopeful modern background music for a vertical social media reel: soft piano, light plucked strings, gentle modern percussion from 6 seconds, warm and inspiring, steady 100 BPM, clear ending.",
    warm:    "Warm, calm acoustic guitar and soft pads, subtle background music under spoken interviews, low energy, no strong drums, sincere and encouraging, 85 BPM, gentle fade at the end.",
    upbeat:  "Upbeat playful modern pop instrumental for a lively social media reel, bright synth plucks, claps and light bass, energetic but friendly, 118 BPM, clear button ending."
  };

  var S = { items: [], recipe: "questions", project: "disc", logo: null, logoNavy: null,
            music: null, musicBlob: null, musicLabel: "", beats: null,
            lines: [], voice: null, endLen: null, regs: [], plan: [],
            t: 0, playing: false, clock: 0, seq: 0, exporting: false };

  function status(t, err) { var e = $("rgStatus"); e.textContent = t || ""; e.className = "status" + (err ? " err" : ""); }
  function fmt(s) { s = Math.max(0, s); var m = Math.floor(s / 60), r = Math.floor(s % 60); return m + ":" + (r < 10 ? "0" : "") + r; }
  function token() { try { return localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY); } catch (e) { return null; } }

  /* ---------- access (same rule as Thumbnail Gen) ---------- */
  function checkAccess() {
    var t = token();
    if (!t) { location.href = "../"; return Promise.reject(new Error("no session")); }
    return fetch(WORKER + "/projects", { headers: { "Authorization": "Bearer " + t } })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (r) {
        if (!r.ok) { location.href = "../"; throw new Error("session"); }
        var me = ((r.d && r.d.projects) || []).filter(function (p) { return p.slug === SLUG; })[0];
        if (!me || me.status !== "ready") { $("rgGateMsg").textContent = "لا تملك صلاحية الوصول إلى هذه الأداة."; throw new Error("denied"); }
      });
  }

  /* ---------- timeline ---------- */
  function recipe() { return RECIPES[S.recipe] || RECIPES.questions; }
  function ready() { return S.items.filter(function (it) { return !it.missing && !it.off && !it.skip; }); }
  /* Everything on the timeline in order: shots, text cards, then the end card. */
  function segs() { var l = ready(); return l.length ? l.concat([{ kind: "end", len: S.endLen || recipe().end }]) : []; }
  function total() { return segs().reduce(function (s, x) { return s + x.len; }, 0); }
  function ease(x) { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); }
  function half(a, b) { return Math.min(XF / 2, a.len / 3, b.len / 3); }   // half a dissolve; short shots get a shorter one
  /* What is on screen at time t: segment a, and during a dissolve also segment
     b drawn over it with b.alpha. Around a cut the outgoing shot runs a little
     past its end and the incoming one starts a little before its in-point, so
     neither freezes while they blend. */
  function locate(t) {
    var list = segs(), acc = 0, i = 0, h;
    while (i < list.length - 1 && t >= acc + list[i].len) { acc += list[i].len; i++; }
    var it = list[i], local = t - acc;
    var loc = { item: it.kind === "end" ? null : it, idx: i, local: local, a: { seg: it, local: local }, b: null };
    if (i > 0 && local < (h = half(list[i - 1], it))) {
      loc.a = { seg: list[i - 1], local: local + list[i - 1].len };
      loc.b = { seg: it, local: local, alpha: ease((local + h) / (2 * h)) };
    } else if (i < list.length - 1 && local > it.len - (h = half(it, list[i + 1]))) {
      loc.b = { seg: list[i + 1], local: local - it.len, alpha: ease((local - it.len + h) / (2 * h)) };
    }
    return loc;
  }

  /* ---------- drawing (shared by preview, thumbnails and export) ---------- */
  function drawMedia(g, w, h, it, p) {
    var el = it.el, sw = it.w, sh = it.h, rot = it.rot % 180 !== 0;
    var rw = rot ? sh : sw, rh = rot ? sw : sh, s = Math.max(w / rw, h / rh) * (1 + 0.06 * p);  // cover + slow push-in
    g.save(); g.translate(w / 2, h / 2); if (it.rot) g.rotate(it.rot * Math.PI / 180);
    g.drawImage(el, -sw * s / 2, -sh * s / 2, sw * s, sh * s); g.restore();
  }
  /* Each project's logo in two colourings — one for footage and the navy end
     card, one for the light text cards — and its accent, which stands in for red
     everywhere on the page. */
  var PROJECTS = {
    sz:   { name: "Study Zone",          accent: "#f99d1c", onDark: "assets/sz-logo.svg",   onLight: "assets/sz-logo-navy.svg" },
    leap: { name: "LEAP",                accent: "#3aa5af", onDark: "assets/leap-logo.svg", onLight: "assets/leap-logo-navy.svg" },
    disc: { name: "DISC",                accent: "#f99d1c", onDark: "assets/disc-logo.svg", onLight: "assets/disc-logo-navy.svg" },
    cu:   { name: "Children University", accent: "#f99d1c", onDark: "assets/cu-logo.svg",   onLight: "assets/cu-logo-navy.svg" }
  };
  function project() { return PROJECTS[S.project] || PROJECTS.disc; }
  /* Scale a logo to fit a box, whatever its shape (wide DISC, tall CU). */
  function fitBox(im, bw, bh) { var s = Math.min(bw / im.naturalWidth, bh / im.naturalHeight); return { w: im.naturalWidth * s, h: im.naturalHeight * s }; }
  /* Logo top-centre: the box is the DISC logo of the approved reels (22.5 % wide,
     top edge at 4.8 %), taller than DISC needs so upright logos get about the
     same area. */
  function logo(g, w, h, onLight) {
    var im = onLight ? S.logoNavy : S.logo;
    if (!im) return;
    var b = fitBox(im, w * 0.225, h * 0.09);
    g.drawImage(im, (w - b.w) / 2, h * 0.048, b.w, b.h);
  }
  /* Split the card text into lines that fit: the user's own line breaks first,
     then words wrapped to the safe width. */
  function wrap(g, text, maxW) {
    var out = [];
    text.trim().split(/\r?\n/).forEach(function (para) {
      var line = "";
      para.trim().split(/\s+/).forEach(function (word) {
        var t = line ? line + " " + word : word;
        if (line && g.measureText(t).width > maxW) { out.push(line); line = word; } else line = t;
      });
      if (line) out.push(line);
    });
    return out.slice(0, 5);
  }
  function textCard(g, w, h, it, local) {
    var k = w / W, a = ease((local - 0.05) / 0.45);   // the text settles in once the card has dissolved in
    g.fillStyle = CARD_BG; g.fillRect(0, 0, w, h);
    logo(g, w, h, true);
    if (!it.text || !it.text.trim()) return;
    g.save(); g.globalAlpha *= a; g.fillStyle = CARD_INK; g.font = "700 " + (77 * k) + "px 'Somar Sans'";
    g.textAlign = "center"; g.direction = "rtl";
    var lines = wrap(g, it.text, w * 0.84), lh = 136 * k, y0 = h * 0.5 - (lines.length - 1) * lh / 2 + 18 * k + (1 - a) * 26 * k;
    lines.forEach(function (l, i) { g.fillText(l, w / 2, y0 + i * lh); });
    g.restore();
  }
  function endCard(g, w, h) {
    var k = w / W;
    g.fillStyle = NAVY; g.fillRect(0, 0, w, h);
    if (S.logo) { var b = fitBox(S.logo, w * 0.42, h * 0.28); g.drawImage(S.logo, (w - b.w) / 2, (h - b.h) / 2, b.w, b.h); }
    else { g.save(); g.fillStyle = "#fff"; g.font = "700 " + (150 * k) + "px 'Somar Sans'"; g.textAlign = "center"; g.direction = "rtl"; g.fillText(project().name, w / 2, h / 2 + 50 * k); g.restore(); }
  }
  function drawSeg(g, w, h, seg, local) {
    if (seg.kind === "end") return endCard(g, w, h);
    if (seg.kind === "card") return textCard(g, w, h, seg, local);
    drawMedia(g, w, h, seg, Math.max(0, Math.min(1, (local + XF / 2) / (seg.len + XF))));
    if (seg.tint) { g.fillStyle = TINT; g.fillRect(0, 0, w, h); }
    logo(g, w, h, false);
  }
  /* One frame. The media elements must already show the right moments. */
  function frame(g, w, h, loc) {
    g.fillStyle = "#000"; g.fillRect(0, 0, w, h);
    drawSeg(g, w, h, loc.a.seg, loc.a.local);
    if (loc.b) { g.save(); g.globalAlpha = loc.b.alpha; drawSeg(g, w, h, loc.b.seg, loc.b.local); g.restore(); }
  }
  function vTime(it, local) { return Math.max(0, Math.min(it.srcDur - 0.04, it.start + local)); }
  function seekEl(it, local) {   // resolves once a video shows start+local (images and cards: at once)
    if (it.kind !== "video") return Promise.resolve();
    var target = vTime(it, local);
    if (Math.abs(it.el.currentTime - target) < 0.001 && it.el.readyState >= 2) return Promise.resolve();
    return new Promise(function (r) { it.el.addEventListener("seeked", r, { once: true }); it.el.currentTime = target; });
  }
  function seekLoc(loc) { return Promise.all([seekEl(loc.a.seg, loc.a.local), loc.b && seekEl(loc.b.seg, loc.b.local)]); }

  /* ---------- media ---------- */
  var nextId = 1;
  function loadMedia(file) {
    var url = URL.createObjectURL(file), isVideo = /^video\//.test(file.type) || /\.(mp4|mov|m4v|webm)$/i.test(file.name);
    if (!isVideo) return new Promise(function (res, rej) {
      var im = new Image(); im.onload = function () { res({ kind: "image", el: im, url: url, file: file, w: im.naturalWidth, h: im.naturalHeight, srcDur: Infinity }); };
      im.onerror = function () { rej(new Error(file.name)); }; im.src = url; });
    return new Promise(function (res, rej) {
      var v = document.createElement("video"); v.muted = true; v.playsInline = true; v.preload = "auto";
      v.onloadeddata = function () { res({ kind: "video", el: v, url: url, file: file, w: v.videoWidth, h: v.videoHeight, srcDur: v.duration }); };
      v.onerror = function () { rej(new Error(file.name)); }; v.src = url; });
  }
  function addFiles(files) {
    var list = [].slice.call(files || []); if (!list.length) return;
    status("…جارٍ تحميل " + list.length + " ملف");
    // Load in parallel, but add in the order the files were picked (big clips
    // finish loading last, which would otherwise shuffle the sequence).
    var jobs = list.map(function (f) { return loadMedia(f).then(function (m) { return { f: f, m: m }; }, function (e) { return { error: e.message }; }); });
    Promise.all(jobs).then(function (res) {
      res.forEach(function (r) {
        if (r.error) return;
        var f = r.f, m = r.m;
        var miss = S.items.filter(function (it) { return it.missing && it.name === f.name; })[0];   // re-link after "فتح مشروع"
        if (miss) { Object.assign(miss, m, { missing: false }); clampItem(miss); return; }
        var it = Object.assign({ id: nextId++, name: f.name, rot: 0, tint: false, sound: false, missing: false }, m);
        it.len = recipe().len;
        it.start = it.kind === "video" ? Math.min(1, Math.max(0, it.srcDur - it.len)) : 0;
        clampItem(it); S.items.push(it);
      });
      var bad = res.filter(function (r) { return r && r.error; });
      status(bad.length ? "تعذّر فتح: " + bad.map(function (b) { return b.error; }).join("، ") : "", !!bad.length);
      relayout();
    });
  }
  function newCard(text) { return { id: nextId++, kind: "card", text: text || "", len: CARD_LEN, missing: false }; }
  function clampItem(it) {
    it.len = Math.max(1, Math.min(15, +it.len || (it.kind === "card" ? CARD_LEN : recipe().len)));
    if (it.kind === "video") { it.len = Math.min(it.len, Math.max(1, Math.floor((it.srcDur - 0.1) * 10) / 10)); it.start = Math.max(0, Math.min(+it.start || 0, it.srcDur - it.len - 0.05)); }
  }

  /* ---------- clip cards ---------- */
  function countText() {
    var cards = S.items.filter(function (it) { return it.kind === "card"; }).length, off = S.items.filter(function (it) { return it.off && !it.skip; }).length, skip = S.items.filter(function (it) { return it.skip; }).length, shots = S.items.length - cards - off - skip;
    return S.items.length ? "· " + shots + " لقطة" + (cards ? " · " + cards + " كرت نص" : "") + (off ? " · " + off + " خارج الريل" : "") + (skip ? " · " + skip + " مستبعدة" : "") + " · " + fmt(total()) : "";
  }
  function renderClips() {
    var box = $("rgClips"); box.innerHTML = "";
    $("rgCount").textContent = countText(); musicNote();
    if (!S.items.length) { box.innerHTML = '<div class="no-clips">لا لقطات بعد — ابدأ بإضافة المواد من اليمين</div>'; }
    S.items.forEach(function (it, i) {
      var c = document.createElement("div"); c.className = "clip" + (it.missing ? " missing" : "") + (it.off || it.skip ? " off" : "") + (it.kind === "card" ? " is-card" : "");
      var lenField = '<div style="flex:1"><label class="l">المدة (ث)</label><input type="number" data-f="len" min="1" max="15" step="0.5" value="' + (+it.len.toFixed(2)) + '"></div>';
      var moveDel = '<button type="button" data-a="del" title="حذف">✕</button>';
      if (it.missing) {
        c.innerHTML = '<div class="thumb" style="display:flex;align-items:center;justify-content:center;color:#aaa;font-size:12px;padding:10px;text-align:center">بانتظار الملف:<br>' + esc(it.name) + '</div>' +
          '<div class="hint">أضف هذا الملف من «المواد» ليُربط تلقائياً</div><div class="tools"><button type="button" data-a="del" title="حذف">✕</button></div>';
      } else if (it.kind === "card") {
        c.innerHTML = '<div class="thumb"><canvas width="180" height="320"></canvas><span class="num">' + (i + 1) + '</span><span class="kind">TEXT</span></div>' +
          '<textarea placeholder="نص الكرت — سؤال جذب أو انتقال لفكرة جديدة">' + esc(it.text) + '</textarea>' +
          '<div class="row">' + lenField + '</div>' +
          '<div class="tools">' + moveDel + '</div>';
        var ta = c.querySelector("textarea");
        ta.addEventListener("input", function () { it.text = ta.value; thumb(it, c); drawAt(S.t); });
      } else {
        c.innerHTML = '<div class="thumb"><canvas width="180" height="320"></canvas><span class="num">' + (i + 1) + '</span><span class="kind">' + (it.kind === "video" ? "VIDEO " + it.srcDur.toFixed(1) + "s" : "PHOTO") + '</span></div>' +
          '<div class="row">' + lenField +
          (it.kind === "video" ? '<div style="flex:1"><label class="l">البداية (ث)</label><input type="number" data-f="start" min="0" step="0.5" value="' + it.start.toFixed(1) + '"></div>' : "") + '</div>' +
          '<div class="row"><label class="chk"><input type="checkbox" data-f="tint"' + (it.tint ? " checked" : "") + '> طبقة كحلية</label>' +
          (it.kind === "video" ? '<label class="chk"><input type="checkbox" data-f="sound"' + (it.sound ? " checked" : "") + '> الصوت الأصلي</label>' : "") + '</div>' +
          (it.skip ? '<div class="hint" style="color:var(--accent)">مستبعدة' + (it.why ? " — " + esc(it.why) : "") + '</div>'
                   : it.off ? '<div class="hint" style="color:var(--accent)">خارج الريل — الوقت ما بيكفي</div>' : "") +
          '<div class="tools"><button type="button" data-a="card" title="كرت نص قبل هذه اللقطة">+ نص</button><button type="button" data-a="rot" title="تدوير 90°">↻</button>' +
          '<button type="button" data-a="skip" title="' + (it.skip ? "إرجاع للريل" : "استبعاد من الريل") + '">' + (it.skip ? "↺" : "⊘") + '</button>' + moveDel + '</div>';
      }
      if (!it.missing) {
        [].forEach.call(c.querySelectorAll("input[data-f]"), function (inp) {
          inp.addEventListener("change", function () {
            if (inp.dataset.f === "tint") it.tint = inp.checked; else if (inp.dataset.f !== "sound") it[inp.dataset.f] = +inp.value;
            if (inp.dataset.f === "sound") { setSound(it, inp); return; }
            clampItem(it); if (inp.dataset.f !== "tint") inp.value = inp.dataset.f === "start" ? it.start.toFixed(1) : +it.len.toFixed(2);
            thumb(it, c); $("rgCount").textContent = countText(); drawAt(S.t);
          });
        });
        thumb(it, c);
      }
      c.querySelector(".tools").addEventListener("click", function (e) {
        var a = e.target.dataset && e.target.dataset.a; if (!a) return;
        var j = S.items.indexOf(it);
        if (a === "rot") { it.rot = (it.rot + 90) % 360; thumb(it, c); drawAt(S.t); return; }
        if (a === "skip") { it.skip = !it.skip; it.why = ""; relayout(); return; }
        if (a === "card") { S.items.splice(j, 0, newCard()); if (!voiceReady()) relayout(); else { stop(); renderClips(); } var ta2 = box.children[j] && box.children[j].querySelector("textarea"); if (ta2) ta2.focus(); return; }
        if (a === "del") {
          if (it.kind === "card" && it.line != null && S.lines[it.line]) { S.lines[it.line].card = ""; renderLines(); }   // otherwise the next layout would bring it back
          S.items.splice(j, 1); relayout(); return;
        }
      });
      dragCard(c, it);
      box.appendChild(c);
    });
    $("rgExport").disabled = !ready().length || S.items.some(function (x) { return x.missing; });
    $("rgCover").disabled = !ready().length;
    $("rgEmpty").hidden = !!ready().length;
  }
  /* Reorder by dragging a card onto another: it lands before or after that
     card depending on which half the pointer is over (the grid runs right to
     left). Dragging never starts from a field or button, so text can still be
     selected and edited. */
  var dragged = null;
  function dragCard(c, it) {
    c.draggable = true;
    c.addEventListener("mousedown", function (e) { c.draggable = !e.target.closest("textarea, input, button, select, label"); });
    c.addEventListener("dragstart", function (e) {
      dragged = it; c.classList.add("dragging"); stop();
      e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", "");
    });
    c.addEventListener("dragend", function () { dragged = null; c.classList.remove("dragging"); clearDrop(); });
    c.addEventListener("dragover", function (e) {
      if (!dragged || dragged === it) return;
      e.preventDefault(); e.dataTransfer.dropEffect = "move";
      var after = afterHalf(c, e); clearDrop(); c.classList.add(after ? "drop-after" : "drop-before");
    });
    c.addEventListener("dragleave", function (e) { if (!c.contains(e.relatedTarget)) c.classList.remove("drop-before", "drop-after"); });
    c.addEventListener("drop", function (e) {
      e.preventDefault(); if (!dragged || dragged === it) return;
      var after = afterHalf(c, e), from = S.items.indexOf(dragged);
      S.items.splice(from, 1);
      S.items.splice(S.items.indexOf(it) + (after ? 1 : 0), 0, dragged);
      dragged = null; renderClips(); S.t = Math.min(S.t, total()); drawAt(S.t);
    });
  }
  function afterHalf(c, e) { var r = c.getBoundingClientRect(), mid = r.left + r.width / 2; return getComputedStyle(c).direction === "rtl" ? e.clientX < mid : e.clientX > mid; }
  function clearDrop() { [].forEach.call(document.querySelectorAll(".clip.drop-before, .clip.drop-after"), function (x) { x.classList.remove("drop-before", "drop-after"); }); }
  var thumbQueue = Promise.resolve();
  function thumb(it, card) {   // serialised: one video element must not seek for two jobs at once
    thumbQueue = thumbQueue.then(function () {
      return seekEl(it, 0).then(function () { var cv = card.querySelector("canvas"); if (!cv) return; var g = cv.getContext("2d"); g.fillStyle = "#000"; g.fillRect(0, 0, 180, 320); drawSeg(g, 180, 320, it, it.kind === "card" ? it.len : 0); });
    });
  }
  function esc(s) { return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }

  /* ---------- preview ---------- */
  var cv = null, g = null;
  function drawAt(t) {
    if (!ready().length) { g.fillStyle = "#111"; g.fillRect(0, 0, cv.width, cv.height); updateTime(); return; }
    var loc = locate(t), seq = ++S.seq;
    seekLoc(loc).then(function () { if (seq === S.seq || S.playing) { frame(g, cv.width, cv.height, loc); gridGuide(g, cv.width, cv.height); } });
    updateTime();
  }
  function updateTime() {
    var T = total(), sk = $("rgSeek"); $("rgTime").textContent = fmt(S.t) + " / " + fmt(T);
    sk.value = T ? Math.round(S.t / T * 1000) : 0; sk.style.setProperty("--p", sk.value / 10 + "%");
  }
  /* Real-time playback: videos play natively, the canvas copies their frames;
     the music player is ducked under the voiceover and under shots that keep
     their own sound, as in the export. */
  function play() {
    if (!ready().length) return;
    if (S.t >= total() - 0.05) S.t = 0;
    S.playing = true; $("rgPlay").textContent = "❚❚"; $("rgPlay").classList.add("playing"); S.clock = performance.now() - S.t * 1000; S.regs = duckRegions(); S.plan = voicePlan();
    ready().forEach(function (it) { if (it.kind === "video") it.el.muted = !it.sound; });
    var mp = $("rgMusicPlayer"); if (S.musicBlob) { mp.currentTime = S.t; mp.volume = musicGain(S.t, S.regs); mp.play().catch(function () {}); }
    requestAnimationFrame(tick);
  }
  function tick(now) {
    if (!S.playing) return;
    S.t = (now - S.clock) / 1000;
    if (S.t >= total()) { stop(); S.t = total(); drawAt(S.t); return; }
    var loc = locate(S.t), on = [loc.a, loc.b].filter(function (x) { return x && x.seg.kind === "video"; });
    ready().forEach(function (it) {   // during a dissolve both videos play; every other one is paused
      if (it.kind !== "video") return;
      var o = on.filter(function (x) { return x.seg === it; })[0];
      if (o && it.el.paused) { it.el.currentTime = vTime(it, o.local); it.el.play().catch(function () {}); }
      else if (!o && !it.el.paused) it.el.pause();
    });
    if (S.musicBlob) $("rgMusicPlayer").volume = Math.min(1, musicGain(S.t, S.regs));
    if (S.plan.length) {   // the voice plays block by block and stays silent over the cards
      var vp = $("rgVoicePlayer"), blk = S.plan.filter(function (b) { return S.t >= b.at && S.t < b.at + b.dur; })[0];
      if (blk) {
        var want = blk.src0 + S.t - blk.at;
        if (vp.paused || Math.abs(vp.currentTime - want) > 0.25) { vp.currentTime = want; if (vp.paused) vp.play().catch(function () {}); }
      } else if (!vp.paused) vp.pause();
    }
    frame(g, cv.width, cv.height, loc); gridGuide(g, cv.width, cv.height); updateTime();
    requestAnimationFrame(tick);
  }
  function stop() {
    S.playing = false; $("rgPlay").textContent = "▶"; $("rgPlay").classList.remove("playing");
    ready().forEach(function (it) { if (it.kind === "video") it.el.pause(); });
    $("rgMusicPlayer").pause(); $("rgVoicePlayer").pause();
  }

  /* ---------- audio: decoding, ducking, mixing ---------- */
  function decode(blob) { return blob.arrayBuffer().then(function (ab) { return new OfflineAudioContext(2, 1, SR).decodeAudioData(ab); }); }
  function b64Blob(b64, type) { var s = atob(b64), a = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) a[i] = s.charCodeAt(i); return new Blob([a], { type: type }); }
  /* Where each segment sits on the timeline, with the half-dissolves on either side. */
  function positions() {
    var list = segs(), acc = 0;
    return list.map(function (s, i) {
      var p = { seg: s, t0: acc, h0: i ? half(list[i - 1], s) : 0, h1: i < list.length - 1 ? half(s, list[i + 1]) : 0 };
      acc += s.len; return p;
    });
  }
  /* Stretches where the music steps back: under each voiceover line, and under
     shots that keep their original sound. */
  function duckRegions() {
    var r = [];
    voicePlan().forEach(function (b) {
      for (var i = b.a; i <= b.z; i++) { var tm = S.voice.times[i]; r.push({ a: b.at + tm.start - b.src0 - 0.1, b: b.at + tm.end - b.src0 + 0.2, l: DUCK_VOICE }); }
    });
    positions().forEach(function (p) { if (p.seg.sound) r.push({ a: p.t0, b: p.t0 + p.seg.len, l: DUCK_SOUND }); });
    return r;
  }
  function musicGain(t, regs) {
    var gn = MUSIC_BASE;
    regs.forEach(function (x) {
      var f = t < x.a ? 1 - (x.a - t) / RAMP : t > x.b ? 1 - (t - x.b) / RAMP : 1;
      if (f > 0) gn = Math.min(gn, MUSIC_BASE + (x.l - MUSIC_BASE) * f);
    });
    return gn;
  }
  function ensureAudio(it) {
    if (it.audio) return Promise.resolve(it.audio);
    if (!it.file) return Promise.reject(new Error("no file"));
    return decode(it.file).then(function (b) { it.audio = b; return b; });
  }
  function setSound(it, inp) {
    it.sound = inp.checked; it.el.muted = !it.sound;
    if (!it.sound) return;
    status("…جارٍ قراءة صوت المقطع");
    ensureAudio(it).then(function () { status(""); }, function () {
      it.sound = false; inp.checked = false; it.el.muted = true;
      status("تعذّر قراءة صوت هذا المقطع — صيغة الصوت غير مدعومة بالمتصفح", true);
    });
  }
  /* The whole soundtrack as one stereo buffer: ducked music, the voiceover, and
     the original sound of the shots that keep it (faded across their dissolves). */
  function mixAudio(T) {
    var len = Math.round(T * SR), L = new Float32Array(len), R = new Float32Array(len), any = false, i, k;
    var regs = duckRegions();
    if (S.music) {
      any = true;
      var m = S.music, mL = m.getChannelData(0), mR = m.numberOfChannels > 1 ? m.getChannelData(1) : mL, n = Math.min(m.length, len), fo = 1.5 * SR, fi = 0.3 * SR;
      for (var o = 0; o < n; o += 256) {
        var gn = musicGain((o + 128) / SR, regs);
        for (i = o; i < Math.min(o + 256, n); i++) { var f = Math.min(1, (n - i) / fo, i / fi) * gn; L[i] += mL[i] * f; R[i] += mR[i] * f; }
      }
    }
    voicePlan().forEach(function (b) {   // each block of the reading at its place, with 10 ms edges so the cuts don't click
      any = true;
      var v = S.voice.buf, vL = v.getChannelData(0), vR = v.numberOfChannels > 1 ? v.getChannelData(1) : vL;
      var s0 = Math.round(b.src0 * SR), n = Math.round(b.dur * SR), d0 = Math.round(b.at * SR), fe = 0.01 * SR;
      for (i = 0; i < n && d0 + i < len && s0 + i < v.length; i++) {
        if (d0 + i < 0) continue;
        var fv = Math.min(1, i / fe, (n - i) / fe); L[d0 + i] += vL[s0 + i] * fv; R[d0 + i] += vR[s0 + i] * fv;
      }
    });
    positions().forEach(function (p) {
      var it = p.seg; if (!it.sound || !it.audio) return;
      any = true;
      var a = it.audio, aL = a.getChannelData(0), aR = a.numberOfChannels > 1 ? a.getChannelData(1) : aL;
      var s0 = Math.max(0, Math.round((p.t0 - p.h0) * SR)), s1 = Math.min(len, Math.round((p.t0 + it.len + p.h1) * SR));
      var f0 = Math.max(1, 2 * p.h0 * SR), f1 = Math.max(1, 2 * p.h1 * SR);
      for (k = s0; k < s1; k++) {
        var src = Math.round((it.start + k / SR - p.t0) * SR); if (src < 0 || src >= a.length) continue;
        var fd = Math.min(1, (k - s0) / f0, (s1 - k) / f1); L[k] += aL[src] * fd; R[k] += aR[src] * fd;
      }
    });
    if (!any) return null;
    var peak = 0; for (i = 0; i < len; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
    if (peak > 0.98) { var sc = 0.98 / peak; for (i = 0; i < len; i++) { L[i] *= sc; R[i] *= sc; } }
    return { L: L, R: R, len: len };
  }

  /* ---------- music ---------- */
  function setMusic(blob, label) {
    S.musicBlob = blob; S.music = null; S.musicLabel = label; S.beats = null;
    var mp = $("rgMusicPlayer");
    if (!blob) { mp.hidden = true; mp.removeAttribute("src"); $("rgMusicSt").textContent = "بدون موسيقى"; return Promise.resolve(); }
    mp.src = URL.createObjectURL(blob); mp.hidden = false;
    return decode(blob)
      .then(function (buf) {
        S.music = buf; var bt = detectBeats(buf); S.beats = bt.beats; S.bpm = bt.bpm;
        if ($("rgBeatSync").checked && snapToBeats()) drawAt(S.t);
        renderClips();
      })
      .catch(function () { $("rgMusicSt").textContent = "تعذّرت قراءة ملف الموسيقى"; S.musicBlob = null; });
  }
  /* Re-read on every timeline change, so "too short" never outlives the edit that fixed it. */
  function musicNote() {
    if (!S.music) return;
    var short = S.music.duration + 0.3 < total();
    $("rgMusicSt").textContent = "✓ " + S.musicLabel + " · " + S.music.duration.toFixed(1) + " ث · " + Math.round(S.bpm) + " BPM" +
      (short ? " — أقصر من الريل (" + total().toFixed(1) + " ث)، أعد التوليد" : $("rgBeatSync").checked ? " · القطع على الإيقاع" : "");
    $("rgMusicSt").style.color = short ? "var(--accent)" : "";
  }
  function genMusic() {
    var secs = REEL_LEN + 1, btn = $("rgGenMusic");   // the reel is always REEL_LEN; +1 s so the music never runs out early
    btn.disabled = true; $("rgMusicSt").textContent = "…جارٍ توليد موسيقى " + secs + " ثانية";
    fetch(WORKER + "/reels/music", { method: "POST", headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token() },
      body: JSON.stringify({ prompt: MOODS[$("rgMood").value], seconds: secs }) })
      .then(function (r) {
        if (r.ok) return r.blob().then(function (b) { return setMusic(b, "موسيقى مولّدة"); });
        return r.json().catch(function () { return {}; }).then(function (e) {
          $("rgMusicSt").textContent = r.status === 403 ? "توليد الموسيقى متاح حالياً لـ Owner وComms فقط — يمكنك رفع ملف موسيقى" : (e.error || "تعذّر توليد الموسيقى");
        });
      })
      .catch(function () { $("rgMusicSt").textContent = "تعذّر الاتصال بخدمة الموسيقى"; })
      .then(function () { btn.disabled = false; });
  }

  /* ---------- beats ----------
     Generated music never keeps exactly the BPM it was asked for, so the beat
     grid is measured: an onset curve (rises in overall and low-band energy),
     the tempo from its autocorrelation (biased toward ~110 BPM to avoid
     half/double tempo), the phase that lands most beats on onsets, and each
     beat nudged to the strongest onset within ±35 ms. */
  function detectBeats(buf) {
    var x = buf.getChannelData(0), x2 = buf.numberOfChannels > 1 ? buf.getChannelData(1) : x, hop = 512, n = Math.floor(x.length / hop), fps = SR / hop;
    var en = new Float32Array(n), lo = new Float32Array(n), o = new Float32Array(n), lp = 0, i, k;
    for (i = 0; i < n; i++) {
      var e = 0, el = 0;
      for (k = i * hop; k < (i + 1) * hop; k++) { var s = (x[k] + x2[k]) * 0.5; lp += 0.028 * (s - lp); e += s * s; el += lp * lp; }   // one-pole low-pass ≈ 200 Hz
      en[i] = Math.log(1 + 1000 * e / hop); lo[i] = Math.log(1 + 1000 * el / hop);
    }
    for (i = 1; i < n; i++) o[i] = Math.max(0, en[i] - en[i - 1]) + Math.max(0, lo[i] - lo[i - 1]);
    var ac = [], best = -1, lag0 = Math.round(fps * 60 / 180), lag1 = Math.round(fps * 60 / 60), bestLag = lag0;
    for (var lag = lag0 - 1; lag <= lag1 + 1; lag++) {
      var sum = 0; for (i = lag; i < n; i++) sum += o[i] * o[i - lag]; ac[lag] = sum / (n - lag);
      if (lag < lag0 || lag > lag1) continue;
      var wgt = Math.exp(-0.5 * Math.pow(Math.log2(60 * fps / lag / 110) / 0.9, 2));
      if (ac[lag] * wgt > best) { best = ac[lag] * wgt; bestLag = lag; }
    }
    var p = bestLag, den = ac[p - 1] - 2 * ac[p] + ac[p + 1];
    if (den) { var d = (ac[p - 1] - ac[p + 1]) / (2 * den); if (Math.abs(d) < 1) p += d; }   // sub-frame period
    var ph = 0, bestS = -1, t;
    for (var q = 0; q < p; q += 0.5) { var sc = 0; for (t = q; t < n; t += p) sc += o[Math.round(t)] || 0; if (sc > bestS) { bestS = sc; ph = q; } }
    var beats = [];
    for (t = ph; t < n; t += p) { var c = Math.round(t), mx = c; for (k = -3; k <= 3; k++) if ((o[c + k] || 0) > (o[mx] || 0)) mx = c + k; beats.push(mx / fps); }
    return { bpm: 60 * fps / p, beats: beats };
  }
  function nearestBeat(t, tol) {
    var b = null; (S.beats || []).forEach(function (x) { if (Math.abs(x - t) <= tol && (b === null || Math.abs(x - t) < Math.abs(b - t))) b = x; });
    return b;
  }
  /* Move every cut to the nearest beat (the dissolve is centred on the cut, so
     its middle lands on the beat). Cards stay within 0.3 s of their voiceover
     line; a cut stays where it is if moving it would make a segment shorter
     than 1 s or ask a clip for more footage than it has. With a voiceover the
     end card takes up the difference so the reel stays REEL_LEN long. */
  function snapToBeats() {
    var list = ready(); if (!S.beats || !S.beats.length || list.length < 2) return false;
    var lens = list.map(function (it) { return it.len; }), endLen = S.endLen;
    snapCuts(list, 0.3);
    if (voiceReady() && !voiceFits()) {   // a card moved onto the voice: put it back and snap only the shot-to-shot cuts
      list.forEach(function (it, i) { it.len = lens[i]; }); S.endLen = endLen;
      snapCuts(list, 0);
    }
    return true;
  }
  function snapCuts(list, cardTol) {
    var period = (S.beats[S.beats.length - 1] - S.beats[0]) / Math.max(1, S.beats.length - 1);
    var acc = 0, prev = 0, cuts = [];
    list.forEach(function (it, i) {
      acc += it.len;
      var nextIt = list[i + 1], card = it.kind === "card" || (nextIt && nextIt.kind === "card");
      var nb = card ? (cardTol ? nearestBeat(acc, cardTol) : null) : nearestBeat(acc, Math.min(0.6, period * 0.55));
      if (nb === null || nb - prev < 1) nb = acc;
      if (it.kind === "video" && nb - prev > it.srcDur - 0.15) nb = acc;
      cuts.push(nb); prev = nb;
    });
    prev = 0;
    list.forEach(function (it, i) { it.len = cuts[i] - prev; prev = cuts[i]; if (it.kind === "video") clampItem(it); });
    if (S.endLen) S.endLen = Math.max(2, REEL_LEN - cuts[cuts.length - 1]);
  }

  /* ---------- script → voiceover lines and cards ---------- */
  function voiceBudget() { return REEL_LEN - recipe().end - 3 * (2.8 + VO_GAP) - 1.5; }   // room left for speech beside ~3 silent cards
  function voiceSt(t, err) { var e = $("rgVoiceSt"); e.textContent = t || ""; e.style.color = err ? "var(--accent)" : ""; }
  function lineStat() {
    var words = S.lines.reduce(function (s, l) { return s + (l.voice.trim() ? l.voice.trim().split(/\s+/).length : 0); }, 0);
    var est = words / 2.1, el = $("rgLineStat");
    el.textContent = words + " كلمة · ≈ " + Math.round(est) + " ث من " + Math.round(voiceBudget());
    el.style.color = est > voiceBudget() ? "var(--accent)" : "";
  }
  function renderLines() {
    var box = $("rgLines"); box.innerHTML = "";
    var has = S.lines.length > 0; box.hidden = !has; $("rgLineTools").hidden = !has; $("rgVoiceGen").hidden = !has;
    S.lines.forEach(function (l, i) {
      var row = document.createElement("div"); row.className = "line";
      row.innerHTML = '<span class="n">' + (i + 1) + '</span><div class="f"><textarea data-k="voice" rows="2" placeholder="جملة التعليق">' + esc(l.voice) + '</textarea>' +
        '<textarea data-k="card" rows="1" class="card-in" placeholder="نص كرت (اختياري)">' + esc(l.card) + '</textarea></div><button type="button" title="حذف الجملة">✕</button>';
      var tv = row.querySelector('[data-k="voice"]'), tc = row.querySelector('[data-k="card"]');
      tv.addEventListener("input", function () { l.voice = tv.value; lineStat(); if (S.voice) { S.voice.stale = true; voiceSt("تغيّر نص التعليق — أعد توليد الصوت ليتطابق", true); } });
      tc.addEventListener("input", function () {   // live text on the matching card; adding/removing a card re-arranges on blur
        l.card = tc.value;
        S.items.forEach(function (it) { if (it.kind === "card" && it.line === i) it.text = l.card; });
        drawAt(S.t);
      });
      tc.addEventListener("change", function () {
        var had = S.items.some(function (it) { return it.kind === "card" && it.line === i; });
        if (S.voice && !S.voice.stale && had !== !!l.card.trim()) arrange(); else renderClips();
      });
      row.querySelector("button").onclick = function () {
        S.lines.splice(i, 1); renderLines(); lineStat();
        if (S.voice) { S.voice.stale = true; voiceSt("تغيّرت الجمل — أعد توليد الصوت ليتطابق", true); }
      };
      box.appendChild(row);
    });
    if (has) lineStat();
  }
  function draft() {
    var txt = $("rgScript").value.trim(), btn = $("rgDraft");
    if (!txt) { voiceSt("اكتب السكريبت أولاً", true); return; }
    btn.disabled = true; voiceSt("…جارٍ صياغة النص");
    fetch(WORKER + "/reels/script", { method: "POST", headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token() },
      body: JSON.stringify({ script: txt, seconds: Math.round(voiceBudget()) }) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (r) {
        if (!r.ok) { voiceSt(r.d.error || "تعذّرت الصياغة", true); return; }
        S.lines = r.d.lines.map(function (l) { return { voice: l.voice, card: l.card || "" }; });
        renderLines(); voiceSt("راجع الجمل ونصوص الكروت وعدّلها، ثم ولّد التعليق الصوتي");
      })
      .catch(function () { voiceSt("تعذّر الاتصال بخدمة الصياغة", true); })
      .then(function () { btn.disabled = false; });
  }
  function setVoice(data, times, dur) {
    var blob = b64Blob(data, "audio/mpeg");
    return decode(blob).then(function (buf) {
      S.voice = { data: data, blob: blob, buf: buf, times: times, dur: dur || buf.duration, stale: false };
      var vp = $("rgVoicePlayer"); vp.src = URL.createObjectURL(blob); vp.hidden = false; $("rgArrange").hidden = false;
    });
  }
  function genVoice() {
    var lines = S.lines.map(function (l) { return l.voice.trim(); }).filter(Boolean), btn = $("rgVoiceGen");
    if (!lines.length) return;
    if (lines.length !== S.lines.length) { voiceSt("في جملة فاضية — اكتبها أو احذفها", true); return; }
    btn.disabled = true; voiceSt("…جارٍ توليد التعليق الصوتي بصوت مازن لاوند");
    fetch(WORKER + "/reels/voice", { method: "POST", headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token() },
      body: JSON.stringify({ lines: lines }) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (r) {
        if (!r.ok) { voiceSt(r.d.error || "تعذّر توليد التعليق", true); return; }
        return setVoice(r.d.audio, r.d.lines, r.d.duration).then(function () {
          voiceSt("✓ تعليق صوتي · " + S.voice.dur.toFixed(1) + " ث"); arrange();
        });
      })
      .catch(function () { voiceSt("تعذّر الاتصال بخدمة التعليق الصوتي", true); })
      .then(function () { btn.disabled = false; });
  }

  /* ---------- arrange: lay the voiceover over the shots ----------
     Cards are read in silence: the reel shows a card alone (music up), then
     the voice picks up after it and never says the card's words. So the
     continuous reading is cut into blocks — one from the first line, and one
     from every line that has a card — and each block plays right after its
     card. The minute is shared: cards, the blocks, and any time left over
     spread evenly after each block, so shots linger before the next card. */
  function cardLen(text) { var w = text.trim().split(/s+/).length; return Math.max(2.2, Math.min(CARD_MAX, 1.4 + 0.3 * w)); }
  function voiceBlocks() {
    var T = S.voice.times, out = [];
    S.lines.forEach(function (l, i) { if (i === 0 || l.card.trim()) out.push({ a: i, z: i, card: l.card.trim() }); else out[out.length - 1].z = i; });
    out.forEach(function (b) { b.src0 = Math.max(0, T[b.a].start - 0.06); b.src1 = Math.min(S.voice.buf.duration, T[b.z].end + 0.15); b.dur = b.src1 - b.src0; });
    return out;
  }
  /* Where each block plays, read off the timeline as it is now (after beat
     snapping or a manual edit): just after its card, else VO_OFFSET in. */
  function voicePlan() {
    if (!voiceReady()) return [];
    var pos = positions(), blocks = voiceBlocks(), prevEnd = 0;
    blocks.forEach(function (b) {
      var p = b.card ? pos.filter(function (x) { return x.seg.kind === "card" && x.seg.line === b.a; })[0] : null;
      b.at = p ? p.t0 + p.seg.len + VO_GAP : b.a === 0 ? VO_OFFSET : prevEnd + 0.3;
      prevEnd = b.at + b.dur;
    });
    return blocks;
  }
  /* Every block ends before the next card starts, and the last before the end card. */
  function voiceFits() {
    var plan = voicePlan(), pos = positions();
    return plan.every(function (b, k) {
      var nx = plan[k + 1], limit;
      if (nx && nx.card) { var p = pos.filter(function (x) { return x.seg.kind === "card" && x.seg.line === nx.a; })[0]; limit = p ? p.t0 : Infinity; }
      else if (!nx) { var endP = pos[pos.length - 1]; limit = endP ? endP.t0 : Infinity; }
      else limit = Infinity;
      return b.at + b.dur <= limit + 0.02;
    });
  }
  function arrange() {
    if (!S.voice) return;
    if (S.items.some(function (it) { return it.missing; })) { voiceSt("أضف الملفات الناقصة أولاً", true); return; }
    if (S.voice.times.length !== S.lines.length) { voiceSt("عدد الجمل تغيّر — أعد توليد الصوت أولاً", true); return; }
    var shots = S.items.filter(function (it) { return it.kind !== "card" && !it.skip; }), skipped = S.items.filter(function (it) { return it.skip; });
    var C = REEL_LEN - recipe().end, blocks = voiceBlocks(), wins = [], gaps = [], t = 0;
    function lead(b) { return b.card ? VO_GAP : b.a === 0 ? VO_OFFSET : 0.3; }
    var need = blocks.reduce(function (s, b) { return s + (b.card ? cardLen(b.card) : 0) + lead(b) + b.dur; }, 0), slack = C - need;
    if (slack < 0) { voiceSt("التعليق مع الكروت " + need.toFixed(1) + " ث — أطول من الريل بـ " + (-slack).toFixed(1) + " ث. اختصر الجمل أو الكروت وأعد توليد الصوت.", true); return; }
    blocks.forEach(function (b) {
      if (b.card) { var cl = cardLen(b.card); wins.push({ s: t, e: t + cl, text: b.card, line: b.a }); t += cl; }
      var e = t + lead(b) + b.dur + slack / blocks.length; gaps.push({ s: t, e: e }); t = e;
    });
    gaps[gaps.length - 1].e = C;
    if (!shots.length) { voiceSt("✓ التعليق جاهز — أضف اللقطات ثم اضغط «توزيع على اللقطات»"); return; }
    if (shots.length < gaps.length) { voiceSt("الريل بحاجة " + gaps.length + " لقطات على الأقل (عندك " + shots.length + ")", true); return; }
    var G = gaps.reduce(function (s, x) { return s + x.e - x.s; }, 0);
    var use = shots.slice(0, Math.max(gaps.length, Math.min(shots.length, Math.floor(G / 1.5))));
    var counts = gaps.map(function () { return 1; });
    for (var k = gaps.length; k < use.length; k++) {
      var j = 0; gaps.forEach(function (x, gi) { if ((x.e - x.s) / counts[gi] > (gaps[j].e - gaps[j].s) / counts[j]) j = gi; });
      counts[j]++;
    }
    var pieces = [], si = 0, short = 0, pool = shots.slice(use.length);
    gaps.forEach(function (x, gi) {
      var mine = use.slice(si, si + counts[gi]); si += counts[gi];
      var sh = fill(x.e - x.s, mine);
      while (sh > 0.05 && pool.length) { mine.push(pool.shift()); sh = fill(x.e - x.s, mine); }   // clips ran short: bring in an unused shot
      short += sh;
      pieces.push({ s: x.s, items: mine });
    });
    use = [].concat.apply([], pieces.map(function (p) { return p.items; }));
    wins.forEach(function (w) { var c = newCard(w.text); c.len = w.e - w.s; c.line = w.line; pieces.push({ s: w.s, items: [c] }); });
    pieces.sort(function (a, b) { return a.s - b.s; });
    var off = pool;
    off.forEach(function (it) { it.off = true; }); use.forEach(function (it) { it.off = false; });
    S.items = [].concat.apply([], pieces.map(function (p) { return p.items; })).concat(off, skipped);
    S.endLen = REEL_LEN - S.items.filter(function (it) { return !it.off; }).reduce(function (s, it) { return s + it.len; }, 0);
    var synced = $("rgBeatSync").checked && snapToBeats();
    stop(); S.t = 0; renderClips(); drawAt(0);
    voiceSt("✓ تم توزيع " + S.lines.length + " جمل على " + use.length + " لقطة و" + wins.length + " كروت" + (synced ? " · القطع على الإيقاع" : "") +
      (off.length ? " · " + off.length + " لقطات خارج الريل (الوقت ما بيكفي)" : "") + (short > 0.05 ? " · المقاطع أقصر من المطلوب بـ " + short.toFixed(1) + " ث" : ""), off.length > 0 || short > 0.05);
  }
  /* Share len among the shots of one stretch: equal parts, except clips too
     short for their part, which take all they have and pass on the rest.
     Returns the time no shot could cover. */
  function fill(len, shots) {
    var free = shots.slice(), rest = len;
    function cap(it) { return it.kind === "video" ? Math.max(1, it.srcDur - 0.15) : Infinity; }
    while (free.length) {
      var share = rest / free.length, capped = free.filter(function (it) { return cap(it) < share; });
      if (!capped.length) { free.forEach(function (it) { it.len = share; clampItem(it); }); return 0; }
      capped.forEach(function (it) { it.len = cap(it); clampItem(it); rest -= it.len; });
      free = free.filter(function (it) { return capped.indexOf(it) < 0; });
    }
    return Math.max(0, rest);
  }

  /* Without a voiceover the reel is still REEL_LEN long: text cards keep their
     length and the shots share the rest in their order (at least 1.5 s each;
     shots that do not fit wait at the end, marked "خارج الريل"). */
  function fitReel() {
    var shots = S.items.filter(function (it) { return !it.missing && !it.skip && it.kind !== "card"; });
    var cards = S.items.filter(function (it) { return !it.missing && it.kind === "card"; });
    var skipped = S.items.filter(function (it) { return it.skip; });
    if (!shots.length) { S.endLen = null; return 0; }
    var room = Math.max(1.5, REEL_LEN - recipe().end - cards.reduce(function (s, c) { return s + c.len; }, 0));
    var n = Math.max(1, Math.min(shots.length, Math.floor(room / 1.5))), use = shots.slice(0, n), pool = shots.slice(n);
    var sh = fill(room, use);
    while (sh > 0.05 && pool.length) { use.push(pool.shift()); sh = fill(room, use); }
    use.forEach(function (it) { it.off = false; }); pool.forEach(function (it) { it.off = true; });
    S.items = S.items.filter(function (it) { return !it.off && !it.skip; }).concat(pool, skipped);
    S.endLen = REEL_LEN - ready().reduce(function (s, it) { return s + it.len; }, 0);
    return sh;
  }
  function voiceReady() { return !!(S.voice && !S.voice.stale && S.voice.times.length === S.lines.length); }
  /* Re-lay the whole reel after shots or cards come and go: over the
     voiceover when there is one, otherwise evenly; then onto the beat. */
  function relayout() {
    if (voiceReady()) { arrange(); return; }
    fitReel();
    if ($("rgBeatSync").checked) snapToBeats();
    stop(); renderClips(); S.t = Math.min(S.t, total()); drawAt(S.t);
  }

  /* ---------- shot picker ----------
     Looks at every shot on the device (nothing is uploaded): sharpness (the
     variance of the Laplacian on a small grey copy — shaky or out-of-focus
     footage scores low), exposure, and a 64-bit difference hash to spot
     look-alikes. It keeps the best of each look-alike group, sets aside
     blurred and badly lit shots, and keeps as many of the strongest as fit the
     minute at ~2.4 s each, in the user's order. Set-aside shots stay in the
     list and come back with ↺. */
  var PICK_W = 192, PICK_SHOT = 2.4;
  function seekTo(el, t) {
    return new Promise(function (r) {
      if (Math.abs(el.currentTime - t) < 0.001 && el.readyState >= 2) { r(); return; }
      el.addEventListener("seeked", r, { once: true }); el.currentTime = t;
    });
  }
  function measure(el, sw, sh) {
    var w = PICK_W, h = Math.max(8, Math.round(PICK_W * sh / sw)), i;
    var x = new OffscreenCanvas(w, h).getContext("2d", { willReadFrequently: true });
    x.drawImage(el, 0, 0, w, h);
    var d = x.getImageData(0, 0, w, h).data, gy = new Float32Array(w * h), sum = 0;
    for (i = 0; i < w * h; i++) { gy[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]; sum += gy[i]; }
    var n = 0, m = 0, m2 = 0;
    for (var y = 1; y < h - 1; y++) for (var c = 1; c < w - 1; c++) {
      var k = y * w + c, lap = 4 * gy[k] - gy[k - 1] - gy[k + 1] - gy[k - w] - gy[k + w];
      n++; m += lap; m2 += lap * lap;
    }
    var hx = new OffscreenCanvas(9, 8).getContext("2d", { willReadFrequently: true });
    hx.drawImage(el, 0, 0, 9, 8);
    var hd = hx.getImageData(0, 0, 9, 8).data, bits = [];
    for (var r = 0; r < 8; r++) for (var q = 0; q < 8; q++) { var a = (r * 9 + q) * 4, b = a + 4; bits.push(hd[a] + hd[a + 1] + hd[a + 2] > hd[b] + hd[b + 1] + hd[b + 2] ? 1 : 0); }
    return { sharp: n ? m2 / n - (m / n) * (m / n) : 0, bright: sum / (w * h), hash: bits };
  }
  /* A clip is judged by its sharpest of three moments (one soft frame should
     not sink a good clip); its look-alike hash comes from the middle one. */
  function analyse(it) {
    if (it.kind !== "video") return Promise.resolve(measure(it.el, it.w, it.h));
    var res = [];
    return [0.2, 0.5, 0.8].reduce(function (p, f) {
      return p.then(function () { return seekTo(it.el, Math.min(it.srcDur - 0.05, it.srcDur * f)); })
              .then(function () { res.push(measure(it.el, it.w, it.h)); });
    }, Promise.resolve()).then(function () {
      var best = res.slice().sort(function (a, b) { return b.sharp - a.sharp; })[0];
      return { sharp: best.sharp, bright: best.bright, hash: res[1].hash };
    });
  }
  function hamming(a, b) { var d = 0; for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) d++; return d; }
  function pickShots() {
    var shots = S.items.filter(function (it) { return !it.missing && it.kind !== "card"; }), btn = $("rgPick"), done = 0;
    if (shots.length < 2) { status("أضف لقطات أولاً", true); return; }
    stop(); btn.disabled = true;
    thumbQueue = thumbQueue.catch(function () {}).then(function () {   // shares the queue with thumbnails: one seek per video at a time
      return shots.reduce(function (p, it) {
        return p.then(function () { return analyse(it); }).then(function (q) { it.q = q; status("…جارٍ فحص اللقطات " + (++done) + " / " + shots.length); });
      }, Promise.resolve());
    });
    thumbQueue.then(function () { decide(shots); }, function () { status("تعذّر فحص اللقطات", true); })
      .then(function () { btn.disabled = false; });
  }
  function decide(shots) {
    var sharp = shots.map(function (it) { return it.q.sharp; }).sort(function (a, b) { return a - b; }), med = sharp[Math.floor(sharp.length / 2)] || 1;
    shots.forEach(function (it) {
      var q = it.q; it.why = "";
      q.score = Math.min(2, q.sharp / med) - (q.bright < 40 || q.bright > 220 ? 0.6 : 0);
      if (q.bright < 40) it.why = "معتمة";   // before sharpness: a dark frame also has little detail
      else if (q.bright > 220) it.why = "فاتحة كتير";
      else if (q.sharp < 0.35 * med) it.why = "ضبابية أو مهزوزة";
    });
    var groups = [];
    shots.forEach(function (it) {
      var gr = groups.filter(function (x) { return hamming(x[0].q.hash, it.q.hash) <= 10; })[0];
      if (gr) gr.push(it); else groups.push([it]);
    });
    groups.forEach(function (gr) {
      gr.slice().sort(function (a, b) { return b.q.score - a.q.score; }).slice(1).forEach(function (it) { if (!it.why) it.why = "بتشبه لقطة أوضح منها"; });
    });
    var cardTime = voiceReady() ? voiceBlocks().reduce(function (s, b) { return s + (b.card ? cardLen(b.card) : 0); }, 0)
                                : S.items.filter(function (it) { return it.kind === "card"; }).reduce(function (s, c) { return s + c.len; }, 0);
    var N = Math.max(1, Math.round((REEL_LEN - recipe().end - cardTime) / PICK_SHOT));
    var good = shots.filter(function (it) { return !it.why; }).sort(function (a, b) { return b.q.score - a.q.score; });
    good.slice(N).forEach(function (it) { it.why = "أضعف من غيرها"; });
    shots.forEach(function (it) { it.skip = !!it.why; });
    relayout();
    var count = function (w) { return shots.filter(function (it) { return it.why === w; }).length; };
    var kept = shots.length - shots.filter(function (it) { return it.skip; }).length;
    var parts = [["ضبابية", count("ضبابية أو مهزوزة")], ["متشابهة", count("بتشبه لقطة أوضح منها")], ["إضاءة", count("معتمة") + count("فاتحة كتير")], ["أضعف", count("أضعف من غيرها")]]
      .filter(function (p) { return p[1]; }).map(function (p) { return p[1] + " " + p[0]; });
    status("✓ اخترت " + kept + " من " + shots.length + " لقطة" + (parts.length ? " · استبعدت: " + parts.join("، ") : "") + " — ↺ بيرجّع أي لقطة");
  }

  /* ---------- cover ----------
     A clean picture for the reel's cover: the shot under the playhead at full
     size, with no logo and no text (Instagram puts its own title on it). On a
     text card or the end card it takes the next shot, else the one before; in
     a dissolve, whichever shot shows more. The optional guide darkens what
     Instagram's 3:4 profile grid crops off. */
  function gridGuide(g, w, h) {
    if (!$("rgGrid").checked) return;
    var band = (h - w * 4 / 3) / 2;
    g.save(); g.fillStyle = "rgba(0,0,0,.55)"; g.fillRect(0, 0, w, band); g.fillRect(0, h - band, w, band);
    g.strokeStyle = "rgba(255,255,255,.85)"; g.setLineDash([6, 5]); g.lineWidth = 1.5;
    g.strokeRect(0.75, band, w - 1.5, h - 2 * band); g.restore();
  }
  function coverShot() {
    var loc = locate(S.t), x = loc.b && loc.b.alpha > 0.5 ? loc.b : loc.a;
    if (x.seg.kind === "image" || x.seg.kind === "video") return { it: x.seg, local: x.local };
    var list = ready(), i = list.indexOf(x.seg); if (i < 0) i = list.length;
    var shots = list.filter(function (it) { return it.kind !== "card"; });
    var it = list.slice(i + 1).filter(function (it) { return it.kind !== "card"; })[0] || shots[shots.length - 1];
    return it ? { it: it, local: 0 } : null;
  }
  function exportCover() {
    var c = coverShot();
    if (!c) { status("ما في لقطة للغلاف — أضف صورة أو مقطع", true); return; }
    stop(); var oc = new OffscreenCanvas(W, H), og = oc.getContext("2d"), it = c.it;
    seekEl(it, c.local).then(function () {
      og.fillStyle = "#000"; og.fillRect(0, 0, W, H);
      drawMedia(og, W, H, it, Math.max(0, Math.min(1, (c.local + XF / 2) / (it.len + XF))));
      if (it.tint) { og.fillStyle = TINT; og.fillRect(0, 0, W, H); }
      return oc.convertToBlob({ type: "image/jpeg", quality: 0.92 });
    }).then(function (blob) {
      var a = document.createElement("a");
      a.download = fileName().replace(/^Reel_/, "Cover_").replace(/\.mp4$/, ".jpg"); a.href = URL.createObjectURL(blob); a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 10000);
      status("✓ تم حفظ صورة الغلاف من اللقطة " + (S.items.indexOf(it) + 1) + " — بدون شعار ولا نص");
      drawAt(S.t);
    }).catch(function (e) { status("تعذّر حفظ الغلاف: " + (e && e.message || e), true); });
  }

  /* ---------- export ---------- */
  function exportMp4() {
    if (typeof VideoEncoder === "undefined" || typeof Mp4Muxer === "undefined") { status("المتصفح لا يدعم التصدير. استخدم Chrome أو Edge.", true); return; }
    var T = total();
    if (S.lines.length && !voiceReady() &&
        !confirm(S.voice ? "نص التعليق تغيّر بعد توليد الصوت، فالصوت والكروت ما بيطابقوا النص. تصدير على كل حال؟"
                         : "التعليق الصوتي لسا ما تولّد، فالريل رح يطلع بلا صوت مازن وبلا كروت السكريبت. تصدير على كل حال؟")) return;
    if (Math.abs(T - REEL_LEN) > 0.1 && confirm("طول الريل " + T.toFixed(1) + " ث مش " + REEL_LEN + ". ضبطه على " + REEL_LEN + " ث قبل التصدير؟")) relayout();
    stop(); status("…تحضير الصوت");
    Promise.all(ready().filter(function (it) { return it.sound; }).map(ensureAudio))
      .then(runExport, function () { status("تعذّر قراءة الصوت الأصلي لأحد المقاطع — ألغِ «الصوت الأصلي» له", true); });
  }
  function runExport() {
    S.exporting = true;
    var btn = $("rgExport"), bar = $("rgBar"), fill = $("rgBarFill"), T = total(), frames = Math.round(T * FPS), list = ready();
    btn.disabled = true; bar.hidden = false; fill.style.width = "0"; status("…جارٍ التصدير");
    var mix = mixAudio(frames / FPS), hasAudio = !!mix, t0 = performance.now();
    var muxer = new Mp4Muxer.Muxer({ target: new Mp4Muxer.ArrayBufferTarget(), fastStart: "in-memory",
      video: { codec: "avc", width: W, height: H, frameRate: FPS },
      audio: hasAudio ? { codec: "aac", numberOfChannels: 2, sampleRate: 44100 } : undefined });
    var venc = new VideoEncoder({ output: function (c, m) { muxer.addVideoChunk(c, m); }, error: function (e) { fail(e); } });
    venc.configure({ codec: "avc1.640028", width: W, height: H, bitrate: VIDEO_BPS, framerate: FPS });
    var oc = new OffscreenCanvas(W, H), og = oc.getContext("2d"), f = 0;
    function fail(e) { S.exporting = false; btn.disabled = false; bar.hidden = true; status("خطأ بالتصدير: " + (e && e.message || e), true); }
    function step() {
      if (f >= frames) return finish();
      var t = f / FPS, loc = locate(t);
      return seekLoc(loc).then(function () {
        frame(og, W, H, loc);
        var vf = new VideoFrame(oc, { timestamp: Math.round(f * 1e6 / FPS), duration: Math.round(1e6 / FPS) });
        venc.encode(vf, { keyFrame: f % (FPS * 2) === 0 }); vf.close(); f++;
        if (f % 10 === 0) { fill.style.width = Math.round(f / frames * 92) + "%"; status("…جارٍ التصدير " + Math.round(f / frames * 100) + "%"); }
        return (venc.encodeQueueSize > 8 || f % 10 === 0) ? yieldTask().then(step) : step();
      });
    }
    function finish() {
      return venc.flush().then(function () {
        if (!hasAudio) return;
        var aenc = new AudioEncoder({ output: function (c, m) { muxer.addAudioChunk(c, m); }, error: function (e) { fail(e); } });
        aenc.configure({ codec: "mp4a.40.2", sampleRate: 44100, numberOfChannels: 2, bitrate: 160000 });
        var len = mix.len, L = mix.L, R = mix.R;
        for (var off = 0; off < len; off += 1024) {
          var n = Math.min(1024, len - off), buf = new Float32Array(n * 2);
          buf.set(L.subarray(off, off + n), 0); buf.set(R.subarray(off, off + n), n);
          var ad = new AudioData({ format: "f32-planar", sampleRate: 44100, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round(off / 44100 * 1e6), data: buf });
          aenc.encode(ad); ad.close();
        }
        return aenc.flush();
      }).then(function () {
        muxer.finalize();
        var blob = new Blob([muxer.target.buffer], { type: "video/mp4" }), a = document.createElement("a");
        a.download = fileName(); a.href = URL.createObjectURL(blob); a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 10000);
        var secs = (performance.now() - t0) / 1000;
        fill.style.width = "100%"; S.exporting = false; btn.disabled = false;
        status("✓ تم التصدير خلال " + Math.round(secs) + " ث · " + (blob.size / 1048576).toFixed(1) + " MB");
        setTimeout(function () { bar.hidden = true; }, 1500); drawAt(S.t);
      });
    }
    Promise.resolve().then(step).catch(fail);
  }
  /* Let the page breathe between frames. A message channel, not setTimeout:
     browsers throttle timers to ~1/s in a background tab, which would stall an
     export the user switched away from. */
  var yq = [], ych = new MessageChannel();
  ych.port1.onmessage = function () { var r = yq.shift(); if (r) r(); };
  function yieldTask() { return new Promise(function (r) { yq.push(r); ych.port2.postMessage(0); }); }
  function fileName() {
    var first = (ready().filter(function (it) { return it.kind === "card" && it.text.trim(); })[0] || {}).text || "";
    var title = (project().name + " " + first.replace(/\s+/g, " ")).trim().replace(/[\\/:*?"<>|؟?]/g, "").slice(0, 60);
    var d = new Date(), p = function (n) { return (n < 10 ? "0" : "") + n; };
    return "Reel_" + title + "_" + p(d.getMonth() + 1) + p(d.getDate()) + d.getFullYear() + ".mp4";
  }

  /* ---------- device speed test (5 s synthetic reel) ---------- */
  function bench() {
    if (typeof VideoEncoder === "undefined") { status("المتصفح لا يدعم التصدير. استخدم Chrome أو Edge.", true); return; }
    status("…جارٍ اختبار السرعة");
    var enc = new VideoEncoder({ output: function () {}, error: function () {} }), oc = new OffscreenCanvas(W, H), og = oc.getContext("2d"), n = FPS * 5, t0 = performance.now(), f = 0;
    enc.configure({ codec: "avc1.640028", width: W, height: H, bitrate: VIDEO_BPS, framerate: FPS });
    (function loop() {
      for (var i = 0; i < 5 && f < n; i++, f++) {
        var grd = og.createLinearGradient(0, 0, W, H); grd.addColorStop(0, NAVY); grd.addColorStop(1, "hsl(" + (f * 3) + ",60%,50%)");
        og.fillStyle = grd; og.fillRect(0, 0, W, H); og.save(); og.globalAlpha = 0.6; textCard(og, W, H, { text: "اختبار السرعة" }, f / FPS); og.restore();
        var vf = new VideoFrame(oc, { timestamp: f * 40000 }); enc.encode(vf); vf.close();
      }
      if (f < n) { setTimeout(loop, 0); return; }
      enc.flush().then(function () { var x = 5 / ((performance.now() - t0) / 1000); status("سرعة جهازك: " + x.toFixed(1) + "× الوقت الحقيقي — ريل دقيقة بحدود " + Math.max(1, Math.round(60 / x)) + " ث (للصور؛ الفيديو أبطأ)"); });
    })();
  }

  /* ---------- projects (settings only; media is re-linked by file name) ---------- */
  function saveProject() {
    var d = { app: "reels-gen", v: 3, recipe: S.recipe, project: S.project,
              beatSync: $("rgBeatSync").checked, endLen: S.endLen, script: $("rgScript").value, lines: S.lines,
              voice: S.voice ? { data: S.voice.data, times: S.voice.times, dur: S.voice.dur } : null,   // the paid-for voiceover travels with the project
              items: S.items.map(function (it) {
                return it.kind === "card" ? { kind: "card", text: it.text, len: it.len, line: it.line }
                                          : { name: it.name, kind: it.kind, start: it.start, len: it.len, rot: it.rot, tint: it.tint, sound: !!it.sound, off: !!it.off, skip: !!it.skip, why: it.why || "" };
              }) };
    var a = document.createElement("a"); a.download = "Reel_project_" + project().name + ".json";
    a.href = URL.createObjectURL(new Blob([JSON.stringify(d)], { type: "application/json" })); a.click();
    status("✓ تم حفظ المشروع (الإعدادات والنصوص — الملفات تُضاف من جهازك عند الفتح)");
  }
  function openProject(d) {
    if (!d || d.app !== "reels-gen" || !Array.isArray(d.items)) { status("الملف ليس مشروع Reels Gen", true); return; }
    stop(); S.recipe = RECIPES[d.recipe] ? d.recipe : "questions"; $("rgRecipe").value = S.recipe;
    setProject(PROJECTS[d.project] ? d.project : "disc");   // projects saved before the picker were DISC reels
    S.items = [];
    d.items.forEach(function (x) {
      if (x.kind === "card") { var c = newCard(String(x.text || "")); c.len = +x.len || CARD_LEN; if (x.line != null) c.line = +x.line; S.items.push(c); return; }
      if (d.v === 1 && x.text && String(x.text).trim()) S.items.push(newCard(String(x.text)));   // v1 captions sat on the shot; they become a card before it
      S.items.push({ id: nextId++, name: String(x.name || ""), kind: x.kind, start: +x.start || 0, len: +x.len || recipe().len, rot: +x.rot || 0, tint: !!x.tint, sound: !!x.sound, off: !!x.off, skip: !!x.skip, why: String(x.why || ""), missing: true });
    });
    $("rgBeatSync").checked = d.beatSync !== false; S.endLen = +d.endLen || null;
    $("rgScript").value = d.script || ""; S.lines = Array.isArray(d.lines) ? d.lines.map(function (l) { return { voice: String(l.voice || ""), card: String(l.card || "") }; }) : [];
    renderLines(); S.voice = null; $("rgVoicePlayer").hidden = true; $("rgArrange").hidden = true; voiceSt("");
    if (d.voice && d.voice.data) setVoice(d.voice.data, d.voice.times || [], d.voice.dur).then(function () { voiceSt("✓ تعليق صوتي · " + S.voice.dur.toFixed(1) + " ث"); }, function () { voiceSt("تعذّرت قراءة التعليق المحفوظ", true); });
    S.t = 0; renderClips(); drawAt(0);
    status("✓ تم فتح المشروع — أضف الملفات (" + S.items.length + ") من «المواد» وستُربط بأسمائها");
  }

  /* Load both logos of the chosen project; a late load from an earlier pick is dropped. */
  function setProject(key) {
    S.project = key; $("rgProject").value = key; S.logo = null; S.logoNavy = null;
    var p = project();
    document.documentElement.style.setProperty("--accent", p.accent);
    [["logo", p.onDark], ["logoNavy", p.onLight]].forEach(function (x) {
      var im = new Image();
      im.onload = function () { if (S.project !== key) return; S[x[0]] = im; if (cv) { renderClips(); drawAt(S.t); } };
      im.src = x[1];
    });
  }

  /* ---------- wiring ---------- */
  function wire() {
    cv = $("rgCanvas"); g = cv.getContext("2d");
    $("rgFiles").addEventListener("change", function (e) { addFiles(e.target.files); e.target.value = ""; });
    var drop = $("rgDrop");
    ["dragenter", "dragover"].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add("over"); }); });
    ["dragleave", "drop"].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove("over"); }); });
    drop.addEventListener("drop", function (e) { addFiles(e.dataTransfer.files); });
    $("rgRecipe").addEventListener("change", function () {
      S.recipe = this.value; S.endLen = null; var r = recipe();   // re-apply the recipe's shot length (text cards keep theirs)
      S.items.forEach(function (it) { if (it.kind !== "card") { it.len = r.len; clampItem(it); } });
      relayout();
    });
    $("rgDraft").onclick = draft;
    $("rgVoiceGen").onclick = genVoice;
    $("rgArrange").onclick = arrange;
    $("rgAddLine").onclick = function () { S.lines.push({ voice: "", card: "" }); renderLines(); var t = $("rgLines").querySelectorAll('[data-k="voice"]'); t[t.length - 1].focus(); if (S.voice) S.voice.stale = true; };
    $("rgBeatSync").addEventListener("change", function () {
      if (this.checked) { if (snapToBeats()) { renderClips(); drawAt(S.t); } }
      else if (S.voice && !S.voice.stale) arrange();   // back to the unsnapped layout
    });
    $("rgAddCard").onclick = function () {
      S.items.push(newCard()); if (!voiceReady()) relayout(); else { stop(); renderClips(); }
      var tas = $("rgClips").querySelectorAll("textarea"); if (tas.length) tas[tas.length - 1].focus();
    };
    $("rgPlay").onclick =function () { if (S.playing) { stop(); drawAt(S.t); } else play(); };
    $("rgSeek").addEventListener("input", function () { stop(); S.t = this.value / 1000 * total(); drawAt(S.t); });
    $("rgGenMusic").onclick = genMusic;
    $("rgMusicFile").addEventListener("change", function (e) { var f = e.target.files[0]; if (f) setMusic(f, f.name); e.target.value = ""; });
    $("rgNoMusic").onclick = function () { setMusic(null); };
    $("rgProject").addEventListener("change", function () { setProject(this.value); });
    $("rgExport").onclick = exportMp4;
    $("rgCover").onclick = exportCover;
    $("rgGrid").addEventListener("change", function () { drawAt(S.t); });
    $("rgPick").onclick = pickShots;
    $("rgBench").onclick = bench;
    $("rgSave").onclick = saveProject;
    $("rgOpen").addEventListener("change", function (e) {
      var f = e.target.files[0]; if (!f) return; var r = new FileReader();
      r.onload = function () { try { openProject(JSON.parse(r.result)); } catch (err) { status("ملف غير صالح", true); } };
      r.readAsText(f); e.target.value = "";
    });
    window.addEventListener("beforeunload", function (e) { if (S.exporting) { e.preventDefault(); e.returnValue = ""; } });
    setProject($("rgProject").value);
    renderClips(); drawAt(0);
  }

  checkAccess().then(function () {
    $("rgGate").hidden = true; $("rgApp").hidden = false;
    return document.fonts.load("700 92px 'Somar Sans'");
  }).then(wire).catch(function (e) {
    if (["no session", "session", "denied"].indexOf(e.message) < 0) $("rgGateMsg").textContent = "تعذّر تحميل الأداة: " + e.message;
  });
})();
