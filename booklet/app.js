/* Booklet Maker — a PDF as a booklet to print on both sides and fold.
   Each sheet carries four pages, two on each side, in the order that
   reads straight once the sheets are stacked and folded in the middle.
   The sheet is two pages wide (A5 pages → A4 landscape). Everything happens
   in the browser with pdf-lib: the pages are placed as they are (vector, no
   rasterising), and the file never leaves the device.
   Binding: right (Arabic: the cover is the left half of the outer sheet,
   the spine on its right) or left (English: the mirror). Print duplex,
   flipping on the short edge. */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };

  var WORKER = "https://studyzone-auth.ct-aleppo3.workers.dev";
  var TOKEN_KEY = "sz_auth_token", SLUG = "booklet-maker";
  var MM = 72 / 25.4;                    // points per millimetre
  var GUTTER_MM = 5;                     // between the two pages at the fold
  var MAX_BYTES = 200 * 1048576;
  var SHEETS = [["A3", 297, 420], ["A4", 210, 297], ["A5", 148, 210], ["A6", 105, 148], ["B4", 250, 353], ["B5", 176, 250],
                ["Letter", 215.9, 279.4], ["Legal", 215.9, 355.6], ["Tabloid", 279.4, 431.8]];

  var S = { file: null, bytes: null, pages: 0, w: 0, h: 0, busy: false };

  function status(t, err) { var e = $("bkStatus"); e.textContent = t || ""; e.className = "status" + (err ? " err" : ""); }
  function token() { try { return localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY); } catch (e) { return null; } }
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }

  /* ---------- access: the booklet-maker project; the Owner and the Comms Manager always ---------- */
  function checkAccess() {
    var t = token();
    if (!t) { location.href = "../"; return Promise.reject(new Error("no session")); }
    return fetch(WORKER + "/me", { headers: { "Authorization": "Bearer " + t } })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (r) {
        if (!r.ok || !r.d || !r.d.user) { location.href = "../"; throw new Error("session"); }
        var role = r.d.user.role, me = (r.d.projects || []).filter(function (p) { return p.slug === SLUG; })[0];
        if (role === "owner" || role === "comms") return;
        if (!me || me.status !== "ready") { $("bkGateMsg").textContent = "لا تملك صلاحية الوصول إلى هذه الأداة."; throw new Error("denied"); }
      });
  }

  /* ---------- the order ---------- */
  /* Sheet by sheet, outermost first: the front holds the last and the first
     page still free, the back the two next to them. */
  function order(n) {
    var sheets = [], lo = 1, hi = n;
    while (lo < hi) { sheets.push({ front: [hi, lo], back: [lo + 1, hi - 1] }); lo += 2; hi -= 2; }
    return sheets;
  }
  /* Which page goes in the sheet's left half and which in its right, as it
     lies flat. Left binding: the cover is the right half of the outer front
     ([4|1], inside [2|3]); right binding is its mirror ([1|4], inside [3|2]). */
  function halves(pair, rtl) {
    var a = pair[0], b = pair[1];   // front: [last, first]; back: [first+1, last-1]
    return rtl ? { left: b, right: a } : { left: a, right: b };
  }

  function paperName(wmm, hmm) {
    var a = Math.min(wmm, hmm), b = Math.max(wmm, hmm);
    var hit = SHEETS.filter(function (s) { return Math.abs(s[1] - a) < 3 && Math.abs(s[2] - b) < 3; })[0];
    return hit ? hit[0] + (wmm > hmm ? " بالعرض" : " بالطول") : Math.round(wmm) + "×" + Math.round(hmm) + " mm";
  }

  /* ---------- the file ---------- */
  function pageSize(p) {   // as shown: a page turned 90° or 270° swaps its sides
    var s = p.getSize(), r = ((p.getRotation().angle % 360) + 360) % 360;
    return r === 90 || r === 270 ? { w: s.height, h: s.width, r: r } : { w: s.width, h: s.height, r: r };
  }
  function load(f) {
    if (!f) return;
    if (!(f.type === "application/pdf" || /\.pdf$/i.test(f.name || ""))) { status("اختر ملف PDF", true); return; }
    if (f.size > MAX_BYTES) { status("الملف أكبر من " + Math.round(MAX_BYTES / 1048576) + " MB", true); return; }
    status("…جارٍ قراءة الملف");
    f.arrayBuffer().then(function (buf) {
      return PDFLib.PDFDocument.load(buf, { ignoreEncryption: true }).then(function (doc) {
        var n = doc.getPageCount(); if (!n) throw new Error("الملف ما فيه صفحات");
        var s = pageSize(doc.getPage(0));
        var mixed = doc.getPages().some(function (p) { var q = pageSize(p); return Math.abs(q.w - s.w) > 2 || Math.abs(q.h - s.h) > 2; });
        S.file = f; S.bytes = buf; S.pages = n; S.w = s.w; S.h = s.h; S.mixed = mixed;
        status(mixed ? "صفحات الملف مو كلها بنفس المقاس: كل صفحة رح تتصغّر لتساع مكان أول صفحة" : "");
        render();
        BKMock.set(buf, n, $("bkBinding").value === "right");
      });
    }).catch(function (e) {
      S.file = null; render(); BKMock.clear();
      status(/encrypt/i.test(String(e && e.message)) ? "الملف محمي بكلمة سر، افتح الحماية عنه أول" : "تعذّر فتح الملف: " + ((e && e.message) || ""), true);
    });
  }

  /* ---------- the summary and the order, drawn ---------- */
  function render() {
    var has = !!S.file;
    $("bkFileBox").hidden = !has; $("bkDrop").hidden = has; $("bkGo").disabled = !has || S.busy;
    $("bkEmpty").hidden = has; $("bkPlan").hidden = !has;
    if (!has) return;
    var padded = Math.ceil(S.pages / 4) * 4, blanks = padded - S.pages, sheets = padded / 4;
    var pw = S.w / MM, ph = S.h / MM, rtl = $("bkBinding").value === "right";
    $("bkFileName").textContent = S.file.name;
    $("bkFileMeta").textContent = S.pages + " صفحة · " + paperName(pw, ph);
    $("bkFacts").innerHTML =
      fact("الصفحات", S.pages + (blanks ? " + " + blanks + " فاضية" : "")) +
      fact("الأوراق", sheets + " ورقة، وجهين") +
      fact("مقاس الصفحة", paperName(pw, ph)) +
      fact("ورقة الطباعة", paperName(pw * 2, ph));
    var html = "";
    order(padded).forEach(function (sh, i) {
      html += '<div class="sheet"><div class="sheet-n">الورقة ' + (i + 1) + "</div>" + side("وجه", halves(sh.front, rtl), i === 0) + side("ظهر", halves(sh.back, rtl), false) + "</div>";
    });
    $("bkSheets").innerHTML = html;
    function fact(k, v) { return '<div class="fact"><span>' + esc(k) + "</span><b>" + esc(v) + "</b></div>"; }
    function side(label, h, outer) {
      return '<div class="side"><span class="side-l">' + label + '</span><div class="spread">' + pg(h.left, outer) + pg(h.right, outer) + "</div></div>";
    }
    function pg(n, outer) {
      var blank = n > S.pages, cover = outer && n === 1;
      return '<div class="pg' + (blank ? " blank" : "") + (cover ? " cover" : "") + '">' + (blank ? "فاضية" : n) + "</div>";
    }
  }

  /* ---------- the booklet ---------- */
  function build() {
    if (!S.file || S.busy) return;
    S.busy = true; render(); status("…جارٍ تجهيز الكتيّب");
    var rtl = $("bkBinding").value === "right";
    var gutter = GUTTER_MM * MM;
    var withNums = $("bkNums").checked, withFold = $("bkFold").checked;
    var PL = PDFLib, slotW = S.w, slotH = S.h, sheetW = slotW * 2;
    Promise.all([PL.PDFDocument.load(S.bytes, { ignoreEncryption: true }), PL.PDFDocument.create()]).then(function (docs) {
      var src = docs[0], out = docs[1], n = src.getPageCount(), padded = Math.ceil(n / 4) * 4;
      return out.embedPages(src.getPages()).then(function (emb) {
        return (withNums ? out.embedFont(PL.StandardFonts.Helvetica) : Promise.resolve(null)).then(function (font) {
          order(padded).forEach(function (sh) {
            ["front", "back"].forEach(function (sideName) {
              var h = halves(sh[sideName], rtl), sheet = out.addPage([sheetW, slotH]);
              place(sheet, h.left, 0, true);
              place(sheet, h.right, slotW, false);
              if (withFold) {   // short ticks at the fold, top and bottom, outside the type area
                [[slotH - 14, slotH], [0, 14]].forEach(function (y) {
                  sheet.drawLine({ start: { x: slotW, y: y[0] }, end: { x: slotW, y: y[1] }, thickness: 0.4, color: PL.rgb(0.45, 0.45, 0.45) });
                });
              }
              if (font) [[h.left, slotW / 2], [h.right, slotW * 1.5]].forEach(function (p) {
                if (p[0] > n) return;
                var t = String(p[0]), tw = font.widthOfTextAtSize(t, 7);
                sheet.drawText(t, { x: p[1] - tw / 2, y: 6, size: 7, font: font, color: PL.rgb(0.5, 0.5, 0.5) });
              });
            });
          });
          return out.save();
          /* One page into its half: as large as fits once the gutter is
             taken on the fold side, pushed to the outer edge, centred in height. */
          function place(sheet, num, x0, isLeft) {
            if (num > n) return;
            var p = src.getPage(num - 1), sz = pageSize(p), g = gutter / 2;
            var s = Math.min((slotW - g) / sz.w, slotH / sz.h), w = sz.w * s, hh = sz.h * s;
            var x = isLeft ? x0 + (slotW - g - w) : x0 + g, y = (slotH - hh) / 2;
            var e = emb[num - 1], r = sz.r;
            if (r === 0) sheet.drawPage(e, { x: x, y: y, xScale: s, yScale: s });
            else if (r === 90) sheet.drawPage(e, { x: x, y: y + hh, xScale: s, yScale: s, rotate: PL.degrees(-90) });
            else if (r === 180) sheet.drawPage(e, { x: x + w, y: y + hh, xScale: s, yScale: s, rotate: PL.degrees(180) });
            else sheet.drawPage(e, { x: x + w, y: y, xScale: s, yScale: s, rotate: PL.degrees(90) });
          }
        });
      });
    }).then(function (bytes) {
      var name = (S.file.name || "document").replace(/\.pdf$/i, "") + "_booklet.pdf";
      var url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
      var a = document.createElement("a"); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
      status("✓ تم التحميل. اطبعه على وجهين، والقلب على الحافة القصيرة (Flip on short edge)");
    }).catch(function (e) {
      status("تعذّر تجهيز الكتيّب: " + ((e && e.message) || ""), true);
    }).then(function () { S.busy = false; render(); });
  }

  /* ---------- wiring ---------- */
  function wire() {
    var drop = $("bkDrop");
    $("bkFile").addEventListener("change", function (e) { load(e.target.files[0]); e.target.value = ""; });
    ["dragenter", "dragover"].forEach(function (t) { drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.add("over"); }); });
    ["dragleave", "drop"].forEach(function (t) { drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.remove("over"); }); });
    drop.addEventListener("drop", function (e) { load(e.dataTransfer.files[0]); });
    $("bkRemove").addEventListener("click", function () { S.file = null; S.bytes = null; status(""); render(); BKMock.clear(); });
    $("bkBinding").addEventListener("change", function () { render(); BKMock.binding($("bkBinding").value === "right"); });
    $("bkGo").addEventListener("click", build);
    render();
  }

  checkAccess().then(function () { $("bkGate").hidden = true; $("bkApp").hidden = false; wire(); }, function () {});
})();
