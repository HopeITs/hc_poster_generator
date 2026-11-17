/* Business Card Maker — the card, measured from the designer's InDesign file
   (001HC_SYR_Business card 2027): 240.445 × 141.232 pt, 24 to an A3 sheet.
   One description of the words drawn on the card, in points from its top-left
   corner, serves the screen (a canvas, over assets/card-front.png) and the
   print file (pdfkit, over assets/print-front.pdf), so the two always match.
   The card's frame, red line and icons come from the template; only the
   words are drawn here. */
(function () {
  "use strict";
  var W = 240.445, H = 141.232;
  var INK = "#404041", INK_CMYK = [0, 0, 0, 90];               // K 90, as in the file
  var NAME = { x: 24.199, y: 34.375, size: 15, weight: 900, spacing: 0.3, max: 183.7 };
  var TITLE = { x: 24.199, y: 46.375, size: 8, weight: 600, max: 183.7 };
  var LINES = { x: 38.012, y: [84.273, 96.537, 108.801, 121.065], size: 7.2483, max: W - 24.199 - 38.012 };
  var FONT = { 500: "SomarSans-Medium", 600: "SomarSans-SemiBold", 700: "SomarSans-Bold", 900: "SomarSans-Black" };
  // where each card's top-left corner is on the A3 sheet (pt), front side
  var SHEET = { w: 841.89, h: 1190.55, cards: (function () {
    var xs = [14.4232, 300.7224, 587.0217], out = [];
    for (var r = 0; r < 8; r++) xs.forEach(function (x) { out.push([x, 14.4221 + r * 145.7818]); });
    return out;
  })() };

  /* The detail lines as runs of medium (500) and bold (700) text, the way the
     designer set them: the last two groups of the phone number, the country
     and the city, the name before @, and the site's name are bold. */
  function details(c) {
    var ph = String(c.phone || "").trim().replace(/\s+/g, " "), g = ph ? ph.split(" ") : [];
    var nb = g.length >= 3 ? 2 : g.length ? 1 : 0;
    var phone = g.length ? [[g.slice(0, g.length - nb).join(" ") + (g.length > nb ? " " : ""), 500], [g.slice(g.length - nb).join(" "), 700]] : [];
    var city = String(c.city || "").trim(), street = String(c.street || "").trim();
    var place = [["Syria", 700]];
    if (city) place.push([", ", 500], [city, 700]);
    if (street) place.push([", " + street, 500]);
    var mail = String(c.email || "").trim(), at = mail.indexOf("@");
    var email = at > 0 ? [[mail.slice(0, at), 700], [mail.slice(at), 500]] : mail ? [[mail, 500]] : [];
    var web = String(c.web || "").trim(), m = /^(www\.)?([^.]+)(\..*)?$/i.exec(web);
    var site = !web ? [] : m ? [[m[1] || "", 500], [m[2], 700], [m[3] || "", 500]] : [[web, 500]];
    return [phone, place, email, site].map(function (runs) { return runs.filter(function (r) { return r[0]; }); });
  }

  /* Everything to draw, with sizes made smaller where a text is wider than its
     place. measure(text, weight, size, spacing) gives a width in points. */
  function layout(c, measure) {
    var out = [], notes = [];
    function fit(spec, runs, label) {
      var w = runs.reduce(function (s, r) { return s + measure(r[0], r[1], spec.size, spec.spacing || 0); }, 0);
      var size = w > spec.max ? spec.size * spec.max / w : spec.size;
      if (size < spec.size - 0.01) notes.push(label);
      return size;
    }
    var name = String(c.name || "").trim().toUpperCase();
    if (name) {
      var s1 = fit(NAME, [[name, 900]], "الاسم");
      out.push({ x: NAME.x, y: NAME.y, size: s1, spacing: NAME.spacing * s1 / NAME.size, runs: [[name, 900]] });
    }
    var title = String(c.title || "").trim();
    if (title) out.push({ x: TITLE.x, y: TITLE.y, size: fit(TITLE, [[title, 600]], "المسمى الوظيفي"), spacing: 0, runs: [[title, 600]] });
    details(c).forEach(function (runs, i) {
      if (!runs.length) return;
      out.push({ x: LINES.x, y: LINES.y[i], size: fit(LINES, runs, ["الهاتف", "العنوان", "الإيميل", "الموقع"][i]), spacing: 0, runs: runs });
    });
    return { lines: out, shrunk: notes };
  }

  /* ---------- on a canvas: k pixels per point ---------- */
  function measurer(g) {
    return function (t, weight, size, spacing) {
      g.font = weight + " " + size * 10 + "px 'Somar Sans'";
      if ("letterSpacing" in g) g.letterSpacing = (spacing || 0) * 10 + "px";
      return g.measureText(t).width / 10;
    };
  }
  function drawCanvas(g, lay, k, ox, oy) {
    g.save(); g.fillStyle = INK; g.textBaseline = "alphabetic"; g.textAlign = "left"; g.direction = "ltr";
    lay.lines.forEach(function (l) {
      var x = (ox || 0) + l.x * k;
      l.runs.forEach(function (r) {
        g.font = r[1] + " " + l.size * k + "px 'Somar Sans'";
        if ("letterSpacing" in g) g.letterSpacing = l.spacing * k + "px";
        g.fillText(r[0], x, (oy || 0) + l.y * k);
        x += g.measureText(r[0]).width;
      });
    });
    if ("letterSpacing" in g) g.letterSpacing = "0px";
    g.restore();
  }

  /* ---------- in the print file (pdfkit, points, y down) ---------- */
  function drawPdf(doc, lay, ox, oy) {
    lay.lines.forEach(function (l) {
      var x = ox + l.x;
      l.runs.forEach(function (r) {
        doc.font(FONT[r[1]]).fontSize(l.size).fillColor(INK_CMYK);
        doc.text(r[0], x, oy + l.y, { lineBreak: false, baseline: "alphabetic", characterSpacing: l.spacing });
        x += doc.widthOfString(r[0], { characterSpacing: l.spacing });
      });
    });
  }

  window.BCard = { W: W, H: H, SHEET: SHEET, FONT: FONT, layout: layout, measurer: measurer, drawCanvas: drawCanvas, drawPdf: drawPdf };
})();
