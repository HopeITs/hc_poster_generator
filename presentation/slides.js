/* Presentation Maker — the slide layouts, drawn once as a list of shapes in
   pixels on a 960×540 slide, read by both the preview (app.js, absolutely
   placed boxes) and the PowerPoint export (pptxgenjs, 96 px to the inch), so
   the two never drift apart. The layouts follow the approved Hope Center
   mockup and are drawn for Arabic (right to left); for English every shape
   not marked `fixed` is mirrored across the slide and «start» alignment
   becomes left. The logo stays at the top left in both, as on the letterhead.
   Shapes: rect {fill, line, lineW, circle, alpha}, text {text, size, weight
   400|700|900, color, align start|end|center, valign top|middle|bottom, lh,
   ltr}, img {src, label, circle} and logo {variant red|white}. A text or
   photo the user fills carries `key`, its path in the slide ("items.2.t"),
   which the editor edits in place; a text also carries `ph`, its hint. */
(function () {
  "use strict";
  var W = 960, H = 540;
  var LOGO_RATIO = 172.71 / 58.78;
  var GREY_PHOTO = "#b7b9bc";

  /* The five projects' looks; only Hope Center is drawn so far (its mockup is approved). */
  var BRANDS = {
    "hope-center": { name: "Hope Center", main: "#be1f24", deep: "#a51b1f", dark: "#414042", text: "#58595b", muted: "#808285", soft: "#f4f4f5", rule: "#d3d3d5",
                     org: "Christian Hope Center", web: "www.hcsyria.org", logo: { red: "assets/hope-red.svg", white: "assets/hope-white.svg" } }
  };

  /* What each type holds, with its labels in the page and its starting text in both languages. */
  var T = {
    ar: { cover: "الغلاف", section: "فاصل قسم", textphoto: "نص وصورة", points: "نقاط", numbers: "أرقام", timeline: "جدول زمني", story: "قصة / اقتباس", team: "الفريق", thanks: "شكراً" },
    en: { cover: "Cover", section: "Section", textphoto: "Text and photo", points: "Points", numbers: "Numbers", timeline: "Timeline", story: "Story / quote", team: "Team", thanks: "Thank you" }
  };
  var ORDER = ["cover", "section", "textphoto", "points", "numbers", "timeline", "story", "team", "thanks"];

  function blank(type, lang) {
    var ar = lang !== "en";
    function list(n, f) { var a = []; for (var i = 0; i < n; i++) a.push(f(i)); return a; }
    switch (type) {
      case "cover": return { type: type, tag: ar ? "تقرير المشروع · 2026" : "Project report · 2026", title: ar ? "عنوان العرض التقديمي" : "Presentation title",
        subtitle: ar ? "سطر فرعي يشرح موضوع العرض بكلمات قليلة" : "A short line on what this presentation is about",
        presenter: "", photo: null };
      case "section": return { type: type, kicker: ar ? "القسم الأول" : "Part one", title: ar ? "عنوان القسم" : "Section title",
        text: ar ? "جملة قصيرة بتقول شو رح نحكي بهالقسم" : "One sentence on what this part covers" };
      case "textphoto": return { type: type, kicker: ar ? "عن المشروع" : "About the project", title: ar ? "عنوان الشريحة" : "Slide title",
        text: ar ? "فقرة قصيرة بتشرح الفكرة الأساسية لهالشريحة، بأربع أسطر على الأكتر." : "A short paragraph on this slide's main idea, four lines at most.", photo: null };
      case "points": return { type: type, title: ar ? "أهداف المشروع" : "Project goals",
        items: list(4, function (i) { return { t: (ar ? "النقطة " : "Point ") + (i + 1), d: ar ? "شرح قصير بسطر أو سطرين" : "A short line or two" }; }) };
      case "numbers": return { type: type, title: ar ? "أثرنا بالأرقام" : "Our impact in numbers",
        stats: list(3, function () { return { v: "", t: ar ? "عنوان الرقم" : "Label", d: ar ? "وصف قصير وفترته" : "Short description and period" }; }) };
      case "timeline": return { type: type, title: ar ? "مراحل المشروع" : "Project stages",
        steps: list(4, function (i) { return { when: "", t: (ar ? "المرحلة " : "Stage ") + (i + 1), d: ar ? "شو صار فيها بسطرين" : "What happened, in two lines" }; }) };
      case "story": return { type: type, quote: ar ? "جملة من كلام صاحب القصة، بكلماته هو." : "A sentence from the person, in their own words.", name: "", role: "", photo: null };
      case "team": return { type: type, title: ar ? "فريق العمل" : "The team", people: list(4, function () { return { n: "", r: "", photo: null }; }) };
      case "thanks": return { type: type, title: ar ? "شكراً لكم" : "Thank you", text: ar ? "للأسئلة والتواصل" : "Questions and contact", email: "", phone: "" };
    }
    return null;
  }

  /* ---------- the shapes ---------- */
  function photo(x, y, w, h, src, label, extra) {
    var e = { t: "img", x: x, y: y, w: w, h: h, src: src || null, label: label };
    for (var k in extra || {}) e[k] = extra[k];
    return e;
  }
  function header(c) {
    return [
      { t: "logo", x: 48, y: 28, h: 26, variant: "red", fixed: true },
      { t: "text", x: 452, y: 28, w: 460, h: 26, text: c.deck, size: 12, weight: 700, color: c.b.muted, align: "right", valign: "middle", fixed: true },
      { t: "rect", x: 48, y: 70, w: 864, h: 1, fill: c.b.rule, fixed: true }
    ];
  }
  function footer(c, x0, x1) {   // Arabic: the organisation's name at the right, the number at the left
    x0 = x0 == null ? 48 : x0; x1 = x1 == null ? 912 : x1;
    return [
      { t: "text", x: x1 - 300, y: 508, w: 300, h: 16, text: c.b.org, size: 11, weight: 400, color: c.b.muted, align: "start", valign: "middle", ltr: true },
      { t: "text", x: x0, y: 508, w: 60, h: 16, text: pad(c.n), size: 11, weight: 400, color: c.b.muted, align: "end", valign: "middle", ltr: true }
    ];
  }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  /* An editable text: its value from the slide at `key` (a path such as
     "items.2.t"), and the hint the editor shows while it is empty. An empty
     text is left out of the exports and the thumbnails. */
  function get(s, key) { return key.split(".").reduce(function (o, k) { return o == null ? o : o[k]; }, s); }
  var PH = {
    ar: { tag: "[الشارة]", title: "[العنوان]", subtitle: "[سطر فرعي]", presenter: "[اسم المقدّم]", kicker: "[فوق العنوان]", text: "[النص]",
          t: "[العنوان]", d: "[الشرح]", v: "[رقم]", when: "[التاريخ]", quote: "[الاقتباس]", name: "[اسم صاحب القصة]", role: "[الصفة · المشروع · المدينة]",
          n: "[الاسم]", r: "[الدور]", email: "[البريد الإلكتروني]", phone: "[رقم الهاتف]" },
    en: { tag: "[Tag]", title: "[Title]", subtitle: "[Subtitle]", presenter: "[Presenter]", kicker: "[Above the title]", text: "[Text]",
          t: "[Title]", d: "[Details]", v: "[Number]", when: "[Date]", quote: "[Quote]", name: "[Name]", role: "[Role · project · city]",
          n: "[Name]", r: "[Role]", email: "[Email]", phone: "[Phone]" }
  };
  function tx(c, s, key, o) {
    var v = get(s, key), last = key.split(".").pop();
    o.t = "text"; o.key = key; o.text = v == null ? "" : String(v); o.ph = PH[c.rtl ? "ar" : "en"][last] || "";
    return o;
  }
  function heading(c, s, color, x, y, w) {
    return [
      tx(c, s, "title", { x: x, y: y, w: w, h: 46, size: 34, weight: 900, color: color, align: "start", valign: "top", lh: 1.2 }),
      { t: "rect", x: x + w - 48, y: y + 56, w: 48, h: 3, fill: color === c.b.main ? c.b.dark : c.b.main }
    ];
  }
  function blankPhoto(c) { return c.rtl ? "اكبس مرتين لتختار صورة" : "Double-click to choose a photo"; }

  var DRAW = {
    cover: function (s, c) {
      var b = c.b, ar = c.rtl, x = 434, w = 470, tw = tagW(s.tag || (ar ? "[الشارة]" : "[Tag]")), e = [
        { t: "rect", x: 0, y: 0, w: W, h: H, fill: "#ffffff", fixed: true },
        { t: "logo", x: 48, y: 28, h: 34, variant: "red", fixed: true },
        { t: "text", x: 612, y: 30, w: 300, h: 30, text: b.web, size: 12, weight: 700, color: b.muted, align: "right", valign: "middle", ltr: true, fixed: true },
        { t: "rect", x: 48, y: 80, w: 864, h: 2, fill: b.main, fixed: true },
        { t: "rect", x: x + w - tw, y: 132, w: tw, h: 28, fill: b.main, dep: "tag" },
        tx(c, s, "tag", { x: x + w - tw, y: 132, w: tw, h: 28, size: 13, weight: 700, color: "#ffffff", align: "center", valign: "middle" }),
        tx(c, s, "title", { x: x, y: 176, w: w, h: 124, size: 50, weight: 900, color: b.main, align: "start", valign: "top", lh: 1.12 }),
        tx(c, s, "subtitle", { x: x, y: 306, w: w, h: 62, size: 20, weight: 400, color: b.text, align: "start", valign: "top", lh: 1.5 }),
        { t: "rect", x: x + w - 64, y: 380, w: 64, h: 4, fill: b.dark },
        { t: "text", x: x, y: 398, w: w, h: 18, text: ar ? "تقديم" : "Presented by", size: 13, weight: 400, color: b.muted, align: "start", valign: "top", dep: "presenter" },
        tx(c, s, "presenter", { x: x, y: 418, w: w, h: 26, size: 17, weight: 700, color: b.dark, align: "start", valign: "top" }),
        { t: "rect", x: 86, y: 140, w: 330, h: 340, line: b.main, lineW: 3 },
        photo(64, 118, 330, 340, s.photo, blankPhoto(c), { key: "photo" })
      ];
      return e.concat(footer(c));
    },
    section: function (s, c) {
      var b = c.b;
      return [
        { t: "rect", x: 0, y: 0, w: W, h: H, fill: b.main, fixed: true },
        { t: "rect", x: 0, y: 0, w: 300, h: H, fill: b.deep },
        { t: "logo", x: 48, y: 28, h: 30, variant: "white", fixed: true },
        { t: "text", x: 40, y: 300, w: 300, h: 200, text: pad(c.sectionNo), size: 200, weight: 900, color: "#ffffff", alpha: 0.18, align: "start", valign: "bottom", ltr: true, lh: 1 },
        tx(c, s, "kicker", { x: 376, y: 168, w: 520, h: 24, size: 16, weight: 700, color: "#ffffff", align: "start", valign: "top", alpha: 0.85 }),
        tx(c, s, "title", { x: 376, y: 202, w: 520, h: 124, size: 52, weight: 900, color: "#ffffff", align: "start", valign: "top", lh: 1.15 }),
        { t: "rect", x: 832, y: 336, w: 64, h: 4, fill: "#ffffff" },
        tx(c, s, "text", { x: 376, y: 356, w: 520, h: 64, size: 19, weight: 400, color: "#ffffff", align: "start", valign: "top", lh: 1.6, alpha: 0.9 }),
        { t: "text", x: 612, y: 508, w: 300, h: 16, text: b.org, size: 11, weight: 400, color: "#ffffff", alpha: 0.75, align: "start", valign: "middle", ltr: true }
      ];
    },
    textphoto: function (s, c) {
      var b = c.b;
      return [{ t: "rect", x: 0, y: 0, w: W, h: H, fill: "#ffffff", fixed: true }].concat(header(c), [
        tx(c, s, "kicker", { x: 474, y: 110, w: 430, h: 22, size: 14, weight: 700, color: b.main, align: "start", valign: "top" }),
        tx(c, s, "title", { x: 474, y: 140, w: 430, h: 92, size: 36, weight: 900, color: b.dark, align: "start", valign: "top", lh: 1.2 }),
        { t: "rect", x: 856, y: 244, w: 48, h: 3, fill: b.main },
        tx(c, s, "text", { x: 474, y: 264, w: 430, h: 200, size: 17, weight: 400, color: b.text, align: "start", valign: "top", lh: 1.75 }),
        photo(0, 71, 400, 469, s.photo, blankPhoto(c), { key: "photo" }),
        { t: "rect", x: 400, y: 71, w: 6, h: 469, fill: b.main }
      ], footer(c, 448));
    },
    points: function (s, c) {
      var b = c.b, e = [{ t: "rect", x: 0, y: 0, w: W, h: H, fill: "#ffffff", fixed: true }].concat(header(c), heading(c, s, b.main, 56, 100, 848));
      var items = (s.items || []).slice(0, 6), rows = Math.ceil(items.length / 2), gap = rows > 2 ? 86 : 110;
      items.forEach(function (it, i) {
        var col = i % 2, row = Math.floor(i / 2), x = col === 0 ? 504 : 56, y = 196 + row * gap;   // first column on the right
        e.push({ t: "rect", x: x + 356, y: y, w: 44, h: 44, fill: b.main },
               { t: "text", x: x + 356, y: y, w: 44, h: 44, text: pad(i + 1), size: 20, weight: 900, color: "#ffffff", align: "center", valign: "middle", ltr: true },
               tx(c, s, "items." + i + ".t", { x: x, y: y, w: 340, h: 26, size: 19, weight: 700, color: b.dark, align: "start", valign: "top" }),
               tx(c, s, "items." + i + ".d", { x: x, y: y + 30, w: 340, h: gap - 42, size: 15, weight: 400, color: "#6f6e71", align: "start", valign: "top", lh: 1.6 }));
      });
      return e.concat(footer(c));
    },
    numbers: function (s, c) {
      var b = c.b, e = [{ t: "rect", x: 0, y: 0, w: W, h: H, fill: "#ffffff", fixed: true }].concat(header(c), heading(c, s, b.dark, 56, 100, 848));
      var st = (s.stats || []).slice(0, 4), n = st.length || 1, gap = 24, w = (848 - gap * (n - 1)) / n;
      st.forEach(function (it, i) {
        var x = 904 - (i + 1) * w - i * gap;   // first card on the right
        e.push({ t: "rect", x: x, y: 210, w: w, h: 190, fill: b.soft },
               { t: "rect", x: x, y: 210, w: w, h: 5, fill: b.main },
               tx(c, s, "stats." + i + ".v", { x: x + 24, y: 238, w: w - 48, h: 56, size: 46, weight: 900, color: b.main, align: "start", valign: "top", lh: 1 }),
               tx(c, s, "stats." + i + ".t", { x: x + 24, y: 304, w: w - 48, h: 26, size: 18, weight: 700, color: b.dark, align: "start", valign: "top" }),
               tx(c, s, "stats." + i + ".d", { x: x + 24, y: 336, w: w - 48, h: 52, size: 14, weight: 400, color: "#6f6e71", align: "start", valign: "top", lh: 1.5 }));
      });
      return e.concat(footer(c));
    },
    timeline: function (s, c) {
      var b = c.b, e = [{ t: "rect", x: 0, y: 0, w: W, h: H, fill: "#ffffff", fixed: true }].concat(header(c), heading(c, s, b.main, 56, 100, 848));
      var st = (s.steps || []).slice(0, 5), n = st.length || 1, gap = 24, w = (848 - gap * (n - 1)) / n;
      e.push({ t: "rect", x: 56, y: 283, w: 848, h: 3, fill: b.main });
      st.forEach(function (it, i) {
        var x = 904 - (i + 1) * w - i * gap;   // first stage on the right
        e.push(tx(c, s, "steps." + i + ".when", { x: x, y: 230, w: w, h: 30, size: 15, weight: 700, color: b.muted, align: "start", valign: "bottom" }),
               { t: "rect", x: x + w - 22, y: 274, w: 22, h: 22, fill: "#ffffff", line: b.main, lineW: 5, circle: true },
               tx(c, s, "steps." + i + ".t", { x: x, y: 308, w: w, h: 26, size: 19, weight: 700, color: b.dark, align: "start", valign: "top" }),
               tx(c, s, "steps." + i + ".d", { x: x, y: 338, w: w, h: 80, size: 14, weight: 400, color: "#6f6e71", align: "start", valign: "top", lh: 1.6 }));
      });
      return e.concat(footer(c));
    },
    story: function (s, c) {
      var b = c.b;
      return [
        { t: "rect", x: 0, y: 0, w: W, h: H, fill: "#ffffff", fixed: true },
        photo(490, 0, 470, 540, s.photo, blankPhoto(c), { key: "photo" }),
        { t: "rect", x: 458, y: 40, w: 64, h: 64, fill: b.main },
        { t: "text", x: 458, y: 40, w: 64, h: 64, text: "”", size: 62, weight: 900, color: "#ffffff", align: "center", valign: "middle", ltr: true },
        { t: "logo", x: 48, y: 30, h: 26, variant: "red", fixed: true },
        tx(c, s, "quote", { x: 56, y: 150, w: 380, h: 170, size: 26, weight: 700, color: b.dark, align: "start", valign: "top", lh: 1.55 }),
        { t: "rect", x: 388, y: 336, w: 48, h: 3, fill: b.main },
        tx(c, s, "name", { x: 56, y: 356, w: 380, h: 26, size: 18, weight: 700, color: b.main, align: "start", valign: "top" }),
        tx(c, s, "role", { x: 56, y: 384, w: 380, h: 22, size: 14, weight: 400, color: b.muted, align: "start", valign: "top" }),
        { t: "text", x: 56, y: 508, w: 60, h: 16, text: pad(c.n), size: 11, weight: 400, color: b.muted, align: "end", valign: "middle", ltr: true }
      ];
    },
    team: function (s, c) {
      var b = c.b, e = [{ t: "rect", x: 0, y: 0, w: W, h: H, fill: "#ffffff", fixed: true }].concat(header(c), [
        tx(c, s, "title", { x: 56, y: 100, w: 848, h: 46, size: 34, weight: 900, color: b.dark, align: "center", valign: "top", lh: 1.2 }),
        { t: "rect", x: 456, y: 156, w: 48, h: 3, fill: b.main }
      ]);
      var ps = (s.people || []).slice(0, 5), n = ps.length || 1, cw = Math.min(200, 800 / n), x0 = 480 + (n * cw) / 2;
      ps.forEach(function (p, i) {
        var x = x0 - (i + 1) * cw, d = 132;
        e.push({ t: "rect", x: x + (cw - d) / 2 - 6, y: 204, w: d + 12, h: d + 12, fill: b.main, circle: true },
               { t: "rect", x: x + (cw - d) / 2 - 3, y: 207, w: d + 6, h: d + 6, fill: "#ffffff", circle: true },
               photo(x + (cw - d) / 2, 210, d, d, p.photo, "", { circle: true, key: "people." + i + ".photo" }),
               tx(c, s, "people." + i + ".n", { x: x, y: 362, w: cw, h: 26, size: 18, weight: 700, color: b.dark, align: "center", valign: "top" }),
               tx(c, s, "people." + i + ".r", { x: x, y: 390, w: cw, h: 22, size: 14, weight: 700, color: b.main, align: "center", valign: "top" }));
      });
      return e.concat(footer(c));
    },
    thanks: function (s, c) {
      var b = c.b, e = [
        { t: "rect", x: 0, y: 0, w: W, h: H, fill: b.main, fixed: true },
        { t: "logo", x: 480 - 32 * LOGO_RATIO, y: 120, h: 64, variant: "white", fixed: true },
        { t: "rect", x: 448, y: 208, w: 64, h: 3, fill: "#ffffff", fixed: true },
        tx(c, s, "title", { x: 80, y: 232, w: 800, h: 76, size: 60, weight: 900, color: "#ffffff", align: "center", valign: "middle", lh: 1.1, fixed: true }),
        tx(c, s, "text", { x: 80, y: 318, w: 800, h: 30, size: 18, weight: 400, color: "#ffffff", alpha: 0.9, align: "center", valign: "middle", fixed: true }),
        { t: "rect", x: 0, y: 530, w: W, h: 10, fill: b.dark, fixed: true }
      ];
      // the contact line: the site, then the email and the phone, centred together (the empty ones left out of the exports)
      var parts = [{ text: b.web }, tx(c, s, "email", {}), tx(c, s, "phone", {})].filter(function (p) { return c.edit || p.text; });
      var pw = 250, x0 = 480 - (parts.length * pw) / 2;
      parts.forEach(function (p, i) {
        var o = { t: "text", x: x0 + i * pw, y: 362, w: pw, h: 26, size: 15, weight: 700, color: "#ffffff", align: "center", valign: "middle", ltr: true, fixed: true, text: p.text };
        if (p.key) { o.key = p.key; o.ph = p.ph; }
        e.push(o);
      });
      return e;
    }
  };
  function tagW(text) { return Math.min(470, 28 + String(text).length * 8); }

  /* A slide's shapes for its place in the deck, mirrored for English. Outside
     the editor (ctx.edit), what hangs on an empty field (the cover's tag box,
     «تقديم» without a presenter) is left out. A box the user resized keeps its
     new size (slide.box, by field, in the Arabic layout's place), and a box the
     user formatted from the ribbon keeps its formatting (slide.fmt, by field:
     size, weight, color, align, lh, italic, underline, strike, shadow, spacing,
     caps, hl, indent, dir). A photo dragged in its frame keeps the part shown
     (slide.pos, by field: px and py from 0 to 1, as CSS object-position). */
  function shapes(slide, ctx) {
    var list = (DRAW[slide.type] || DRAW.textphoto)(slide, ctx), box = slide.box || {}, fmt = slide.fmt || {}, pos = slide.pos || {};
    list = list.map(function (e) {
      var r = e.key && box[e.key], f = e.key && fmt[e.key], p = e.key && e.t === "img" && pos[e.key], k; if (!r && !f && !p) return e;
      var m = {}; for (k in e) m[k] = e[k];
      if (r) { m.x = r.x; m.y = r.y; m.w = r.w; m.h = r.h; }
      if (p) { m.px = p.x; m.py = p.y; }
      if (f) for (k in f) m[k] = f[k];
      return m;
    });
    if (!ctx.edit) list = list.filter(function (e) { return !e.dep || String(get(slide, e.dep) || "").trim(); });
    if (ctx.rtl) return list;
    return list.map(function (e) {
      if (e.fixed) return e;
      var m = {}; for (var k in e) m[k] = e[k];
      m.x = W - e.x - (e.w != null ? e.w : e.h * LOGO_RATIO);
      return m;
    });
  }
  /* The side a text box keeps its lines on: start is right in Arabic, left in English. */
  function side(e, rtl) {
    if (e.align === "center" || e.align === "left" || e.align === "right" || e.align === "justify") return e.align;
    return e.align === "end" ? (rtl ? "left" : "right") : (rtl ? "right" : "left");
  }
  /* The way a text box's lines run: chosen from the ribbon, or the deck's language
     (a box marked ltr, such as a web address, always runs left to right). */
  function dirOf(e, rtl) { return e.dir || (e.ltr ? "ltr" : (rtl ? "rtl" : "ltr")); }

  window.PMSlides = { W: W, H: H, LOGO_RATIO: LOGO_RATIO, GREY_PHOTO: GREY_PHOTO, BRANDS: BRANDS, NAMES: T, ORDER: ORDER, blank: blank, shapes: shapes, side: side, dirOf: dirOf, get: get };
})();
