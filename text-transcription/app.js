/* Text Transcription — the text in images, as editable text.
   Two engines, the user's choice per run or per image:
   - On the device: Tesseract (vendor/tesseract, self-hosted; the worker,
     WebAssembly core and Arabic/English data load on first use and are cached).
     Free, and the image never leaves the device. Only small images are
     enlarged first. A low mean confidence suggests Gemini.
   - Gemini through the auth Worker (/transcribe/images): images are scaled
     down to GEM_SIDE, sent in batches of GEM_BATCH (one request each) and
     deleted from Google once read.
   Every text stays editable; copy all, or download it as a .txt file. */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };

  var WORKER = "https://studyzone-auth.ct-aleppo3.workers.dev";
  var TOKEN_KEY = "sz_auth_token", SLUG = "text-transcription";
  var LOW_CONF = 88;                  // Tesseract mean confidence (%) under which Gemini is suggested: a clean page scored 91, a design it misread 82
  var OCR_MIN_SIDE = 1000, OCR_MAX_SCALE = 2;   // only small images are enlarged: enlarging a readable one made Tesseract worse
  var GEM_SIDE = 2400, GEM_BATCH = 6, GEM_MAX_BYTES = 30 * 1048576;
  var LANG_NAMES = { "ara+eng": "عربي وإنكليزي", ara: "عربي", eng: "English" };

  var S = { items: [], busy: false, ocr: null, ocrLang: "" }, nextId = 1;

  function status(t, err) { var e = $("ttStatus"); e.textContent = t || ""; e.className = "status" + (err ? " err" : ""); }
  function bar(p) { $("ttBar").hidden = p == null; $("ttBarFill").style.width = Math.round((p || 0) * 100) + "%"; }
  function token() { try { return localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY); } catch (e) { return null; } }
  function esc(s) { return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }

  /* ---------- access (same rule as Thumbnail Gen) ---------- */
  function checkAccess() {
    var t = token();
    if (!t) { location.href = "../"; return Promise.reject(new Error("no session")); }
    return fetch(WORKER + "/projects", { headers: { "Authorization": "Bearer " + t } })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (r) {
        if (!r.ok) { location.href = "../"; throw new Error("session"); }
        var me = ((r.d && r.d.projects) || []).filter(function (p) { return p.slug === SLUG; })[0];
        if (!me || me.status !== "ready") { $("ttGateMsg").textContent = "لا تملك صلاحية الوصول إلى هذه الأداة."; throw new Error("denied"); }
      });
  }

  /* ---------- images ---------- */
  function addFiles(files) {
    var list = [].slice.call(files || []).filter(function (f) { return /^image\//.test(f.type); });
    if (!list.length) { status("اختر صوراً (JPG أو PNG أو WEBP)", true); return; }
    list.forEach(function (f) {
      S.items.push({ id: nextId++, file: f, url: URL.createObjectURL(f), name: f.name || "image", text: "", engine: "", conf: null, state: "", err: "" });
    });
    status(""); render();
  }
  function loadImage(it) {
    if (it.img) return Promise.resolve(it.img);
    return new Promise(function (res, rej) {
      var im = new Image(); im.onload = function () { it.img = im; res(im); }; im.onerror = function () { rej(new Error("تعذّر فتح الصورة")); }; im.src = it.url;
    });
  }
  /* On a white background (transparent PNGs read as black otherwise), enlarged
     when small: Tesseract reads small type far better at a larger size. */
  function ocrCanvas(im) {
    var w = im.naturalWidth, h = im.naturalHeight, k = Math.min(OCR_MAX_SCALE, Math.max(1, OCR_MIN_SIDE / Math.max(w, h)));
    var c = document.createElement("canvas"); c.width = Math.round(w * k); c.height = Math.round(h * k);
    var g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); g.imageSmoothingQuality = "high"; g.drawImage(im, 0, 0, c.width, c.height);
    return c;
  }
  /* Tesseract wraps left-to-right lines in invisible direction marks, which
     travel with copied text; out they go, with stray spaces and blank runs. */
  function clean(t) {
    return String(t || "").replace(/[‎‏‪-‮]/g, "").split("\n").map(function (l) { return l.replace(/\s+$/, "").replace(/^\s+/, ""); })
      .join("\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  /* ---------- results ---------- */
  function render() {
    var box = $("ttItems"); box.innerHTML = "";
    if (!S.items.length) box.innerHTML = '<div class="empty">لا صور بعد — أضف صوراً من اليمين،<br>ثم اختر «تفريغ على الجهاز» أو «دقة أعلى»</div>';
    S.items.forEach(function (it, i) {
      var el = document.createElement("div"); el.className = "item"; it.el = el;
      el.innerHTML = '<div class="pic"><img alt=""><span class="num">' + (i + 1) + '</span></div>' +
        '<div class="body"><div class="meta"></div><textarea dir="auto" spellcheck="false" placeholder="النص بيظهر هون بعد التفريغ — وفيك تعدّله"></textarea>' +
        '<div class="tools"><button type="button" class="btn-line" data-a="copy">نسخ</button><button type="button" class="btn-line" data-a="gem">دقة أعلى لهالصورة</button><button type="button" class="btn-line" data-a="del">حذف</button></div></div>';
      var img = el.querySelector("img"); img.src = it.url; img.onclick = function () { zoom(it.url); };
      var ta = el.querySelector("textarea"); ta.value = it.text; ta.addEventListener("input", function () { it.text = ta.value; buttons(); });
      el.querySelector(".tools").addEventListener("click", function (e) {
        var a = e.target.dataset && e.target.dataset.a; if (!a) return;
        if (a === "copy") copy(it.text, "✓ نسخت نص الصورة " + (S.items.indexOf(it) + 1));
        else if (a === "gem") runGemini([it]);
        else if (a === "del") { URL.revokeObjectURL(it.url); S.items.splice(S.items.indexOf(it), 1); render(); }
      });
      paint(it); box.appendChild(el);
    });
    buttons();
  }
  function paint(it) {
    if (!it.el) return;
    var m = it.el.querySelector(".meta"), ta = it.el.querySelector("textarea"), h = "";
    if (it.state === "busy") h = '<span class="tag">…جارٍ التفريغ</span>';
    else if (it.state === "error") h = '<span class="warn">' + esc(it.err) + '</span>';
    else if (it.engine === "device") h = '<span class="tag dev">على الجهاز</span>' + (it.conf != null ? "<span>دقة تقديرية " + it.conf + "%</span>" : "") +
      (it.conf != null && it.conf < LOW_CONF ? '<span class="warn">منخفضة — جرّب «دقة أعلى»</span>' : "");
    else if (it.engine === "gemini") h = '<span class="tag gem">Gemini</span>';
    else h = "<span>بانتظار التفريغ</span>";
    m.innerHTML = h;
    if (document.activeElement !== ta) ta.value = it.text;
    it.el.querySelector('[data-a="gem"]').disabled = S.busy;
  }
  function buttons() {
    var n = S.items.length, any = S.items.some(function (it) { return it.text.trim(); });
    $("ttLocal").disabled = $("ttGemini").disabled = !n || S.busy;
    $("ttCopyAll").disabled = $("ttSave").disabled = !any;
    $("ttClear").disabled = !n || S.busy;
    $("ttCount").textContent = n ? "· " + n + " صورة" : "";
    S.items.forEach(function (it) { if (it.el) it.el.querySelector('[data-a="gem"]').disabled = S.busy; });
  }
  function zoom(url) {
    var z = document.createElement("div"); z.className = "zoom"; z.innerHTML = '<img alt="">'; z.querySelector("img").src = url;
    z.onclick = function () { z.remove(); }; document.body.appendChild(z);
  }
  function busy(on) { S.busy = on; buttons(); if (!on) bar(null); }

  /* ---------- on the device: Tesseract ---------- */
  var OCR_STEPS = { "loading tesseract core": "…جارٍ تحميل محرّك القراءة", "initializing tesseract": "…جارٍ تجهيز المحرّك",
                    "loading language traineddata": "…جارٍ تحميل بيانات اللغة", "initializing api": "…جارٍ تجهيز المحرّك" };
  var ocrNow = null;   // {i, n} while recognizing, for the progress bar
  function ocrLog(m) {
    if (m.status === "recognizing text" && ocrNow) { bar((ocrNow.i + m.progress) / ocrNow.n); return; }
    if (OCR_STEPS[m.status]) { status(OCR_STEPS[m.status] + (m.progress ? " " + Math.round(m.progress * 100) + "%" : "")); bar(m.progress || 0); }
  }
  /* One worker, kept for the page's lifetime; a new language starts a new one. */
  function ocrWorker(lang) {
    if (S.ocr && S.ocrLang === lang) return S.ocr;
    var old = S.ocr; if (old) old.then(function (w) { w.terminate(); }).catch(function () {});
    var base = new URL("vendor/tesseract/", location.href).href;
    S.ocrLang = lang;
    S.ocr = Tesseract.createWorker(lang, 1, {   // 1 = the LSTM engine
      workerPath: base + "worker.min.js", corePath: base + "core", langPath: base + "lang",
      workerBlobURL: false,   // a file, not a blob: URL — the CSP allows only 'self' for workers
      logger: ocrLog, errorHandler: function () {}
    });   // default settings: preserve_interword_spaces ran Arabic words together
    S.ocr.catch(function () { S.ocr = null; });
    return S.ocr;
  }
  function runLocal() {
    if (typeof Tesseract === "undefined") { status("تعذّر تحميل محرّك القراءة", true); return; }
    var list = S.items.slice(), lang = $("ttLang").value;
    if (!list.length) return;
    busy(true); status("…جارٍ تجهيز محرّك القراءة"); bar(0);
    ocrWorker(lang).then(function (w) {
      var i = 0, low = 0;
      function next() {
        if (i >= list.length) return;
        var it = list[i]; ocrNow = { i: i, n: list.length };
        it.state = "busy"; paint(it); status("…جارٍ قراءة الصورة " + (i + 1) + " من " + list.length);
        return loadImage(it).then(function (im) { return w.recognize(ocrCanvas(im)); }).then(function (r) {
          it.text = clean(r.data.text); it.conf = Math.round(r.data.confidence); it.engine = "device"; it.state = "";
          if (it.conf < LOW_CONF) low++;
        }, function (e) { it.state = "error"; it.err = "تعذّرت القراءة: " + (e && e.message || e); })
          .then(function () { paint(it); i++; return next(); });
      }
      return Promise.resolve(next()).then(function () {
        status("✓ تم تفريغ " + list.length + " صورة على الجهاز" + (low ? " · " + low + " منها بدقة منخفضة — جرّب «دقة أعلى» لها" : ""));
      });
    }).catch(function (e) {
      status("تعذّر تشغيل محرّك القراءة على هالجهاز: " + (e && e.message || e) + " — جرّب «دقة أعلى»", true);
    }).then(function () { ocrNow = null; busy(false); buttons(); });
  }

  /* ---------- Gemini ---------- */
  /* At most GEM_SIDE on the long side, as JPEG on white: small enough to send,
     sharp enough for small print. */
  function shrink(it) {
    return loadImage(it).then(function (im) {
      var w = im.naturalWidth, h = im.naturalHeight, k = Math.min(1, GEM_SIDE / Math.max(w, h));
      var c = document.createElement("canvas"); c.width = Math.round(w * k); c.height = Math.round(h * k);
      var g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); g.drawImage(im, 0, 0, c.width, c.height);
      return new Promise(function (res) { c.toBlob(res, "image/jpeg", 0.9); });
    });
  }
  /* Body: [4-byte JSON length][JSON {lang, sizes}][the JPEGs back to back] — the
     Worker hands the bytes on to Gemini as they are. The answer streams (spaces
     while Gemini reads, then the JSON). */
  function askGemini(blobs, lang) {
    var meta = new TextEncoder().encode(JSON.stringify({ lang: lang, sizes: blobs.map(function (b) { return b.size; }) }));
    var hdr = new Uint8Array(4); new DataView(hdr.buffer).setUint32(0, meta.length);
    return fetch(WORKER + "/transcribe/images", { method: "POST", headers: { "Authorization": "Bearer " + token(), "Content-Type": "application/octet-stream" },
      body: new Blob([hdr, meta].concat(blobs)) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { if (!r.ok || d.error) throw new Error(d.error || "HTTP " + r.status); return d; }); });
  }
  function runGemini(list) {
    list = list || S.items.slice(); if (!list.length) return;
    var lang = $("ttLang").value, batches = [];
    for (var k = 0; k < list.length; k += GEM_BATCH) batches.push(list.slice(k, k + GEM_BATCH));
    busy(true); bar(0);
    var done = 0, failed = 0;
    function next(b) {
      if (b >= batches.length) return Promise.resolve();
      var group = batches[b];
      group.forEach(function (it) { it.state = "busy"; paint(it); });
      status("…Gemini عم يقرأ " + (list.length > 1 ? "الصور " + (done + 1) + "–" + (done + group.length) + " من " + list.length : "الصورة"));
      return Promise.all(group.map(shrink)).then(function (blobs) {
        if (blobs.reduce(function (s, x) { return s + x.size; }, 0) > GEM_MAX_BYTES) throw new Error("الصور كبيرة كتير مع بعض");
        return askGemini(blobs, lang);
      }).then(function (d) {
        group.forEach(function (it, i) { it.text = clean((d.texts || [])[i]); it.engine = "gemini"; it.conf = null; it.state = ""; });
      }, function (e) {
        failed += group.length;
        group.forEach(function (it) { it.state = "error"; it.err = e && e.message || String(e); });
      }).then(function () { group.forEach(paint); done += group.length; bar(done / list.length); return next(b + 1); });
    }
    next(0).then(function () {
      status(failed ? "Gemini ما قدر يقرأ " + failed + " صورة — شوف السبب جنبها" : "✓ قرأ Gemini " + list.length + " صورة", !!failed);
      busy(false); buttons();
    });
  }

  /* ---------- export ---------- */
  function allText() {
    var withText = S.items.filter(function (it) { return it.text.trim(); });
    return withText.length === 1 ? withText[0].text : withText.map(function (it) { return "— صورة " + (S.items.indexOf(it) + 1) + " —\n" + it.text; }).join("\n\n");
  }
  function copy(text, done) {
    if (!text.trim()) return;
    navigator.clipboard.writeText(text).then(function () { status(done); }, function () { status("ما قدرت انسخ — حدّد النص وانسخه يدوياً", true); });
  }
  function saveTxt() {
    var d = new Date(), p = function (n) { return (n < 10 ? "0" : "") + n; };
    var a = document.createElement("a"); a.download = "Text_Transcription_" + p(d.getMonth() + 1) + p(d.getDate()) + d.getFullYear() + ".txt";
    a.href = URL.createObjectURL(new Blob(["﻿" + allText()], { type: "text/plain;charset=utf-8" }));   // BOM: Notepad reads Arabic as UTF-8
    a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 10000);
  }

  /* ---------- wiring ---------- */
  function wire() {
    $("ttFiles").addEventListener("change", function (e) { addFiles(e.target.files); e.target.value = ""; });
    var drop = $("ttDrop");
    ["dragenter", "dragover"].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add("over"); }); });
    ["dragleave", "drop"].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove("over"); }); });
    drop.addEventListener("drop", function (e) { addFiles(e.dataTransfer.files); });
    document.addEventListener("paste", function (e) {   // a screenshot straight from the clipboard
      var files = [].slice.call((e.clipboardData && e.clipboardData.files) || []).filter(function (f) { return /^image\//.test(f.type); });
      if (files.length && !(e.target && /textarea|input/i.test(e.target.tagName))) { e.preventDefault(); addFiles(files); }
    });
    $("ttLocal").onclick = runLocal;
    $("ttGemini").onclick = function () { runGemini(); };
    $("ttCopyAll").onclick = function () { copy(allText(), "✓ نسخت كل النصوص"); };
    $("ttSave").onclick = saveTxt;
    $("ttClear").onclick = function () { S.items.forEach(function (it) { URL.revokeObjectURL(it.url); }); S.items = []; status(""); render(); };
    $("ttLang").addEventListener("change", function () { if (S.items.some(function (it) { return it.engine; })) status("اللغة: " + LANG_NAMES[this.value] + " — أعد التفريغ لتطبيقها"); });
    render();
  }

  checkAccess().then(function () {
    $("ttGate").hidden = true; $("ttApp").hidden = false;
    wire();
  }).catch(function (e) {
    if (["no session", "session", "denied"].indexOf(e.message) < 0) $("ttGateMsg").textContent = "تعذّر تحميل الأداة: " + e.message;
  });
})();
