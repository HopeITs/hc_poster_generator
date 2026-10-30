/* Thumbnail Gen — HC YouTube thumbnail.
   Layout numbers are in the PSD's pixel space (2953×1661) and scaled to the
   output canvas, so the same code draws the preview and the 2000×1125 export.
   Picture → effect stack (compositor.js + assets/stack.json) → logo → title. */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };

  var WORKER = "https://studyzone-auth.ct-aleppo3.workers.dev";
  var TOKEN_KEY = "sz_auth_token";
  var SLUG = "thumbnail-gen";

  var PSD_W = 2953, PSD_H = 1661;                  // layout space
  var OUT_W = 2000, OUT_H = 1125;                   // export size (JPG)
  var YT_MAX_BYTES = 2 * 1024 * 1024 - 32 * 1024;   // YouTube rejects thumbnails over 2 MB
  var PREVIEW = 0.5, DRAG = 0.25;                   // preview / while-dragging scale

  /* From the PSD: "Text" is a placed Illustrator object (Avenir Black Oblique
     48pt, leading 48pt, white) at 89% opacity; its artboard maps to
     x 168→1681 / y 1173→1619, i.e. ×4.0323 horizontally, ×4.0207 vertically.
     Lines grow upward from the last baseline, as in the file. Illustrator set
     the sample with optical kerning (and line 2 tracked tighter); a uniform
     -3.5/1000 em tracking keeps any title within ~3px of that at 2000px. */
  var TEXT = { x: 168, lastBaseline: 1530.80, lead: 193.0, size: 193.55, tracking: -0.0035, maxW: 1620, alpha: 0.8902, font: "Avenir Black Oblique" };
  /* "Logo" is a placed SVG (172.71×58.78 viewBox, centred in a 176.18×62.75 page)
     at x 175→585 / y 150→297, fill opacity 90%. */
  var LOGO = { x: 179.04, y: 154.65, w: 401.92, h: 137.70, alpha: 0.902 };

  var S = { stack: null, layerImgs: {}, decoded: {}, logo: null, pic: null, isDefault: true,
            zoom: 1, panX: 0, panY: 0, fx: null, fxKey: "", busy: false, queued: null };

  function status(t, err) { var e = $("tgStatus"); e.textContent = t || ""; e.className = "status" + (err ? " err" : ""); }
  function loadImg(src) { return new Promise(function (res, rej) { var im = new Image(); im.onload = function () { res(im); }; im.onerror = function () { rej(new Error("تعذّر تحميل " + src)); }; im.src = src; }); }

  /* ---------- access ---------- */
  function token() { try { return localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY); } catch (e) { return null; } }
  function deny(msg) { $("tgGateMsg").textContent = msg; }
  function checkAccess() {
    var t = token();
    if (!t) { location.href = "../"; return Promise.reject(new Error("no session")); }
    return fetch(WORKER + "/projects", { headers: { "Authorization": "Bearer " + t } })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (r) {
        if (!r.ok) { location.href = "../"; throw new Error("session"); }
        var ps = (r.d && r.d.projects) || [];
        var me = ps.filter(function (p) { return p.slug === SLUG; })[0];
        if (!me || me.status !== "ready") { deny("لا تملك صلاحية الوصول إلى هذه الأداة."); throw new Error("denied"); }
      });
  }

  /* ---------- assets ---------- */
  function loadAssets() {
    return fetch("assets/stack.json").then(function (r) { return r.json(); }).then(function (st) {
      S.stack = st;
      var srcs = {};
      (function walk(steps) { steps.forEach(function (s) {
        if (s.type === "layer") srcs[s.src] = 1;
        else if (s.type === "clip") { srcs[s.base.src] = 1; s.clipped.forEach(function (c) { srcs[c.src] = 1; }); }
        else if (s.type === "group") walk(s.steps);
      }); })(st.steps);
      var jobs = Object.keys(srcs).map(function (f) { return loadImg("assets/" + f).then(function (im) { S.layerImgs[f] = im; }); });
      jobs.push(loadImg("assets/logo.svg").then(function (im) { S.logo = im; }));
      jobs.push(loadImg("assets/default.jpg").then(function (im) { S.pic = im; }));
      jobs.push(document.fonts.load("100px '" + TEXT.font + "'"));
      return Promise.all(jobs);
    });
  }
  /* Effect layers decoded to ImageData at a given output size (cached). */
  function layerData(src, w, h) {
    var key = src + "@" + w;
    if (!S.decoded[key]) {
      var c = document.createElement("canvas"); c.width = w; c.height = h;
      var g = c.getContext("2d", { willReadFrequently: true }); g.drawImage(S.layerImgs[src], 0, 0, w, h);
      S.decoded[key] = g.getImageData(0, 0, w, h);
    }
    return S.decoded[key];
  }
  /* stack.json → compositor steps with ImageData and adjustment functions. */
  function steps(list, w, h) {
    // "defaultOnly" = the Generative Fill patch that repairs the bundled photo's
    // left edge; it means nothing on an uploaded picture.
    return list.filter(function (s) { return !s.defaultOnly || S.isDefault; }).map(function (s) {
      if (s.type === "layer") return { type: "layer", img: layerData(s.src, w, h), blend: s.blend, opacity: s.opacity, blendIf: s.blendIf || null };
      if (s.type === "clip") return { type: "clip",
        base: { img: layerData(s.base.src, w, h), blend: s.base.blend, opacity: s.base.opacity },
        clipped: s.clipped.map(function (c) { return { img: layerData(c.src, w, h), blend: c.blend, opacity: c.opacity }; }) };
      if (s.type === "group") return { type: "group", opacity: s.opacity, steps: steps(s.steps, w, h) };
      if (s.kind === "hueSat") return { type: "adjust", fn: ThumbFX.hueSat(s.sat), opacity: s.opacity };
      return { type: "adjust", fn: ThumbFX.tone(S.stack.tone), opacity: s.opacity };
    });
  }

  /* ---------- picture placement ---------- */
  /* Cover the canvas, scaled by zoom; pan is a fraction of the canvas size and
     is clamped so the picture always covers the frame. */
  function placement(w, h) {
    var iw = S.pic.naturalWidth || S.pic.width, ih = S.pic.naturalHeight || S.pic.height;
    var sc = Math.max(w / iw, h / ih) * S.zoom, dw = iw * sc, dh = ih * sc;
    var x = (w - dw) / 2 + S.panX * w, y = (h - dh) / 2 + S.panY * h;
    x = Math.min(0, Math.max(w - dw, x)); y = Math.min(0, Math.max(h - dh, y));
    S.panX = (x - (w - dw) / 2) / w; S.panY = (y - (h - dh) / 2) / h;   // keep pan within bounds
    return { x: x, y: y, w: dw, h: dh };
  }

  /* Picture + effects, as ImageData (the expensive part, cached by state). */
  function effects(w, h) {
    var pl = placement(w, h), key = [w, S.isDefault, S.pic.src.length, S.pic.src.slice(-32), S.zoom, pl.x.toFixed(2), pl.y.toFixed(2)].join("|");
    if (S.fx && S.fxKey === key) return S.fx;
    var c = document.createElement("canvas"); c.width = w; c.height = h;
    var g = c.getContext("2d", { willReadFrequently: true });
    g.fillStyle = "#fff"; g.fillRect(0, 0, w, h);
    g.imageSmoothingQuality = "high"; g.drawImage(S.pic, pl.x, pl.y, pl.w, pl.h);
    var id = g.getImageData(0, 0, w, h), d = id.data, n = w * h, f = new Float32Array(n * 3);
    for (var p = 0; p < n; p++) { f[p * 3] = d[p * 4] / 255; f[p * 3 + 1] = d[p * 4 + 1] / 255; f[p * 3 + 2] = d[p * 4 + 2] / 255; }
    ThumbFX.run(f, steps(S.stack.steps, w, h));
    for (var q = 0; q < n; q++) { d[q * 4] = f[q * 3] * 255 + 0.5; d[q * 4 + 1] = f[q * 3 + 1] * 255 + 0.5; d[q * 4 + 2] = f[q * 3 + 2] * 255 + 0.5; d[q * 4 + 3] = 255; }
    S.fx = id; S.fxKey = key;
    return id;
  }

  /* Title lines, shrunk together if one would run past the text column.
     Drawn as an alpha mask first, because the PSD's text layer uses Blend If
     (underlying gray 0→30 / 127→255): it thins out over very dark and bright
     parts of the image, which is what lets the grain show through the letters. */
  function drawTitle(g, k) {
    var lines = $("tgTitle").value.split(/\r?\n/).map(function (l) { return l.replace(/\s+$/, ""); }).filter(function (l) { return l.trim() !== ""; });
    if (!lines.length) return;
    var size = TEXT.size * k;
    function setFont(px) { g.font = px + "px '" + TEXT.font + "'"; g.letterSpacing = (px * TEXT.tracking) + "px"; }
    setFont(size);
    var widest = Math.max.apply(null, lines.map(function (l) { return g.measureText(l).width; }));
    var fit = Math.min(1, TEXT.maxW * k / widest);
    setFont(size * fit);
    g.fillStyle = "#fff"; g.textBaseline = "alphabetic"; g.textAlign = "left"; g.direction = "ltr";
    var last = TEXT.lastBaseline * k, lead = TEXT.lead * k * fit;
    lines.forEach(function (l, i) { g.fillText(l, TEXT.x * k, last - (lines.length - 1 - i) * lead); });
  }
  /* White title over the image data, alpha × opacity × Blend If of what is under it. */
  function applyTitle(id, k) {
    var w = id.width, h = id.height, c = document.createElement("canvas"); c.width = w; c.height = h;
    var g = c.getContext("2d", { willReadFrequently: true });
    drawTitle(g, k);
    var m = g.getImageData(0, 0, w, h).data, d = id.data, range = S.stack.text && S.stack.text.blendIf;
    for (var j = 0; j < d.length; j += 4) {
      var a = m[j + 3]; if (!a) continue;
      a = a / 255 * TEXT.alpha * ThumbFX.blendIfFactor(range, d[j] / 255, d[j + 1] / 255, d[j + 2] / 255);
      d[j] += (255 - d[j]) * a; d[j + 1] += (255 - d[j + 1]) * a; d[j + 2] += (255 - d[j + 2]) * a;
    }
    return id;
  }
  function compose(canvas, w, h) {
    var k = w / PSD_W, g = canvas.getContext("2d");
    canvas.width = w; canvas.height = h;
    var fx = effects(w, h), id = new ImageData(new Uint8ClampedArray(fx.data), w, h);   // keep the cached effects clean
    g.putImageData(applyTitle(id, k), 0, 0);
    g.globalAlpha = LOGO.alpha; g.drawImage(S.logo, LOGO.x * k, LOGO.y * k, LOGO.w * k, LOGO.h * k); g.globalAlpha = 1;
  }

  /* ---------- live YouTube mockup ----------
     Every slot is redrawn from the preview canvas at its own on-screen size
     (× devicePixelRatio), and the video title mirrors the thumbnail title. */
  function updateMock() {
    var src = $("tgCanvas"), dpr = window.devicePixelRatio || 1;
    [].forEach.call(document.querySelectorAll("canvas.yt-live"), function (c) {
      var w = Math.round(c.clientWidth * dpr), h = Math.round(c.clientHeight * dpr); if (!w || !h) return;
      if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
      var g = c.getContext("2d"); g.imageSmoothingQuality = "high"; g.drawImage(src, 0, 0, w, h);
    });
    var title = $("tgTitle").value.replace(/\s+/g, " ").trim() || "Untitled";
    [].forEach.call(document.querySelectorAll(".yt-live-title"), function (e) { e.textContent = title; });
  }
  function setMockTheme(dark) {
    $("tgYt").classList.toggle("dark", dark);
    $("tgYtDark").classList.toggle("on", dark); $("tgYtLight").classList.toggle("on", !dark);
  }

  /* ---------- preview scheduling ---------- */
  function render(scale) {
    S.queued = scale || PREVIEW;
    if (S.busy) return;
    S.busy = true; $("tgBusy").classList.add("on");
    requestAnimationFrame(function () {
      setTimeout(function () {
        var sc = S.queued; S.queued = null;
        try { compose($("tgCanvas"), Math.round(OUT_W * sc), Math.round(OUT_H * sc)); updateMock(); }
        catch (e) { status("خطأ بالمعالجة: " + e.message, true); }
        S.busy = false;
        if (S.queued) render(S.queued); else $("tgBusy").classList.remove("on");
      }, 0);
    });
  }

  /* ---------- controls ---------- */
  function setPicture(img, isDefault) {
    S.pic = img; S.isDefault = isDefault; S.zoom = 1; S.panX = 0; S.panY = 0; S.fx = null;
    $("tgZoom").value = 100; $("tgZoomV").textContent = "100%";
    $("tgImgReset").hidden = isDefault;
    $("tgDropT").textContent = isDefault ? "اسحب صورة هنا أو اضغط للاختيار" : "✓ تم رفع الصورة — اضغط للتغيير";
    render();
  }
  function readFile(f) {
    if (!f || !/^image\//.test(f.type)) { status("الملف ليس صورة", true); return; }
    var r = new FileReader();
    r.onload = function () { loadImg(r.result).then(function (im) { status(""); setPicture(im, false); }, function () { status("تعذّرت قراءة الصورة", true); }); };
    r.readAsDataURL(f);
  }
  function wire() {
    $("tgTitle").addEventListener("input", function () { render(); });
    $("tgFile").addEventListener("change", function (e) { readFile(e.target.files[0]); e.target.value = ""; });
    var drop = $("tgDrop");
    ["dragenter", "dragover"].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add("over"); }); });
    ["dragleave", "drop"].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove("over"); }); });
    drop.addEventListener("drop", function (e) { readFile(e.dataTransfer.files[0]); });
    $("tgImgReset").onclick = function () { loadImg("assets/default.jpg").then(function (im) { setPicture(im, true); }); };
    $("tgZoom").addEventListener("input", function () { S.zoom = this.value / 100; $("tgZoomV").textContent = this.value + "%"; render(DRAG); });
    $("tgZoom").addEventListener("change", function () { render(); });
    $("tgPosReset").onclick = function () { S.zoom = 1; S.panX = 0; S.panY = 0; $("tgZoom").value = 100; $("tgZoomV").textContent = "100%"; render(); };
    // Drag the picture inside the preview.
    var st = $("tgStage"), drag = null;
    st.addEventListener("pointerdown", function (e) { drag = { x: e.clientX, y: e.clientY, px: S.panX, py: S.panY }; st.setPointerCapture(e.pointerId); st.classList.add("drag"); });
    st.addEventListener("pointermove", function (e) {
      if (!drag) return; var r = st.getBoundingClientRect();
      S.panX = drag.px + (e.clientX - drag.x) / r.width; S.panY = drag.py + (e.clientY - drag.y) / r.height; render(DRAG);
    });
    function end() { if (!drag) return; drag = null; st.classList.remove("drag"); render(); }
    st.addEventListener("pointerup", end); st.addEventListener("pointercancel", end);
    $("tgDownload").onclick = download;
    $("tgYtLight").onclick = function () { setMockTheme(false); };
    $("tgYtDark").onclick = function () { setMockTheme(true); };
    window.addEventListener("resize", updateMock);
    $("tgSaveBtn").onclick = saveProject;
    $("tgProjFile").addEventListener("change", function (e) {
      var f = e.target.files[0]; if (!f) return; var r = new FileReader();
      r.onload = function () { try { loadProject(JSON.parse(r.result)); } catch (err) { status("ملف غير صالح", true); } };
      r.readAsText(f); e.target.value = "";
    });
  }

  /* 001HC_SYR_Youtube Thumb_<title>.<ext> — title lines joined by spaces,
     characters Windows forbids in file names removed. */
  function fileName(ext) {
    var title = $("tgTitle").value.replace(/\s+/g, " ").trim().replace(/[\\/:*?"<>|]/g, "").slice(0, 80) || "Untitled";
    return "001HC_SYR_Youtube Thumb_" + title + "." + (ext || "jpg");
  }

  /* ---------- project files (same idea as the other generators) ----------
     The uploaded picture travels inside the JSON as a data URL; the bundled
     default is stored as null. */
  function projectData() {
    return { app: "thumbnail-gen", v: 1, title: $("tgTitle").value,
             image: S.isDefault ? null : S.pic.src, zoom: S.zoom, panX: S.panX, panY: S.panY };
  }
  function saveProject() {
    var d = projectData();
    var a = document.createElement("a"); a.download = fileName("json");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(d)], { type: "application/json" })); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
    status("✓ تم حفظ المشروع");
  }
  function loadProject(d) {
    if (!d || d.app !== "thumbnail-gen") { status("الملف ليس مشروع Thumbnail Gen", true); return; }
    $("tgTitle").value = typeof d.title === "string" ? d.title : "";
    function place() {
      S.zoom = Math.min(3, Math.max(1, +d.zoom || 1)); S.panX = +d.panX || 0; S.panY = +d.panY || 0; S.fx = null;
      $("tgZoom").value = Math.round(S.zoom * 100); $("tgZoomV").textContent = Math.round(S.zoom * 100) + "%";
      render(); status("✓ تم فتح المشروع");
    }
    var src = (typeof d.image === "string" && /^data:image\//.test(d.image)) ? d.image : null;
    loadImg(src || "assets/default.jpg").then(function (im) { setPicture(im, !src); place(); },
      function () { status("تعذّرت قراءة صورة المشروع", true); });
  }
  function download() {
    var btn = $("tgDownload"); btn.disabled = true; btn.textContent = "…جارٍ التصدير"; status("");
    setTimeout(function () {
      try {
        // Render at the PSD's own size, then downscale: the grain textures blend
        // exactly as in Photoshop only at full resolution (measured: 1.77 vs 4.0
        // mean error when compositing at 2000px directly).
        var full = document.createElement("canvas"); compose(full, PSD_W, PSD_H);
        var c = document.createElement("canvas"); c.width = OUT_W; c.height = OUT_H;
        var cg = c.getContext("2d"); cg.imageSmoothingEnabled = true; cg.imageSmoothingQuality = "high";
        cg.drawImage(full, 0, 0, OUT_W, OUT_H);
        // Highest JPEG quality that stays under YouTube's 2 MB thumbnail limit
        // (0.99 ≈ 1 MB for a typical photo; the grainy sample is ≈1.7 MB).
        var q = 0.99;
        (function encode() {
          c.toBlob(function (b) {
            if (b.size > YT_MAX_BYTES && q > 0.85) { q = Math.round((q - 0.02) * 100) / 100; encode(); return; }
            var a = document.createElement("a"); a.download = fileName(); a.href = URL.createObjectURL(b); a.click();
            archive(b, a.download);
            setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
            btn.disabled = false; btn.textContent = "DOWNLOAD"; status("✓ تم التحميل (" + (b.size / 1048576).toFixed(1) + " MB)");
            S.fx = null; render();               // the export replaced the cached full-size effects
          }, "image/jpeg", q);
        })();
      } catch (e) { btn.disabled = false; btn.textContent = "DOWNLOAD"; status("خطأ بالتصدير: " + e.message, true); }
    }, 30);
  }

  /* ---------- the archive ----------
     Each downloaded thumbnail's project goes, in the background, to the
     Worker's archive with a small preview (the same as Poster Maker); a design
     opened from the archive arrives through sessionStorage. */
  function archive(file, name) {
    var pj = new Blob([JSON.stringify(projectData())], { type: "application/json" });   // the project is what is kept; the picture makes the preview
    var u = URL.createObjectURL(file), im = new Image();
    im.onload = function () {
      var c = document.createElement("canvas"); c.width = 320; c.height = Math.round(320 * im.naturalHeight / im.naturalWidth);
      c.getContext("2d").drawImage(im, 0, 0, c.width, c.height); URL.revokeObjectURL(u);
      var meta = { project: "thumbnail-gen", template: "", filename: name.replace(/\.(jpe?g|png)$/i, ".json"), mime: "application/json", fileSize: pj.size, projSize: 0, thumb: c.toDataURL("image/jpeg", 0.72) };
      var m = new TextEncoder().encode(JSON.stringify(meta)), h = new Uint8Array(4); new DataView(h.buffer).setUint32(0, m.length);
      fetch(WORKER + "/archive", { method: "POST", headers: { "Authorization": "Bearer " + token(), "Content-Type": "application/octet-stream" }, body: new Blob([h, m, pj]) })
        .then(function (r) { if (r.ok) savedNote(); else console.warn("archive: HTTP " + r.status); }, function (e) { console.warn("archive", e); });
    };
    im.onerror = function () { URL.revokeObjectURL(u); };
    im.src = u;
  }
  /* «✓ تم الحفظ في الأرشيف» under the preview, once the Worker has the copy. */
  var savedTimer = null;
  function savedNote() {
    var n = $("tgSaved"); n.classList.remove("out"); n.hidden = false; clearTimeout(savedTimer);
    savedTimer = setTimeout(function () { n.classList.add("out"); savedTimer = setTimeout(function () { n.hidden = true; n.classList.remove("out"); }, 500); }, 3500);
  }
  function fromArchive() {
    var t = null; try { t = sessionStorage.getItem("arcOpen"); sessionStorage.removeItem("arcOpen"); } catch (e) {}
    if (t) { try { loadProject(JSON.parse(t)); } catch (e) { status("تعذّر فتح التصميم من الأرشيف", true); } }
  }

  checkAccess().then(function () {
    $("tgGate").hidden = true; $("tgApp").hidden = false;
    return loadAssets();
  }).then(function () {
    wire(); $("tgDownload").disabled = false; render(); fromArchive();
  }).catch(function (e) { if (["no session", "session", "denied"].indexOf(e.message) < 0) deny("تعذّر تحميل الأداة: " + e.message); });
})();
