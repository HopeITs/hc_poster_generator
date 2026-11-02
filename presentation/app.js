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
  var FONT = { 400: "Somar Sans", 700: "Somar Sans Bold", 900: "Somar Sans Black" };   // the installed families, one per weight

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
  function slideEl(slide, ctx) {
    var root = document.createElement("div");
    root.className = "slide"; root.dir = ctx.rtl ? "rtl" : "ltr";
    P.shapes(slide, ctx).forEach(function (e) {
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
        if (e.src) { d = document.createElement("img"); d.className = "im"; d.src = e.src; d.alt = ""; }
        else { d = document.createElement("div"); d.className = "noimg"; d.style.background = P.GREY_PHOTO; d.innerHTML = PHOTO_ICON + (e.label && ctx.edit ? "<span>" + esc(e.label) + "</span>" : ""); }
        if (e.circle) d.style.borderRadius = "50%";
        if (ctx.edit && e.key) { d.classList.add("pick"); d.dataset.key = e.key; if (S.sel && S.sel.key === e.key) d.classList.add("sel"); }
      } else {
        if (!ctx.edit && !e.text) return;
        d = document.createElement("div"); d.className = "tx";
        d.style.fontSize = e.size + "px"; d.style.fontWeight = e.weight; d.style.color = e.color; d.style.lineHeight = e.lh || 1.25;
        d.style.textAlign = P.side(e, ctx.rtl);
        d.style.justifyContent = e.valign === "middle" ? "center" : e.valign === "bottom" ? "flex-end" : "flex-start";
        d.style.direction = e.ltr ? "ltr" : (ctx.rtl ? "rtl" : "ltr");
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
      root.appendChild(d);
    });
    return root;
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
  }
  function drawStage() {
    var st = $("pmStage"), el;
    sizeStage();
    el = placeIn(st, S.slides[S.cur], ctxFor(S.cur, true));
    fitTo(st, el, st.clientWidth);
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
    S.sel = { key: d.dataset.key, kind: "text" }; armed = true; ribbon();
  }
  function onClick(e) {
    var d = e.target.closest && e.target.closest(".pick"); if (!d) return;
    S.sel = { key: d.dataset.key, kind: "photo" };
    [].forEach.call($("pmStage").querySelectorAll(".pick"), function (x) { x.classList.toggle("sel", x === d); });
    ribbon(); $("pmPhotoFile").click();
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
      b.innerHTML = '<span class="n">' + (i + 1) + '</span><span class="box"></span>';
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
    $("pmBarDeck").textContent = S.deck ? "· " + S.deck : "";
  }
  function render() { drawStrip(); drawStage(); ribbon(); $("pmNotes").value = S.slides[S.cur].notes || ""; saveSoon(); }

  function tabTo(name) {
    [].forEach.call(document.querySelectorAll(".tab"), function (t) { t.classList.toggle("on", t.dataset.tab === name); });
    $("rbHome").hidden = name !== "home"; $("rbFile").hidden = name !== "file"; $("rbDesign").hidden = name !== "design";
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
  function showSlide() {
    var o = $("pmShow"), k = Math.min(innerWidth / P.W, innerHeight / P.H);
    o.innerHTML = ""; var el = slideEl(S.slides[show.i], ctxFor(show.i));
    el.style.transform = "scale(" + k + ")"; el.style.left = Math.round((innerWidth - P.W * k) / 2) + "px"; el.style.top = Math.round((innerHeight - P.H * k) / 2) + "px";
    o.appendChild(el);
  }
  function showStep(d) {
    var i = show.i + d; if (i < 0) return;
    if (i >= S.slides.length) { endShow(); return; }
    show.i = i; showSlide();
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
    if (e.key === "Escape") { gallery(false); return; }
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
    greyPhoto(file).then(function (src) { remember(); setPath(S.slides[at], key, src); status(""); render(); }, function () { status("تعذّر فتح الصورة", true); });
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
  function cropped(src, w, h) {
    return loadImg(src).then(function (im) {
      var c = document.createElement("canvas"); c.width = Math.round(w * 2); c.height = Math.round(h * 2);
      var s = Math.max(c.width / im.naturalWidth, c.height / im.naturalHeight), dw = im.naturalWidth * s, dh = im.naturalHeight * s;
      c.getContext("2d").drawImage(im, (c.width - dw) / 2, (c.height - dh) / 2, dw, dh);
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
  function box(e) { return { x: e.x / PX, y: e.y / PX, w: e.w / PX, h: e.h / PX }; }
  function addShape(pptx, slide, e, ctx) {
    var o;
    if (e.t === "rect") {
      o = box(e);
      o.fill = e.fill ? { color: hex(e.fill), transparency: e.alpha != null ? Math.round((1 - e.alpha) * 100) : 0 } : { color: "FFFFFF", transparency: 100 };
      o.line = e.line ? { color: hex(e.line), width: e.lineW * 0.75 } : { type: "none" };
      slide.addShape(e.circle ? pptx.ShapeType.ellipse : pptx.ShapeType.rect, o);
      return null;
    }
    if (e.t === "logo") {
      return logoData(ctx.b.logo[e.variant]).then(function (data) {
        slide.addImage({ data: data, x: e.x / PX, y: e.y / PX, w: e.h * P.LOGO_RATIO / PX, h: e.h / PX });
      });
    }
    if (e.t === "img") {
      if (e.src) return cropped(e.src, e.w, e.h).then(function (data) { o = box(e); o.data = data; if (e.circle) o.rounding = true; slide.addImage(o); });
      o = box(e); o.fill = { color: hex(P.GREY_PHOTO) }; o.line = { type: "none" };
      slide.addShape(e.circle ? pptx.ShapeType.ellipse : pptx.ShapeType.rect, o);
      return null;
    }
    if (!e.text) return null;
    var rtl = ctx.rtl && !e.ltr;
    o = copy(box(e), { fontFace: FONT[e.weight] || FONT[400], fontSize: Math.round(e.size * 0.75 * 10) / 10, color: hex(e.color),
      align: P.side(e, ctx.rtl), valign: e.valign || "top", margin: 0, rtlMode: rtl, lang: rtl ? "ar-SA" : "en-US",
      lineSpacingMultiple: e.lh || 1.15, fit: "shrink" });
    if (e.alpha != null) o.transparency = Math.round((1 - e.alpha) * 100);
    slide.addText(e.text, o);
    return null;
  }
  function fileBase() { return (S.deck || "Presentation").replace(/[\\/:*?"<>|]+/g, "").trim().slice(0, 60) || "Presentation"; }
  function exportPptx() {
    if (S.busy) return; S.busy = true; status("…جارٍ تجهيز ملف PowerPoint");
    buildPptx().then(function (pptx) { return pptx.writeFile({ fileName: fileBase() + ".pptx" }); })
      .then(function () { status("✓ نزل ملف PowerPoint"); }, function (e) { status("تعذّر تجهيز الملف: " + ((e && e.message) || ""), true); })
      .then(function () { S.busy = false; });
  }

  /* ---------- PDF: each slide painted on a canvas from the same shapes, one page each ----------
     The browser's own text drawing joins Arabic letters properly, which a
     screenshot of the page (html2canvas) does not; text too long for its box
     shrinks until it fits, as the PowerPoint's does. */
  var PDF_SCALE = 2.5;
  function wrap(g, text, maxW) {
    var out = [];
    String(text).split("\n").forEach(function (para) {
      var words = para.split(/\s+/), line = "";
      words.forEach(function (w) {
        var t = line ? line + " " + w : w;
        if (line && g.measureText(t).width > maxW) { out.push(line); line = w; } else line = t;
      });
      out.push(line);
    });
    return out;
  }
  function paintText(g, e, rtl) {
    var size = e.size, lh = e.lh || 1.25, lines;
    for (;;) {
      g.font = e.weight + " " + size + "px 'Somar Sans'";
      lines = wrap(g, e.text, e.w);
      if (lines.length * size * lh <= e.h + 1 || size <= 8) break;
      size -= 1;
    }
    var al = P.side(e, rtl), total = lines.length * size * lh;
    var y = e.valign === "middle" ? e.y + (e.h - total) / 2 : e.valign === "bottom" ? e.y + e.h - total : e.y;
    g.fillStyle = e.color; g.globalAlpha = e.alpha != null ? e.alpha : 1;
    g.direction = e.ltr ? "ltr" : (rtl ? "rtl" : "ltr");
    g.textAlign = al; g.textBaseline = "middle";
    var x = al === "center" ? e.x + e.w / 2 : al === "right" ? e.x + e.w : e.x;
    lines.forEach(function (ln, k) { g.fillText(ln, x, y + (k + 0.5) * size * lh); });
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
            var s = Math.max(e.w / im.naturalWidth, e.h / im.naturalHeight), dw = im.naturalWidth * s, dh = im.naturalHeight * s;
            g.drawImage(im, e.x + (e.w - dw) / 2, e.y + (e.h - dh) / 2, dw, dh); g.restore();
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
    fonts.then(function () { return PDFLib.PDFDocument.create(); })
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
