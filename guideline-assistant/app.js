/* Guidelines Assistant — منطق الواجهة (يُحمَّل كملفّ خارجي: script-src 'self') */
(function () {
  "use strict";

  var ROLES = ["عنوان رئيسي", "عنوان فرعي", "نص", "تعداد ناعم", "تعداد خشن"];

  var fileInput = document.getElementById("gaFile");
  var drop      = document.getElementById("gaDrop");
  var status    = document.getElementById("gaStatus");
  var reviewCard= document.getElementById("gaReviewCard");
  var reviewBox = document.getElementById("gaReview");
  var reviewSub = document.getElementById("gaReviewSub");

  function setStatus(html, isErr) {
    status.innerHTML = html;
    status.className = "status" + (isErr ? " err" : "");
  }

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
    var blocks = d.blocks || [];

    blocks.forEach(function (b) {
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
        // ارتفاع تلقائي بسيط
        setTimeout(function () { ta.style.height = "auto"; ta.style.height = (ta.scrollHeight + 2) + "px"; }, 0);
        ta.addEventListener("input", function () { ta.style.height = "auto"; ta.style.height = (ta.scrollHeight + 2) + "px"; });
        row.appendChild(sel);
        row.appendChild(ta);
      }
      reviewBox.appendChild(row);
    });

    var s = d.stats || {};
    reviewSub.textContent = "المصدر: " + (d.source || "") + " · " + (s.paragraphs || 0) + " فقرة · " + (s.tables || 0) + " جدول";
    reviewCard.hidden = false;
    reviewCard.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  /* ربط عناصر الرفع */
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
