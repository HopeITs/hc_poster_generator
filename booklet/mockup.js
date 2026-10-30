/* Booklet Maker — the preview: the PDF's pages on the folded booklet of the
   mockup (taken from "Book Mockup.psd"). The closed booklet shows the cover
   and the back page; the open one shows one inside spread at a time, and the
   arrows turn its pages.
   mockup/ holds what the PSD gives: the background with the cast shadows
   (base.jpg), the three light layers (contrast.jpg: colour burn, darks.jpg:
   multiply, lights.jpg: screen) and mesh.json, the outline of each half of
   each booklet (top and bottom edge, 33 points each, in base.jpg's pixels).
   A page is laid on its half with a Coons patch between those two edges and
   drawn triangle by triangle; the light layers then go over the paper only.
   Pages are drawn by PDF.js (../text-transcription/vendor/pdfjs). */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var DIR = "mockup/", ASPECT = 1885 / 2647;   // one half of the PSD's spread (A7 page)
  var NU = 32, NV = 24, TEX_H = 900;

  var assets = null, pdfjs = null;
  var M = { doc: null, pages: 0, rtl: true, spread: 0, cache: {}, run: 0 };

  function img(name) {
    return new Promise(function (ok, no) { var i = new Image(); i.onload = function () { ok(i); }; i.onerror = no; i.src = DIR + name; });
  }
  function loadAssets() {
    return assets || (assets = Promise.all([
      fetch(DIR + "mesh.json").then(function (r) { return r.json(); }),
      img("base.jpg"), img("contrast.jpg"), img("darks.jpg"), img("lights.jpg")
    ]).then(function (a) { return { mesh: a[0], base: a[1], contrast: a[2], darks: a[3], lights: a[4] }; }));
  }
  function pdfLib() {
    return pdfjs || (pdfjs = import(new URL("../text-transcription/vendor/pdfjs/pdf.min.js", location.href).href).then(function (m) {
      m.GlobalWorkerOptions.workerSrc = new URL("../text-transcription/vendor/pdfjs/pdf.worker.min.js", location.href).href; return m;
    }));
  }

  /* One page as a texture the shape of a half: white, the page centred in
     it as large as fits. A page past the end of the file stays white. */
  function texture(n) {
    if (M.cache[n]) return M.cache[n];
    var c = document.createElement("canvas");
    c.height = TEX_H; c.width = Math.round(TEX_H * ASPECT);
    var g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
    if (n > M.pages || !M.doc) return (M.cache[n] = Promise.resolve(c));
    var doc = M.doc;
    return (M.cache[n] = doc.getPage(n).then(function (p) {
      var v1 = p.getViewport({ scale: 1 }), s = Math.min(c.width / v1.width, c.height / v1.height);
      var vp = p.getViewport({ scale: s }), t = document.createElement("canvas");
      t.width = Math.round(vp.width); t.height = Math.round(vp.height);
      var tg = t.getContext("2d"); tg.fillStyle = "#fff"; tg.fillRect(0, 0, t.width, t.height);
      return p.render({ canvasContext: tg, viewport: vp }).promise.then(function () {
        g.drawImage(t, Math.round((c.width - t.width) / 2), Math.round((c.height - t.height) / 2));
        return c;
      });
    }));
  }

  /* The half's grid: points spread evenly along the top and bottom edges,
     joined by straight lines. */
  function grid(half) {
    var top = resample(half.top, NU + 1), bot = resample(half.bottom, NU + 1), g = [];
    for (var j = 0; j <= NV; j++) {
      var v = j / NV, row = [];
      for (var i = 0; i <= NU; i++) row.push([top[i][0] + (bot[i][0] - top[i][0]) * v, top[i][1] + (bot[i][1] - top[i][1]) * v]);
      g.push(row);
    }
    return g;
  }
  function resample(pts, n) {
    var d = [0];
    for (var i = 1; i < pts.length; i++) d.push(d[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    var out = [], k = 1;
    for (var j = 0; j < n; j++) {
      var t = d[d.length - 1] * j / (n - 1);
      while (k < d.length - 1 && d[k] < t) k++;
      var f = (t - d[k - 1]) / ((d[k] - d[k - 1]) || 1);
      out.push([pts[k - 1][0] + (pts[k][0] - pts[k - 1][0]) * f, pts[k - 1][1] + (pts[k][1] - pts[k - 1][1]) * f]);
    }
    return out;
  }
  function outline(g, half) {   // the half's own shape, for the paper and the light layers
    g.moveTo(half.top[0][0], half.top[0][1]);
    half.top.forEach(function (p) { g.lineTo(p[0], p[1]); });
    half.bottom.slice().reverse().forEach(function (p) { g.lineTo(p[0], p[1]); });
    g.closePath();
  }
  /* The texture on the grid, one triangle at a time: each is clipped a
     little larger than itself so no hairline shows between them. */
  function warp(g, tex, pts) {
    var tw = tex.width, th = tex.height;
    for (var j = 0; j < NV; j++) for (var i = 0; i < NU; i++) {
      var s00 = [i / NU * tw, j / NV * th], s10 = [(i + 1) / NU * tw, j / NV * th],
          s01 = [i / NU * tw, (j + 1) / NV * th], s11 = [(i + 1) / NU * tw, (j + 1) / NV * th];
      tri(g, tex, [s00, s10, s11], [pts[j][i], pts[j][i + 1], pts[j + 1][i + 1]]);
      tri(g, tex, [s00, s11, s01], [pts[j][i], pts[j + 1][i + 1], pts[j + 1][i]]);
    }
  }
  function tri(g, tex, s, d) {
    var cx = (d[0][0] + d[1][0] + d[2][0]) / 3, cy = (d[0][1] + d[1][1] + d[2][1]) / 3;
    g.save(); g.beginPath();
    d.forEach(function (p, k) {
      var dx = p[0] - cx, dy = p[1] - cy, l = Math.hypot(dx, dy) || 1, x = p[0] + dx / l * 0.8, y = p[1] + dy / l * 0.8;
      if (k) g.lineTo(x, y); else g.moveTo(x, y);
    });
    g.closePath(); g.clip();
    var x0 = s[0][0], y0 = s[0][1], x1 = s[1][0] - x0, y1 = s[1][1] - y0, x2 = s[2][0] - x0, y2 = s[2][1] - y0;
    var u1 = d[1][0] - d[0][0], v1 = d[1][1] - d[0][1], u2 = d[2][0] - d[0][0], v2 = d[2][1] - d[0][1];
    var det = x1 * y2 - x2 * y1;
    if (det) {
      var a = (u1 * y2 - u2 * y1) / det, b = (v1 * y2 - v2 * y1) / det, c = (u2 * x1 - u1 * x2) / det, e = (v2 * x1 - v1 * x2) / det;
      g.setTransform(a, b, c, e, d[0][0] - a * x0 - c * y0, d[0][1] - b * x0 - e * y0);
      g.drawImage(tex, 0, 0);
    }
    g.restore();
  }

  /* Which page lies on which half. Outside (the closed booklet): the cover
     and the last page; right binding puts the cover on the left half, as in
     the printed sheet. Inside: pages 2k and 2k+1, the even one on the right
     for a right binding. */
  function padded() { return Math.max(4, Math.ceil(M.pages / 4) * 4); }
  function spreads() { return padded() / 2 - 1; }
  function layout() {
    var last = padded(), a = 2 * M.spread + 2, b = a + 1;
    return {
      closed: M.rtl ? [1, last] : [last, 1],
      open: M.rtl ? [b, a] : [a, b]
    };
  }

  function draw() {
    var run = ++M.run, L = layout();
    labels();
    if (!M.doc) return;
    $("bkMockNote").textContent = "…جارٍ تجهيز المعاينة";
    Promise.all([loadAssets(), texture(L.closed[0]), texture(L.closed[1]), texture(L.open[0]), texture(L.open[1])]).then(function (r) {
      if (run !== M.run) return;
      var A = r[0], tex = { closed: [r[1], r[2]], open: [r[3], r[4]] };
      var cv = $("bkCanvas"), W = A.mesh.w, H = A.mesh.h;
      if (cv.width !== W) { cv.width = W; cv.height = H; }
      var paper = document.createElement("canvas"); paper.width = W; paper.height = H;
      var p = paper.getContext("2d"), shape = new Path2D();
      A.mesh.cards.forEach(function (card) {
        card.halves.forEach(function (half, h) {
          var one = new Path2D(); outline(one, half); shape.addPath(one);
          p.fillStyle = "#fff"; p.fill(one);
          warp(p, tex[card.name][h], grid(half));
        });
      });
      p.globalCompositeOperation = "color-burn"; p.drawImage(A.contrast, 0, 0);
      p.globalCompositeOperation = "multiply"; p.drawImage(A.darks, 0, 0);
      p.globalCompositeOperation = "screen"; p.drawImage(A.lights, 0, 0);
      p.globalCompositeOperation = "destination-in"; p.fillStyle = "#000"; p.fill(shape);
      var g = cv.getContext("2d");
      g.drawImage(A.base, 0, 0); g.drawImage(paper, 0, 0);
      $("bkMockNote").textContent = "";
    }).catch(function () { if (run === M.run) $("bkMockNote").textContent = "تعذّر تجهيز المعاينة"; });
  }

  function labels() {
    var n = spreads(), L = layout(), a = Math.min(L.open[0], L.open[1]), b = Math.max(L.open[0], L.open[1]);
    var show = function (k) { return k > M.pages ? "فاضية" : k; };
    $("bkSpread").textContent = "الصفحات " + show(a) + " و " + show(b) + "  ·  " + (M.spread + 1) + " من " + n;
    // the right arrow goes back for a right binding, forward for a left one
    $("bkRight").disabled = M.rtl ? M.spread === 0 : M.spread >= n - 1;
    $("bkLeft").disabled = M.rtl ? M.spread >= n - 1 : M.spread === 0;
  }
  function turn(step) {
    var n = spreads(), s = Math.max(0, Math.min(n - 1, M.spread + step));
    if (s !== M.spread) { M.spread = s; draw(); }
  }

  window.BKMock = {
    /* A new file: its bytes (copied, PDF.js takes them), its page count and the binding. */
    set: function (bytes, pages, rtl) {
      BKMock.clear();
      M.pages = pages; M.rtl = rtl; M.spread = 0;
      $("bkMock").hidden = false;
      var run = M.run;
      $("bkMockNote").textContent = "…جارٍ تجهيز المعاينة";
      pdfLib().then(function (m) { return m.getDocument({ data: new Uint8Array(bytes.slice(0)), isEvalSupported: false }).promise; })
        .then(function (doc) {
          if (run !== M.run) { doc.destroy(); return; }
          M.doc = doc; draw();
        }, function () { if (run === M.run) $("bkMockNote").textContent = "تعذّر تجهيز المعاينة"; });
    },
    binding: function (rtl) { if (rtl !== M.rtl) { M.rtl = rtl; if (M.doc) draw(); } },
    clear: function () {
      M.run++;
      if (M.doc) M.doc.destroy();
      M.doc = null; M.pages = 0; M.cache = {};
      $("bkMock").hidden = true;
      var cv = $("bkCanvas"); cv.getContext("2d").clearRect(0, 0, cv.width, cv.height);
    }
  };

  document.addEventListener("DOMContentLoaded", function () {
    $("bkRight").addEventListener("click", function () { turn(M.rtl ? -1 : 1); });
    $("bkLeft").addEventListener("click", function () { turn(M.rtl ? 1 : -1); });
  });
})();
