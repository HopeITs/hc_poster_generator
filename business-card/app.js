/* Business Card Maker — the page. The card's details come from the staff
   sheet through the Worker (GET /cards/me: the signed-in person's row, and for
   the Owner and the Comms Manager the list of staff to pick from, then
   /cards/staff?email=), and every field can be changed for this card only.
   The card shows on the designer's mockup (the PSD's photo without its sample
   cards, assets/mockup-base.jpg, with each side laid into its corner points and
   multiplied, so the photo's light and shadows stay on it) or flat, front or
   back. The download is the print file: the InDesign front page without its
   words (assets/print-front.pdf) with this card's words set 24 times over it
   by pdfkit, in CMYK and Somar Sans, then the InDesign back page as it is. */
(function () {
  "use strict";
  var WORKER = "https://studyzone-auth.ct-aleppo3.workers.dev", TOKEN_KEY = "sz_auth_token", SLUG = "business-card";
  var B = window.BCard, $ = function (id) { return document.getElementById(id); };
  var FIELDS = ["name", "title", "phone", "city", "street", "email"];
  var S = { card: blank(), sheet: null, view: "mock", staff: [], busy: false, img: {}, mock: null, lay: null };
  var PX = 4;   // canvas pixels per point for the card sides (962 × 565)

  var WEB = "www.hcsyria.org";   // the organisation's site, the same on every card
  function blank() { return { name: "", title: "", phone: "", city: "Aleppo", street: "", email: "", web: WEB }; }
  function token() { try { return localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY); } catch (e) { return null; } }
  function myEmail() { try { var m = JSON.parse(localStorage.getItem("hc_me") || sessionStorage.getItem("hc_me") || "null"); return (m && m.user && m.user.email) || ""; } catch (e) { return ""; } }
  function status(t, err) { $("bcStatus").textContent = t || ""; $("bcStatus").className = "status" + (err ? " err" : ""); }
  function api(path) {
    return fetch(WORKER + path, { headers: { "Authorization": "Bearer " + token() } }).then(function (r) { return r.json().then(function (d) { if (!r.ok) throw new Error(d.error || "HTTP " + r.status); return d; }); });
  }
  function loadImg(src) { return new Promise(function (ok, no) { var im = new Image(); im.onload = function () { ok(im); }; im.onerror = function () { no(new Error("تعذّر تحميل " + src)); }; im.src = src; }); }

  /* ---------- the form ---------- */
  function fill(c) {
    S.card = Object.assign(blank(), c || {}); S.card.web = WEB;
    FIELDS.forEach(function (k) {
      var el = $("bc" + k[0].toUpperCase() + k.slice(1));
      if (k === "city" && S.card.city && ![].some.call(el.options, function (o) { return o.value === S.card.city; })) el.add(new Option(S.card.city, S.card.city));
      el.value = S.card[k] || "";
    });
    $("bcReset").disabled = !S.sheet;
    draw();
  }
  function source(kind) {
    var n = $("bcSrc"), ok = kind === "sheet";
    n.hidden = false; n.className = "note" + (ok ? "" : " warn");
    n.innerHTML = (ok ? '<svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#1a8a4a" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>'
                      : '<svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#b26a00" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5v.01"/></svg>') +
      "<span>" + ({ sheet: "تعبّت المعلومات من جدول الموظفين. فيك تعدّلها لهالكرت بس، والجدول ما بيتغيّر",
                    missing: "ما لقينا هالإيميل بجدول الموظفين، عبّي المعلومات بإيدك",
                    off: "جدول الموظفين لسا ما انربط، عبّي المعلومات بإيدك",
                    archive: "انفتح من الأرشيف" })[kind] + "</span>";
  }

  /* ---------- checks before the download ---------- */
  function checks() {
    var c = S.card, out = [], digits = String(c.phone || "").replace(/\D/g, "");
    out.push(c.name.trim() ? ["ok", "الاسم موجود"] : ["bad", "اكتب الاسم"]);
    out.push(!c.phone.trim() ? ["bad", "اكتب رقم الهاتف"] : /^\+?[\d ]+$/.test(c.phone.trim()) && digits.length >= 9 && digits.length <= 15 ? ["ok", "رقم الهاتف بصيغة صحيحة"] : ["bad", "رقم الهاتف لازم يكون أرقام ومسافات بس، متل ‎+963 993 360 492"]);
    out.push(/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c.email.trim()) ? ["ok", "الإيميل صحيح"] : ["bad", "الإيميل مو صحيح"]);
    (S.lay ? S.lay.shrunk : []).forEach(function (w) { out.push(["warn", w + " أطول من مكانه، صغّرنا الخط شوي"]); });
    $("bcChecks").innerHTML = out.map(function (x) { return '<li class="' + x[0] + '"><i aria-hidden="true">' + (x[0] === "ok" ? "✓" : "!") + "</i>" + x[1] + "</li>"; }).join("");
    $("bcPhone").classList.toggle("bad", out[1][0] === "bad"); $("bcEmail").classList.toggle("bad", out[2][0] === "bad");
    var bad = out.some(function (x) { return x[0] === "bad"; });
    $("bcPdf").disabled = bad || S.busy; $("bcSave").disabled = bad;
    return !bad;
  }

  /* ---------- the card on a canvas ---------- */
  var mctx = document.createElement("canvas").getContext("2d");
  function sideFront() {
    var c = document.createElement("canvas"); c.width = Math.round(B.W * PX); c.height = Math.round(B.H * PX);
    var g = c.getContext("2d"); g.drawImage(S.img.front, 0, 0, c.width, c.height);
    B.drawCanvas(g, S.lay, PX, 0, 0); return c;
  }
  function sideBack() {
    var c = document.createElement("canvas"); c.width = Math.round(B.W * PX); c.height = Math.round(B.H * PX);
    c.getContext("2d").drawImage(S.img.back, 0, 0, c.width, c.height); return c;
  }

  /* A side laid into four corner points: the rectangle split into a grid, each
     cell's two triangles drawn with the affine map of their corners under the
     perspective (homography) that takes the rectangle to the quad. */
  function homography(q) {
    var x0 = q[0][0], y0 = q[0][1], x1 = q[1][0], y1 = q[1][1], x2 = q[2][0], y2 = q[2][1], x3 = q[3][0], y3 = q[3][1];
    var dx1 = x1 - x2, dx2 = x3 - x2, dy1 = y1 - y2, dy2 = y3 - y2, sx = x0 - x1 + x2 - x3, sy = y0 - y1 + y2 - y3;
    var den = dx1 * dy2 - dx2 * dy1, g = (sx * dy2 - dx2 * sy) / den, h = (dx1 * sy - sx * dy1) / den;
    var a = x1 - x0 + g * x1, b = x3 - x0 + h * x3, d = y1 - y0 + g * y1, e = y3 - y0 + h * y3;
    return function (u, v) { var w = g * u + h * v + 1; return [(a * u + b * v + x0) / w, (d * u + e * v + y0) / w]; };
  }
  function tri(g, img, s, d) {
    var x0 = s[0][0], y0 = s[0][1], x1 = s[1][0], y1 = s[1][1], x2 = s[2][0], y2 = s[2][1];
    var den = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0); if (!den) return;
    var a = ((d[1][0] - d[0][0]) * (y2 - y0) - (d[2][0] - d[0][0]) * (y1 - y0)) / den;
    var b = ((d[1][1] - d[0][1]) * (y2 - y0) - (d[2][1] - d[0][1]) * (y1 - y0)) / den;
    var c = ((d[2][0] - d[0][0]) * (x1 - x0) - (d[1][0] - d[0][0]) * (x2 - x0)) / den;
    var e = ((d[2][1] - d[0][1]) * (x1 - x0) - (d[1][1] - d[0][1]) * (x2 - x0)) / den;
    var cx = (d[0][0] + d[1][0] + d[2][0]) / 3, cy = (d[0][1] + d[1][1] + d[2][1]) / 3;
    g.save(); g.beginPath();
    d.forEach(function (p, i) {   // 1.5 px larger all round: neighbours overlap, so no seam shows between them
      var dx = p[0] - cx, dy = p[1] - cy, l = Math.sqrt(dx * dx + dy * dy) || 1, px = p[0] + dx / l * 1.5, py = p[1] + dy / l * 1.5;
      i ? g.lineTo(px, py) : g.moveTo(px, py);
    });
    g.closePath(); g.clip();
    g.setTransform(a, b, c, e, d[0][0] - a * x0 - c * y0, d[0][1] - b * x0 - e * y0);
    g.drawImage(img, 0, 0); g.restore();
  }
  function warp(g, img, q, inset) {
    var H = homography(q), N = 14, w = img.width, h = img.height, i, j;
    var cw = (w - 2 * inset) / N, ch = (h - 2 * inset) / N;
    for (j = 0; j < N; j++) for (i = 0; i < N; i++) {
      var s00 = [inset + i * cw, inset + j * ch], s10 = [inset + (i + 1) * cw, inset + j * ch], s01 = [inset + i * cw, inset + (j + 1) * ch], s11 = [inset + (i + 1) * cw, inset + (j + 1) * ch];
      var d00 = H(i / N, j / N), d10 = H((i + 1) / N, j / N), d01 = H(i / N, (j + 1) / N), d11 = H((i + 1) / N, (j + 1) / N);
      tri(g, img, [s00, s10, s11], [d00, d10, d11]); tri(g, img, [s00, s11, s01], [d00, d11, d01]);
    }
  }
  function quadPath(g, q) { g.moveTo(q[0][0], q[0][1]); for (var i = 1; i < 4; i++) g.lineTo(q[i][0], q[i][1]); g.closePath(); }
  /* The quad pushed out from its middle by px pixels. */
  function grow(q, px) {
    var cx = (q[0][0] + q[1][0] + q[2][0] + q[3][0]) / 4, cy = (q[0][1] + q[1][1] + q[2][1] + q[3][1]) / 4;
    return q.map(function (p) { var dx = p[0] - cx, dy = p[1] - cy, l = Math.sqrt(dx * dx + dy * dy) || 1; return [p[0] + dx / l * px, p[1] + dy / l * px]; });
  }
  /* Each side is laid on a layer of its own first, and the layer multiplied onto
     the photo once: the triangles' overlaps would show as lines if each one were
     multiplied. The back stops a little short of the front card's edge, so none
     of its red shows along it. */
  function drawMock(cv, front, back) {
    var m = S.mock, g = cv.getContext("2d"); cv.width = m.w; cv.height = m.h;
    g.drawImage(S.img.mock, 0, 0, m.w, m.h);
    var inset = 0.6 * PX;   // the cut frame stays off the photo
    [[back, m.bottom, true], [front, m.top, false]].forEach(function (s) {
      var lay = document.createElement("canvas"); lay.width = m.w; lay.height = m.h;
      var l = lay.getContext("2d");
      l.beginPath(); quadPath(l, s[1]); l.clip();   // nothing outside the card's own corners
      if (s[2]) { l.beginPath(); l.rect(0, 0, m.w, m.h); quadPath(l, grow(m.top, 3)); l.clip("evenodd"); }
      warp(l, s[0], s[1], inset);
      g.globalCompositeOperation = "multiply"; g.drawImage(lay, 0, 0);
    });
    g.globalCompositeOperation = "source-over";
  }

  var timer = 0;
  function draw() {
    clearTimeout(timer);
    timer = setTimeout(function () {
      if (!S.img.front) return;
      S.lay = B.layout(S.card, B.measurer(mctx));
      checks();
      var front = sideFront(), back = sideBack(), cv = $("bcCanvas"), st = $("bcStage");
      st.classList.toggle("flat", S.view !== "mock");
      if (S.view === "mock") drawMock(cv, front, back);
      else { var src = S.view === "front" ? front : back; cv.width = src.width; cv.height = src.height; cv.getContext("2d").drawImage(src, 0, 0); }
      sheet($("bcSheetF"), front, "#ffffff"); sheet($("bcSheetB"), back, "#be1f24");
    }, 60);
  }
  function sheet(cv, side, bg) {
    var g = cv.getContext("2d"), k = cv.width / B.SHEET.w;
    g.fillStyle = bg; g.fillRect(0, 0, cv.width, cv.height);
    B.SHEET.cards.forEach(function (p) { g.drawImage(side, p[0] * k, p[1] * k, B.W * k, B.H * k); });
  }

  /* ---------- the print file ---------- */
  var loading = {};
  function need(src) {
    return loading[src] || (loading[src] = new Promise(function (ok, no) {
      var sc = document.createElement("script"); sc.src = src; sc.onload = ok;
      sc.onerror = function () { delete loading[src]; no(new Error("تعذّر تحميل " + src)); };
      document.head.appendChild(sc);
    }));
  }
  function bytes(url) { return fetch(url).then(function (r) { if (!r.ok) throw new Error("تعذّر تحميل " + url); return r.arrayBuffer(); }); }
  /* The words of 24 cards on an A3 page of their own, in Somar Sans and K 90. */
  function textPage() {
    var faces = Object.keys(B.FONT).map(function (w) { return bytes("../guideline-assistant/fonts/" + B.FONT[w] + ".otf").then(function (b) { return [B.FONT[w], b]; }); });
    return Promise.all(faces).then(function (fs) {
      return new Promise(function (ok, no) {
        var doc = new PDFDocument({ size: [B.SHEET.w, B.SHEET.h], margin: 0, autoFirstPage: true }), parts = [];
        fs.forEach(function (f) { doc.registerFont(f[0], f[1]); });
        doc.on("data", function (c) { parts.push(c); });
        doc.on("end", function () { new Blob(parts).arrayBuffer().then(ok, no); });
        doc.on("error", no);
        B.SHEET.cards.forEach(function (p) { B.drawPdf(doc, S.lay, p[0], p[1]); });
        doc.end();
      });
    });
  }
  function fileName() { return "Business card - " + (S.card.name.trim() || "Hope Center").replace(/[\\/:*?"<>|]+/g, "").slice(0, 60) + ".pdf"; }
  function exportPdf() {
    if (S.busy || !checks()) return;
    S.busy = true; $("bcPdf").disabled = true; status("…جارٍ تجهيز ملف الطباعة");
    Promise.all([need("vendor/pdfkit.min.js"), need("../vendor/pdf-lib.min.js")])
      .then(function () { return Promise.all([textPage(), bytes("assets/print-front.pdf"), bytes("assets/print-back.pdf")]); })
      .then(function (r) {
        var P = PDFLib.PDFDocument;
        return Promise.all([P.create(), P.load(r[1]), P.load(r[2])]).then(function (d) {
          var out = d[0];
          return Promise.all([out.copyPages(d[1], [0]), out.copyPages(d[2], [0]), out.embedPdf(r[0], [0])]).then(function (x) {
            var front = x[0][0]; out.addPage(front); front.drawPage(x[2][0], { x: 0, y: 0 });
            out.addPage(x[1][0]);
            out.setTitle(fileName().replace(/\.pdf$/, "")); out.setAuthor("Christian Hope Center"); out.setCreator("HC Generator — Business Card Maker");
            return out.save();
          });
        });
      })
      .then(function (pdf) { download(new Blob([pdf], { type: "application/pdf" }), fileName()); status("✓ نزل ملف الطباعة"); archive(true); },
            function (e) { status("تعذّر تجهيز الملف: " + ((e && e.message) || ""), true); })
      .then(function () { S.busy = false; checks(); });
  }
  function download(blob, name) {
    var u = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(u); }, 4000);
  }

  /* ---------- the archive: the card's details, with the front as its picture ---------- */
  function archive(quiet) {
    if (!checks()) return;
    var pj = new Blob([JSON.stringify({ v: 1, tool: SLUG, card: S.card })], { type: "application/json" });
    var c = document.createElement("canvas"); c.width = 320; c.height = Math.round(320 * B.H / B.W);
    c.getContext("2d").drawImage(sideFront(), 0, 0, c.width, c.height);
    var meta = { project: SLUG, template: "", filename: fileName().replace(/\.pdf$/, ".json"), mime: "application/json", fileSize: pj.size, projSize: 0, thumb: c.toDataURL("image/jpeg", 0.8) };
    var m = new TextEncoder().encode(JSON.stringify(meta)), h = new Uint8Array(4); new DataView(h.buffer).setUint32(0, m.length);
    fetch(WORKER + "/archive", { method: "POST", headers: { "Authorization": "Bearer " + token(), "Content-Type": "application/octet-stream" }, body: new Blob([h, m, pj]) })
      .then(function (r) { if (!quiet) status(r.ok ? "✓ انحفظ بالأرشيف" : "ما انحفظ بالأرشيف", !r.ok); }, function () { if (!quiet) status("ما انحفظ بالأرشيف", true); });
  }

  /* ---------- the staff sheet ---------- */
  /* The sheet writes numbers its own way ("993360492 / 944123456", "0993…",
     "963…"): the card shows the first one as +963 993 360 492. */
  function phoneOf(raw) {
    var first = String(raw || "").split(/[\/,;|]|or/)[0].trim(), d = first.replace(/\D/g, "");
    if (/^00963/.test(d)) d = d.slice(5); else if (/^963/.test(d)) d = d.slice(3); else if (/^0/.test(d)) d = d.slice(1);
    return d.length === 9 ? "+963 " + d.slice(0, 3) + " " + d.slice(3, 6) + " " + d.slice(6) : first;
  }
  function fromSheet(card) {
    if (card) card = Object.assign({}, card, { phone: phoneOf(card.phone) });
    S.sheet = card ? Object.assign(blank(), card) : null;
    source(card ? "sheet" : S.configured === false ? "off" : "missing");
    fill(card || { email: S.pickEmail || myEmail() });
  }
  function pick() {
    var v = $("bcPick").value.trim(), hit = S.staff.filter(function (p) { return v === p.name + " — " + p.email || v.toLowerCase() === p.email.toLowerCase(); })[0];
    if (!hit) return;
    S.pickEmail = hit.email; status("…جارٍ جلب معلومات " + hit.name);
    api("/cards/staff?email=" + encodeURIComponent(hit.email)).then(function (d) { status(""); fromSheet(d.card); }, function (e) { status(e.message, true); });
  }

  function wire() {
    FIELDS.forEach(function (k) {
      var el = $("bc" + k[0].toUpperCase() + k.slice(1));
      el.addEventListener(el.tagName === "SELECT" ? "change" : "input", function () { S.card[k] = el.value; draw(); });
    });
    [].forEach.call(document.querySelectorAll(".tabs button"), function (b) {
      b.onclick = function () {
        S.view = b.dataset.v;
        [].forEach.call(document.querySelectorAll(".tabs button"), function (x) { x.setAttribute("aria-selected", x === b ? "true" : "false"); });
        draw();
      };
    });
    $("bcPdf").onclick = exportPdf;
    $("bcSave").onclick = function () { archive(false); };
    $("bcReset").onclick = function () { if (S.sheet) { fill(S.sheet); source("sheet"); } };
    $("bcPick").addEventListener("change", pick);
    $("bcPick").addEventListener("input", pick);
  }

  function start() {
    $("bcGate").hidden = true; $("bcApp").hidden = false;
    wire();
    var fonts = document.fonts ? Promise.all([500, 600, 700, 900].map(function (w) { return document.fonts.load(w + " 20px 'Somar Sans'"); })) : Promise.resolve();
    var art = Promise.all([loadImg("assets/card-front.png"), loadImg("assets/card-back.png"), loadImg("assets/mockup-base.jpg"), fetch("assets/mockup.json").then(function (r) { return r.json(); })])
      .then(function (r) { S.img = { front: r[0], back: r[1], mock: r[2] }; S.mock = r[3]; });
    var opened = null; try { opened = JSON.parse(sessionStorage.getItem("arcOpen") || "null"); sessionStorage.removeItem("arcOpen"); } catch (e) {}
    var data = opened && opened.card ? Promise.resolve(null) : api("/cards/me").catch(function (e) { status(e.message, true); return { configured: undefined }; });
    Promise.all([fonts, art, data]).then(function (r) {
      var d = r[2];
      if (opened && opened.card) { fill(opened.card); source("archive"); return; }
      S.configured = d.configured;
      if (d.staff && d.staff.length) {
        S.staff = d.staff; $("bcWho").hidden = false;
        $("bcStaff").innerHTML = d.staff.map(function (p) { return '<option value="' + (p.name + " — " + p.email).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;") + '"></option>'; }).join("");
      }
      fromSheet(d.card || null);
    }, function (e) { status(e.message, true); });
  }

  hcToolAccess(SLUG, "bc").then(start, function () {});
})();
