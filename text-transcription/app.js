/* Text Transcription — the text in images and PDF files, as editable text.
   «تفريغ النص» sends them to Gemini through the auth Worker
   (/transcribe/images): images scaled down to GEM_SIDE in batches of
   GEM_BATCH, each PDF as it is in a request of its own (Gemini reads its
   pages, text or scan); all deleted from Google once read.
   Image type: plain text, a card or document (ID, passport, certificate…), or
   an invoice for the accounting team. A document or invoice comes back as its
   fields — label and value, both editable — with the full text folded below.
   Nothing is stored: everything stays in the page until it is closed.
   Copy all, download a .txt, or download every document as one CSV sheet
   (a row per image, a column per field label) that opens in Excel. */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };

  var WORKER = "https://studyzone-auth.ct-aleppo3.workers.dev";
  var TOKEN_KEY = "sz_auth_token", SLUG = "text-transcription";
  var GEM_SIDE = 2400, GEM_BATCH = 6, GEM_MAX_BYTES = 30 * 1048576;
  var LANG_NAMES = { "ara+eng": "عربي وإنكليزي", ara: "عربي", eng: "English" };
  var KIND_HINTS = {
    text: "النص كما هو، بفقراته وأسطره",
    doc: "كل صورة وثيقة: الاسم، تاريخ الولادة، الرقم… كل معلومة بخانة",
    invoice: "تاريخ الفاتورة، رقمها، تفاصيلها بالإنكليزي والمبلغ الإجمالي، مع النص الكامل — و«تنزيل Excel» بيعطي جدول الفواتير"
  };

  var S = { items: [], busy: false, docOk: false }, nextId = 1;

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
  function isPdfFile(f) { return f.type === "application/pdf" || /\.pdf$/i.test(f.name || ""); }
  function addFiles(files) {
    var all = [].slice.call(files || []), list = all.filter(function (f) { return /^image\//.test(f.type) || isPdfFile(f); });
    if (!list.length) { status("اختر صوراً (JPG أو PNG أو WEBP) أو ملفات PDF", true); return; }
    var big = list.filter(function (f) { return isPdfFile(f) && f.size > GEM_MAX_BYTES; });
    list = list.filter(function (f) { return big.indexOf(f) < 0; });
    list.forEach(function (f) {
      S.items.push({ id: nextId++, file: f, url: URL.createObjectURL(f), name: f.name || "image", pdf: isPdfFile(f), text: "", engine: "", state: "", err: "",
                     docType: "", fields: [], ver: 0 });
    });
    status(big.length ? "ملف PDF أكبر من " + Math.round(GEM_MAX_BYTES / 1048576) + " MB ما انضاف: " + big.map(function (f) { return f.name; }).join("، ") : "", !!big.length);
    render();
  }
  function loadImage(it) {
    if (it.img) return Promise.resolve(it.img);
    return new Promise(function (res, rej) {
      var im = new Image(); im.onload = function () { it.img = im; res(im); }; im.onerror = function () { rej(new Error("تعذّر فتح الصورة")); }; im.src = it.url;
    });
  }
  /* Invisible direction marks travel with copied text; out they go, with
     stray spaces and blank runs. */
  function clean(t) {
    return String(t || "").replace(/[‎‏‪-‮]/g, "").split("\n").map(function (l) { return l.replace(/\s+$/, "").replace(/^\s+/, ""); })
      .join("\n").replace(/\n{3,}/g, "\n\n").trim();
  }
  function isDoc(it) { return it.fields.length > 0; }

  /* ---------- results ---------- */
  function render() {
    var box = $("ttItems"); box.innerHTML = "";
    if (!S.items.length) box.innerHTML = '<div class="empty">لا صور بعد — أضف صوراً من اليمين،<br>ثم اضغط «تفريغ النص»</div>';
    S.items.forEach(function (it, i) {
      var el = document.createElement("div"); el.className = "item"; it.el = el; it.shown = -1;
      el.innerHTML = '<div class="pic"><img alt=""><span class="num">' + (i + 1) + '</span></div>' +
        '<div class="body"><div class="meta"></div><div class="out"></div>' +
        '<div class="tools"><button type="button" class="btn-line" data-a="copy">نسخ</button><button type="button" class="btn-line" data-a="gem">تفريغ هالصورة</button><button type="button" class="btn-line" data-a="del">حذف</button></div></div>';
      if (it.pdf) {   // no preview of a PDF's pages here: a tile with its name, opening the file itself
        var pic = el.querySelector(".pic"); pic.querySelector("img").remove();
        var tile = document.createElement("button"); tile.type = "button"; tile.className = "pdf"; tile.title = "فتح الملف";
        tile.innerHTML = '<b>PDF</b><span></span>'; tile.querySelector("span").textContent = it.name;
        tile.onclick = function () { window.open(it.url, "_blank", "noopener"); };
        pic.insertBefore(tile, pic.firstChild);
      } else { var img = el.querySelector("img"); img.src = it.url; img.onclick = function () { zoom(it.url); }; }
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
      var multi = /\n/.test(f.value) || f.value.length > 70;   // an invoice's item list, one per line
      tr.innerHTML = '<td class="l"><input dir="auto" aria-label="الخانة"></td><td>' + (multi ? '<textarea dir="auto" aria-label="القيمة"></textarea>' : '<input dir="auto" aria-label="القيمة">') +
        '</td><td class="c"><button type="button">نسخ</button></td>';
      var ins = tr.querySelectorAll("input, textarea"); ins[0].value = f.label; ins[1].value = f.value;
      if (multi) ins[1].rows = Math.min(8, f.value.split("\n").length + 1);
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
    else if (it.engine === "gemini") h = '<span class="tag gem">تم التفريغ</span>' + (isDoc(it) ? "<span>" + (it.docType === "فاتورة" ? "فاتورة" : "وثيقة") + " · " + it.fields.length + " خانة</span>" : "");
    else h = "<span>بانتظار التفريغ</span>";
    m.innerHTML = h;
    if (it.shown !== it.ver) { out(it); it.shown = it.ver; }
    it.el.querySelector('[data-a="gem"]').disabled = S.busy;
  }
  function buttons() {
    var n = S.items.length, any = S.items.some(function (it) { return it.text.trim() || isDoc(it); });
    $("ttGemini").disabled = !n || S.busy;
    $("ttCopyAll").disabled = $("ttSave").disabled = !any;
    $("ttCsv").disabled = !S.items.some(isDoc);
    $("ttClear").disabled = !n || S.busy;
    $("ttCount").textContent = n ? "· " + n + " ملف" : "";
    S.items.forEach(function (it) { if (it.el) it.el.querySelector('[data-a="gem"]').disabled = S.busy; });
  }
  function zoom(url) {
    var z = document.createElement("div"); z.className = "zoom"; z.innerHTML = '<img alt="">'; z.querySelector("img").src = url;
    z.onclick = function () { z.remove(); }; document.body.appendChild(z);
  }
  function busy(on) { S.busy = on; buttons(); if (!on) bar(null); }

  /* ---------- Gemini ---------- */
  /* At most GEM_SIDE on the long side, as JPEG on white: small enough to send,
     sharp enough for small print. */
  function shrink(it) {
    if (it.pdf) return Promise.resolve(it.file);   // a PDF goes as it is: Gemini reads its pages
    return loadImage(it).then(function (im) {
      var w = im.naturalWidth, h = im.naturalHeight, k = Math.min(1, GEM_SIDE / Math.max(w, h));
      var c = document.createElement("canvas"); c.width = Math.round(w * k); c.height = Math.round(h * k);
      var g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); g.drawImage(im, 0, 0, c.width, c.height);
      return new Promise(function (res) { c.toBlob(res, "image/jpeg", 0.9); });
    });
  }
  /* Body: [4-byte JSON length][JSON {lang, mode, sizes, mimes}][the JPEGs or PDF back to back] —
     the Worker hands the bytes on to Gemini as they are. The answer streams
     (spaces while Gemini reads, then the JSON). */
  function askGemini(blobs, lang, mode, group) {
    var meta = new TextEncoder().encode(JSON.stringify({ lang: lang, mode: mode, sizes: blobs.map(function (b) { return b.size; }),
      mimes: group.map(function (it) { return it.pdf ? "application/pdf" : "image/jpeg"; }) }));
    var hdr = new Uint8Array(4); new DataView(hdr.buffer).setUint32(0, meta.length);
    return fetch(WORKER + "/transcribe/images", { method: "POST", headers: { "Authorization": "Bearer " + token(), "Content-Type": "application/octet-stream" },
      body: new Blob([hdr, meta].concat(blobs)) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { if (!r.ok || d.error) throw new Error(d.error || "HTTP " + r.status); return d; }); });
  }
  /* Cards and documents carry personal data: say once per visit where the
     images go before any of them leaves the device for Gemini. A box in the
     page, not confirm(): some browsers (and embedded ones) suppress native
     dialogs and answer "no" without showing anything. Resolves true or false. */
  function docConsent(mode) {
    if (mode === "text" || S.docOk) return Promise.resolve(true);
    return new Promise(function (done) {
      var a = document.createElement("div"); a.className = "ask";
      a.innerHTML = '<div class="box" role="dialog" aria-modal="true" aria-labelledby="ttAskT"><h2 id="ttAskT">قبل الإرسال لـ Gemini</h2>' +
        "<p>الصور رح تنقرأ عند Google (Gemini) وبتنحذف من عندهم مباشرة بعد القراءة. الأداة ما بتخزّن لا الصور ولا المعلومات — كل شي بيضل بهالصفحة لحد ما تسكّرها.</p>" +
        "<p>إذا فيها بطاقات أو وثائق شخصية، تأكد إنه مسموح ترفعها لخدمة خارجية.</p>" +
        '<div class="row"><button type="button" class="btn" data-ok="1">متابعة</button><button type="button" class="btn-line" data-ok="0">إلغاء</button></div></div>';
      function close(ok) { document.removeEventListener("keydown", key); a.remove(); if (ok) S.docOk = true; done(ok); }
      function key(e) { if (e.key === "Escape") close(false); }
      a.addEventListener("click", function (e) { var b = e.target.closest("[data-ok]"); if (b) close(b.dataset.ok === "1"); else if (e.target === a) close(false); });
      document.addEventListener("keydown", key);
      document.body.appendChild(a); a.querySelector('[data-ok="1"]').focus();
    });
  }
  function runGemini(list) {
    list = list || S.items.slice(); if (!list.length || S.busy) return;
    var mode = $("ttKind").value;
    docConsent(mode).then(function (ok) { if (ok) sendGemini(list, mode); else status("ما انبعت شي — اضغط «متابعة» بالنافذة لترسل الصور"); });
  }
  function sendGemini(list, mode) {
    var lang = $("ttLang").value, batches = [];
    // images in batches of GEM_BATCH; a PDF alone, so a long one has the whole answer to itself
    list.forEach(function (it) {
      var last = batches[batches.length - 1];
      if (!it.pdf && last && !last[0].pdf && last.length < GEM_BATCH) last.push(it); else batches.push([it]);
    });
    busy(true); bar(0);
    var done = 0, failed = 0, docs = 0;
    function next(b) {
      if (b >= batches.length) return Promise.resolve();
      var group = batches[b];
      group.forEach(function (it) { it.state = "busy"; paint(it); });
      status("…جارٍ تفريغ " + (list.length > 1 ? "الملفات " + (done + 1) + (group.length > 1 ? "–" + (done + group.length) : "") + " من " + list.length : group[0].pdf ? "ملف PDF" : "الصورة") +
             (group[0].pdf ? " — الملفات الطويلة بتاخد وقت أطول" : ""));
      return Promise.all(group.map(shrink)).then(function (blobs) {
        if (blobs.reduce(function (s, x) { return s + x.size; }, 0) > GEM_MAX_BYTES) throw new Error("الصور كبيرة كتير مع بعض");
        return askGemini(blobs, lang, mode, group);
      }).then(function (d) {
        group.forEach(function (it, i) {
          var r = (d.images || [])[i] || { text: (d.texts || [])[i] || "", fields: [] };
          it.text = clean(r.text); it.fields = (r.fields || []).map(function (f) { return { label: f.label, value: f.value }; }); it.docType = r.docType || "";
          it.engine = "gemini"; it.state = ""; it.ver++;
          if (isDoc(it)) docs++;
        });
      }, function (e) {
        failed += group.length;
        group.forEach(function (it) { it.state = "error"; it.err = e && e.message || String(e); });
      }).then(function () { group.forEach(paint); done += group.length; bar(done / list.length); return next(b + 1); });
    }
    next(0).then(function () {
      status(failed ? "ما قدرت فرّغ " + failed + " صورة — شوف السبب جنبها"
                    : mode === "invoice" ? "✓ تم تفريغ " + list.length + " فاتورة — راجع الخانات، و«تنزيل Excel» بيعطيك جدولها"
                    : "✓ تم تفريغ " + list.length + (list.every(function (it) { return it.pdf; }) ? " ملف PDF" : list.some(function (it) { return it.pdf; }) ? " ملف" : " صورة") +
                      (docs ? " · " + docs + " منها وثائق مقسومة لخانات" : ""), !!failed);
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
    var bills = docs.every(function (it) { return it.docType === "فاتورة"; });
    download((bills ? "Invoices_" : "Documents_") + stamp() + ".csv", rows.join("\r\n"), "text/csv");
    status("✓ نزّلت " + docs.length + (bills ? " فاتورة" : " وثيقة") + " بجدول واحد");
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
    $("ttGemini").onclick = function () { runGemini(); };
    $("ttCopyAll").onclick = function () { copy(allText(), "✓ نسخت كل النصوص"); };
    $("ttSave").onclick = function () { download("Text_Transcription_" + stamp() + ".txt", allText(), "text/plain"); };
    $("ttCsv").onclick = saveCsv;
    $("ttClear").onclick = function () { S.items.forEach(function (it) { URL.revokeObjectURL(it.url); }); S.items = []; status(""); render(); };
    $("ttLang").addEventListener("change", function () { if (S.items.some(function (it) { return it.engine; })) status("اللغة: " + LANG_NAMES[this.value] + " — أعد التفريغ لتطبيقها"); });
    var kindHint = function () { $("ttKindHint").textContent = KIND_HINTS[$("ttKind").value]; };
    $("ttKind").addEventListener("change", function () { kindHint(); if (S.items.some(function (it) { return it.engine; })) status("اضغط «تفريغ النص» من جديد لتطبيق نوع الصورة"); });
    kindHint(); render();
  }

  checkAccess().then(function () {
    $("ttGate").hidden = true; $("ttApp").hidden = false;
    wire();
  }).catch(function (e) {
    if (["no session", "session", "denied"].indexOf(e.message) < 0) $("ttGateMsg").textContent = "تعذّر تحميل الأداة: " + e.message;
  });
})();
