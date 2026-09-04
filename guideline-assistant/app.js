/* Guidelines Assistant — منطق الواجهة (يُحمَّل كملفّ خارجي: script-src 'self') */
(function () {
  "use strict";

  var ROLES = ["عنوان رئيسي", "عنوان فرعي", "نص", "تعداد ناعم", "تعداد خشن"];

  var fileInput  = document.getElementById("gaFile");
  var drop       = document.getElementById("gaDrop");
  var status     = document.getElementById("gaStatus");
  var reviewCard = document.getElementById("gaReviewCard");
  var reviewBox  = document.getElementById("gaReview");
  var reviewSub  = document.getElementById("gaReviewSub");
  var genBtn     = document.getElementById("gaGenerate");
  var genStatusEl= document.getElementById("gaGenStatus");
  var govAll     = document.getElementById("gaGovAll");

  var lastBlocks = null;
  var paraEditors = [];

  function setStatus(html, isErr) {
    status.innerHTML = html;
    status.className = "status" + (isErr ? " err" : "");
  }
  function genStatus(html, isErr) {
    genStatusEl.innerHTML = html;
    genStatusEl.className = "status" + (isErr ? " err" : "");
  }

  /* ---------------- المعالجة (رفع → قراءة → تصحيح → تصنيف) ---------------- */
  function process(file) {
    if (!file) return;
    reviewCard.hidden = true;
    setStatus('<span class="spinner"></span> جارٍ قراءة الملفّ ومعالجته…', false);

    var fd = new FormData();
    fd.append("file", file);

    fetch("api/process.php", { method: "POST", body: fd })
      .then(function (r) { return r.json().catch(function () { return { ok: false, error: "ردّ غير صالح من الخادم" }; }); })
      .then(function (d) {
        if (!d.ok) { setStatus("تعذّرت المعالجة: " + (d.error || ""), true); return; }
        setStatus("تمّت المعالجة — راجِع النتيجة وعدّل قبل التوليد.", false);
        renderReview(d);
      })
      .catch(function () { setStatus("تعذّر الاتصال بالخادم.", true); });
  }

  function roleSelect(current) {
    var sel = document.createElement("select");
    sel.className = "rev-role";
    ROLES.forEach(function (r) {
      var o = document.createElement("option");
      o.value = r; o.textContent = r;
      if (r === current) o.selected = true;
      sel.appendChild(o);
    });
    return sel;
  }

  function renderReview(d) {
    reviewBox.innerHTML = "";
    lastBlocks = d.blocks || [];
    paraEditors = [];

    lastBlocks.forEach(function (b) {
      var row = document.createElement("div");
      if (b.type === "table") {
        row.className = "rev-row tbl";
        var tag = document.createElement("span");
        tag.className = "rev-tag"; tag.textContent = "جدول";
        var wrap = document.createElement("div");
        wrap.className = "rev-tblwrap";
        var tbl = document.createElement("table");
        tbl.className = "rev-tbl";
        (b.rows || []).forEach(function (cells) {
          var tr = document.createElement("tr");
          cells.forEach(function (c) {
            var td = document.createElement("td");
            td.textContent = c;
            tr.appendChild(td);
          });
          tbl.appendChild(tr);
        });
        wrap.appendChild(tbl);
        row.appendChild(tag);
        row.appendChild(wrap);
      } else {
        row.className = "rev-row";
        var sel = roleSelect(b.role || "نص");
        var ta = document.createElement("textarea");
        ta.className = "rev-text";
        ta.rows = 1;
        ta.value = b.text || "";
        setTimeout(function () { ta.style.height = "auto"; ta.style.height = (ta.scrollHeight + 2) + "px"; }, 0);
        ta.addEventListener("input", function () { ta.style.height = "auto"; ta.style.height = (ta.scrollHeight + 2) + "px"; });
        row.appendChild(sel);
        row.appendChild(ta);
        paraEditors.push({ block: b, sel: sel, ta: ta });
      }
      reviewBox.appendChild(row);
    });

    var s = d.stats || {};
    reviewSub.textContent = "المصدر: " + (d.source || "") + " · " + (s.paragraphs || 0) + " فقرة · " + (s.tables || 0) + " جدول";
    genStatus("");
    reviewCard.hidden = false;
    reviewCard.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  /* ---------------- التوليد (Word/PDF على ترويسة المحافظة) ---------------- */
  function checkedValues(sel) {
    return Array.prototype.map.call(document.querySelectorAll(sel + ":checked"), function (x) { return x.value; });
  }

  function parseFilename(res, fallback) {
    var cd = res.headers.get("Content-Disposition") || "";
    var m = /filename\*=UTF-8''([^;]+)/i.exec(cd);
    if (m) { try { return decodeURIComponent(m[1]); } catch (e) {} }
    var m2 = /filename="?([^";]+)"?/i.exec(cd);
    return (m2 && m2[1]) || fallback;
  }

  function download(blob, name) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = name || "document";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
  }

  function generate() {
    if (!lastBlocks) return;
    // زامن تعديلات المراجعة
    paraEditors.forEach(function (e) { e.block.role = e.sel.value; e.block.text = e.ta.value; });

    var govs = (govAll && govAll.checked) ? ["all"] : checkedValues(".ga-gov");
    var formats = checkedValues(".ga-fmt");
    if (!govs.length) { genStatus("اختر محافظة واحدة على الأقل.", true); return; }
    if (!formats.length) { genStatus("اختر صيغة إخراج واحدة على الأقل.", true); return; }

    genBtn.disabled = true;
    genStatus('<span class="spinner"></span> جارٍ التوليد…');

    fetch("api/generate.php", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ blocks: lastBlocks, govs: govs, formats: formats })
    })
      .then(function (res) {
        if (!res.ok) {
          return res.json().then(function (d) { throw new Error(d.error || "فشل التوليد"); },
                                 function () { throw new Error("فشل التوليد"); });
        }
        var name = parseFilename(res, "Guidelines");
        return res.blob().then(function (b) { download(b, name); });
      })
      .then(function () { genBtn.disabled = false; genStatus("تمّ التوليد — نزّل الملفّ ✓"); })
      .catch(function (err) { genBtn.disabled = false; genStatus(err.message || "فشل التوليد", true); });
  }

  if (genBtn) genBtn.addEventListener("click", generate);

  // «كل المحافظات» يعطّل الاختيار الفرديّ
  if (govAll) {
    govAll.addEventListener("change", function () {
      document.querySelectorAll(".ga-gov").forEach(function (x) {
        x.disabled = govAll.checked;
        if (govAll.checked) x.checked = false;
        x.closest(".chk").style.opacity = govAll.checked ? ".5" : "";
      });
    });
  }

  /* ---------------- ربط عناصر الرفع ---------------- */
  if (fileInput) {
    fileInput.disabled = false;
    fileInput.addEventListener("change", function () {
      if (fileInput.files && fileInput.files[0]) process(fileInput.files[0]);
    });
  }
  if (drop) {
    ["dragenter", "dragover"].forEach(function (ev) {
      drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add("over"); });
    });
    ["dragleave", "drop"].forEach(function (ev) {
      drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove("over"); });
    });
    drop.addEventListener("drop", function (e) {
      var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) process(f);
    });
  }
})();
