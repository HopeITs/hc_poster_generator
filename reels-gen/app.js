/* Reels Gen (Beta) — vertical reels (1080×1920, 25 fps) from photos and video
   clips, edited and encoded in the browser. Visual language follows the DISC
   reels: hook questions over the raw shots, then captions on a navy tint, a
   logo on screen, and a navy end card. Media never leaves the device; only the
   music request goes to the auth Worker (/reels/music, ElevenLabs). */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };

  var WORKER = "https://studyzone-auth.ct-aleppo3.workers.dev";
  var TOKEN_KEY = "sz_auth_token", SLUG = "reels-gen";
  var W = 1080, H = 1920, FPS = 25, VIDEO_BPS = 14000000;
  var NAVY = "#0a3c55", TINT = "rgba(10,60,85,.45)";
  /* Recipes set the defaults for new shots: seconds per shot, how many opening
     "hook" shots stay untinted, and the end-card length. */
  var RECIPES = {
    questions: { len: 4, hook: 3, end: 3.5 },
    ad:        { len: 3, hook: 0, end: 3 }
  };
  var MOODS = {
    hopeful: "Uplifting, hopeful modern background music for a vertical social media reel: soft piano, light plucked strings, gentle modern percussion from 6 seconds, warm and inspiring, steady 100 BPM, clear ending.",
    warm:    "Warm, calm acoustic guitar and soft pads, subtle background music under spoken interviews, low energy, no strong drums, sincere and encouraging, 85 BPM, gentle fade at the end.",
    upbeat:  "Upbeat playful modern pop instrumental for a lively social media reel, bright synth plucks, claps and light bass, energetic but friendly, 118 BPM, clear button ending."
  };

  var S = { items: [], recipe: "questions", logo: null, logoData: null,
            music: null, musicBlob: null, musicLabel: "",
            t: 0, playing: false, clock: 0, cur: -1, seq: 0, exporting: false };

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
  function ready() { return S.items.filter(function (it) { return !it.missing; }); }
  function total() { return ready().reduce(function (s, it) { return s + it.len; }, 0) + (ready().length ? recipe().end : 0); }
  /* Which shot (or the end card) is on screen at time t, and how far into it. */
  function locate(t) {
    var list = ready(), acc = 0;
    for (var i = 0; i < list.length; i++) { if (t < acc + list[i].len) return { item: list[i], idx: i, local: t - acc }; acc += list[i].len; }
    return { item: null, idx: list.length, local: t - acc };
  }

  /* ---------- drawing (shared by preview, thumbnails and export) ---------- */
  function drawMedia(g, w, h, it, p) {
    var el = it.el, sw = it.w, sh = it.h, rot = it.rot % 180 !== 0;
    var rw = rot ? sh : sw, rh = rot ? sw : sh, s = Math.max(w / rw, h / rh) * (1 + 0.06 * p);  // cover + slow push-in
    g.save(); g.translate(w / 2, h / 2); if (it.rot) g.rotate(it.rot * Math.PI / 180);
    g.drawImage(el, -sw * s / 2, -sh * s / 2, sw * s, sh * s); g.restore();
  }
  function caption(g, w, h, text, local, tint) {
    if (!text || !text.trim()) return;
    var k = w / W, a = Math.min(1, local / 0.48), lines = text.split(/\r?\n/).slice(0, 3), lh = 112 * k;
    if (!tint) {   // soft dark band so white text reads over bright, untinted shots
      var grd = g.createLinearGradient(0, h * 0.32, 0, h * 0.68);
      grd.addColorStop(0, "rgba(0,0,0,0)"); grd.addColorStop(0.5, "rgba(0,0,0,.42)"); grd.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = grd; g.fillRect(0, h * 0.32, w, h * 0.36);
    }
    g.save(); g.globalAlpha = a; g.fillStyle = "#fff"; g.font = "700 " + (92 * k) + "px 'Somar Sans'";
    g.textAlign = "center"; g.direction = "rtl"; g.shadowColor = "rgba(0,0,0,.5)"; g.shadowBlur = 28 * k;
    var y0 = h * 0.5 - (lines.length - 1) * lh / 2 + (1 - a) * 30 * k;
    lines.forEach(function (l, i) { g.fillText(l, w / 2, y0 + i * lh); });
    g.restore();
  }
  function watermark(g, w, h) {
    if (!S.logo || !$("rgWatermark").checked) return;
    var lw = w * 0.15, lh = lw * S.logo.naturalHeight / S.logo.naturalWidth;
    g.save(); g.globalAlpha = 0.92; g.drawImage(S.logo, (w - lw) / 2, h * 0.9 - lh / 2, lw, lh); g.restore();
  }
  function endCard(g, w, h, local) {
    var k = w / W, a = Math.min(1, local / 0.4);
    g.fillStyle = NAVY; g.fillRect(0, 0, w, h); g.save(); g.globalAlpha = a;
    if (S.logo) { var lw = w * 0.42, lh = lw * S.logo.naturalHeight / S.logo.naturalWidth; g.drawImage(S.logo, (w - lw) / 2, (h - lh) / 2, lw, lh); }
    else { g.fillStyle = "#fff"; g.font = "700 " + (150 * k) + "px 'Somar Sans'"; g.textAlign = "center"; g.direction = "rtl"; g.fillText($("rgEndText").value || "", w / 2, h / 2 + 50 * k); }
    g.restore();
  }
  /* One frame. The media element must already show the right moment. */
  function frame(g, w, h, loc) {
    g.fillStyle = "#000"; g.fillRect(0, 0, w, h);
    if (!loc.item) { endCard(g, w, h, loc.local); return; }
    var it = loc.item;
    drawMedia(g, w, h, it, Math.min(1, loc.local / it.len));
    if (it.tint) { g.fillStyle = TINT; g.fillRect(0, 0, w, h); }
    caption(g, w, h, it.text, loc.local, it.tint);
    watermark(g, w, h);
  }
  function seekEl(it, local) {   // resolves once a video shows start+local (images: at once)
    if (it.kind !== "video") return Promise.resolve();
    var target = Math.min(it.srcDur - 0.04, it.start + local);
    if (Math.abs(it.el.currentTime - target) < 0.001 && it.el.readyState >= 2) return Promise.resolve();
    return new Promise(function (r) { it.el.addEventListener("seeked", r, { once: true }); it.el.currentTime = target; });
  }

  /* ---------- media ---------- */
  var nextId = 1;
  function loadMedia(file) {
    var url = URL.createObjectURL(file), isVideo = /^video\//.test(file.type) || /\.(mp4|mov|m4v|webm)$/i.test(file.name);
    if (!isVideo) return new Promise(function (res, rej) {
      var im = new Image(); im.onload = function () { res({ kind: "image", el: im, url: url, w: im.naturalWidth, h: im.naturalHeight, srcDur: Infinity }); };
      im.onerror = function () { rej(new Error(file.name)); }; im.src = url; });
    return new Promise(function (res, rej) {
      var v = document.createElement("video"); v.muted = true; v.playsInline = true; v.preload = "auto";
      v.onloadeddata = function () { res({ kind: "video", el: v, url: url, w: v.videoWidth, h: v.videoHeight, srcDur: v.duration }); };
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
        var it = Object.assign({ id: nextId++, name: f.name, text: "", rot: 0, missing: false }, m);
        it.len = recipe().len; it.tint = S.items.length >= recipe().hook;
        it.start = it.kind === "video" ? Math.min(1, Math.max(0, it.srcDur - it.len)) : 0;
        clampItem(it); S.items.push(it);
      });
      var bad = res.filter(function (r) { return r && r.error; });
      status(bad.length ? "تعذّر فتح: " + bad.map(function (b) { return b.error; }).join("، ") : "", !!bad.length);
      renderClips(); S.t = Math.min(S.t, total()); drawAt(S.t);
    });
  }
  function clampItem(it) {
    it.len = Math.max(1, Math.min(15, +it.len || recipe().len));
    if (it.kind === "video") { it.len = Math.min(it.len, Math.max(1, Math.floor((it.srcDur - 0.1) * 10) / 10)); it.start = Math.max(0, Math.min(+it.start || 0, it.srcDur - it.len - 0.05)); }
  }

  /* ---------- clip cards ---------- */
  function renderClips() {
    var box = $("rgClips"); box.innerHTML = "";
    $("rgCount").textContent = S.items.length ? "· " + S.items.length + " لقطة · " + fmt(total()) : "";
    if (!S.items.length) { box.innerHTML = '<div class="no-clips">لا لقطات بعد — ابدأ بإضافة المواد من اليمين</div>'; }
    S.items.forEach(function (it, i) {
      var c = document.createElement("div"); c.className = "clip" + (it.missing ? " missing" : "");
      if (it.missing) {
        c.innerHTML = '<div class="thumb" style="display:flex;align-items:center;justify-content:center;color:#aaa;font-size:12px;padding:10px;text-align:center">بانتظار الملف:<br>' + esc(it.name) + '</div>' +
          '<div class="hint">أضف هذا الملف من «المواد» ليُربط تلقائياً</div><div class="tools"><button type="button" data-a="del" title="حذف">✕</button></div>';
      } else {
        c.innerHTML = '<div class="thumb"><canvas width="180" height="320"></canvas><span class="num">' + (i + 1) + '</span><span class="kind">' + (it.kind === "video" ? "VIDEO " + it.srcDur.toFixed(1) + "s" : "PHOTO") + '</span></div>' +
          '<textarea placeholder="نص اللقطة (اختياري)">' + esc(it.text) + '</textarea>' +
          '<div class="row"><div style="flex:1"><label class="l">المدة (ث)</label><input type="number" data-f="len" min="1" max="15" step="0.5" value="' + it.len + '"></div>' +
          (it.kind === "video" ? '<div style="flex:1"><label class="l">البداية (ث)</label><input type="number" data-f="start" min="0" step="0.5" value="' + it.start.toFixed(1) + '"></div>' : "") + '</div>' +
          '<label class="chk"><input type="checkbox" data-f="tint"' + (it.tint ? " checked" : "") + '> طبقة كحلية</label>' +
          '<div class="tools"><button type="button" data-a="rot" title="تدوير 90°">↻</button><button type="button" data-a="up" title="تقديم">→</button><button type="button" data-a="down" title="تأخير">←</button><button type="button" data-a="del" title="حذف">✕</button></div>';
        var ta = c.querySelector("textarea");
        ta.addEventListener("input", function () { it.text = ta.value; drawAt(S.t); });
        [].forEach.call(c.querySelectorAll("input[data-f]"), function (inp) {
          inp.addEventListener("change", function () {
            if (inp.dataset.f === "tint") it.tint = inp.checked; else it[inp.dataset.f] = +inp.value;
            clampItem(it); if (inp.dataset.f !== "tint") inp.value = inp.dataset.f === "start" ? it.start.toFixed(1) : it.len;
            thumb(it, c); $("rgCount").textContent = "· " + S.items.length + " لقطة · " + fmt(total()); drawAt(S.t);
          });
        });
        thumb(it, c);
      }
      c.querySelector(".tools").addEventListener("click", function (e) {
        var a = e.target.dataset && e.target.dataset.a; if (!a) return;
        var j = S.items.indexOf(it);
        if (a === "rot") { it.rot = (it.rot + 90) % 360; thumb(it, c); drawAt(S.t); return; }
        if (a === "del") S.items.splice(j, 1);
        if (a === "up" && j > 0) S.items.splice(j - 1, 0, S.items.splice(j, 1)[0]);
        if (a === "down" && j < S.items.length - 1) S.items.splice(j + 1, 0, S.items.splice(j, 1)[0]);
        stop(); renderClips(); S.t = Math.min(S.t, total()); drawAt(S.t);
      });
      box.appendChild(c);
    });
    $("rgExport").disabled = !ready().length || S.items.some(function (x) { return x.missing; });
    $("rgEmpty").hidden = !!ready().length;
  }
  var thumbQueue = Promise.resolve();
  function thumb(it, card) {   // serialised: one video element must not seek for two jobs at once
    thumbQueue = thumbQueue.then(function () {
      return seekEl(it, 0).then(function () { var cv = card.querySelector("canvas"); if (!cv) return; var g = cv.getContext("2d"); g.fillStyle = "#000"; g.fillRect(0, 0, 180, 320); drawMedia(g, 180, 320, it, 0); if (it.tint) { g.fillStyle = TINT; g.fillRect(0, 0, 180, 320); } });
    });
  }
  function esc(s) { return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }

  /* ---------- preview ---------- */
  var cv = null, g = null;
  function drawAt(t) {
    if (!ready().length) { g.fillStyle = "#111"; g.fillRect(0, 0, cv.width, cv.height); updateTime(); return; }
    var loc = locate(t), seq = ++S.seq;
    (loc.item ? seekEl(loc.item, loc.local) : Promise.resolve()).then(function () { if (seq === S.seq || S.playing) frame(g, cv.width, cv.height, loc); });
    updateTime();
  }
  function updateTime() { var T = total(); $("rgTime").textContent = fmt(S.t) + " / " + fmt(T); $("rgSeek").value = T ? Math.round(S.t / T * 1000) : 0; }
  /* Real-time playback: videos play natively, the canvas copies their frames. */
  function play() {
    if (!ready().length) return;
    if (S.t >= total() - 0.05) S.t = 0;
    S.playing = true; $("rgPlay").textContent = "❚❚"; S.clock = performance.now() - S.t * 1000; S.cur = -1;
    var mp = $("rgMusicPlayer"); if (S.musicBlob) { mp.currentTime = S.t; mp.play().catch(function () {}); }
    requestAnimationFrame(tick);
  }
  function tick(now) {
    if (!S.playing) return;
    S.t = (now - S.clock) / 1000;
    if (S.t >= total()) { stop(); S.t = total(); drawAt(S.t); return; }
    var loc = locate(S.t);
    if (loc.idx !== S.cur) {   // shot change: stop the old video, start the new one at its in-point
      var old = ready()[S.cur]; if (old && old.kind === "video") old.el.pause();
      S.cur = loc.idx;
      if (loc.item && loc.item.kind === "video") { loc.item.el.currentTime = loc.item.start + loc.local; loc.item.el.play().catch(function () {}); }
    }
    frame(g, cv.width, cv.height, loc); updateTime();
    requestAnimationFrame(tick);
  }
  function stop() {
    S.playing = false; $("rgPlay").textContent = "▶";
    ready().forEach(function (it) { if (it.kind === "video") it.el.pause(); });
    $("rgMusicPlayer").pause();
  }

  /* ---------- music ---------- */
  function setMusic(blob, label) {
    S.musicBlob = blob; S.music = null; S.musicLabel = label;
    var mp = $("rgMusicPlayer");
    if (!blob) { mp.hidden = true; mp.removeAttribute("src"); $("rgMusicSt").textContent = "بدون موسيقى"; return Promise.resolve(); }
    mp.src = URL.createObjectURL(blob); mp.hidden = false;
    return blob.arrayBuffer().then(function (ab) { return new AudioContext({ sampleRate: 44100 }).decodeAudioData(ab); })
      .then(function (buf) { S.music = buf; $("rgMusicSt").textContent = "✓ " + label + " · " + buf.duration.toFixed(1) + " ث" + (buf.duration + 0.5 < total() ? " — أقصر من الفيديو، أعد التوليد" : ""); })
      .catch(function () { $("rgMusicSt").textContent = "تعذّرت قراءة ملف الموسيقى"; S.musicBlob = null; });
  }
  function genMusic() {
    var secs = Math.ceil(total()) || 30, btn = $("rgGenMusic");
    if (secs < 10) secs = 10; if (secs > 90) secs = 90;
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

  /* ---------- export ---------- */
  function exportMp4() {
    if (typeof VideoEncoder === "undefined" || typeof Mp4Muxer === "undefined") { status("المتصفح لا يدعم التصدير. استخدم Chrome أو Edge.", true); return; }
    stop(); S.exporting = true;
    var btn = $("rgExport"), bar = $("rgBar"), fill = $("rgBarFill"), T = total(), frames = Math.round(T * FPS), list = ready();
    btn.disabled = true; bar.hidden = false; fill.style.width = "0"; status("…جارٍ التصدير");
    var hasAudio = !!S.music, t0 = performance.now();
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
      return (loc.item ? seekEl(loc.item, loc.local) : Promise.resolve()).then(function () {
        frame(og, W, H, loc);
        var vf = new VideoFrame(oc, { timestamp: Math.round(f * 1e6 / FPS), duration: Math.round(1e6 / FPS) });
        venc.encode(vf, { keyFrame: f % (FPS * 2) === 0 }); vf.close(); f++;
        if (f % 10 === 0) { fill.style.width = Math.round(f / frames * 92) + "%"; status("…جارٍ التصدير " + Math.round(f / frames * 100) + "%"); }
        return (venc.encodeQueueSize > 8 || f % 10 === 0) ? new Promise(function (r) { setTimeout(r, 0); }).then(step) : step();
      });
    }
    function finish() {
      return venc.flush().then(function () {
        if (!hasAudio) return;
        var aenc = new AudioEncoder({ output: function (c, m) { muxer.addAudioChunk(c, m); }, error: function (e) { fail(e); } });
        aenc.configure({ codec: "mp4a.40.2", sampleRate: 44100, numberOfChannels: 2, bitrate: 160000 });
        var a = S.music, len = Math.min(a.length, Math.round(frames / FPS * 44100)), L = a.getChannelData(0), R = a.numberOfChannels > 1 ? a.getChannelData(1) : L;
        var fadeOut = 1.5 * 44100, fadeIn = 0.3 * 44100;
        for (var off = 0; off < len; off += 1024) {
          var n = Math.min(1024, len - off), buf = new Float32Array(n * 2);
          for (var k = 0; k < n; k++) { var i = off + k, gain = Math.min(1, (len - i) / fadeOut, i / fadeIn); buf[k] = L[i] * gain; buf[n + k] = R[i] * gain; }
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
  function fileName() {
    var first = (ready().filter(function (it) { return it.text.trim(); })[0] || {}).text || "";
    var title = (($("rgEndText").value || "Reel") + " " + first.replace(/\s+/g, " ")).trim().replace(/[\\/:*?"<>|؟?]/g, "").slice(0, 60);
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
        og.fillStyle = grd; og.fillRect(0, 0, W, H); caption(og, W, H, "اختبار السرعة", f / FPS, true);
        var vf = new VideoFrame(oc, { timestamp: f * 40000 }); enc.encode(vf); vf.close();
      }
      if (f < n) { setTimeout(loop, 0); return; }
      enc.flush().then(function () { var x = 5 / ((performance.now() - t0) / 1000); status("سرعة جهازك: " + x.toFixed(1) + "× الوقت الحقيقي — ريل دقيقة بحدود " + Math.max(1, Math.round(60 / x)) + " ث (للصور؛ الفيديو أبطأ)"); });
    })();
  }

  /* ---------- projects (settings only; media is re-linked by file name) ---------- */
  function saveProject() {
    var d = { app: "reels-gen", v: 1, recipe: S.recipe, endText: $("rgEndText").value, watermark: $("rgWatermark").checked, logo: S.logoData,
              items: S.items.map(function (it) { return { name: it.name, kind: it.kind, start: it.start, len: it.len, rot: it.rot, text: it.text, tint: it.tint }; }) };
    var a = document.createElement("a"); a.download = "Reel_project_" + ($("rgEndText").value || "reel") + ".json";
    a.href = URL.createObjectURL(new Blob([JSON.stringify(d)], { type: "application/json" })); a.click();
    status("✓ تم حفظ المشروع (الإعدادات والنصوص — الملفات تُضاف من جهازك عند الفتح)");
  }
  function openProject(d) {
    if (!d || d.app !== "reels-gen" || !Array.isArray(d.items)) { status("الملف ليس مشروع Reels Gen", true); return; }
    stop(); S.recipe = RECIPES[d.recipe] ? d.recipe : "questions"; $("rgRecipe").value = S.recipe;
    $("rgEndText").value = d.endText || ""; $("rgWatermark").checked = d.watermark !== false;
    S.items = d.items.map(function (x) { return { id: nextId++, name: String(x.name || ""), kind: x.kind, start: +x.start || 0, len: +x.len || recipe().len, rot: +x.rot || 0, text: String(x.text || ""), tint: !!x.tint, missing: true }; });
    setLogo(d.logo === undefined ? DEFAULT_LOGO : d.logo);   // null = the user had removed it
    S.t = 0; renderClips(); drawAt(0);
    status("✓ تم فتح المشروع — أضف الملفات (" + S.items.length + ") من «المواد» وستُربط بأسمائها");
  }

  /* The DISC logo is the default (white + orange, made for the navy end card);
     an uploaded logo replaces it for other projects, "إزالة" falls back to the
     end-card text. */
  var DEFAULT_LOGO = "assets/disc-logo.svg";
  function setLogo(src) {
    if (!src) { S.logo = null; S.logoData = null; $("rgLogoClear").hidden = true; $("rgLogoLbl").firstChild.nodeValue = "رفع الشعار (PNG)"; if (cv) drawAt(S.t); return; }
    var im = new Image();
    im.onload = function () {
      S.logo = im; S.logoData = src; $("rgLogoClear").hidden = false;
      $("rgLogoLbl").firstChild.nodeValue = src === DEFAULT_LOGO ? "✓ شعار DISC — اضغط للتبديل" : "✓ تم رفع الشعار";
      if (cv) drawAt(S.t);
    };
    im.src = src;
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
      S.recipe = this.value; var r = recipe();   // re-apply the recipe's defaults to every shot
      S.items.forEach(function (it, i) { it.len = r.len; it.tint = i >= r.hook; clampItem(it); });
      stop(); renderClips(); S.t = Math.min(S.t, total()); drawAt(S.t);
    });
    $("rgPlay").onclick = function () { if (S.playing) { stop(); drawAt(S.t); } else play(); };
    $("rgSeek").addEventListener("input", function () { stop(); S.t = this.value / 1000 * total(); drawAt(S.t); });
    $("rgGenMusic").onclick = genMusic;
    $("rgMusicFile").addEventListener("change", function (e) { var f = e.target.files[0]; if (f) setMusic(f, f.name); e.target.value = ""; });
    $("rgNoMusic").onclick = function () { setMusic(null); };
    $("rgEndText").addEventListener("input", function () { drawAt(S.t); });
    $("rgWatermark").addEventListener("change", function () { drawAt(S.t); });
    $("rgLogoFile").addEventListener("change", function (e) { var f = e.target.files[0]; if (!f) return; var r = new FileReader(); r.onload = function () { setLogo(r.result); }; r.readAsDataURL(f); e.target.value = ""; });
    $("rgLogoClear").onclick = function () { setLogo(null); };
    $("rgExport").onclick = exportMp4;
    $("rgBench").onclick = bench;
    $("rgSave").onclick = saveProject;
    $("rgOpen").addEventListener("change", function (e) {
      var f = e.target.files[0]; if (!f) return; var r = new FileReader();
      r.onload = function () { try { openProject(JSON.parse(r.result)); } catch (err) { status("ملف غير صالح", true); } };
      r.readAsText(f); e.target.value = "";
    });
    window.addEventListener("beforeunload", function (e) { if (S.exporting) { e.preventDefault(); e.returnValue = ""; } });
    setLogo(DEFAULT_LOGO);
    renderClips(); drawAt(0);
  }

  checkAccess().then(function () {
    $("rgGate").hidden = true; $("rgApp").hidden = false;
    return document.fonts.load("700 92px 'Somar Sans'");
  }).then(wire).catch(function (e) {
    if (["no session", "session", "denied"].indexOf(e.message) < 0) $("rgGateMsg").textContent = "تعذّر تحميل الأداة: " + e.message;
  });
})();
