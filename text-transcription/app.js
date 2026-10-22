/* Text Transcription — the text in images, as editable text.
   Two engines, the user's choice per run or per image:
   - On the device: Tesseract (vendor/tesseract, self-hosted; the worker,
     WebAssembly core and Arabic/English data load on first use and are cached).
     Free, and the image never leaves the device. Only small images are
     enlarged first. A low mean confidence suggests Gemini.
   - Gemini through the auth Worker (/transcribe/images): images are scaled
     down to GEM_SIDE, sent in batches of GEM_BATCH (one request each) and
     deleted from Google once read.
   Image type: plain text, a card or document (ID, passport, certificate…),
   or automatic. A document comes back as its fields — label and value, both
   editable — with the full text folded below; reading fields takes Gemini.
   Nothing is stored: everything stays in the page until it is closed.
   Copy all, download a .txt, or download every document as one CSV sheet
   (a row per image, a column per field label) that opens in Excel. */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };

  var WORKER = "https://studyzone-auth.ct-aleppo3.workers.dev";
  var TOKEN_KEY = "sz_auth_token", SLUG = "text-transcription";
  var LOW_CONF = 88;                  // Tesseract mean confidence (%) under which Gemini is suggested: a clean page scored 91, a design it misread 82
  var OCR_MIN_SIDE = 1000, OCR_MAX_SCALE = 2;   // only small images are enlarged: enlarging a readable one made Tesseract worse
  var GEM_SIDE = 2400, GEM_BATCH = 6, GEM_MAX_BYTES = 30 * 1048576;
  var LANG_NAMES = { "ara+eng": "عربي وإنكليزي", ara: "عربي", eng: "English" };
  var KIND_HINTS = {
    auto: "Gemini بيعرف إذا الصورة بطاقة أو وثيقة ويطلّع خاناتها، وإلا بيطلّع النص",
    text: "النص كما هو، بفقراته وأسطره",
    doc: "كل صورة وثيقة: الاسم، تاريخ الولادة، الرقم… كل معلومة بخانة — بتحتاج «دقة أعلى»"
  };

  var S = { items: [], busy: false, ocr: null, ocrLang: "", docOk: false }, nextId = 1;

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
      S.items.push({ id: nextId++, file: f, url: URL.createObjectURL(f), name: f.name || "image", text: "", engine: "", conf: null, state: "", err: "",
                     docType: "", fields: [], ver: 0 });
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
  function isDoc(it) { return it.fields.length > 0; }

  /* ---------- results ---------- */
  function render() {
    var box = $("ttItems"); box.innerHTML = "";
    if (!S.items.length) box.innerHTML = '<div class="empty">لا صور بعد — أضف صوراً من اليمين،<br>ثم اختر «تفريغ على الجهاز» أو «دقة أعلى»</div>';
    S.items.forEach(function (it, i) {
      var el = document.createElement("div"); el.className = "item"; it.el = el; it.shown = -1;
      el.innerHTML = '<div class="pic"><img alt=""><span class="num">' + (i + 1) + '</span></div>' +
        '<div class="body"><div class="meta"></div><div class="out"></div>' +
        '<div class="tools"><button type="button" class="btn-line" data-a="copy">نسخ</button><button type="button" class="btn-line" data-a="gem">دقة أعلى لهالصورة</button><button type="button" class="btn-line" data-a="del">حذف</button></div></div>';
      var img = el.querySelector("img"); img.src = it.url; img.onclick = function () { zoom(it.url); };
      el.querySelector(".tools").addEventListener("click", function (e) {
        var a = e.target.dataset && e.target.dataset.a; if (!a) return;
        if (a === "copy") copy(itemText(it), "✓ نسخت " + (isDoc(it) ? "خانات" : "نص") + " الصورة " + (S.items.indexOf(it) + 1));
        else if (a === "gem") runGemini([it]);
        else if (a === "del") { URL.revokeObjectURL(it.url); S.items.splice(S.items.indexOf(it), 1); render(); }
      });
      paint(it); box.appendChild(el);
    });
    buttons();
  }
  /* The text, or for a document its fields — rebuilt only when a new reading
     arrives (it.ver), so typing in them is never interrupted. */
  function out(it) {
    var o = it.el.querySelector(".out"); o.innerHTML = "";
    var ta = document.createElement("textarea");
    ta.dir = "auto"; ta.spellcheck = false; ta.placeholder = "النص بيظهر هون بعد التفريغ — وفيك تعدّله"; ta.value = it.text;
    ta.addEventListener("input", function () { it.text = ta.value; buttons(); });
    if (!isDoc(it)) { o.appendChild(ta); return; }
    if (it.docType) { var dt = document.createElement("div"); dt.className = "doc-type"; dt.textContent = it.docType; o.appendChild(dt); }
    var tb = document.createElement("table"); tb.className = "fields";
    it.fields.forEach(function (f) {
      var tr = document.createElement("tr");
      tr.innerHTML = '<td class="l"><input dir="auto" aria-label="الخانة"></td><td><input dir="auto" aria-label="القيمة"></td><td class="c"><button type="button">نسخ</button></td>';
      var ins = tr.querySelectorAll("input"); ins[0].value = f.label; ins[1].value = f.value;
      ins[0].addEventListener("input", function () { f.label = ins[0].value; });
      ins[1].addEventListener("input", function () { f.value = ins[1].value; buttons(); });
      tr.querySelector("button").onclick = function () { copy(f.value, "✓ نسخت «" + (f.label || "القيمة") + "»"); };
      tb.appendChild(tr);
    });
    o.appendChild(tb);
    var det = document.createElement("details"); det.className = "full";
    det.innerHTML = "<summary>النص الكامل</summary>"; det.appendChild(ta); o.appendChild(det);
  }
  function paint(it) {
    if (!it.el) return;
    var m = it.el.querySelector(".meta"), h = "";
    if (it.state === "busy") h = '<span class="tag">…جارٍ التفريغ</span>';
    else if (it.state === "error") h = '<span class="warn">' + esc(it.err) + '</span>';
    else if (it.engine === "device") h = '<span class="tag dev">على الجهاز</span>' + (it.conf != null ? "<span>دقة تقديرية " + it.conf + "%</span>" : "") +
      (it.conf != null && it.conf < LOW_CONF ? '<span class="warn">منخفضة — جرّب «دقة أعلى»</span>' : "");
    else if (it.engine === "gemini") h = '<span class="tag gem">Gemini</span>' + (isDoc(it) ? "<span>وثيقة · " + it.fields.length + " خانة</span>" : "");
    else h = "<span>بانتظار التفريغ</span>";
    m.innerHTML = h;
    if (it.shown !== it.ver) { out(it); it.shown = it.ver; }
    it.el.querySelector('[data-a="gem"]').disabled = S.busy;
  }
  function buttons() {
    var n = S.items.length, any = S.items.some(function (it) { return it.text.trim() || isDoc(it); });
    $("ttLocal").disabled = $("ttGemini").disabled = !n || S.busy;
    $("ttCopyAll").disabled = $("ttSave").disabled = !any;
    $("ttCsv").disabled = !S.items.some(isDoc);
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
    if ($("ttKind").value === "doc") { status("تقسيم البطاقات لخانات بيحتاج «دقة أعلى» — القراءة على الجهاز بتطلّع النص بس. غيّر نوع الصورة لـ «نص عادي» لتقراها هون.", true); return; }
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
          it.text = clean(r.data.text); it.conf = Math.round(r.data.confidence); it.engine = "device"; it.state = ""; it.fields = []; it.docType = ""; it.ver++;
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
  /* Body: [4-byte JSON length][JSON {lang, mode, sizes}][the JPEGs back to back] —
     the Worker hands the bytes on to Gemini as they are. The answer streams
     (spaces while Gemini reads, then the JSON). */
  function askGemini(blobs, lang, mode) {
    var meta = new TextEncoder().encode(JSON.stringify({ lang: lang, mode: mode, sizes: blobs.map(function (b) { return b.size; }) }));
    var hdr = new Uint8Array(4); new DataView(hdr.buffer).setUint32(0, meta.length);
    return fetch(WORKER + "/transcribe/images", { method: "POST", headers: { "Authorization": "Bearer " + token(), "Content-Type": "application/octet-stream" },
      body: new Blob([hdr, meta].concat(blobs)) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { if (!r.ok || d.error) throw new Error(d.error || "HTTP " + r.status); return d; }); });
  }
  /* Cards and documents carry personal data: say once per visit where the
     images go before any of them leaves the device for Gemini. */
  function docConsent(mode) {
    if (mode === "text" || S.docOk) return true;
    S.docOk = confirm("الصور رح تنقرأ عند Google (Gemini) وبتنحذف من عندهم مباشرة بعد القراءة. الأداة ما بتخزّن لا الصور ولا المعلومات — كل شي بيضل بهالصفحة لحد ما تسكّرها.\n\nإذا فيها بطاقات أو وثائق شخصية، تأكد إنه مسموح ترفعها لخدمة خارجية.\n\nمتابعة؟");
    return S.docOk;
  }
  function runGemini(list) {
    list = list || S.items.slice(); if (!list.length) return;
    var lang = $("ttLang").value, mode = $("ttKind").value, batches = [];
    if (!docConsent(mode)) { status("ما انبعت شي"); return; }
    for (var k = 0; k < list.length; k += GEM_BATCH) batches.push(list.slice(k, k + GEM_BATCH));
    busy(true); bar(0);
    var done = 0, failed = 0, docs = 0;
    function next(b) {
      if (b >= batches.length) return Promise.resolve();
      var group = batches[b];
      group.forEach(function (it) { it.state = "busy"; paint(it); });
      status("…Gemini عم يقرأ " + (list.length > 1 ? "الصور " + (done + 1) + "–" + (done + group.length) + " من " + list.length : "الصورة"));
      return Promise.all(group.map(shrink)).then(function (blobs) {
        if (blobs.reduce(function (s, x) { return s + x.size; }, 0) > GEM_MAX_BYTES) throw new Error("الصور كبيرة كتير مع بعض");
        return askGemini(blobs, lang, mode);
      }).then(function (d) {
        group.forEach(function (it, i) {
          var r = (d.images || [])[i] || { text: (d.texts || [])[i] || "", fields: [] };
          it.text = clean(r.text); it.fields = (r.fields || []).map(function (f) { return { label: f.label, value: f.value }; }); it.docType = r.docType || "";
          it.engine = "gemini"; it.conf = null; it.state = ""; it.ver++;
          if (isDoc(it)) docs++;
        });
      }, function (e) {
        failed += group.length;
        group.forEach(function (it) { it.state = "error"; it.err = e && e.message || String(e); });
      }).then(function () { group.forEach(paint); done += group.length; bar(done / list.length); return next(b + 1); });
    }
    next(0).then(function () {
      status(failed ? "Gemini ما قدر يقرأ " + failed + " صورة — شوف السبب جنبها"
                    : "✓ قرأ Gemini " + list.length + " صورة" + (docs ? " · " + docs + " منها وثائق مقسومة لخانات" : ""), !!failed);
      busy(false); buttons();
    });
  }

  /* ---------- export ---------- */
  function itemText(it) {
    if (!isDoc(it)) return it.text;
    return (it.docType ? it.docType + "\n" : "") + it.fields.map(function (f) { return f.label + ": " + f.value; }).join("\n");
  }
  function allText() {
    var withText = S.items.filter(function (it) { return itemText(it).trim(); });
    return withText.length === 1 ? itemText(withText[0]) : withText.map(function (it) { return "— صورة " + (S.items.indexOf(it) + 1) + " —\n" + itemText(it); }).join("\n\n");
  }
  function copy(text, done) {
    if (!String(text || "").trim()) return;
    navigator.clipboard.writeText(text).then(function () { status(done); }, function () { status("ما قدرت انسخ — حدّد النص وانسخه يدوياً", true); });
  }
  function download(name, text, type) {
    var a = document.createElement("a"); a.download = name;
    a.href = URL.createObjectURL(new Blob(["﻿" + text], { type: type + ";charset=utf-8" }));   // BOM: Notepad and Excel read Arabic as UTF-8
    a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 10000);
  }
  function stamp() { var d = new Date(), p = function (n) { return (n < 10 ? "0" : "") + n; }; return p(d.getMonth() + 1) + p(d.getDate()) + d.getFullYear(); }
  /* Every document as one sheet: a row per image, a column per field label in
     the order labels first appear, so the same field of many cards lines up. */
  function saveCsv() {
    var docs = S.items.filter(isDoc), cols = [];
    docs.forEach(function (it) { it.fields.forEach(function (f) { if (f.label && cols.indexOf(f.label) < 0) cols.push(f.label); }); });
    var q = function (v) { return '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"'; };
    // Excel reads a bare number or date by itself: a national ID or phone loses its leading zero,
    // a date gets reformatted. Written as ="…" it stays text, exactly as on the card.
    var cell = function (v) { v = String(v == null ? "" : v); return /^[\d\s+\-\/.]+$/.test(v) && /\d/.test(v) ? q('="' + v + '"') : q(v); };
    var rows = [["الصورة", "نوع الوثيقة"].concat(cols).map(q).join(",")];
    docs.forEach(function (it) {
      var row = [S.items.indexOf(it) + 1, it.docType];
      cols.forEach(function (c) { var f = it.fields.filter(function (x) { return x.label === c; })[0]; row.push(f ? f.value : ""); });
      rows.push(row.map(function (v, i) { return i === 0 ? q(v) : cell(v); }).join(","));
    });
    download("Documents_" + stamp() + ".csv", rows.join("\r\n"), "text/csv");
    status("✓ نزّلت " + docs.length + " وثيقة بجدول واحد");
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
    $("ttSave").onclick = function () { download("Text_Transcription_" + stamp() + ".txt", allText(), "text/plain"); };
    $("ttCsv").onclick = saveCsv;
    $("ttClear").onclick = function () { S.items.forEach(function (it) { URL.revokeObjectURL(it.url); }); S.items = []; status(""); render(); };
    $("ttLang").addEventListener("change", function () { if (S.items.some(function (it) { return it.engine; })) status("اللغة: " + LANG_NAMES[this.value] + " — أعد التفريغ لتطبيقها"); });
    var kindHint = function () { $("ttKindHint").textContent = KIND_HINTS[$("ttKind").value]; };
    $("ttKind").addEventListener("change", function () { kindHint(); if (S.items.some(function (it) { return it.engine; })) status("أعد التفريغ بـ «دقة أعلى» لتطبيق نوع الصورة"); });
    kindHint(); render();
  }

  checkAccess().then(function () {
    $("ttGate").hidden = true; $("ttApp").hidden = false;
    wire();
  }).catch(function (e) {
    if (["no session", "session", "denied"].indexOf(e.message) < 0) $("ttGateMsg").textContent = "تعذّر تحميل الأداة: " + e.message;
  });
})();
