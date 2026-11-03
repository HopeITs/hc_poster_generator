/* Flipbook — the tool page: a PDF chosen here is kept in the browser
   (IndexedDB "hc-flipbook", key "local") and shown by viewer.html, small in
   the preview and full size in a new tab. The book's direction is suggested
   from the language of its first pages; every option reloads the preview
   except the paper, which the viewer changes in place (postMessage). */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var MAX_BYTES = 200 * 1048576;
  var FX = {
    magazine: "صفحات وغلاف مرنة تنثني عند التقليب، مثل المجلات والنشرات.",
    book: "غلاف مقوّى سميك يُفتح كلوح صلب، وصفحات داخلية مرنة.",
    album: "كل الأوراق مقوّاة وسميكة تُقلَّب كألواح، مثل ألبومات الصور.",
    notebook: "حلقات معدنية على الكعب، مثل دفاتر الملاحظات والتقويمات.",
    slider: "الصفحات تنزلق أفقيًا واحدة تلو الأخرى، مناسب للعروض التقديمية.",
    cards: "الصفحات بطاقات مكدّسة، تُسحب العليا لتظهر التي تحتها.",
    coverflow: "الصفحة الحالية في المنتصف والصفحات المجاورة مائلة بشكل ثلاثي الأبعاد.",
    onepage: "صفحة واحدة تُقلَّب في كل مرة حتى على الشاشات الكبيرة."
  };

  var S = { file: null, name: "", pages: 0, stored: false, run: 0 }, pvKey = "";

  function status(t, err) { var e = $("fbStatus"); e.textContent = t || ""; e.className = "status" + (err ? " err" : ""); }
  function pagesText(n) { return n === 1 ? "صفحة واحدة" : n === 2 ? "صفحتان" : n <= 10 ? n + " صفحات" : n + " صفحة"; }

  /* ---------- the browser's copy of the file, read back by the viewer ---------- */
  function idb() {
    return new Promise(function (ok, no) {
      var r = indexedDB.open("hc-flipbook", 2);
      r.onupgradeneeded = function () { if (!r.result.objectStoreNames.contains("files")) r.result.createObjectStore("files"); };
      r.onsuccess = function () { ok(r.result); }; r.onerror = function () { no(r.error); };
    });
  }
  function idbPut(key, val) {
    return idb().then(function (db) {
      return new Promise(function (ok, no) {
        var tx = db.transaction("files", "readwrite"); tx.objectStore("files").put(val, key);
        tx.oncomplete = ok; tx.onerror = function () { no(tx.error); };
      });
    });
  }

  /* ---------- the file ---------- */
  function load(f) {
    if (!f) return;
    if (!(f.type === "application/pdf" || /\.pdf$/i.test(f.name || ""))) { status("اختر ملف PDF", true); return; }
    if (f.size > MAX_BYTES) { status("الملف أكبر من " + Math.round(MAX_BYTES / 1048576) + " MB", true); return; }
    var run = ++S.run;
    S.file = f; S.name = f.name.replace(/\.pdf$/i, ""); S.pages = 0; S.stored = false;
    $("fbSuggest").hidden = true; status("…جارٍ قراءة الملف"); render();
    idbPut("local", { name: S.name, data: f }).then(function () {
      if (run !== S.run) return;
      S.stored = true;
      pdfjsLib.GlobalWorkerOptions.workerSrc = "vendor/pdf.worker.min.js";
      return f.arrayBuffer().then(function (buf) { return pdfjsLib.getDocument({ data: new Uint8Array(buf), isEvalSupported: false }).promise; })
        .then(function (doc) {
          if (run !== S.run) { doc.destroy(); return; }
          S.pages = doc.numPages; render();
          return suggest(doc).then(function (rtl) {
            if (run === S.run && rtl != null) { $("fbDir").value = rtl ? "1" : "0"; $("fbSuggest").hidden = false; }
          }).then(function () { doc.destroy(); }, function () { doc.destroy(); });
        })
        .then(function () { if (run === S.run) { status(""); preview(); } },
              function () { if (run === S.run) { status("ما قدرنا نقرأ الملف، جرّب تفتحه", true); preview(); } });
    }, function () { if (run === S.run) status("تعذّر حفظ الملف بالمتصفح", true); });
  }
  /* Arabic letters outnumbering Latin ones in the first four pages: an Arabic book. */
  function suggest(doc) {
    var ar = 0, la = 0, p = 1, last = Math.min(4, doc.numPages);
    function next() {
      if (p > last) return Promise.resolve(ar + la > 20 ? ar > la : null);
      return doc.getPage(p++).then(function (pg) { return pg.getTextContent(); }).then(function (tc) {
        var s = tc.items.map(function (i) { return i.str; }).join(" ");
        ar += (s.match(/[؀-ۿ]/g) || []).length; la += (s.match(/[A-Za-z]/g) || []).length;
        return next();
      });
    }
    return next();
  }

  /* ---------- the viewer, small here or full size in a new tab ---------- */
  function query(embed) {
    var q = new URLSearchParams();
    if ($("fbDir").value === "1") q.set("rtl", "1");
    if ($("fbSplit").value !== "auto") q.set("split", $("fbSplit").value);
    q.set("paper", $("fbPaper").value);
    q.set("effect", $("fbEffect").value);
    if ($("fbEffect").value === "notebook") q.set("pages", $("fbNbPages").value);
    q.set("local", "1");
    if (embed) q.set("embed", "1");
    return q;
  }
  function preview() {
    if (!S.file || !S.stored) return;
    var q = query(true), fr = $("fbPv");
    var key = Array.from(q.entries()).filter(function (e) { return e[0] !== "paper"; }).map(function (e) { return e.join("="); }).join("&");
    if (key !== pvKey) { pvKey = key; fr.src = "viewer.html?" + q; }
    else if (fr.contentWindow) fr.contentWindow.postMessage({ type: "hcfb-paper", value: $("fbPaper").value }, location.origin);
  }

  function render() {
    var has = !!S.file;
    $("fbFileBox").hidden = !has; $("fbDrop").hidden = has;
    $("fbEmpty").hidden = has; $("fbPv").hidden = !has;
    $("fbOpen").disabled = !has || !S.stored;
    if (!has) { pvKey = ""; $("fbPv").src = "about:blank"; return; }
    $("fbFileName").textContent = S.file.name;
    $("fbFileMeta").textContent = S.pages ? pagesText(S.pages) : "…جارٍ القراءة";
  }
  function fx() {
    $("fbFxDesc").textContent = FX[$("fbEffect").value] || "";
    $("fbNbField").hidden = $("fbEffect").value !== "notebook";
  }

  /* ---------- wiring ---------- */
  function wire() {
    var drop = $("fbDrop");
    $("fbFile").addEventListener("change", function (e) { load(e.target.files[0]); e.target.value = ""; });
    ["dragenter", "dragover"].forEach(function (t) { drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.add("over"); }); });
    ["dragleave", "drop"].forEach(function (t) { drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.remove("over"); }); });
    drop.addEventListener("drop", function (e) { load(e.dataTransfer.files[0]); });
    $("fbRemove").addEventListener("click", function () { S.run++; S.file = null; S.stored = false; status(""); render(); });
    $("fbDir").addEventListener("change", function () { $("fbSuggest").hidden = true; preview(); });
    $("fbEffect").addEventListener("change", function () { fx(); preview(); });
    ["fbNbPages", "fbPaper", "fbSplit"].forEach(function (id) { $(id).addEventListener("change", preview); });
    $("fbOpen").addEventListener("click", function () {
      if (S.file && S.stored) window.open("viewer.html?" + query(false), "_blank", "noopener");
    });
    fx(); render();
  }

  fbAccess().then(function () { $("fbGate").hidden = true; $("fbApp").hidden = false; wire(); }, function (e) {
    if (e && e.message === "denied") $("fbGateMsg").textContent = "لا تملك صلاحية الوصول إلى هذه الأداة.";
  });
})();
