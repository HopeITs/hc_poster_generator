/* Presentation Maker — the page, laid out like PowerPoint: a ribbon with its
   tabs, the slides in a column, the slide in the middle and a status bar.
   The slide is edited in place: each text slides.js marks with a `key` is a
   box to type in, each photo a place to click for a picture; the ribbon's
   list group adds or removes the item being typed in (a point, a number, a
   stage, a person). Slides are drawn from slides.js's shapes: as placed
   boxes on the page (the slide, the column, the gallery), on a canvas for
   the PDF, and through pptxgenjs for the PowerPoint, its text left editable.
   Photos are made black and white as they come in (the brand's way);
   «حفظ مشروع» saves the whole deck, photos too, as one file, and the deck
   is also kept in the browser as it changes (AutoRecover), so a closed tab
   or a refresh loses nothing. Every change can be undone; «عرض» shows the
   deck full screen; each slide has speaker notes, which go into the
   PowerPoint. */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var P = window.PMSlides, PX = 96;   // pixels to the inch in the PowerPoint (a 960×540 slide is 10×5.625 in)
  var MAX_PHOTO = 1600;
  var FONT = { 400: "Somar Sans", 500: "Somar Sans Medium", 600: "Somar Sans SemiBold", 700: "Somar Sans Bold", 900: "Somar Sans Black" };   // the installed families, one per weight
  var INDENT = 36;   // one step of «زيادة المسافة البادئة», in slide px
  function caseOf(t, caps) {
    t = String(t || "");
    return caps === "upper" ? t.toUpperCase() : caps === "lower" ? t.toLowerCase() : caps === "title" ? t.toLowerCase().replace(/(^|\s)([a-z])/g, function (m, a, b) { return a + b.toUpperCase(); }) : t;
  }

  /* The repeated parts of a slide: how many it may hold and what a new one starts as. */
  var LISTS = {
    items:  { min: 2, max: 6, one: "نقطة", name: "النقاط", make: function () { return { t: "", d: "" }; } },
    stats:  { min: 2, max: 4, one: "رقم", name: "الأرقام", make: function () { return { v: "", t: "", d: "" }; } },
    steps:  { min: 3, max: 5, one: "مرحلة", name: "المراحل", make: function () { return { when: "", t: "", d: "" }; } },
    people: { min: 1, max: 5, one: "شخص", name: "الفريق", make: function () { return { n: "", r: "", photo: null }; } }
  };

  var S = { brand: "hope-center", lang: "ar", deck: "", slides: [], cur: 0, busy: false, sel: null };

  function status(t, err) { var e = $("pmStatus"); e.textContent = t || ""; e.style.color = err ? "#ffffff" : ""; e.style.fontWeight = err ? "900" : ""; }
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function fresh() {
    S.slides = ["cover", "textphoto", "points", "numbers", "thanks"].map(function (t) { return P.blank(t, S.lang); });
    S.cur = 0;
  }
  function ctxFor(i, edit) {
    var sec = 0; for (var k = 0; k <= i && k < S.slides.length; k++) if (S.slides[k].type === "section") sec++;
    return { b: P.BRANDS[S.brand], rtl: S.lang !== "en", n: i + 1, sectionNo: sec || 1, edit: !!edit, deck: S.deck || (S.lang === "en" ? "Presentation" : "عرض تقديمي") };
  }
  function setPath(obj, key, v) {
    var p = key.split("."), o = obj;
    for (var i = 0; i < p.length - 1; i++) o = o[p[i]];
    o[p[p.length - 1]] = v;
  }

  /* ---------- undo and redo ----------
     A snapshot is the deck as it was: objects and arrays copied, strings (the
     photos among them) shared, so keeping sixty of them costs little. A
     structural change remembers the deck first; typing remembers it once
     per text box, on its first keystroke. */
  var UNDO = [], REDO = [], MAX_UNDO = 60, armed = false;
  function clone(o) {
    if (Array.isArray(o)) return o.map(clone);
    if (o && typeof o === "object") { var c = {}; for (var k in o) c[k] = clone(o[k]); return c; }
    return o;
  }
  function snap() { return { brand: S.brand, lang: S.lang, deck: S.deck, slides: clone(S.slides), cur: S.cur }; }
  function remember() { UNDO.push(snap()); if (UNDO.length > MAX_UNDO) UNDO.shift(); REDO = []; saveSoon(); }
  function restore(x) {
    S.brand = x.brand; S.lang = x.lang; S.deck = x.deck; S.slides = x.slides; S.cur = Math.min(x.cur, x.slides.length - 1); S.sel = null;
    syncDesign(); render(); saveSoon();
  }
  function undo() { if (!UNDO.length) return; REDO.push(snap()); restore(UNDO.pop()); }
  function redo() { if (!REDO.length) return; UNDO.push(snap()); restore(REDO.pop()); }
  function syncDesign() { $("pmBrand").value = S.brand; $("pmLang").value = S.lang; $("pmDeck").value = S.deck; }

  /* ---------- AutoRecover: the deck kept in this browser (IndexedDB) as it changes ---------- */
  var DB_NAME = "hc-presentation", saveTimer = 0;
  function db() {
    return new Promise(function (ok, no) {
      var r = indexedDB.open(DB_NAME, 1);
      r.onupgradeneeded = function () { r.result.createObjectStore("decks"); };
      r.onsuccess = function () { ok(r.result); }; r.onerror = function () { no(r.error); };
    });
  }
  function saveSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      var data = { v: 1, brand: S.brand, lang: S.lang, deck: S.deck, slides: S.slides, cur: S.cur };
      db().then(function (d) {
        return new Promise(function (ok, no) { var tx = d.transaction("decks", "readwrite"); tx.objectStore("decks").put(data, "autosave"); tx.oncomplete = ok; tx.onerror = function () { no(tx.error); }; });
      }).then(function () { status("✓ انحفظ بالجهاز"); }, function () { status("ما انحفظ بالجهاز", true); });
    }, 700);
  }
  function loadSaved() {
    return db().then(function (d) {
      return new Promise(function (ok) { var q = d.transaction("decks").objectStore("decks").get("autosave"); q.onsuccess = function () { ok(q.result || null); }; q.onerror = function () { ok(null); }; });
    }).catch(function () { return null; });
  }

  /* ---------- drawing a slide as boxes ---------- */
  var PHOTO_ICON = '<svg aria-hidden="true" width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 17l-5-5-9 8"/></svg>';
  /* One slide's boxes. `edit` makes the keyed texts typeable and the keyed photos clickable. */
  /* Morph's pairs: the same field on two slides (the title, the photo), the
     logo, and otherwise the n-th shape of the same kind and colour. */
  function morphIds(list) {
    var seen = {};
    return list.map(function (e) {
      if (e.key) return "k:" + e.key;
      if (e.t === "logo") return "logo";
      var sig = e.t + ":" + (e.fill || e.line || "") + ":" + (e.circle ? 1 : 0);
      seen[sig] = (seen[sig] || 0) + 1; return sig + ":" + seen[sig];
    });
  }
  function slideEl(slide, ctx) {
    var root = document.createElement("div");
    root.className = "slide"; root.dir = ctx.rtl ? "rtl" : "ltr";
    var list = P.shapes(slide, ctx), ids = morphIds(list);
    list.forEach(function (e, n) {
      var d;
      if (e.t === "rect") {
        d = document.createElement("div");
        d.style.background = e.fill || "transparent";
        if (e.line) d.style.border = e.lineW + "px solid " + e.line;
        if (e.circle) d.style.borderRadius = "50%";
        if (ctx.edit && e.dep && !String(P.get(slide, e.dep) || "").trim()) d.style.opacity = 0.35;   // shown faded while its text is empty
      } else if (e.t === "logo") {
        d = document.createElement("img"); d.src = ctx.b.logo[e.variant]; d.alt = ""; e = copy(e, { w: e.h * P.LOGO_RATIO });
      } else if (e.t === "img") {
        if (e.src) { d = document.createElement("img"); d.className = "im"; d.src = e.src; d.alt = ""; d.draggable = false; d.style.objectPosition = pct(e.px) + " " + pct(e.py); }
        else { d = document.createElement("div"); d.className = "noimg"; d.style.background = P.GREY_PHOTO; d.innerHTML = PHOTO_ICON + (e.label && ctx.edit ? "<span>" + esc(e.label) + "</span>" : ""); }
        if (e.circle) d.style.borderRadius = "50%";
        if (ctx.edit && e.key) { d.classList.add("pick"); d.dataset.key = e.key; if (S.sel && S.sel.key === e.key) d.classList.add("sel"); }
      } else {
        if (!ctx.edit && !e.text) return;
        d = document.createElement("div"); d.className = "tx";
        styleTx(d, e, ctx);
        if (ctx.edit && e.key) {
          d.classList.add("ed"); d.dataset.key = e.key; d.dataset.ph = e.ph || "";
          try { d.contentEditable = "plaintext-only"; } catch (x) { d.contentEditable = "true"; }
          if (d.contentEditable !== "plaintext-only") d.contentEditable = "true";
          d.spellcheck = false;
        }
        d.textContent = e.text;
        if (ctx.edit && e.dep && !String(P.get(slide, e.dep) || "").trim()) d.style.opacity = 0.35;
      }
      d.style.left = e.x + "px"; d.style.top = e.y + "px"; d.style.width = e.w + "px"; d.style.height = e.h + "px";
      if (e.alpha != null && !d.style.opacity) d.style.opacity = e.alpha;
      d.dataset.m = ids[n];
      root.appendChild(d);
    });
    return root;
  }
  /* A text box's look, from its shape: also used to restyle the box being
     edited when the ribbon changes it, without drawing the slide again. */
  function styleTx(d, e, ctx) {
    var st = d.style, al = P.side(e, ctx.rtl);
    st.fontSize = e.size + "px"; st.fontWeight = e.weight; st.color = e.color; st.lineHeight = e.lh || 1.25;
    st.textAlign = al; st.textAlignLast = al === "justify" ? "auto" : "";
    st.justifyContent = e.valign === "middle" ? "center" : e.valign === "bottom" ? "flex-end" : "flex-start";
    st.direction = P.dirOf(e, ctx.rtl);
    st.fontStyle = e.italic ? "italic" : "";
    st.textDecoration = [e.underline ? "underline" : "", e.strike ? "line-through" : ""].join(" ").trim();
    st.textShadow = e.shadow ? "2px 2px 3px rgba(0,0,0,.35)" : "";
    st.letterSpacing = e.spacing ? e.spacing + "px" : "";
    st.textTransform = e.caps === "upper" ? "uppercase" : e.caps === "lower" ? "lowercase" : e.caps === "title" ? "capitalize" : "";
    st.background = e.hl || "";
    st.paddingInlineStart = e.indent ? e.indent * INDENT + "px" : "";
  }
  function pct(v) { return (v == null ? 50 : Math.round(v * 1000) / 10) + "%"; }
  /* Where a photo covering a w×h frame is drawn: px and py place it as CSS object-position does (0.5, the middle, by default). */
  function coverAt(im, w, h, px, py) {
    var s = Math.max(w / im.naturalWidth, h / im.naturalHeight), dw = im.naturalWidth * s, dh = im.naturalHeight * s;
    return { x: (w - dw) * (px == null ? 0.5 : px), y: (h - dh) * (py == null ? 0.5 : py), w: dw, h: dh };
  }
  function copy(o, more) { var c = {}, k; for (k in o) c[k] = o[k]; for (k in more || {}) c[k] = more[k]; return c; }
  function fitTo(box, el, w) { el.style.transform = "scale(" + (w / P.W) + ")"; }
  function placeIn(box, slide, ctx) { box.innerHTML = ""; var el = slideEl(slide, ctx); box.appendChild(el); fitTo(box, el, box.clientWidth); return el; }

  /* ---------- the slide in the middle ---------- */
  function sizeStage() {
    var work = $("pmWork"), st = $("pmStage"), tip = work.querySelector(".tip");
    var w = Math.max(240, Math.min(work.clientWidth - 40, (work.clientHeight - 40 - (tip ? tip.offsetHeight + 12 : 0)) * P.W / P.H));
    $("pmNotes").style.width = Math.round(w) + "px";
    st.style.width = Math.round(w) + "px"; st.style.height = Math.round(w * P.H / P.W) + "px";
    if (st.firstChild) fitTo(st, st.firstChild, Math.round(w));
    frame();
  }
  function drawStage() {
    var st = $("pmStage"), el;
    sizeStage();
    el = placeIn(st, S.slides[S.cur], ctxFor(S.cur, true));
    fitTo(st, el, st.clientWidth);
    frame();
  }

  /* ---------- the selected box: a frame with handles to make it bigger or smaller ----------
     Dragging a handle changes the box on the slide straight away; letting go keeps
     the new size in slide.box (in the Arabic layout's place, so English mirrors it). */
  var HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"], MIN_BOX = 24;
  function selEl() {
    var sl = $("pmStage").firstChild; if (!sl || !S.sel) return null;
    return sl.querySelector('[data-key="' + S.sel.key + '"]');
  }
  function frame() {
    var sl = $("pmStage").firstChild; if (!sl) return;
    var f = sl.querySelector(".hd"), d = selEl();
    if (!d) { if (f) f.remove(); return; }
    if (!f) {
      f = document.createElement("div"); f.className = "hd";
      HANDLES.forEach(function (h) { var i = document.createElement("i"); i.dataset.h = h; f.appendChild(i); });
      sl.appendChild(f);
    }
    var k = $("pmStage").clientWidth / P.W;
    f.style.setProperty("--k", k);
    f.style.left = d.style.left; f.style.top = d.style.top; f.style.width = d.style.width; f.style.height = d.style.height;
  }
  function onHandle(e) {
    var h = e.target.dataset && e.target.dataset.h; if (!h || !e.target.closest(".hd")) return;
    e.preventDefault(); e.stopPropagation();   // the text keeps its caret
    var d = selEl(); if (!d) return;
    var k = $("pmStage").clientWidth / P.W, x0 = e.clientX, y0 = e.clientY, moved = false;
    var r0 = { x: parseFloat(d.style.left), y: parseFloat(d.style.top), w: parseFloat(d.style.width), h: parseFloat(d.style.height) }, r = r0;
    function mv(ev) {
      var dx = (ev.clientX - x0) / k, dy = (ev.clientY - y0) / k, x = r0.x, y = r0.y, w = r0.w, hh = r0.h;
      if (/e/.test(h)) w = Math.min(P.W - x, Math.max(MIN_BOX, r0.w + dx));
      if (/w/.test(h)) { x = Math.max(0, Math.min(r0.x + r0.w - MIN_BOX, r0.x + dx)); w = r0.x + r0.w - x; }
      if (/s/.test(h)) hh = Math.min(P.H - y, Math.max(MIN_BOX, r0.h + dy));
      if (/n/.test(h)) { y = Math.max(0, Math.min(r0.y + r0.h - MIN_BOX, r0.y + dy)); hh = r0.y + r0.h - y; }
      if (!moved) { moved = true; remember(); }
      r = { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(hh) };
      d.style.left = r.x + "px"; d.style.top = r.y + "px"; d.style.width = r.w + "px"; d.style.height = r.h + "px";
      frame();
    }
    function up() {
      document.removeEventListener("pointermove", mv); document.removeEventListener("pointerup", up);
      if (!moved) return;
      var s = S.slides[S.cur]; s.box = s.box || {};
      s.box[d.dataset.key] = { x: S.lang === "en" ? P.W - r.x - r.w : r.x, y: r.y, w: r.w, h: r.h };
      thumbSoon(S.cur); saveSoon();
    }
    document.addEventListener("pointermove", mv); document.addEventListener("pointerup", up);
  }
  /* Typing changes the slide's data and that slide's thumbnail; the slide itself is
     already showing what was typed, so it is left alone (the caret stays put). */
  function onType(e) {
    var d = e.target.closest && e.target.closest(".ed"); if (!d) return;
    if (armed) { armed = false; remember(); }
    setPath(S.slides[S.cur], d.dataset.key, d.textContent);
    saveSoon();
    if (d.dataset.key === "tag" || /^email$|^phone$/.test(d.dataset.key)) d.style.opacity = "";
    thumbSoon(S.cur);
  }
  function onFocus(e) {
    var d = e.target.closest && e.target.closest(".ed"); if (!d) return;
    S.sel = { key: d.dataset.key, kind: "text" }; armed = true; ribbon(); frame();
  }
  /* A photo's frame: one click selects it (the frame and its handles), two
     clicks choose another photo, and a drag moves the photo inside the frame
     to choose the part shown. */
  function onClick(e) {
    var d = e.target.closest && e.target.closest(".pick"); if (!d) return;
    S.sel = { key: d.dataset.key, kind: "photo" };
    [].forEach.call($("pmStage").querySelectorAll(".pick"), function (x) { x.classList.toggle("sel", x === d); });
    ribbon(); frame();
  }
  function onDblClick(e) {
    var d = e.target.closest && e.target.closest(".pick"); if (!d) return;
    onClick(e); $("pmPhotoFile").click();
  }
  function onPan(e) {
    var d = e.target.closest && e.target.closest(".pick.im"); if (!d || e.button !== 0) return;
    e.preventDefault();
    var k = $("pmStage").clientWidth / P.W, w = parseFloat(d.style.width), h = parseFloat(d.style.height);
    var r = coverAt(d, w, h, 1, 1), ox = -r.x, oy = -r.y;   // how far the photo reaches past its frame
    var p0 = (getComputedStyle(d).objectPosition || "50% 50%").split(" ").map(function (v) { return parseFloat(v) / 100; });
    var x0 = e.clientX, y0 = e.clientY, moved = false, px = p0[0], py = p0[1];
    function mv(ev) {
      var dx = (ev.clientX - x0) / k, dy = (ev.clientY - y0) / k;
      if (!moved && Math.abs(dx) + Math.abs(dy) < 3) return;
      if (!moved) { moved = true; remember(); d.classList.add("panning"); }
      px = ox > 0 ? Math.max(0, Math.min(1, p0[0] - dx / ox)) : 0.5;
      py = oy > 0 ? Math.max(0, Math.min(1, p0[1] - dy / oy)) : 0.5;
      d.style.objectPosition = pct(px) + " " + pct(py);
    }
    function up() {
      document.removeEventListener("pointermove", mv); document.removeEventListener("pointerup", up);
      d.classList.remove("panning");
      if (!moved) return;
      var s = S.slides[S.cur]; s.pos = s.pos || {};
      s.pos[d.dataset.key] = { x: Math.round(px * 1000) / 1000, y: Math.round(py * 1000) / 1000 };
      thumbSoon(S.cur); saveSoon();
    }
    document.addEventListener("pointermove", mv); document.addEventListener("pointerup", up);
  }

  /* ---------- the column of slides ---------- */
  var thumbTimer = {};
  function thumbSoon(i) { clearTimeout(thumbTimer[i]); thumbTimer[i] = setTimeout(function () { drawThumb(i); }, 250); }
  function drawThumb(i) {
    var b = $("pmStrip").children[i]; if (!b) return;
    var box = b.querySelector(".box"); placeIn(box, S.slides[i], ctxFor(i));
  }
  var dragFrom = -1;
  function drawStrip() {
    var strip = $("pmStrip"); strip.innerHTML = "";
    S.slides.forEach(function (s, i) {
      var b = document.createElement("button"); b.type = "button"; b.className = "th" + (i === S.cur ? " on" : ""); b.draggable = true;
      b.setAttribute("aria-label", (i + 1) + " · " + P.NAMES.ar[s.type]);
      b.innerHTML = '<span class="n">' + (i + 1) + (s.trans === "morph" ? '<span class="trm" title="Morph">✦</span>' : "") + '</span><span class="box"></span>';
      b.onclick = function () { go(i); };
      b.ondragstart = function (ev) { dragFrom = i; ev.dataTransfer.effectAllowed = "move"; ev.dataTransfer.setData("text/plain", String(i)); };
      b.ondragover = function (ev) { if (dragFrom < 0 || dragFrom === i) return; ev.preventDefault(); b.classList.add("drop"); };
      b.ondragleave = function () { b.classList.remove("drop"); };
      b.ondrop = function (ev) { ev.preventDefault(); b.classList.remove("drop"); move(dragFrom, i); dragFrom = -1; };
      b.ondragend = function () { dragFrom = -1; };
      strip.appendChild(b); drawThumb(i);
    });
    var plus = document.createElement("button"); plus.type = "button"; plus.className = "plus"; plus.textContent = "+ شريحة";
    plus.onclick = function () { gallery(true); };
    strip.appendChild(plus);
  }
  function move(from, to) {
    if (from === to || from < 0) return;
    remember();
    var s = S.slides.splice(from, 1)[0]; S.slides.splice(to, 0, s); S.cur = to; S.sel = null; render();
  }
  function go(i) { S.cur = Math.max(0, Math.min(S.slides.length - 1, i)); S.sel = null; gallery(false); render(); }

  /* ---------- the ribbon and the status bar ---------- */
  function listOf(sel) {
    if (!sel) return null;
    var p = sel.key.split(".");
    return p.length === 3 && LISTS[p[0]] ? { name: p[0], index: +p[1], spec: LISTS[p[0]] } : null;
  }
  function ribbon() {
    var L = listOf(S.sel), arr = L ? S.slides[S.cur][L.name] : null;
    $("pmListGrp").hidden = !L;
    if (L) {
      $("pmListName").textContent = L.spec.name;
      $("pmItemAdd").textContent = "+ إضافة " + L.spec.one; $("pmItemAdd").disabled = arr.length >= L.spec.max;
      $("pmItemDel").textContent = "− حذف " + L.spec.one; $("pmItemDel").disabled = arr.length <= L.spec.min;
    }
    var photo = S.sel && S.sel.kind === "photo";
    $("pmPhoto").disabled = !photo;
    $("pmPhotoDel").disabled = !(photo && P.get(S.slides[S.cur], S.sel.key));
    $("pmPrev").disabled = S.cur === 0; $("pmNext").disabled = S.cur === S.slides.length - 1; $("pmDel").disabled = S.slides.length < 2;
    $("pmWhere").textContent = "الشريحة " + (S.cur + 1) + " من " + S.slides.length + " · " + P.NAMES.ar[S.slides[S.cur].type];
    $("pmLangBrand").textContent = (S.lang === "en" ? "English" : "عربي") + " · " + P.BRANDS[S.brand].name;
    fmtRibbon(); transRibbon();
    $("pmBarDeck").textContent = S.deck ? "· " + S.deck : "";
  }
  function render() { drawStrip(); drawStage(); ribbon(); $("pmNotes").value = S.slides[S.cur].notes || ""; saveSoon(); }

  /* ---------- «الخط» and «الفقرة»: the selected text box's formatting ----------
     Formatting is the whole box's, as when a box is selected in PowerPoint; it
     is kept in slide.fmt and reaches the PowerPoint and the PDF from the
     shapes. The font is always Somar Sans: the ribbon chooses its weight. */
  var PT = [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 44, 48, 54, 60, 66, 72, 80, 88, 96];
  var LIST_RE = /^(•\s|\d+[.)]\s)/;
  function selShape() {
    if (!S.sel || S.sel.kind !== "text") return null;
    var key = S.sel.key;
    return P.shapes(S.slides[S.cur], ctxFor(S.cur, true)).filter(function (e) { return e.key === key && e.t === "text"; })[0] || null;
  }
  function fmtRibbon() {
    var e = selShape(), on = !!e;
    [].forEach.call(document.querySelectorAll("#pmFontGrp button,#pmFontGrp select,#pmFontGrp input,#pmParaGrp button"), function (b) { b.disabled = !on; });
    function tog(id, v) { $(id).classList.toggle("on", !!v); $(id).setAttribute("aria-pressed", v ? "true" : "false"); }
    if (!e) { $("pmSize").value = ""; return; }
    $("pmWeight").value = String(e.weight || 400);
    $("pmSize").value = String(Math.round(e.size * 0.75 * 10) / 10);
    tog("fBold", e.weight >= 700); tog("fItalic", e.italic); tog("fUnder", e.underline); tog("fShadow", e.shadow); tog("fStrike", e.strike);
    $("fColor").querySelector(".bar").style.background = e.color;
    $("fHl").querySelector(".bar").style.background = e.hl || "transparent";
    var rtl = S.lang !== "en", al = e.align === "justify" || e.align === "center" ? e.align : P.side(e, rtl);
    tog("pRight", al === "right"); tog("pCenter", al === "center"); tog("pLeft", al === "left"); tog("pJust", al === "justify");
    var dir = P.dirOf(e, rtl); tog("pRtl", dir === "rtl"); tog("pLtr", dir === "ltr");
    var lines = String(e.text || "").split("\n");
    tog("pBul", lines.every(function (l) { return /^•\s/.test(l); }));
    tog("pNum", lines.every(function (l) { return /^\d+[.)]\s/.test(l); }));
    $("pIndL").disabled = !e.indent; $("pIndM").disabled = (e.indent || 0) >= 5;
  }
  /* Restyles the box being edited from its shape, keeping the caret where it is. */
  function restyle() {
    var d = selEl(), e = selShape();
    if (d && e) { styleTx(d, e, ctxFor(S.cur, true)); if (d.textContent !== String(e.text || "")) d.textContent = e.text || ""; }
    frame(); fmtRibbon(); thumbSoon(S.cur); saveSoon();
  }
  function setFmt(props) {
    if (!selShape()) return;
    remember();
    var s = S.slides[S.cur], key = S.sel.key; s.fmt = s.fmt || {};
    var f = s.fmt[key] = s.fmt[key] || {};
    for (var k in props) { if (props[k] === null) delete f[k]; else f[k] = props[k]; }
    restyle();
  }
  function refocus() {
    var d = selEl(); if (!d || document.activeElement === d) return;
    d.focus();
    var r = document.createRange(); r.selectNodeContents(d); r.collapse(false);
    var sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
  }
  function stepSize(up) {
    var e = selShape(); if (!e) return;
    var pt = Math.round(e.size * 0.75 * 10) / 10, next = up ? PT.filter(function (p) { return p > pt; })[0] : PT.filter(function (p) { return p < pt; }).pop();
    if (next) setFmt({ size: next / 0.75 });
  }
  function listToggle(kind) {
    var e = selShape(); if (!e) return;
    var lines = String(e.text || "").split("\n"), isOn = lines.every(function (l) { return kind === "bullet" ? /^•\s/.test(l) : /^\d+[.)]\s/.test(l); });
    var plain = lines.map(function (l) { return l.replace(LIST_RE, ""); });
    var out = isOn ? plain : plain.map(function (l, i) { return (kind === "bullet" ? "• " : (i + 1) + ". ") + l; });
    remember(); setPath(S.slides[S.cur], S.sel.key, out.join("\n")); restyle();
  }
  /* Enter on a line that starts with a bullet or a number starts the next one. */
  function listEnter(ev) {
    if (ev.key !== "Enter" || ev.shiftKey) return;
    var d = ev.target.closest && ev.target.closest(".ed"), sel = getSelection(); if (!d || !sel.rangeCount) return;
    var r = sel.getRangeAt(0).cloneRange(); r.setStart(d, 0);
    var line = r.toString().split("\n").pop(), m = /^(\d+)([.)])\s/.exec(line), pre = /^•\s/.test(line) ? "• " : m ? (+m[1] + 1) + m[2] + " " : "";
    if (!pre) return;
    ev.preventDefault(); document.execCommand("insertText", false, "\n" + pre);
  }
  /* A small menu under a ribbon button: colours, spacing, case, line spacing. */
  function menu(btn, items, pick, swatches) {
    var m = $("pmMenu");
    if (!m.hidden && m.dataset.for === btn.id) { m.hidden = true; return; }
    m.innerHTML = ""; m.dataset.for = btn.id; m.className = "menu" + (swatches ? " sw" : "");
    items.forEach(function (it) {
      var b = document.createElement("button"); b.type = "button";
      if (swatches) { b.title = it.label; b.setAttribute("aria-label", it.label); b.style.background = it.value || "#fff"; if (!it.value) b.className = "none"; }
      else { b.textContent = it.label; if (it.on) b.className = "on"; }
      b.onclick = function () { m.hidden = true; pick(it.value); };
      m.appendChild(b);
    });
    var r = btn.getBoundingClientRect();
    m.hidden = false; m.style.top = Math.round(r.bottom + 4) + "px";
    m.style.left = Math.round(Math.min(innerWidth - m.offsetWidth - 8, Math.max(8, r.right - m.offsetWidth))) + "px";
  }
  function wireFormat() {
    var b = P.BRANDS[S.brand];
    // buttons keep the caret in the text box; the lists and the size field take it and give it back
    [$("pmFontGrp"), $("pmParaGrp"), $("pmMenu")].forEach(function (g) {
      g.addEventListener("mousedown", function (ev) { if (ev.target.closest("button")) ev.preventDefault(); });
    });
    $("pmWeight").onchange = function () { setFmt({ weight: +this.value }); refocus(); };
    $("pmSize").onchange = function () { var pt = parseFloat(this.value); if (pt >= 4 && pt <= 400) setFmt({ size: pt / 0.75 }); else fmtRibbon(); refocus(); };
    $("pmSize").onkeydown = function (ev) { if (ev.key === "Enter") { ev.preventDefault(); this.onchange(); } };
    $("fGrow").onclick = function () { stepSize(true); };
    $("fShrink").onclick = function () { stepSize(false); };
    $("fClear").onclick = function () { var s = S.slides[S.cur]; if (!selShape() || !s.fmt || !s.fmt[S.sel.key]) return; remember(); delete s.fmt[S.sel.key]; restyle(); };
    $("fBold").onclick = function () { var e = selShape(); if (e) setFmt({ weight: e.weight >= 700 ? 400 : 700 }); };
    $("fItalic").onclick = function () { var e = selShape(); if (e) setFmt({ italic: e.italic ? null : true }); };
    $("fUnder").onclick = function () { var e = selShape(); if (e) setFmt({ underline: e.underline ? null : true }); };
    $("fShadow").onclick = function () { var e = selShape(); if (e) setFmt({ shadow: e.shadow ? null : true }); };
    $("fStrike").onclick = function () { var e = selShape(); if (e) setFmt({ strike: e.strike ? null : true }); };
    $("fSpace").onclick = function () {
      var e = selShape(), v = (e && e.spacing) || 0;
      menu(this, [{ label: "ضيق جداً", value: -1.5 }, { label: "ضيق", value: -0.75 }, { label: "عادي", value: 0 }, { label: "واسع", value: 1.5 }, { label: "واسع جداً", value: 3 }]
        .map(function (it) { it.on = it.value === v; return it; }), function (val) { setFmt({ spacing: val || null }); });
    };
    $("fCase").onclick = function () {
      var e = selShape(), v = (e && e.caps) || null;
      menu(this, [{ label: "كما كُتب", value: null }, { label: "UPPERCASE", value: "upper" }, { label: "lowercase", value: "lower" }, { label: "Capitalize Each Word", value: "title" }]
        .map(function (it) { it.on = it.value === v; return it; }), function (val) { setFmt({ caps: val }); });
    };
    $("fHl").onclick = function () {
      menu(this, [{ label: "بلا تظليل", value: null }, { label: "أصفر", value: "#ffe94d" }, { label: "رمادي فاتح", value: "#e9eaec" }, { label: "رمادي", value: "#d3d3d5" }, { label: "أبيض", value: "#ffffff" }],
        function (val) { setFmt({ hl: val }); }, true);
    };
    $("fColor").onclick = function () {
      b = P.BRANDS[S.brand];
      menu(this, [{ label: "أحمر الهوية", value: b.main }, { label: "أحمر غامق", value: b.deep }, { label: "رمادي غامق", value: b.dark }, { label: "رمادي النص", value: b.text },
        { label: "رمادي فاتح", value: b.muted }, { label: "أسود", value: "#000000" }, { label: "أبيض", value: "#ffffff" }], function (val) { setFmt({ color: val }); }, true);
    };
    $("pBul").onclick = function () { listToggle("bullet"); };
    $("pNum").onclick = function () { listToggle("number"); };
    $("pIndL").onclick = function () { var e = selShape(); if (e && e.indent) setFmt({ indent: e.indent - 1 || null }); };
    $("pIndM").onclick = function () { var e = selShape(); if (e && (e.indent || 0) < 5) setFmt({ indent: (e.indent || 0) + 1 }); };
    $("pLh").onclick = function () {
      var e = selShape(), v = e && (e.lh || 1.25);
      menu(this, [1, 1.15, 1.25, 1.5, 2, 2.5, 3].map(function (x) { return { label: x.toFixed(x % 1 ? 2 : 1).replace(/0$/, ""), value: x, on: x === v }; }), function (val) { setFmt({ lh: val }); });
    };
    // the alignment buttons are where they look; kept as start / end so English mirrors them
    function align(phys) { var rtl = S.lang !== "en"; setFmt({ align: phys === "center" || phys === "justify" ? phys : (phys === "right") === rtl ? "start" : "end" }); }
    $("pRight").onclick = function () { align("right"); };
    $("pCenter").onclick = function () { align("center"); };
    $("pLeft").onclick = function () { align("left"); };
    $("pJust").onclick = function () { align("justify"); };
    $("pRtl").onclick = function () { setFmt({ dir: "rtl" }); };
    $("pLtr").onclick = function () { setFmt({ dir: "ltr" }); };
    document.addEventListener("mousedown", function (ev) { var m = $("pmMenu"); if (!m.hidden && !m.contains(ev.target) && !ev.target.closest("#" + m.dataset.for)) m.hidden = true; });
  }

  function tabTo(name) {
    [].forEach.call(document.querySelectorAll(".tab"), function (t) { t.classList.toggle("on", t.dataset.tab === name); });
    $("rbHome").hidden = name !== "home"; $("rbFile").hidden = name !== "file"; $("rbDesign").hidden = name !== "design"; $("rbTrans").hidden = name !== "trans";
    gallery(false);
  }
  function gallery(open) {
    var g = $("pmGallery");
    if (open === undefined) open = g.hidden;
    g.hidden = !open; $("pmNew").classList.toggle("open", open); $("pmNew").setAttribute("aria-expanded", open ? "true" : "false");
    if (!open) return;
    var r = $("pmNew").getBoundingClientRect(); g.style.top = Math.round(r.bottom + 8) + "px";
    var grid = $("pmGalleryGrid"); grid.innerHTML = "";
    P.ORDER.forEach(function (t, i) {
      var b = document.createElement("button"); b.type = "button";
      b.innerHTML = '<span class="box"></span>' + esc(P.NAMES.ar[t]);
      b.onclick = function () { remember(); S.slides.splice(S.cur + 1, 0, P.blank(t, S.lang)); gallery(false); go(S.cur + 1); };
      grid.appendChild(b);
      placeIn(b.firstChild, P.blank(t, S.lang), ctxFor(i));
    });
  }

  /* ---------- Morph: the boxes the two slides share move and resize into
     their new places, the rest fade out and in, as PowerPoint's Morph ---------- */
  var MORPH_PROPS = ["left", "top", "width", "height", "fontSize", "color", "backgroundColor", "opacity", "objectPosition", "letterSpacing"];
  function morph(from, to, secs, done) {
    var ms = Math.round((secs || 2) * 1000), ease = "cubic-bezier(.45,0,.2,1)", bg = to.style.background, anims = [];
    var olds = {}; [].forEach.call(from.children, function (c) { if (c.dataset.m) olds[c.dataset.m] = c; });
    to.style.background = "transparent";
    [].forEach.call(to.children, function (c) {
      var a = olds[c.dataset.m], end = getComputedStyle(c), k0 = {}, k1 = {};
      if (a && a.tagName === c.tagName) {
        var st = getComputedStyle(a);
        MORPH_PROPS.forEach(function (p) { k0[p] = st[p]; k1[p] = end[p]; });
        a.style.visibility = "hidden"; delete olds[c.dataset.m];
        if (c.tagName === "IMG" && a.src !== c.src) {   // another photo in the same place: the old one fades out while moving
          var ghost = a.cloneNode(); ghost.style.visibility = ""; ghost.classList.add("ghost"); to.insertBefore(ghost, c);
          anims.push(ghost.animate([copy(k0, {}), copy(k1, { opacity: 0 })], { duration: ms, easing: ease, fill: "forwards" }));
          k0.opacity = 0;
        }
        anims.push(c.animate([k0, k1], { duration: ms, easing: ease }));
      } else anims.push(c.animate([{ opacity: 0 }, { opacity: end.opacity }], { duration: ms, easing: ease }));
    });
    for (var m in olds) anims.push(olds[m].animate([{ opacity: getComputedStyle(olds[m]).opacity }, { opacity: 0 }], { duration: ms * 0.6, easing: ease, fill: "forwards" }));
    var finish = function () {
      if (!from.parentNode && !to.parentNode) return;
      anims.forEach(function (x) { try { x.cancel(); } catch (e) {} });
      if (from.parentNode) from.remove();
      [].forEach.call(to.querySelectorAll(".ghost"), function (g) { g.remove(); });
      to.style.background = bg; to.morphDone = null; if (done) done();
    };
    to.morphDone = finish;
    setTimeout(finish, ms + 30);
  }
  /* «معاينة»: the slide before plays into this one on the stage, as the show would. */
  function previewTrans() {
    var st = $("pmStage"), i = S.cur, k = st.clientWidth / P.W;
    if (!S.slides[i].trans) return;
    st.innerHTML = "";
    var to = slideEl(S.slides[i], ctxFor(i)); to.style.transform = "scale(" + k + ")";
    if (i > 0) {
      var from = slideEl(S.slides[i - 1], ctxFor(i - 1)); from.style.transform = "scale(" + k + ")"; from.style.background = "#fff";
      st.appendChild(from); st.appendChild(to);
      morph(from, to, S.slides[i].dur, drawStage);
    } else { st.appendChild(to); to.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 600 }); setTimeout(drawStage, 650); }
  }
  function transRibbon() {
    var s = S.slides[S.cur], on = s.trans === "morph";
    $("pmTrMorph").classList.toggle("on", on); $("pmTrMorph").setAttribute("aria-pressed", on ? "true" : "false");
    $("pmTrNone").classList.toggle("on", !on); $("pmTrNone").setAttribute("aria-pressed", on ? "false" : "true");
    $("pmTrDur").value = String(s.dur || 2); $("pmTrDur").disabled = !on; $("pmTrPreview").disabled = !on;
  }

  /* ---------- «عرض»: the deck full screen ----------
     The next slide: a click, Space, Enter, Page Down, the down arrow, or the
     arrow pointing the way the deck reads (left in Arabic, right in English);
     Esc ends the show, as leaving full screen does. */
  var show = null;
  function present(from) {
    var o = $("pmShow"); show = { i: Math.max(0, Math.min(S.slides.length - 1, from)) };
    o.hidden = false; showSlide();
    if (o.requestFullscreen) o.requestFullscreen().catch(function () {});
  }
  function showSlide(animate) {
    var o = $("pmShow"), k = Math.min(innerWidth / P.W, innerHeight / P.H), s = S.slides[show.i];
    var last = o.lastChild; if (last && last.morphDone) { last.morphDone(); last = o.lastChild; }   // a morph still running ends at once
    var el = slideEl(s, ctxFor(show.i));
    el.style.transform = "scale(" + k + ")"; el.style.left = Math.round((innerWidth - P.W * k) / 2) + "px"; el.style.top = Math.round((innerHeight - P.H * k) / 2) + "px";
    if (animate && last && s.trans === "morph") { o.appendChild(el); morph(last, el, s.dur); return; }
    o.innerHTML = ""; o.appendChild(el);
  }
  function showStep(d) {
    var i = show.i + d; if (i < 0) return;
    if (i >= S.slides.length) { endShow(); return; }
    show.i = i; showSlide(d === 1);
  }
  function endShow() {
    if (!show) return;
    var at = show.i; show = null; $("pmShow").hidden = true; $("pmShow").innerHTML = "";
    if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(function () {});
    go(at);
  }
  function showKey(e) {
    var rtl = S.lang !== "en", k = e.key;
    if (k === "Escape") { endShow(); return; }
    if (k === " " || k === "Enter" || k === "PageDown" || k === "ArrowDown" || k === (rtl ? "ArrowLeft" : "ArrowRight")) { e.preventDefault(); showStep(1); }
    else if (k === "PageUp" || k === "ArrowUp" || k === "Backspace" || k === (rtl ? "ArrowRight" : "ArrowLeft")) { e.preventDefault(); showStep(-1); }
    else if (k === "Home") showStep(-show.i);
  }

  /* ---------- the keyboard, as in PowerPoint ---------- */
  function editing(t) { return t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)); }
  function keys(e) {
    if (show) { showKey(e); return; }
    var mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
    if (e.key === "Escape") { gallery(false); $("pmMenu").hidden = true; return; }
    if (mod && e.target.closest && e.target.closest(".ed")) {   // in a text box: PowerPoint's B, I, U and size keys
      if (k === "b") { e.preventDefault(); $("fBold").click(); return; }
      if (k === "i") { e.preventDefault(); $("fItalic").click(); return; }
      if (k === "u") { e.preventDefault(); $("fUnder").click(); return; }
      if (e.key === "]" || e.key === ">") { e.preventDefault(); stepSize(true); return; }
      if (e.key === "[" || e.key === "<") { e.preventDefault(); stepSize(false); return; }
    }
    if (mod && k === "s") { e.preventDefault(); save(); return; }
    if (e.key === "F5") { e.preventDefault(); present(e.shiftKey ? S.cur : 0); return; }
    if (editing(e.target)) return;   // typing: the browser's own keys, its own undo included
    if (mod && k === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
    else if (mod && (k === "y" || (k === "z" && e.shiftKey))) { e.preventDefault(); redo(); }
    else if (mod && k === "d") { e.preventDefault(); $("pmDup").click(); }
    else if (mod && k === "m") { e.preventDefault(); gallery(true); }
    else if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); $("pmDel").click(); }
    else if (e.key === "ArrowUp" || e.key === "PageUp") { e.preventDefault(); go(S.cur - 1); }
    else if (e.key === "ArrowDown" || e.key === "PageDown") { e.preventDefault(); go(S.cur + 1); }
    else if (e.key === "Home") { e.preventDefault(); go(0); }
    else if (e.key === "End") { e.preventDefault(); go(S.slides.length - 1); }
  }

  /* ---------- list items and photos, from the ribbon ---------- */
  function itemAdd() {
    var L = listOf(S.sel); if (!L) return;
    var arr = S.slides[S.cur][L.name]; if (arr.length >= L.spec.max) return;
    remember(); arr = S.slides[S.cur][L.name];
    arr.splice(L.index + 1, 0, L.spec.make());
    S.sel = { key: L.name + "." + (L.index + 1) + "." + Object.keys(L.spec.make())[0], kind: "text" };
    render(); focusSel();
  }
  function itemDel() {
    var L = listOf(S.sel); if (!L) return;
    var arr = S.slides[S.cur][L.name]; if (arr.length <= L.spec.min) return;
    remember(); S.slides[S.cur][L.name].splice(L.index, 1); S.sel = null; render();
  }
  function focusSel() {
    if (!S.sel) return;
    var d = $("pmStage").querySelector('.ed[data-key="' + S.sel.key + '"]'); if (d) d.focus();
  }
  function photoPicked(file) {
    if (!file || !S.sel || S.sel.kind !== "photo") return;
    var key = S.sel.key, at = S.cur;
    status("…جارٍ تجهيز الصورة");
    greyPhoto(file).then(function (src) { remember(); setPath(S.slides[at], key, src); if (S.slides[at].pos) delete S.slides[at].pos[key]; status(""); render(); }, function () { status("تعذّر فتح الصورة", true); });
  }

  /* A photo, black and white and at most 1600 px on its long side. */
  function loadImg(src) { return new Promise(function (ok, no) { var im = new Image(); im.onload = function () { ok(im); }; im.onerror = no; im.src = src; }); }
  function greyPhoto(file) {
    var url = URL.createObjectURL(file);
    return loadImg(url).then(function (im) {
      URL.revokeObjectURL(url);
      var k = Math.min(1, MAX_PHOTO / Math.max(im.naturalWidth, im.naturalHeight)), c = document.createElement("canvas");
      c.width = Math.round(im.naturalWidth * k); c.height = Math.round(im.naturalHeight * k);
      var g = c.getContext("2d"); g.filter = "grayscale(1)"; g.drawImage(im, 0, 0, c.width, c.height);
      return c.toDataURL("image/jpeg", 0.86);
    });
  }

  /* ---------- PowerPoint ---------- */
  function hex(c) { return String(c).replace("#", "").toUpperCase(); }
  /* A photo cut to its frame's shape (the PowerPoint has no "cover"), at twice the frame's size. */
  function cropped(src, w, h, px, py) {
    return loadImg(src).then(function (im) {
      var c = document.createElement("canvas"); c.width = Math.round(w * 2); c.height = Math.round(h * 2);
      var r = coverAt(im, c.width, c.height, px, py);
      c.getContext("2d").drawImage(im, r.x, r.y, r.w, r.h);
      return c.toDataURL("image/jpeg", 0.88);
    });
  }
  /* The logos as PNG: PowerPoint versions before 2019 cannot show SVG. */
  var logoPng = {};
  function logoData(src) {
    return logoPng[src] || (logoPng[src] = loadImg(src).then(function (im) {
      var c = document.createElement("canvas"); c.height = 240; c.width = Math.round(240 * P.LOGO_RATIO);
      c.getContext("2d").drawImage(im, 0, 0, c.width, c.height); return c.toDataURL("image/png");
    }));
  }
  function buildPptx() {
    var pptx = new PptxGenJS(); pptx.layout = "LAYOUT_16x9"; pptx.rtlMode = S.lang !== "en";
    pptx.title = S.deck || "Presentation"; pptx.company = P.BRANDS[S.brand].org;
    var jobs = Promise.resolve();
    S.slides.forEach(function (s, i) {
      jobs = jobs.then(function () {
        var ctx = ctxFor(i), slide = pptx.addSlide(), steps = Promise.resolve();
        if (s.notes && s.notes.trim()) slide.addNotes(s.notes);
        P.shapes(s, ctx).forEach(function (e) {
          steps = steps.then(function () { return addShape(pptx, slide, e, ctx); });
        });
        return steps;
      });
    });
    return jobs.then(function () { return pptx; });
  }
  function boxOf(e) { return { x: e.x / PX, y: e.y / PX, w: e.w / PX, h: e.h / PX }; }
  function addShape(pptx, slide, e, ctx) {
    var o, nm = e.key ? "!!" + e.key : e.t === "logo" ? "!!logo" : "";   // «!!» names: PowerPoint's Morph pairs the boxes by them
    function box(x) { var b = boxOf(x); if (nm) b.objectName = nm; return b; }
    if (e.t === "rect") {
      o = box(e);
      o.fill = e.fill ? { color: hex(e.fill), transparency: e.alpha != null ? Math.round((1 - e.alpha) * 100) : 0 } : { color: "FFFFFF", transparency: 100 };
      o.line = e.line ? { color: hex(e.line), width: e.lineW * 0.75 } : { type: "none" };
      slide.addShape(e.circle ? pptx.ShapeType.ellipse : pptx.ShapeType.rect, o);
      return null;
    }
    if (e.t === "logo") {
      return logoData(ctx.b.logo[e.variant]).then(function (data) {
        slide.addImage({ data: data, x: e.x / PX, y: e.y / PX, w: e.h * P.LOGO_RATIO / PX, h: e.h / PX, objectName: "!!logo" });
      });
    }
    if (e.t === "img") {
      if (e.src) return cropped(e.src, e.w, e.h, e.px, e.py).then(function (data) { o = box(e); o.data = data; if (e.circle) o.rounding = true; slide.addImage(o); });
      o = box(e); o.fill = { color: hex(P.GREY_PHOTO) }; o.line = { type: "none" };
      slide.addShape(e.circle ? pptx.ShapeType.ellipse : pptx.ShapeType.rect, o);
      return null;
    }
    if (!e.text) return null;
    var rtl = P.dirOf(e, ctx.rtl) === "rtl", ind = (e.indent || 0) * INDENT;
    if (e.hl) slide.addShape(pptx.ShapeType.rect, copy(boxOf(e), { fill: { color: hex(e.hl) }, line: { type: "none" } }));
    o = copy(box(ind ? copy(e, { x: rtl ? e.x : e.x + ind, w: e.w - ind }) : e), { fontFace: FONT[e.weight] || FONT[400], fontSize: Math.round(e.size * 0.75 * 10) / 10, color: hex(e.color),
      align: P.side(e, ctx.rtl), valign: e.valign || "top", margin: 0, rtlMode: rtl, lang: rtl ? "ar-SA" : "en-US",
      lineSpacing: Math.round(e.size * 0.75 * (e.lh || 1.25) * 10) / 10, fit: "shrink" });
    if (e.italic) o.italic = true;
    if (e.underline) o.underline = { style: "sng" };
    if (e.strike) o.strike = "sngStrike";
    if (e.spacing) o.charSpacing = Math.round(e.spacing * 0.75 * 10) / 10;
    if (e.shadow) o.shadow = { type: "outer", angle: 45, blur: 3, offset: 2, color: "000000", opacity: 0.35 };
    if (e.alpha != null) o.transparency = Math.round((1 - e.alpha) * 100);
    slide.addText(caseOf(e.text, e.caps), o);
    return null;
  }
  function fileBase() { return (S.deck || "Presentation").replace(/[\\/:*?"<>|]+/g, "").trim().slice(0, 60) || "Presentation"; }
  /* pptxgenjs writes no transitions: Morph is put into each slide's XML afterwards, as PowerPoint writes it
     (with Fade for PowerPoint versions before 2019). */
  function withMorph(pptx) {
    if (!S.slides.some(function (s) { return s.trans === "morph"; })) return pptx.writeFile({ fileName: fileBase() + ".pptx" });
    return pptx.write({ outputType: "blob" }).then(function (blob) { return JSZip.loadAsync(blob); }).then(function (zip) {
      var jobs = S.slides.map(function (s, i) {
        if (s.trans !== "morph") return null;
        var f = "ppt/slides/slide" + (i + 1) + ".xml", ms = Math.round((s.dur || 2) * 1000);
        var tr = '<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><mc:Choice xmlns:p159="http://schemas.microsoft.com/office/powerpoint/2015/09/main" Requires="p159">' +
          '<p:transition spd="slow" p14:dur="' + ms + '" xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main"><p159:morph option="byObject"/></p:transition></mc:Choice>' +
          '<mc:Fallback><p:transition spd="slow"><p:fade/></p:transition></mc:Fallback></mc:AlternateContent>';
        return zip.file(f).async("string").then(function (x) { zip.file(f, x.replace("</p:clrMapOvr></p:sld>", "</p:clrMapOvr>" + tr + "</p:sld>")); });
      });
      return Promise.all(jobs).then(function () { return zip.generateAsync({ type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation" }); });
    }).then(function (blob) { download(blob, fileBase() + ".pptx"); });
  }
  /* The export libraries (about 1 MB) load on the first download, not with the page. */
  var loading = {};
  function need(src) {
    return loading[src] || (loading[src] = new Promise(function (ok, no) {
      var sc = document.createElement("script"); sc.src = src;
      sc.onload = ok; sc.onerror = function () { delete loading[src]; no(new Error("تعذّر تحميل " + src)); };
      document.head.appendChild(sc);
    }));
  }
  function exportPptx() {
    if (S.busy) return; S.busy = true; status("…جارٍ تجهيز ملف PowerPoint");
    need("vendor/pptxgen.bundle.js").then(buildPptx).then(withMorph)
      .then(function () { status("✓ نزل ملف PowerPoint"); }, function (e) { status("تعذّر تجهيز الملف: " + ((e && e.message) || ""), true); })
      .then(function () { S.busy = false; });
  }

  /* ---------- PDF: each slide painted on a canvas from the same shapes, one page each ----------
     The browser's own text drawing joins Arabic letters properly, which a
     screenshot of the page (html2canvas) does not; text too long for its box
     shrinks until it fits, as the PowerPoint's does. */
  var PDF_SCALE = 2.5;
  /* Lines of a text that fit maxW; each knows whether it ends its paragraph (justified text leaves those as they are). */
  function wrap(g, text, maxW) {
    var out = [];
    String(text).split("\n").forEach(function (para) {
      var words = para.split(/\s+/), line = "";
      words.forEach(function (w) {
        var t = line ? line + " " + w : w;
        if (line && g.measureText(t).width > maxW) { out.push({ t: line }); line = w; } else line = t;
      });
      out.push({ t: line, last: true });
    });
    return out;
  }
  function paintText(g, e, rtl) {
    var dir = P.dirOf(e, rtl), ind = (e.indent || 0) * INDENT, bx = dir === "ltr" ? e.x + ind : e.x, bw = e.w - ind;
    var text = caseOf(e.text, e.caps), size = e.size, lh = e.lh || 1.25, lines;
    if ("letterSpacing" in g) g.letterSpacing = (e.spacing || 0) + "px";
    for (;;) {
      g.font = (e.italic ? "italic " : "") + e.weight + " " + size + "px 'Somar Sans'";
      lines = wrap(g, text, bw);
      if (lines.length * size * lh <= e.h + 1 || size <= 8) break;
      size -= 1;
    }
    g.globalAlpha = e.alpha != null ? e.alpha : 1;
    if (e.hl) { g.fillStyle = e.hl; g.fillRect(e.x, e.y, e.w, e.h); }
    var al = P.side(e, rtl), total = lines.length * size * lh, startSide = dir === "rtl" ? "right" : "left";
    var y = e.valign === "middle" ? e.y + (e.h - total) / 2 : e.valign === "bottom" ? e.y + e.h - total : e.y;
    g.fillStyle = e.color; g.direction = dir; g.textBaseline = "middle";
    if (e.shadow) { g.shadowColor = "rgba(0,0,0,.35)"; g.shadowOffsetX = 2; g.shadowOffsetY = 2; g.shadowBlur = 3; }
    lines.forEach(function (ln, k) {
      var ym = y + (k + 0.5) * size * lh, a = al, words = ln.t.split(" "), x0, x1;
      if (a === "justify" && !ln.last && words.length > 1) {
        var ws = words.map(function (w) { return g.measureText(w).width; }), gap = (bw - ws.reduce(function (p, q) { return p + q; }, 0)) / (words.length - 1);
        var cur = dir === "rtl" ? bx + bw : bx;
        g.textAlign = startSide;
        words.forEach(function (w, j) { g.fillText(w, cur, ym); cur += (dir === "rtl" ? -1 : 1) * (ws[j] + gap); });
        x0 = bx; x1 = bx + bw;
      } else {
        if (a === "justify") a = startSide;
        var x = a === "center" ? bx + bw / 2 : a === "right" ? bx + bw : bx, lw = g.measureText(ln.t).width;
        g.textAlign = a; g.fillText(ln.t, x, ym);
        x0 = a === "center" ? x - lw / 2 : a === "right" ? x - lw : x; x1 = x0 + lw;
      }
      if (ln.t && (e.underline || e.strike)) {
        var th = Math.max(1, size * 0.06);
        if (e.underline) g.fillRect(x0, ym + size * 0.42, x1 - x0, th);
        if (e.strike) g.fillRect(x0, ym + size * 0.04, x1 - x0, th);
      }
    });
    g.shadowColor = "transparent"; g.shadowBlur = 0; g.shadowOffsetX = 0; g.shadowOffsetY = 0;
    if ("letterSpacing" in g) g.letterSpacing = "0px";
    g.globalAlpha = 1;
  }
  function paint(i) {
    var ctx = ctxFor(i), c = document.createElement("canvas"), g = c.getContext("2d"), jobs = Promise.resolve();
    c.width = P.W * PDF_SCALE; c.height = P.H * PDF_SCALE; g.scale(PDF_SCALE, PDF_SCALE);
    g.fillStyle = "#ffffff"; g.fillRect(0, 0, P.W, P.H);
    P.shapes(S.slides[i], ctx).forEach(function (e) {
      jobs = jobs.then(function () {
        if (e.t === "rect") {
          g.globalAlpha = e.alpha != null ? e.alpha : 1;
          g.beginPath();
          if (e.circle) g.ellipse(e.x + e.w / 2, e.y + e.h / 2, e.w / 2, e.h / 2, 0, 0, Math.PI * 2); else g.rect(e.x, e.y, e.w, e.h);
          if (e.fill) { g.fillStyle = e.fill; g.fill(); }
          if (e.line) { g.lineWidth = e.lineW; g.strokeStyle = e.line; g.stroke(); }
          g.globalAlpha = 1; return null;
        }
        if (e.t === "logo") return logoData(ctx.b.logo[e.variant]).then(loadImg).then(function (im) { g.drawImage(im, e.x, e.y, e.h * P.LOGO_RATIO, e.h); });
        if (e.t === "img") {
          g.save(); g.beginPath();
          if (e.circle) g.ellipse(e.x + e.w / 2, e.y + e.h / 2, e.w / 2, e.h / 2, 0, 0, Math.PI * 2); else g.rect(e.x, e.y, e.w, e.h);
          g.clip();
          if (!e.src) {
            g.fillStyle = P.GREY_PHOTO; g.fillRect(e.x, e.y, e.w, e.h); g.restore();   // no photo yet: the grey place, without the editor's hint
            return null;
          }
          return loadImg(e.src).then(function (im) {
            var r = coverAt(im, e.w, e.h, e.px, e.py);
            g.drawImage(im, e.x + r.x, e.y + r.y, r.w, r.h); g.restore();
          });
        }
        if (e.text) paintText(g, e, ctx.rtl);
        return null;
      });
    });
    return jobs.then(function () { return c; });
  }
  function exportPdf() {
    if (S.busy) return; S.busy = true; status("…جارٍ تجهيز ملف PDF");
    var pdfDoc, fonts = document.fonts ? Promise.all([400, 700, 900].map(function (w) { return document.fonts.load(w + " 20px 'Somar Sans'"); })) : Promise.resolve();
    Promise.all([fonts, need("../vendor/pdf-lib.min.js")]).then(function () { return PDFLib.PDFDocument.create(); })
      .then(function (d) {
        pdfDoc = d; var chain = Promise.resolve();
        S.slides.forEach(function (s, i) {
          chain = chain.then(function () {
            status("…جارٍ تجهيز ملف PDF · " + (i + 1) + " من " + S.slides.length);
            return paint(i).then(function (cv) { return pdfDoc.embedJpg(cv.toDataURL("image/jpeg", 0.92)); })
              .then(function (img) { var page = pdfDoc.addPage([720, 405]); page.drawImage(img, { x: 0, y: 0, width: 720, height: 405 }); });
          });
        });
        return chain;
      })
      .then(function () { return pdfDoc.save(); })
      .then(function (bytes) { download(new Blob([bytes], { type: "application/pdf" }), fileBase() + ".pdf"); status("✓ نزل ملف PDF"); },
            function (e) { status("تعذّر تجهيز الملف: " + ((e && e.message) || ""), true); })
      .then(function () { S.busy = false; });
  }
  function download(blob, name) {
    var url = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  /* A language switch also switches the starting text nobody has changed yet,
     field by field: what still reads as the other language's sample. */
  function relabel(from, to) {
    S.slides.forEach(function (s, i) {
      var a = P.blank(s.type, from), b = P.blank(s.type, to);
      Object.keys(a).forEach(function (k) {
        if (Array.isArray(a[k])) (s[k] || []).forEach(function (it, j) {
          if (!a[k][j]) return;
          Object.keys(a[k][j]).forEach(function (f) { if (typeof it[f] === "string" && it[f] === a[k][j][f]) it[f] = b[k][j][f]; });
        });
        else if (typeof s[k] === "string" && s[k] === a[k]) s[k] = b[k];
      });
    });
  }

  /* ---------- projects ---------- */
  function save() {
    download(new Blob([JSON.stringify({ v: 1, tool: "presentation-maker", brand: S.brand, lang: S.lang, deck: S.deck, slides: S.slides })], { type: "application/json" }), fileBase() + ".json");
    status("✓ انحفظ المشروع");
  }
  function open(file) {
    file.text().then(function (t) {
      var d = JSON.parse(t);
      if (!d || d.tool !== "presentation-maker" || !Array.isArray(d.slides) || !d.slides.length) throw new Error("bad");
      S.brand = P.BRANDS[d.brand] ? d.brand : "hope-center"; S.lang = d.lang === "en" ? "en" : "ar"; S.deck = String(d.deck || "");
      remember();
      S.slides = d.slides.filter(function (s) { return s && P.NAMES.ar[s.type]; }); S.cur = 0;
      $("pmBrand").value = S.brand; $("pmLang").value = S.lang; $("pmDeck").value = S.deck;
      status("✓ انفتح المشروع"); S.sel = null; render();
    }).catch(function () { status("هاد الملف مو مشروع Presentation Maker", true); });
  }

  /* ---------- wiring ---------- */
  function wire(saved) {
    if (saved && Array.isArray(saved.slides) && saved.slides.length) {   // AutoRecover: back where the last visit left off
      S.brand = P.BRANDS[saved.brand] ? saved.brand : "hope-center"; S.lang = saved.lang === "en" ? "en" : "ar"; S.deck = String(saved.deck || "");
      S.slides = saved.slides.filter(function (x) { return x && P.NAMES.ar[x.type]; }); S.cur = Math.min(+saved.cur || 0, S.slides.length - 1);
      if (!S.slides.length) fresh();
    } else fresh();
    syncDesign();
    var st = $("pmStage");
    st.addEventListener("input", onType);
    st.addEventListener("focusin", onFocus);
    st.addEventListener("click", onClick);
    st.addEventListener("focusout", function () { thumbSoon(S.cur); });
    st.addEventListener("pointerdown", onHandle);
    st.addEventListener("pointerdown", onPan);
    st.addEventListener("dblclick", onDblClick);
    st.addEventListener("keydown", listEnter);
    $("pmTrNone").onclick = function () { var s = S.slides[S.cur]; if (!s.trans) return; remember(); delete s.trans; delete s.dur; drawStrip(); ribbon(); saveSoon(); };
    $("pmTrMorph").onclick = function () { var s = S.slides[S.cur]; if (s.trans !== "morph") { remember(); s.trans = "morph"; drawStrip(); ribbon(); saveSoon(); } previewTrans(); };
    $("pmTrDur").onchange = function () { var s = S.slides[S.cur]; if (!s.trans) return; remember(); s.dur = +this.value; saveSoon(); };
    $("pmTrAll").onclick = function () {
      var s = S.slides[S.cur]; remember();
      S.slides.forEach(function (x) { if (s.trans) { x.trans = s.trans; x.dur = s.dur || 2; } else { delete x.trans; delete x.dur; } });
      drawStrip(); ribbon(); saveSoon(); status(s.trans ? "✓ Morph على كل الشرائح" : "✓ بلا انتقال على كل الشرائح");
    };
    $("pmTrPreview").onclick = previewTrans;
    wireFormat();
    [].forEach.call(document.querySelectorAll(".tab"), function (t) { t.onclick = function () { tabTo(t.dataset.tab); }; });
    $("pmNew").onclick = function () { gallery(); };
    $("pmDup").onclick = function () { remember(); S.slides.splice(S.cur + 1, 0, clone(S.slides[S.cur])); go(S.cur + 1); };
    $("pmDel").onclick = function () { if (S.slides.length < 2) return; remember(); S.slides.splice(S.cur, 1); go(Math.min(S.cur, S.slides.length - 1)); };
    $("pmUndo").onclick = undo;
    $("pmRedo").onclick = redo;
    $("pmPresent").onclick = function () { present(S.cur); };
    $("pmShow").onclick = function () { showStep(1); };
    document.addEventListener("fullscreenchange", function () { if (!document.fullscreenElement && show) endShow(); });
    window.addEventListener("resize", function () { if (show) showSlide(); });
    $("pmNew2").onclick = function () {
      if (!confirm("نبلّش عرض جديد؟ العرض الحالي فيك ترجعله بـ «تراجع».")) return;
      remember(); fresh(); S.deck = ""; syncDesign(); go(0);
    };
    var notesArmed = false;
    $("pmNotes").onfocus = function () { notesArmed = true; };
    $("pmNotes").oninput = function () { if (notesArmed) { notesArmed = false; remember(); } S.slides[S.cur].notes = this.value; saveSoon(); };
    $("pmPrev").onclick = function () { if (S.cur > 0) move(S.cur, S.cur - 1); };
    $("pmNext").onclick = function () { if (S.cur < S.slides.length - 1) move(S.cur, S.cur + 1); };
    $("pmItemAdd").onclick = itemAdd;
    $("pmItemDel").onclick = itemDel;
    $("pmPhoto").onclick = function () { if (S.sel && S.sel.kind === "photo") $("pmPhotoFile").click(); };
    $("pmPhotoDel").onclick = function () { if (S.sel && S.sel.kind === "photo") { remember(); setPath(S.slides[S.cur], S.sel.key, null); render(); } };
    $("pmPhotoFile").onchange = function (e) { photoPicked(e.target.files[0]); e.target.value = ""; };
    [].forEach.call(document.querySelectorAll('[data-act="pptx"]'), function (b) { b.onclick = exportPptx; });
    [].forEach.call(document.querySelectorAll('[data-act="pdf"]'), function (b) { b.onclick = exportPdf; });
    $("pmSave").onclick = save;
    $("pmOpen").onchange = function (e) { if (e.target.files[0]) open(e.target.files[0]); e.target.value = ""; };
    $("pmBrand").onchange = function () { remember(); S.brand = this.value; render(); };
    $("pmLang").onchange = function () { remember(); var was = S.lang; S.lang = this.value; relabel(was, S.lang); render(); };
    var deckArmed = false;
    $("pmDeck").onfocus = function () { deckArmed = true; };
    $("pmDeck").oninput = function () { if (deckArmed) { deckArmed = false; remember(); } S.deck = this.value; drawStage(); ribbon(); saveSoon(); S.slides.forEach(function (s, i) { thumbSoon(i); }); };
    document.addEventListener("keydown", keys);
    document.addEventListener("click", function (e) {
      var g = $("pmGallery");
      if (!g.hidden && !g.contains(e.target) && !e.target.closest("#pmNew") && !e.target.closest(".plus")) gallery(false);
    });
    window.addEventListener("resize", sizeStage);
    render();
    if (document.fonts) document.fonts.ready.then(render);
  }

  pmAccess().then(loadSaved).then(function (saved) { $("pmGate").hidden = true; $("pmApp").hidden = false; wire(saved); }, function (e) {
    if (e && e.message === "denied") $("pmGateMsg").textContent = "لا تملك صلاحية الوصول إلى هذه الأداة.";
  });
})();
