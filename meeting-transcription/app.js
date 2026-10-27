/* Meeting Transcription — a meeting's recording, word for word.
   The recording is decoded on the device to 16 kHz mono and cut into parts of
   PART seconds that overlap by OVER, so no word is lost at a cut; each part is
   compressed to Ogg Opus (about 1.8 MB per ten minutes) and read by Gemini
   through the auth Worker (/meet/transcribe), one part at a time, and deleted
   from Google once read. Each part comes back as segments (time, speaker,
   words); the times become the meeting's own, the overlap is read once.
   A time plays the recording from there; the words can be corrected in place.
   Nothing is stored: everything stays in the page until it is closed. */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };

  var WORKER = "https://studyzone-auth.ct-aleppo3.workers.dev";
  var TOKEN_KEY = "sz_auth_token", SLUG = "meeting-transcription";
  var SR = 16000, PART = 600, OVER = 15, RETRIES = 3, RETRY_WAIT = 60;
  var MAX_BYTES = 400 * 1048576;   // decoding needs the whole file in memory

  var S = { file: null, url: "", segs: [], busy: false };

  function status(t, err) { var e = $("mtStatus"); e.textContent = t || ""; e.className = "status" + (err ? " err" : ""); }
  function bar(p) { $("mtBar").hidden = p == null; $("mtBarFill").style.width = Math.round((p || 0) * 100) + "%"; }
  function token() { try { return localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY); } catch (e) { return null; } }
  function esc(s) { return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function fmt(s) { s = Math.max(0, Math.round(s)); var h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = s % 60; return (h ? h + ":" + (m < 10 ? "0" : "") : "") + m + ":" + (x < 10 ? "0" : "") + x; }
  function secs(t) { var p = String(t || "").trim().split(":").map(Number); if (p.some(isNaN) || !p.length) return 0; return p.reduce(function (a, n) { return a * 60 + n; }, 0); }
  function wait(s) { return new Promise(function (r) { setTimeout(r, s * 1000); }); }

  /* ---------- access (same rule as Text Transcription) ---------- */
  function checkAccess() {
    var t = token();
    if (!t) { location.href = "../"; return Promise.reject(new Error("no session")); }
    return fetch(WORKER + "/projects", { headers: { "Authorization": "Bearer " + t } })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (r) {
        if (!r.ok) { location.href = "../"; throw new Error("session"); }
        var me = ((r.d && r.d.projects) || []).filter(function (p) { return p.slug === SLUG; })[0];
        if (!me || me.status !== "ready") { $("mtGateMsg").textContent = "لا تملك صلاحية الوصول إلى هذه الأداة."; throw new Error("denied"); }
      });
  }

  /* ---------- the recording ---------- */
  function setFile(f) {
    if (!f || S.busy) return;
    if (!/^(audio|video)\//.test(f.type) && !/\.(m4a|mp3|wav|ogg|opus|mp4|webm|aac)$/i.test(f.name || "")) { status("اختر ملف صوت أو فيديو", true); return; }
    if (f.size > MAX_BYTES) { status("الملف أكبر من " + Math.round(MAX_BYTES / 1048576) + " MB", true); return; }
    if (S.url) URL.revokeObjectURL(S.url);
    S.file = f; S.url = URL.createObjectURL(f); S.segs = [];
    $("mtName").textContent = f.name; $("mtInfo").textContent = Math.round(f.size / 1048576) + " MB";
    var pl = $("mtPlayer"); pl.src = S.url; pl.hidden = false;
    pl.onloadedmetadata = function () { if (isFinite(pl.duration)) $("mtInfo").textContent = Math.round(f.size / 1048576) + " MB · " + fmt(pl.duration); };
    $("mtGo").disabled = false; status(""); render();
  }

  /* ---------- Ogg Opus (as Reels Gen sends speech) ---------- */
  var OGG_CRC = (function () {
    var t = new Uint32Array(256);
    for (var i = 0; i < 256; i++) { var r = i << 24; for (var j = 0; j < 8; j++) r = r & 0x80000000 ? (r << 1) ^ 0x04c11db7 : r << 1; t[i] = r >>> 0; }
    return t;
  })();
  function oggPage(packets, granule, seq, flags) {
    var lace = [], size = 0;
    packets.forEach(function (p) { var n = p.length; while (n >= 255) { lace.push(255); n -= 255; } lace.push(n); size += p.length; });
    var page = new Uint8Array(27 + lace.length + size), dv = new DataView(page.buffer), o = 27 + lace.length, c = 0, i;
    page.set([79, 103, 103, 83]); page[5] = flags;   // "OggS"
    dv.setUint32(6, granule % 4294967296, true); dv.setUint32(10, Math.floor(granule / 4294967296), true);
    dv.setUint32(14, 0x4d544731, true); dv.setUint32(18, seq, true); page[26] = lace.length; page.set(lace, 27);
    packets.forEach(function (p) { page.set(p, o); o += p.length; });
    for (i = 0; i < page.length; i++) c = ((c << 8) ^ OGG_CRC[((c >>> 24) ^ page[i]) & 255]) >>> 0;
    dv.setUint32(22, c, true);
    return page;
  }
  function toOgg(x) {
    var packets = [], failed = null, PRE = 312;
    var enc = new AudioEncoder({ output: function (c) { var d = new Uint8Array(c.byteLength); c.copyTo(d); packets.push({ d: d, n: c.duration ? Math.round(c.duration * 0.048) : 960 }); },
                                 error: function (e) { failed = e; } });
    enc.configure({ codec: "opus", sampleRate: SR, numberOfChannels: 1, bitrate: 24000 });
    function feed(o) {
      if (failed) return Promise.reject(failed);
      if (o >= x.length) return enc.flush();
      var n = Math.min(SR, x.length - o);
      var ad = new AudioData({ format: "f32-planar", sampleRate: SR, numberOfFrames: n, numberOfChannels: 1, timestamp: Math.round(o / SR * 1e6), data: x.slice(o, o + n) });
      enc.encode(ad); ad.close();
      return (enc.encodeQueueSize > 20 ? wait(0) : Promise.resolve()).then(function () { return feed(o + n); });
    }
    return feed(0).then(function () {
      enc.close();
      var head = new Uint8Array(19), hv = new DataView(head.buffer), te = new TextEncoder(), vendor = te.encode("meeting-transcription");
      head.set(te.encode("OpusHead")); head[8] = 1; head[9] = 1; hv.setUint16(10, PRE, true); hv.setUint32(12, SR, true);
      var tags = new Uint8Array(16 + vendor.length), tv = new DataView(tags.buffer);
      tags.set(te.encode("OpusTags")); tv.setUint32(8, vendor.length, true); tags.set(vendor, 12);
      var pages = [oggPage([head], 0, 0, 2), oggPage([tags], 0, 1, 0)], seq = 2, gran = PRE, group = [], laces = 0;
      packets.forEach(function (p, i) {
        var l = Math.floor(p.d.length / 255) + 1;
        if (laces + l > 255) { pages.push(oggPage(group, gran, seq++, 0)); group = []; laces = 0; }
        group.push(p.d); laces += l; gran += p.n;
        if (i === packets.length - 1) pages.push(oggPage(group, gran, seq++, 4));
      });
      return new Blob(pages, { type: "audio/ogg" });
    });
  }

  /* ---------- Gemini, one part at a time ---------- */
  function send(ogg, meta) {
    var m = new TextEncoder().encode(JSON.stringify(meta)), hdr = new Uint8Array(4); new DataView(hdr.buffer).setUint32(0, m.length);
    return fetch(WORKER + "/meet/transcribe", { method: "POST", headers: { "Authorization": "Bearer " + token(), "Content-Type": "application/octet-stream" }, body: new Blob([hdr, m, ogg]) })
      .then(function (r) { return r.json().catch(function () { return { error: "HTTP " + r.status }; }).then(function (d) { if (!r.ok && !d.error) d.error = "HTTP " + r.status; d.status = r.status; return d; }); });
  }
  /* A busy model (503) clears in a minute or so: wait and send the part again. */
  function sendPart(ogg, meta, label) {
    var tries = 0;
    return (function go() {
      return send(ogg, meta).then(function (d) {
        if (!d.error) return d;
        if (++tries >= RETRIES || d.status === 401 || d.status === 403 || d.status === 429) throw new Error(d.error);
        status(label + " — Gemini مضغوط، بعيد المحاولة بعد " + RETRY_WAIT + " ث (" + tries + "/" + (RETRIES - 1) + ")", true);
        return wait(RETRY_WAIT).then(go);
      });
    })();
  }
  function go() {
    if (!S.file || S.busy) return;
    var names = $("mtNames").value.split(/[\n،,]+/).map(function (s) { return s.replace(/\s+/g, " ").trim(); }).filter(Boolean);
    S.busy = true; buttons(); S.segs = []; render(); bar(0); status("…جارٍ فك ترميز التسجيل");
    var x, dur, n;
    S.file.arrayBuffer()
      .then(function (ab) { return new OfflineAudioContext(1, 1, SR).decodeAudioData(ab); })
      .then(function (buf) {
        x = buf.getChannelData(0); dur = buf.duration; n = Math.ceil(dur / PART);
        return (function part(k) {
          if (k >= n) return null;
          var from = Math.max(0, k * PART - (k ? OVER : 0)), to = Math.min(dur, (k + 1) * PART), label = "الجزء " + (k + 1) + " من " + n;
          status("…" + label + ": تجهيز الصوت");
          return toOgg(x.subarray(Math.floor(from * SR), Math.floor(to * SR)))
            .then(function (ogg) { status("…" + label + ": Gemini عم يفرّغ"); return sendPart(ogg, { names: names, terms: "", pass: 1 }, label); })
            .then(function (d) {
              (d.segments || []).forEach(function (s) {
                var t = from + secs(s.t);
                if (k && t < k * PART - 2) return;   // the overlap was read with the part before
                if (String(s.text || "").trim()) S.segs.push({ t: t, speaker: String(s.speaker || "").trim(), text: String(s.text).trim(), part: k });
              });
              render(); bar((k + 1) / n);
              return part(k + 1);
            });
        })(0);
      })
      .then(function () { status("✓ تم تفريغ " + fmt(dur) + " · " + S.segs.length + " مقطع — راجع النص واضغط على أي وقت لتسمع"); },
            function (e) { status("توقّف التفريغ: " + (e && e.message || e) + (S.segs.length ? " — اللي تفرّغ لهون محفوظ بالصفحة" : ""), true); })
      .then(function () { S.busy = false; bar(null); buttons(); });
  }

  /* ---------- the transcript ---------- */
  function render() {
    var box = $("mtSegs");
    $("mtCount").textContent = S.segs.length ? "· " + S.segs.length + " مقطع" : "";
    if (!S.segs.length) { box.innerHTML = '<div class="empty">' + (S.file ? "اضغط «تفريغ الاجتماع»" : "لا تفريغ بعد — ارفع تسجيل الاجتماع<br>واضغط «تفريغ الاجتماع»") + "</div>"; buttons(); return; }
    box.innerHTML = S.segs.map(function (s, i) {
      return '<div class="seg"><button type="button" class="t" data-i="' + i + '" title="اسمع من هون">' + fmt(s.t) + '</button><div class="who">' + esc(s.speaker) +
             '</div><div class="say" contenteditable="true" data-i="' + i + '">' + esc(s.text) + "</div></div>";
    }).join("");
    buttons();
  }
  function plain() { return S.segs.map(function (s) { return "[" + fmt(s.t) + "] " + (s.speaker ? s.speaker + ": " : "") + s.text; }).join("\n"); }
  function buttons() {
    $("mtGo").disabled = !S.file || S.busy;
    $("mtCopy").disabled = $("mtTxt").disabled = !S.segs.length;
  }

  function init() {
    checkAccess().then(function () { $("mtGate").hidden = true; $("mtApp").hidden = false; }, function () {});
    $("mtFile").addEventListener("change", function (e) { setFile(e.target.files[0]); e.target.value = ""; });
    var drop = $("mtDrop");
    ["dragenter", "dragover"].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add("over"); }); });
    ["dragleave", "drop"].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove("over"); }); });
    drop.addEventListener("drop", function (e) { setFile(e.dataTransfer.files[0]); });
    $("mtGo").addEventListener("click", function () { ask(go); });
    $("mtSegs").addEventListener("click", function (e) {
      var b = e.target.closest(".t"); if (!b) return;
      var pl = $("mtPlayer"); pl.currentTime = Math.max(0, S.segs[+b.dataset.i].t - 1); pl.play().catch(function () {});
    });
    $("mtSegs").addEventListener("input", function (e) { var el = e.target.closest(".say"); if (el) S.segs[+el.dataset.i].text = el.textContent; });
    $("mtCopy").addEventListener("click", function () {
      navigator.clipboard.writeText(plain()).then(function () { status("✓ انسخ التفريغ"); }, function () { status("ما قدرت انسخ — استعمل «تنزيل .txt»", true); });
    });
    $("mtTxt").addEventListener("click", function () {
      var a = document.createElement("a"); a.download = (S.file ? S.file.name.replace(/\.[^.]+$/, "") : "meeting") + " — تفريغ.txt";
      a.href = URL.createObjectURL(new Blob(["﻿" + plain()], { type: "text/plain;charset=utf-8" })); a.click();
    });
    window.addEventListener("beforeunload", function (e) { if (S.busy || S.segs.length) { e.preventDefault(); e.returnValue = ""; } });
  }

  /* Before the recording leaves the device: what happens to it, once per page. */
  var agreed = false;
  function ask(then) {
    if (agreed) { then(); return; }
    var d = document.createElement("div"); d.className = "ask";
    d.innerHTML = '<div class="box"><h2>قبل ما يبلّش التفريغ</h2>' +
      "<p>صوت الاجتماع رح ينبعت لـ Google (Gemini) ليتفرّغ، وبينحذف من عندهم بعدها مباشرة. بالمستوى المجاني ممكن Google تستعمل المحتوى لتحسين خدماتها.</p>" +
      "<p><b>ما تبعت اجتماعات حساسة</b> (رواتب، أمور شخصية أو أمنية).</p>" +
      '<div class="row"><button type="button" class="btn" data-ok="1">تمام، فرّغ</button><button type="button" class="btn-line" data-ok="0">إلغاء</button></div></div>';
    function close(ok) { d.remove(); document.removeEventListener("keydown", key); if (ok) { agreed = true; then(); } }
    function key(e) { if (e.key === "Escape") close(false); }
    d.addEventListener("click", function (e) { var b = e.target.closest("[data-ok]"); if (b) close(b.dataset.ok === "1"); else if (e.target === d) close(false); });
    document.addEventListener("keydown", key);
    document.body.appendChild(d);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
