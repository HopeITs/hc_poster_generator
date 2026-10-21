/* Reels Gen (Beta) — vertical reels (1080×1920, 25 fps) from photos and video
   clips, edited and encoded in the browser. Visual language follows the DISC
   reels: raw shots with the logo on top, a few light text cards between them
   (the hook, and each change of idea), and a navy end card. One of ten editing
   styles sets the pace, transitions, clip speeds, colour, motion and card
   animation.
   The user's script becomes voiceover lines and card texts (/reels/script,
   Gemini), read by Mazen Lawand (/reels/voice, ElevenLabs); the lines are laid
   over the shots for a one-minute reel (the voice pauses on each text card) and
   the cuts land on the music's beat.
   The other kind of work, "تلخيص فيديو لريل", turns one long video into a
   summary reel: its strongest moments, cropped to follow the action, under
   music or, without it, with the video's own sound.
   Media never leaves the device; only text and the music request go to the
   auth Worker — and, for a summary told by its speech, the long video's
   soundtrack, which Gemini hears to choose whole thoughts (/reels/moments). */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };

  var WORKER = "https://studyzone-auth.ct-aleppo3.workers.dev";
  var TOKEN_KEY = "sz_auth_token", SLUG = "reels-gen";
  var W = 1080, H = 1920, FPS = 25, VIDEO_BPS = 14000000;
  var NAVY = "#0a3c55", TINT = "rgba(10,60,85,.45)";
  var CARD_BG = "#ebeaf0", CARD_INK = "#105063", CARD_LEN = 3;   // measured from an approved DISC reel
  var SR = 44100, REEL_LEN = 60;   // a reel made from shots is one minute; a summary takes the length picked for it (reelLen)
  var VO_OFFSET = 0.4;             // a voiceover that opens without a card starts this far in
  var VO_GAP = 0.35;               // after a card the voice resumes this long past the cut, once the dissolve is over
  var CARD_MAX = 3.5;   // longest a silent card stays on screen (s)
  var MUSIC_BASE = 0.85, DUCK_VOICE = 0.2, DUCK_SOUND = 0.12, RAMP = 0.3;   // music gain, ducked levels, ramp (s)
  /* Editing styles. Each one is a recipe the timeline applies on its own:
       len    target seconds per shot (how many shots fit the minute)
       every  cut on every Nth beat of the music
       end    end-card seconds
       strong transitions for cuts on a bar start (every 4th beat) — or now and then without music
       light  transitions for the other shot-to-shot cuts; cardTr the one into and out of text cards
              (each entry is [type, seconds], centred on the cut; see frame() for the types)
       speed  automatic clip speed: none | fast (every other clip ×1.6) | light (×1.25)
              | gentle (slight slow-motion) | slow (½ speed on 50/60 fps footage) | ramp (2× then 1×)
       grade  colour look (GRADES), push slow push-in, punch zoom pulse on beats, wiggle tiny sway
       card   how text cards come in, mood the default music */
  var RECIPES = {
    youth:    { name: "شبابي حيوي",      hint: "رتم سريع على الإيقاع، تكبير قافز على الضربات، وتسريع لبعض المقاطع",
                len: 1.4, every: 2, end: 2.5, speed: "fast",   grade: "vivid",   push: 0.04, punch: 0.05, card: "pop",      mood: "energetic",
                strong: [["zoom", 0.25], ["glitch", 0.2]],   light: [["cut", 0], ["whip", 0.25]],      cardTr: ["pop", 0.35] },
    doc:      { name: "وثائقي هادئ",     hint: "لقطات طويلة، تلاشي ناعم، تبطيء خفيف وألوان دافية",
                len: 5,   every: 4, end: 3.5, speed: "gentle", grade: "warm",    push: 0.08,              card: "fade",     mood: "documentary",
                strong: [["dissolve", 1.0]],                  light: [["dissolve", 0.8], ["blur", 0.6]], cardTr: ["dissolve", 0.8] },
    story:    { name: "شهادة وقصة نجاح", hint: "رتم هادئ يترك مساحة للحكي، وكروت بشكل اقتباس",
                len: 4,   every: 4, end: 3.5, speed: "none",   grade: "natural", push: 0.05,              card: "quote",    mood: "warm",
                strong: [["dissolve", 0.5]],                  light: [["cut", 0], ["dissolve", 0.35]],   cardTr: ["dissolve", 0.4] },
    promo:    { name: "إعلان تسجيل",     hint: "وميض أبيض على الضربات، خط عريض، وكرت نهاية أطول",
                len: 2.2, every: 2, end: 4, speed: "light",  grade: "punchy",  push: 0.05,              card: "big",      mood: "upbeat",
                strong: [["flash", 0.3], ["zoom", 0.25]],     light: [["cut", 0], ["wipe", 0.35]],       cardTr: ["flash", 0.3] },
    cine:     { name: "سينمائي",         hint: "تبطيء، تعتيم للأسود، وحبيبات سينمائية",
                len: 4.5, every: 4, end: 3.5, speed: "slow",   grade: "cine",    push: 0.1,               card: "type",     mood: "cinematic",
                strong: [["black", 0.8]],                     light: [["dissolve", 0.9], ["blur", 0.7]], cardTr: ["black", 0.8] },
    memory:   { name: "ذكريات وحنين",    hint: "ألوان باهتة دافية، وميض ضوئي وحركة بطيئة",
                len: 3.5, every: 4, end: 3.5, speed: "gentle", grade: "faded",   push: 0.07,              card: "fade",     mood: "nostalgic",
                strong: [["burn", 0.6]],                      light: [["leak", 0.7], ["dissolve", 0.6]], cardTr: ["dissolve", 0.6] },
    event:    { name: "ملخّص فعالية",    hint: "قطع على كل ضربة، سحب جانبي، وتسريع متدرّج",
                len: 1.2, every: 1, end: 2.5, speed: "ramp",   grade: "vivid",   push: 0.04, punch: 0.04, card: "slide",    mood: "energetic",
                strong: [["whip", 0.25], ["glitch", 0.2]],    light: [["cut", 0], ["slide", 0.3]],       cardTr: ["slide", 0.3] },
    question: { name: "أسئلة جذب",       hint: "سؤال كبير يجذب الانتباه، وتلاشي متوسط",
                len: 3,   every: 2, end: 3.5, speed: "none",   grade: "natural", push: 0.06,              card: "question", mood: "hopeful",
                strong: [["zoom", 0.3]],                      light: [["dissolve", 0.5], ["cut", 0]],    cardTr: ["dissolve", 0.5] },
    steps:    { name: "خطوة بخطوة",      hint: "كروت مرقّمة 1، 2، 3 وانزلاق بين الخطوات",
                len: 3,   every: 2, end: 3.5, speed: "none",   grade: "natural", push: 0.05,              card: "step",     mood: "corporate",
                strong: [["wipe", 0.4]],                      light: [["slide", 0.35], ["cut", 0]],      cardTr: ["slide", 0.4] },
    kids:     { name: "مرح للأطفال",     hint: "ألوان زاهية، قفزات مرحة وحركة خفيفة",
                len: 2,   every: 2, end: 3, speed: "light",  grade: "bright",  push: 0.05, wiggle: true, card: "bounce",  mood: "playful",
                strong: [["iris", 0.5], ["pop", 0.35]],       light: [["slide", 0.35], ["zoomout", 0.3]], cardTr: ["pop", 0.35] }
  };
  var OLD_RECIPES = { questions: "question", ad: "promo" };   // keys saved before the styles
  /* Colour looks: a canvas filter on the footage, then optional overlays. */
  var GRADES = {
    natural: {},
    vivid:   { filter: "saturate(1.35) contrast(1.08)" },
    warm:    { filter: "saturate(1.05) sepia(0.12) brightness(1.03)", wash: "rgba(255,190,120,0.06)" },
    punchy:  { filter: "contrast(1.18) saturate(1.15)" },
    cine:    { filter: "contrast(1.12) saturate(0.8) brightness(0.97)", wash: "rgba(0,90,110,0.10)", vignette: 0.45, grain: 0.07 },
    faded:   { filter: "sepia(0.28) contrast(0.86) saturate(0.85) brightness(1.06)", wash: "rgba(255,225,190,0.08)", vignette: 0.35, grain: 0.05 },
    bright:  { filter: "saturate(1.4) brightness(1.06)" }
  };
  var RAMP_PART = 0.5;   // a ramped clip runs at 2× for this share of its time, then at normal speed
  var MOODS = {
    hopeful: "Uplifting, hopeful modern background music for a vertical social media reel: soft piano, light plucked strings, gentle modern percussion from 6 seconds, warm and inspiring, steady 100 BPM, clear ending.",
    warm:    "Warm, calm acoustic guitar and soft pads, subtle background music under spoken interviews, low energy, no strong drums, sincere and encouraging, 85 BPM, gentle fade at the end.",
    upbeat:  "Upbeat playful modern pop instrumental for a lively social media reel, bright synth plucks, claps and light bass, energetic but friendly, 118 BPM, clear button ending.",
    energetic:   "High-energy modern hip-hop pop instrumental for a youth social media reel: punchy drums, deep bass, crisp claps, catchy synth hook, strong steady beat throughout, 124 BPM, clean ending.",
    documentary: "Calm documentary underscore: soft piano and warm ambient pads, light strings, reflective and sincere, no drums, slow 80 BPM pulse, gentle swell and soft ending.",
    cinematic:   "Cinematic emotional score: sustained strings, deep piano notes, soft low percussion pulses, slow build to a hopeful climax, 90 BPM, epic but restrained, clear ending.",
    nostalgic:   "Nostalgic warm lo-fi instrumental: mellow electric piano, soft vinyl texture, gentle brushed drums, tender and bittersweet, 82 BPM, gentle fade at the end.",
    playful:     "Playful cheerful children's instrumental: ukulele, glockenspiel, hand claps and a whistled melody, bouncy and happy, 112 BPM, clear button ending.",
    corporate:   "Light modern corporate instrumental: clean plucked guitar, soft piano, light percussion and claps, positive and clear, steady 105 BPM, clear ending."
  };

  var S = { items: [], recipe: "question", project: "disc", logo: null, logoNavy: null, mode: "create", sum: null, sumData: null,
            music: null, musicBlob: null, musicLabel: "", musicTrack: null, beats: null,
            lines: [], voice: null, endLen: null, regs: [], plan: [],
            t: 0, playing: false, clock: 0, seq: 0, exporting: false };

  function status(t, err) { var e = $("rgStatus"); e.textContent = t || ""; e.className = "status" + (err ? " err" : ""); }
  function fmt(s) { s = Math.max(0, s); var m = Math.floor(s / 60), r = Math.floor(s % 60); return m + ":" + (r < 10 ? "0" : "") + r; }
  function token() { try { return localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY); } catch (e) { return null; } }

  /* ---------- access (same rule as Thumbnail Gen) ---------- */
  function checkAccess() {
    var t = token();
    if (!t) { location.href = "../"; return Promise.reject(new Error("no session")); }
    return fetch(WORKER + "/projects", { headers: { "Authorization": "Bearer " + t } })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (r) {
        if (!r.ok) { location.href = "../"; throw new Error("session"); }
        var me = ((r.d && r.d.projects) || []).filter(function (p) { return p.slug === SLUG; })[0];
        if (!me || me.status !== "ready") { $("rgGateMsg").textContent = "لا تملك صلاحية الوصول إلى هذه الأداة."; throw new Error("denied"); }
      });
  }

  /* ---------- timeline ---------- */
  function recipe() { return RECIPES[S.recipe] || RECIPES.question; }
  function reelLen() { return S.mode === "sum" ? (+$("rgSumLen").value || 30) : REEL_LEN; }
  function ready() { return S.items.filter(function (it) { return !it.missing && !it.off && !it.skip; }); }
  /* Everything on the timeline in order: shots, text cards, then the end card. */
  function segs() { var l = ready(); return l.length ? l.concat([{ kind: "end", len: S.endLen || recipe().end }]) : []; }
  function total() { return segs().reduce(function (s, x) { return s + x.len; }, 0); }
  function ease(x) { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); }
  /* The transition at every cut of the segment list (plan[i] sits between
     list[i] and list[i + 1]). Cards and the end card take the style's card
     transition. Between shots: with music, a cut on a bar start (every 4th beat)
     is strong and the rest light, each pool used in turn; without music the
     choice is random but seeded by the style and cut number, so the preview and
     the export agree and a reopened project looks the same. The same type is
     never used twice in a row. */
  function cutPlan(list) {
    var st = recipe(), out = [], acc = 0, prev = null, n = { s: 0, l: 0 }, music = !!(S.beats && S.beats.length);
    for (var i = 0; i < list.length - 1; i++) {
      acc += list[i].len;
      var a = list[i], b = list[i + 1], strong = false, pick;
      if (a.kind === "card" || b.kind === "card" || b.kind === "end") pick = st.cardTr;
      else {
        if (music) { var bi = beatIndex(acc); strong = bi >= 0 && bi % 4 === 0; }
        else strong = seeded(i, 1) < 0.3 && !(prev && prev.strong);
        var pool = strong ? st.strong : st.light, key = strong ? "s" : "l";
        var opts = pool.filter(function (p) { return !prev || p[0] !== prev.type; }); if (!opts.length) opts = pool;
        pick = music ? opts[n[key]++ % opts.length] : opts[Math.floor(seeded(i, 2) * opts.length)];
      }
      prev = { type: pick[0], dur: pick[1], strong: strong }; out.push(prev);
    }
    return out;
  }
  function beatIndex(t) {   // index of the beat within 0.12 s of t, or -1
    var b = S.beats, lo = 0, hi = b.length - 1;
    while (lo < hi) { var mid = (lo + hi) >> 1; if (b[mid] < t) lo = mid + 1; else hi = mid; }
    var best = lo; if (lo > 0 && Math.abs(b[lo - 1] - t) < Math.abs(b[lo] - t)) best = lo - 1;
    return Math.abs(b[best] - t) <= 0.12 ? best : -1;
  }
  function seeded(i, salt) {   // a stable number in [0, 1) for this style, cut and purpose
    var h = 2166136261, key = S.recipe + ":" + i + ":" + salt;
    for (var c = 0; c < key.length; c++) { h ^= key.charCodeAt(c); h = Math.imul(h, 16777619); }
    h ^= h >>> 13; h = Math.imul(h, 1274126177); h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }
  // half a transition; short shots get a shorter one
  function halfAt(list, plan, j) { return Math.min(plan[j].dur / 2, list[j].len / 3, list[j + 1].len / 3); }
  /* What is on screen at time t: segment a, and during a dissolve also segment
     b drawn over it with b.alpha. Around a cut the outgoing shot runs a little
     past its end and the incoming one starts a little before its in-point, so
     neither freezes while they blend. */
  function locate(t) {
    var list = segs(), plan = cutPlan(list), acc = 0, i = 0, h;
    while (i < list.length - 1 && t >= acc + list[i].len) { acc += list[i].len; i++; }
    var it = list[i], local = t - acc;
    var loc = { t: t, item: it.kind === "end" ? null : it, idx: i, local: local, a: { seg: it, local: local }, b: null, tr: null };
    if (i > 0 && local < (h = halfAt(list, plan, i - 1))) {
      loc.a = { seg: list[i - 1], local: local + list[i - 1].len };
      loc.b = { seg: it, local: local, alpha: ease((local + h) / (2 * h)) }; loc.tr = plan[i - 1].type;
    } else if (i < list.length - 1 && local > it.len - (h = halfAt(list, plan, i))) {
      loc.b = { seg: list[i + 1], local: local - it.len, alpha: ease((local - it.len + h) / (2 * h)) }; loc.tr = plan[i].type;
    }
    return loc;
  }

  /* ---------- drawing (shared by preview, thumbnails and export) ---------- */
  /* Cover the frame with the shot, scaled by zoom (≥ 1) and turned by sway degrees.
     A shot cut from a long video slides sideways to keep its focus (see
     focusAt) in the middle, as far as the picture reaches. */
  function drawMedia(g, w, h, it, zoom, sway) {
    var el = it.el, sw = it.w, sh = it.h, rot = it.rot % 180 !== 0;
    var rw = rot ? sh : sw, rh = rot ? sw : sh, s = Math.max(w / rw, h / rh) * zoom, dx = 0;
    if (it.sum && !it.rot && S.sum && S.sum.name === it.name) {
      var lim = Math.max(0, (sw * s - w) / 2);
      dx = Math.max(-lim, Math.min(lim, (0.5 - focusAt(el.currentTime)) * sw * s));
    }
    g.save(); g.translate(w / 2 + dx, h / 2); g.rotate(((it.rot || 0) + (sway || 0)) * Math.PI / 180);
    g.drawImage(el, -sw * s / 2, -sh * s / 2, sw * s, sh * s); g.restore();
  }
  /* A shot as the style shows it: graded, pushed in, pulsing on the beat, with
     the style's overlays. No logo (that is a layer of its own). */
  function mediaLayer(g, w, h, it, local, t) {
    var st = recipe(), gr = GRADES[st.grade] || {}, p = Math.max(0, Math.min(1, (local + 0.25) / (it.len + 0.5)));
    var zoom = 1 + st.push * p + (st.punch ? st.punch * beatPulse(t) : 0) + (st.wiggle ? 0.03 : 0);
    var f = [gr.filter, S.fx].filter(Boolean).join(" ");
    g.save(); if (f) g.filter = f;
    drawMedia(g, w, h, it, zoom, st.wiggle ? 0.6 * Math.sin(t * 2.2) : 0);
    g.restore();
    if (it.tint) { g.fillStyle = TINT; g.fillRect(0, 0, w, h); }
    if (gr.wash) { g.fillStyle = gr.wash; g.fillRect(0, 0, w, h); }
    if (gr.vignette) {
      var v = g.createRadialGradient(w / 2, h / 2, h * 0.25, w / 2, h / 2, h * 0.75);
      v.addColorStop(0, "rgba(0,0,0,0)"); v.addColorStop(1, "rgba(0,0,0," + gr.vignette + ")");
      g.fillStyle = v; g.fillRect(0, 0, w, h);
    }
    if (gr.grain) grain(g, w, h, gr.grain);
  }
  var noiseTile = null;
  function grain(g, w, h, amount) {
    if (!noiseTile) {
      noiseTile = new OffscreenCanvas(160, 160);
      var x = noiseTile.getContext("2d"), d = x.createImageData(160, 160);
      for (var i = 0; i < d.data.length; i += 4) { var n = Math.random() * 255; d.data[i] = d.data[i + 1] = d.data[i + 2] = n; d.data[i + 3] = 255; }
      x.putImageData(d, 0, 0);
    }
    g.save(); g.globalAlpha = amount; g.globalCompositeOperation = "overlay";
    var k = w / W; g.translate(Math.random() * 160 * k, Math.random() * 160 * k); g.scale(k * 1.6, k * 1.6);
    g.fillStyle = g.createPattern(noiseTile, "repeat"); g.fillRect(-160, -160, w / (k * 1.6) + 320, h / (k * 1.6) + 320);
    g.restore();
  }
  /* 1 right on every other beat of the music, fading within ~0.3 s; 0 without music. */
  function beatPulse(t) {
    var b = S.beats; if (!b || !b.length) return 0;
    var lo = 0, hi = b.length - 1, k = -1;
    while (lo <= hi) { var mid = (lo + hi) >> 1; if (b[mid] <= t) { k = mid; lo = mid + 1; } else hi = mid - 1; }
    if (k < 0) return 0; if (k % 2) k--;
    var d = t - b[k]; return d < 0.3 ? Math.exp(-d / 0.09) : 0;
  }
  function backOut(x) { x = Math.max(0, Math.min(1, x)); var c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); }
  /* Draw a segment moved or scaled as one frame-sized picture. Footage is drawn
     larger than the frame (cover), so each is clipped to its own frame first. */
  function scaled(g, w, h, k, fn) { g.save(); g.translate(w / 2, h / 2); g.scale(k, k); g.translate(-w / 2, -h / 2); g.beginPath(); g.rect(0, 0, w, h); g.clip(); fn(); g.restore(); }
  function blurred(g, px, fn) {   // a canvas blur over a whole segment, kept when the grade sets its own filter
    var was = S.fx; S.fx = px > 0.3 ? "blur(" + px.toFixed(1) + "px)" : "";
    g.save(); if (S.fx) g.filter = S.fx; fn(); g.restore(); S.fx = was;
  }
  function shifted(g, w, h, dx, fn) { g.save(); g.translate(dx, 0); g.beginPath(); g.rect(0, 0, w, h); g.clip(); fn(); g.restore(); }
  /* Each project's logo in two colourings — one for footage and the navy end
     card, one for the light text cards — and its accent, which stands in for red
     everywhere on the page. */
  var PROJECTS = {
    sz:   { name: "Study Zone",          accent: "#f99d1c", style: "question", onDark: "assets/sz-logo.svg",   onLight: "assets/sz-logo-navy.svg" },
    leap: { name: "LEAP",                accent: "#3aa5af", style: "doc", onDark: "assets/leap-logo.svg", onLight: "assets/leap-logo-navy.svg" },
    disc: { name: "DISC",                accent: "#f99d1c", style: "youth", onDark: "assets/disc-logo.svg", onLight: "assets/disc-logo-navy.svg" },
    cu:   { name: "Children University", accent: "#f99d1c", style: "kids", onDark: "assets/cu-logo.svg",   onLight: "assets/cu-logo-navy.svg" }
  };
  function project() { return PROJECTS[S.project] || PROJECTS.disc; }
  /* Scale a logo to fit a box, whatever its shape (wide DISC, tall CU). */
  function fitBox(im, bw, bh) { var s = Math.min(bw / im.naturalWidth, bh / im.naturalHeight); return { w: im.naturalWidth * s, h: im.naturalHeight * s }; }
  /* Logo top-centre: the box is the DISC logo of the approved reels (22.5 % wide,
     top edge at 4.8 %), taller than DISC needs so upright logos get about the
     same area. */
  function logo(g, w, h, onLight) {
    var im = onLight ? S.logoNavy : S.logo;
    if (!im) return;
    var b = fitBox(im, w * 0.225, h * 0.09);
    g.drawImage(im, (w - b.w) / 2, h * 0.048, b.w, b.h);
  }
  /* Split the card text into lines that fit: the user's own line breaks first,
     then words wrapped to the safe width. */
  function wrap(g, text, maxW) {
    var out = [];
    text.trim().split(/\r?\n/).forEach(function (para) {
      var line = "";
      para.trim().split(/\s+/).forEach(function (word) {
        var t = line ? line + " " + word : word;
        if (line && g.measureText(t).width > maxW) { out.push(line); line = word; } else line = t;
      });
      if (line) out.push(line);
    });
    return out.slice(0, 5);
  }
  /* A light text card. The style decides how the text comes in: fade (rises
     into place), pop / bounce (springs from small), slide (from the left),
     type (letter by letter), quote (with a large quote mark), step (numbered
     1, 2, 3…), question (bigger), big (heavy, with an accent bar). */
  function textCard(g, w, h, it, local) {
    var st = recipe(), kind = st.card, k = w / W, t = local - 0.05;
    g.fillStyle = CARD_BG; g.fillRect(0, 0, w, h);
    if (!it.text || !it.text.trim()) return;
    var size = kind === "big" ? 96 : kind === "question" ? 88 : 77;
    g.save(); g.fillStyle = CARD_INK; g.font = (kind === "big" ? "900 " : "700 ") + (size * k) + "px 'Somar Sans'";
    g.textAlign = "center"; g.direction = "rtl";
    var lines = wrap(g, it.text, w * 0.84), lh = size * 1.77 * k, y0 = h * 0.5 - (lines.length - 1) * lh / 2 + 18 * k;
    var a = ease(t / 0.45), dx = 0, dy = 0, sc = 1, rot = 0;
    if (kind === "pop" || kind === "big" || kind === "bounce") { a = Math.min(1, Math.max(0, t / 0.18)); sc = 0.6 + 0.4 * backOut(t / 0.42); if (kind === "bounce") rot = (1 - backOut(t / 0.5)) * 8; }
    else if (kind === "slide" || kind === "step") { a = ease(t / 0.4); dx = -(1 - a) * 90 * k; }
    else if (kind === "type") a = t > 0 ? 1 : 0;
    else dy = (1 - a) * 26 * k;
    g.globalAlpha *= a;
    g.translate(w / 2 + dx, h / 2 + dy); g.rotate(rot * Math.PI / 180); g.scale(sc, sc); g.translate(-w / 2, -h / 2);
    if (kind === "quote") { g.save(); g.fillStyle = project().accent; g.font = "900 " + (230 * k) + "px 'Somar Sans'"; g.fillText("”", w / 2, y0 - lh * 0.45); g.restore(); }
    if (kind === "step") {
      var n = ready().filter(function (x) { return x.kind === "card"; }).indexOf(it) + 1, cy = y0 - lh - 30 * k;
      g.save(); g.fillStyle = NAVY; g.beginPath(); g.arc(w / 2, cy, 50 * k, 0, Math.PI * 2); g.fill();
      g.fillStyle = "#fff"; g.font = "900 " + (58 * k) + "px 'Somar Sans'"; g.textBaseline = "middle"; g.fillText(String(Math.max(1, n)), w / 2, cy + 3 * k); g.restore();
    }
    var shown = kind === "type" ? Math.floor(Math.max(0, t) / 0.045) : Infinity;
    lines.forEach(function (l, i) {
      if (shown <= 0) return;
      g.fillText(shown >= l.length ? l : l.slice(0, shown), w / 2, y0 + i * lh); shown -= l.length;
    });
    if (kind === "big") { g.fillStyle = project().accent; g.fillRect(w / 2 - 110 * k, y0 + (lines.length - 1) * lh + 50 * k, 220 * k, 12 * k); }
    g.restore();
  }
  function endCard(g, w, h) {
    var k = w / W;
    g.fillStyle = NAVY; g.fillRect(0, 0, w, h);
    if (S.logo) { var b = fitBox(S.logo, w * 0.42, h * 0.28); g.drawImage(S.logo, (w - b.w) / 2, (h - b.h) / 2, b.w, b.h); }
    else { g.save(); g.fillStyle = "#fff"; g.font = "700 " + (150 * k) + "px 'Somar Sans'"; g.textAlign = "center"; g.direction = "rtl"; g.fillText(project().name, w / 2, h / 2 + 50 * k); g.restore(); }
  }
  function drawSeg(g, w, h, seg, local, t) {
    if (seg.kind === "end") return endCard(g, w, h);
    if (seg.kind === "card") return textCard(g, w, h, seg, local);
    mediaLayer(g, w, h, seg, local, t || 0);
  }
  /* One frame. The media elements must already show the right moments.
     Segment a is going out and b coming in, b.alpha of the way through. */
  function frame(g, w, h, loc) {
    var st = recipe(), b = loc.b, t = loc.t || 0, tr = loc.tr, k = w / W;
    var A = function () { drawSeg(g, w, h, loc.a.seg, loc.a.local, t); }, B = function () { drawSeg(g, w, h, b.seg, b.local, t); };
    g.fillStyle = "#000"; g.fillRect(0, 0, w, h);
    if (!b) A();
    else {
      var m = b.alpha;
      var pk = 1 - Math.abs(2 * m - 1);   // 0 at both ends of the transition, 1 in its middle
      if (tr === "flash" || tr === "black" || tr === "leak" || tr === "burn") {   // dip through light or dark, switching at the peak
        (m < 0.5 ? A : B)();
        g.save();
        if (tr === "leak" || tr === "burn") {
          var lx = tr === "burn" ? w * 0.95 : w * 0.15, ly = tr === "burn" ? h * 0.75 : h * 0.2;
          var lg = g.createRadialGradient(lx, ly, 0, lx, ly, h * (tr === "burn" ? 0.75 : 0.9));
          if (tr === "burn") { lg.addColorStop(0, "rgba(255,250,235,1)"); lg.addColorStop(0.35, "rgba(255,140,40,0.95)"); lg.addColorStop(0.7, "rgba(200,40,10,0.5)"); lg.addColorStop(1, "rgba(120,0,0,0)"); }
          else { lg.addColorStop(0, "rgba(255,236,200,1)"); lg.addColorStop(0.5, "rgba(255,170,90,0.75)"); lg.addColorStop(1, "rgba(255,120,60,0.1)"); }
          g.globalAlpha = (tr === "burn" ? 1 : 0.85) * pk; if (tr === "burn") g.globalCompositeOperation = "screen";
          g.fillStyle = lg;
        } else { g.globalAlpha = pk; g.fillStyle = tr === "flash" ? "#fff" : "#000"; }
        g.fillRect(0, 0, w, h); g.restore();
      } else if (tr === "zoom") {   // the old shot rushes in, the new one lands from slightly large
        scaled(g, w, h, 1 + 0.15 * m, A);
        g.save(); g.globalAlpha = m; scaled(g, w, h, 1.15 - 0.15 * m, B); g.restore();
      } else if (tr === "zoomout") {   // the old shot pulls away and fades off the new one
        scaled(g, w, h, 1.1 - 0.1 * m, B);
        g.save(); g.globalAlpha = 1 - m; scaled(g, w, h, 1 - 0.18 * m, A); g.restore();
      } else if (tr === "slide" || tr === "whip") {   // push from the left (reading runs right to left); whip is faster and blurred
        var bl = tr === "whip" ? 46 * k * pk : 0;
        blurred(g, bl, function () { shifted(g, w, h, m * w, A); shifted(g, w, h, -(1 - m) * w, B); });
      } else if (tr === "wipe") {   // the new shot is uncovered from the left, behind a soft white edge
        A(); var ex = m * w;
        g.save(); g.beginPath(); g.rect(0, 0, ex, h); g.clip(); B(); g.restore();
        g.save(); var eg = g.createLinearGradient(ex - 24 * k, 0, ex + 6 * k, 0);
        eg.addColorStop(0, "rgba(255,255,255,0)"); eg.addColorStop(1, "rgba(255,255,255," + (0.7 * pk) + ")");
        g.fillStyle = eg; g.fillRect(ex - 24 * k, 0, 30 * k, h); g.restore();
      } else if (tr === "iris") {   // a growing circle uncovers the new shot from the middle
        A(); g.save(); g.beginPath(); g.arc(w / 2, h / 2, Math.hypot(w, h) / 2 * m, 0, Math.PI * 2); g.clip(); B(); g.restore();
      } else if (tr === "glitch") {   // a quick digital jolt: shifted slices and a colour fringe, switching at the peak
        (m < 0.5 ? A : B)();
        var cvs = g.canvas, seed = Math.floor(m * 12);
        g.save();
        for (var sl = 0; sl < 7; sl++) {
          var r1 = seeded(seed * 7 + sl, 3), r2 = seeded(seed * 7 + sl, 4), y = r1 * h, bh2 = (0.02 + 0.08 * r2) * h;
          g.drawImage(cvs, 0, y, w, bh2, (r2 - 0.5) * 120 * k * pk, y, w, bh2);
        }
        g.globalCompositeOperation = "screen"; g.globalAlpha = 0.2 * pk;
        g.fillStyle = "rgba(255,0,80,1)"; g.fillRect(-8 * k * pk, 0, w, h);
        g.fillStyle = "rgba(0,220,255,1)"; g.fillRect(8 * k * pk, 0, w, h);
        g.restore();
      } else if (tr === "blur") {   // dissolve through a soft focus
        var bp = 28 * k * pk;
        blurred(g, bp, A); g.save(); g.globalAlpha = m; blurred(g, bp, B); g.restore();
      } else if (tr === "pop") {
        A(); g.save(); g.globalAlpha = Math.min(1, m * 2.2); scaled(g, w, h, 0.82 + 0.18 * backOut(m), B); g.restore();
      } else { A(); g.save(); g.globalAlpha = m; B(); g.restore(); }   // dissolve
    }
    logoLayer(g, w, h, loc);
  }
  /* The logo sits above every transition, so it never zooms or slides; between
     a shot and a card the two colourings cross-fade. */
  function logoKind(seg) { return seg.kind === "end" ? null : seg.kind === "card" ? "light" : "dark"; }
  function logoLayer(g, w, h, loc) {
    var A = logoKind(loc.a.seg), B = loc.b ? logoKind(loc.b.seg) : A, m = loc.b ? loc.b.alpha : 0;
    if (A === B) { if (A) logo(g, w, h, A === "light"); return; }
    g.save();
    if (A) { g.globalAlpha = 1 - m; logo(g, w, h, A === "light"); }
    if (B) { g.globalAlpha = m; logo(g, w, h, B === "light"); }
    g.restore();
  }
  /* Automatic speed. A clip carries speed (×) or ramp (2× for the first
     RAMP_PART of its time, then 1×); span() maps reel seconds to source seconds. */
  function rateOf(it) { return it.kind !== "video" ? 1 : it.ramp ? 1 + RAMP_PART : (it.speed || 1); }
  function rateAt(it, local) { return it.ramp ? (local < RAMP_PART * it.len ? 2 : 1) : (it.speed || 1); }
  function span(it, local) {
    if (!it.ramp) return local * (it.speed || 1);
    var r = RAMP_PART * it.len; return local <= r ? 2 * local : 2 * r + (local - r);
  }
  function assignSpeeds(shots) {
    var mode = recipe().speed, vi = 0;
    shots.forEach(function (it) {
      it.speed = 1; it.ramp = false;
      if (it.kind !== "video" || it.talk || (it.sum && !S.musicBlob)) return;   // a summary without music is heard, so it runs at its own speed
      var hi = (it.fps || 30) >= 48;   // 50/60 fps footage slows down cleanly at our 25 fps
      if (mode === "fast") it.speed = vi % 2 ? 1.6 : 1;
      else if (mode === "light") it.speed = 1.25;
      else if (mode === "gentle") it.speed = hi ? 0.7 : 0.85;
      else if (mode === "slow") it.speed = hi ? 0.5 : 0.8;
      else if (mode === "ramp") it.ramp = vi % 2 === 0;
      vi++;
    });
  }
  function vTime(it, local) { return Math.max(0, Math.min(it.srcDur - 0.04, it.start + span(it, local))); }
  /* A clip is heard when the user keeps its sound, every moment of a summary
     that has no music, and every spoken thought (music steps back under it). */
  function hears(it) { return it.kind === "video" && (it.sound || it.talk || (it.sum && !S.musicBlob)); }
  function talkReel() { return S.items.some(function (it) { return it.talk; }); }
  function seekEl(it, local) {   // resolves once a video shows start+local (images and cards: at once)
    if (it.kind !== "video") return Promise.resolve();
    var target = vTime(it, local);
    if (Math.abs(it.el.currentTime - target) < 0.001 && it.el.readyState >= 2) return Promise.resolve();
    return new Promise(function (r) { it.el.addEventListener("seeked", r, { once: true }); it.el.currentTime = target; });
  }
  function seekLoc(loc) { return Promise.all([seekEl(loc.a.seg, loc.a.local), loc.b && seekEl(loc.b.seg, loc.b.local)]); }

  /* ---------- media ---------- */
  var nextId = 1;
  /* Frame rate of an MP4/MOV, read from its header (the first video track's
     timescale ÷ sample duration) without loading the clip. null if unknown. */
  function parseFps(file) {
    var size = file.size;
    function head(off) {
      if (off + 8 > size) return Promise.resolve(null);
      return file.slice(off, off + 16).arrayBuffer().then(function (b) {
        var d = new DataView(b), s = d.getUint32(0), h = 8, t = String.fromCharCode(d.getUint8(4), d.getUint8(5), d.getUint8(6), d.getUint8(7));
        if (s === 1 && b.byteLength >= 16) { s = d.getUint32(8) * 4294967296 + d.getUint32(12); h = 16; } else if (s === 0) s = size - off;
        return { s: s, h: h, t: t };
      });
    }
    function scan(off) {
      return head(off).then(function (x) {
        if (!x || x.s < 8) return null;
        if (x.t === "moov") return x.s > 64e6 ? null : file.slice(off + x.h, off + x.s).arrayBuffer();
        return scan(off + x.s);
      });
    }
    return scan(0).then(function (buf) {
      if (!buf) return null;
      var d = new DataView(buf), fps = null;
      function boxes(o, e, cb) {
        while (o + 8 <= e) {
          var s = d.getUint32(o), h = 8, t = String.fromCharCode(d.getUint8(o + 4), d.getUint8(o + 5), d.getUint8(o + 6), d.getUint8(o + 7));
          if (s === 1) { s = d.getUint32(o + 8) * 4294967296 + d.getUint32(o + 12); h = 16; }
          if (s < 8 || o + s > e) return;
          cb(t, o + h, o + s); o += s;
        }
      }
      boxes(0, buf.byteLength, function (t, c, e) {
        if (t !== "trak" || fps) return;
        var ts = 0, vide = false, delta = 0;
        (function inner(c, e) {
          boxes(c, e, function (t2, c2, e2) {
            if (t2 === "mdia" || t2 === "minf" || t2 === "stbl") inner(c2, e2);
            else if (t2 === "mdhd") ts = d.getUint8(c2) === 1 ? d.getUint32(c2 + 20) : d.getUint32(c2 + 12);
            else if (t2 === "hdlr") vide = String.fromCharCode(d.getUint8(c2 + 8), d.getUint8(c2 + 9), d.getUint8(c2 + 10), d.getUint8(c2 + 11)) === "vide";
            else if (t2 === "stts" && d.getUint32(c2 + 4) > 0) delta = d.getUint32(c2 + 12);
          });
        })(c, e);
        if (vide && ts && delta) fps = ts / delta;
      });
      return fps;
    }).catch(function () { return null; });
  }
  function loadMedia(file) {
    var url = URL.createObjectURL(file), isVideo = /^video\//.test(file.type) || /\.(mp4|mov|m4v|webm)$/i.test(file.name);
    if (!isVideo) return new Promise(function (res, rej) {
      var im = new Image(); im.onload = function () { res({ kind: "image", el: im, url: url, file: file, w: im.naturalWidth, h: im.naturalHeight, srcDur: Infinity }); };
      im.onerror = function () { rej(new Error(file.name)); }; im.src = url; });
    return Promise.all([new Promise(function (res, rej) {
      var v = document.createElement("video"); v.muted = true; v.playsInline = true; v.preload = "auto";
      v.onloadeddata = function () { res({ kind: "video", el: v, url: url, file: file, w: v.videoWidth, h: v.videoHeight, srcDur: v.duration }); };
      v.onerror = function () { rej(new Error(file.name)); }; v.src = url; }), parseFps(file)])
      .then(function (r) { r[0].fps = r[1] || 30; return r[0]; });
  }
  function addFiles(files) {
    var list = [].slice.call(files || []); if (!list.length) return;
    status("…جارٍ تحميل " + list.length + " ملف");
    // Load in parallel, but add in the order the files were picked (big clips
    // finish loading last, which would otherwise shuffle the sequence).
    var jobs = list.map(function (f) { return loadMedia(f).then(function (m) { return { f: f, m: m }; }, function (e) { return { error: e.message }; }); });
    Promise.all(jobs).then(function (res) {
      res.forEach(function (r) {
        if (r.error) return;
        var f = r.f, m = r.m;
        var miss = S.items.filter(function (it) { return it.missing && it.name === f.name; })[0];   // re-link after "فتح مشروع"
        if (miss) { Object.assign(miss, m, { missing: false }); clampItem(miss); return; }
        var it = Object.assign({ id: nextId++, name: f.name, rot: 0, tint: false, sound: false, missing: false }, m);
        it.len = recipe().len;
        it.start = it.kind === "video" ? Math.min(1, Math.max(0, it.srcDur - it.len)) : 0;
        clampItem(it); S.items.push(it);
      });
      var bad = res.filter(function (r) { return r && r.error; });
      status(bad.length ? "تعذّر فتح: " + bad.map(function (b) { return b.error; }).join("، ") : "", !!bad.length);
      relayout();
    });
  }
  function newCard(text) { return { id: nextId++, kind: "card", text: text || "", len: CARD_LEN, missing: false }; }
  function clampItem(it) {
    it.len = Math.max(1, Math.min(it.talk ? 30 : 15, +it.len || (it.kind === "card" ? CARD_LEN : recipe().len)));   // a spoken thought may run longer than a shot
    if (it.kind === "video") {
      it.len = Math.min(it.len, Math.max(1, Math.floor((srcRoom(it) - 0.1) / rateOf(it) * 10) / 10));
      if (it.center != null) it.start = it.center - span(it, it.len) / 2;   // a summary moment stays centred on its best second
      var lo = it.hi != null ? it.lo : 0, hi = it.hi != null ? it.hi : it.srcDur;
      it.start = Math.max(lo, Math.min(+it.start || 0, hi - span(it, it.len) - 0.05));
    }
  }
  /* Source seconds a clip may use: a summary moment stays inside its scene (lo…hi). */
  function srcRoom(it) { return it.hi != null ? it.hi - it.lo : it.srcDur; }

  /* ---------- clip cards ---------- */
  function countText() {
    var cards = S.items.filter(function (it) { return it.kind === "card"; }).length, off = S.items.filter(function (it) { return it.off && !it.skip; }).length, skip = S.items.filter(function (it) { return it.skip; }).length, shots = S.items.length - cards - off - skip;
    return S.items.length ? "· " + shots + " لقطة" + (cards ? " · " + cards + " كرت نص" : "") + (off ? " · " + off + " خارج الريل" : "") + (skip ? " · " + skip + " مستبعدة" : "") + " · " + fmt(total()) : "";
  }
  function renderClips() {
    var box = $("rgClips"); box.innerHTML = "";
    $("rgCount").textContent = countText(); musicNote();
    if (!S.items.length) { box.innerHTML = '<div class="no-clips">لا لقطات بعد — ابدأ بإضافة المواد من اليمين</div>'; }
    S.items.forEach(function (it, i) {
      var c = document.createElement("div"); c.className = "clip" + (it.missing ? " missing" : "") + (it.off || it.skip ? " off" : "") + (it.kind === "card" ? " is-card" : "");
      var lenField = '<div style="flex:1"><label class="l">المدة (ث)</label><input type="number" data-f="len" min="1" max="15" step="0.5" value="' + (+it.len.toFixed(2)) + '"></div>';
      var moveDel = '<button type="button" data-a="del" title="حذف">✕</button>';
      if (it.missing) {
        c.innerHTML = '<div class="thumb" style="display:flex;align-items:center;justify-content:center;color:#aaa;font-size:12px;padding:10px;text-align:center">بانتظار الملف:<br>' + esc(it.name) + '</div>' +
          '<div class="hint">أضف هذا الملف من «المواد» ليُربط تلقائياً</div><div class="tools"><button type="button" data-a="del" title="حذف">✕</button></div>';
      } else if (it.kind === "card") {
        c.innerHTML = '<div class="thumb"><canvas width="180" height="320"></canvas><span class="num">' + (i + 1) + '</span><span class="kind">TEXT</span></div>' +
          '<textarea placeholder="نص الكرت — سؤال جذب أو انتقال لفكرة جديدة">' + esc(it.text) + '</textarea>' +
          '<div class="row">' + lenField + '</div>' +
          '<div class="tools">' + moveDel + '</div>';
        var ta = c.querySelector("textarea");
        ta.addEventListener("input", function () { it.text = ta.value; thumb(it, c); drawAt(S.t); });
      } else {
        c.innerHTML = '<div class="thumb"><canvas width="180" height="320"></canvas><span class="num">' + (i + 1) + '</span><span class="kind">' + (it.kind === "video" ? (it.sum ? "VIDEO @ " + fmt(it.start) : "VIDEO " + it.srcDur.toFixed(1) + "s") + (it.ramp ? " · RAMP" : it.speed && it.speed !== 1 ? " · ×" + it.speed : "") : "PHOTO") + '</span></div>' +
          '<div class="row">' + lenField +
          (it.kind === "video" ? '<div style="flex:1"><label class="l">البداية (ث)</label><input type="number" data-f="start" min="0" step="0.5" value="' + it.start.toFixed(1) + '"></div>' : "") + '</div>' +
          '<div class="row"><label class="chk"><input type="checkbox" data-f="tint"' + (it.tint ? " checked" : "") + '> طبقة كحلية</label>' +
          (it.kind === "video" && !it.sum ? '<label class="chk"><input type="checkbox" data-f="sound"' + (it.sound ? " checked" : "") + '> الصوت الأصلي</label>' : "") + '</div>' +
          (it.talk && (it.say || it.role) ? '<div class="hint" title="' + esc(it.say) + '">' + (it.role ? '<b>' + esc(it.role) + '</b>' + (it.say ? " · " : "") : "") +
                                              esc(it.say.length > 110 ? it.say.slice(0, 110) + "…" : it.say) + '</div>' : "") +
          (it.skip ? '<div class="hint" style="color:var(--accent)">مستبعدة' + (it.why ? " — " + esc(it.why) : "") + '</div>'
                   : it.off ? '<div class="hint" style="color:var(--accent)">خارج الريل — الوقت ما بيكفي</div>' : "") +
          '<div class="tools"><button type="button" data-a="card" title="كرت نص قبل هذه اللقطة">+ نص</button><button type="button" data-a="rot" title="تدوير 90°">↻</button>' +
          '<button type="button" data-a="skip" title="' + (it.skip ? "إرجاع للريل" : "استبعاد من الريل") + '">' + (it.skip ? "↺" : "⊘") + '</button>' + moveDel + '</div>';
      }
      if (!it.missing) {
        [].forEach.call(c.querySelectorAll("input[data-f]"), function (inp) {
          inp.addEventListener("change", function () {
            if (inp.dataset.f === "tint") it.tint = inp.checked; else if (inp.dataset.f !== "sound") it[inp.dataset.f] = +inp.value;
            if (inp.dataset.f === "start" && it.center != null) { it.center = it.start + span(it, it.len) / 2; it.lo = it.hi = undefined; }   // moved by hand: free of its scene
            if (inp.dataset.f === "sound") { setSound(it, inp); return; }
            clampItem(it); if (inp.dataset.f !== "tint") inp.value = inp.dataset.f === "start" ? it.start.toFixed(1) : +it.len.toFixed(2);
            thumb(it, c); $("rgCount").textContent = countText(); drawAt(S.t);
          });
        });
        thumb(it, c);
      }
      c.querySelector(".tools").addEventListener("click", function (e) {
        var a = e.target.dataset && e.target.dataset.a; if (!a) return;
        var j = S.items.indexOf(it);
        if (a === "rot") { it.rot = (it.rot + 90) % 360; thumb(it, c); drawAt(S.t); return; }
        if (a === "skip") { it.skip = !it.skip; it.why = ""; relayout(); return; }
        if (a === "card") { S.items.splice(j, 0, newCard()); if (!voiceReady()) relayout(); else { stop(); renderClips(); } var ta2 = box.children[j] && box.children[j].querySelector("textarea"); if (ta2) ta2.focus(); return; }
        if (a === "del") {
          if (it.kind === "card" && it.line != null && S.lines[it.line]) { S.lines[it.line].card = ""; renderLines(); }   // otherwise the next layout would bring it back
          S.items.splice(j, 1); relayout(); return;
        }
      });
      dragCard(c, it);
      box.appendChild(c);
    });
    $("rgExport").disabled = !ready().length || S.items.some(function (x) { return x.missing; });
    $("rgCover").disabled = !ready().length;
    $("rgEmpty").hidden = !!ready().length;
  }
  /* Reorder by dragging a card onto another: it lands before or after that
     card depending on which half the pointer is over (the grid runs right to
     left). Dragging never starts from a field or button, so text can still be
     selected and edited. */
  var dragged = null;
  function dragCard(c, it) {
    c.draggable = true;
    c.addEventListener("mousedown", function (e) { c.draggable = !e.target.closest("textarea, input, button, select, label"); });
    c.addEventListener("dragstart", function (e) {
      dragged = it; c.classList.add("dragging"); stop();
      e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", "");
    });
    c.addEventListener("dragend", function () { dragged = null; c.classList.remove("dragging"); clearDrop(); });
    c.addEventListener("dragover", function (e) {
      if (!dragged || dragged === it) return;
      e.preventDefault(); e.dataTransfer.dropEffect = "move";
      var after = afterHalf(c, e); clearDrop(); c.classList.add(after ? "drop-after" : "drop-before");
    });
    c.addEventListener("dragleave", function (e) { if (!c.contains(e.relatedTarget)) c.classList.remove("drop-before", "drop-after"); });
    c.addEventListener("drop", function (e) {
      e.preventDefault(); if (!dragged || dragged === it) return;
      var after = afterHalf(c, e), from = S.items.indexOf(dragged);
      S.items.splice(from, 1);
      S.items.splice(S.items.indexOf(it) + (after ? 1 : 0), 0, dragged);
      dragged = null; renderClips(); S.t = Math.min(S.t, total()); drawAt(S.t);
    });
  }
  function afterHalf(c, e) { var r = c.getBoundingClientRect(), mid = r.left + r.width / 2; return getComputedStyle(c).direction === "rtl" ? e.clientX < mid : e.clientX > mid; }
  function clearDrop() { [].forEach.call(document.querySelectorAll(".clip.drop-before, .clip.drop-after"), function (x) { x.classList.remove("drop-before", "drop-after"); }); }
  var thumbQueue = Promise.resolve();
  function thumb(it, card) {   // serialised: one video element must not seek for two jobs at once
    thumbQueue = thumbQueue.then(function () {
      return seekEl(it, 0).then(function () { var cv = card.querySelector("canvas"); if (!cv) return; var g = cv.getContext("2d"); g.fillStyle = "#000"; g.fillRect(0, 0, 180, 320); drawSeg(g, 180, 320, it, it.kind === "card" ? it.len : 0); });
    });
  }
  function esc(s) { return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }

  /* ---------- preview ---------- */
  var cv = null, g = null;
  function drawAt(t) {
    if (!ready().length) { g.fillStyle = "#111"; g.fillRect(0, 0, cv.width, cv.height); updateTime(); return; }
    var loc = locate(t), seq = ++S.seq;
    seekLoc(loc).then(function () { if (seq === S.seq || S.playing) { frame(g, cv.width, cv.height, loc); gridGuide(g, cv.width, cv.height); } });
    updateTime();
  }
  function updateTime() {
    var T = total(), sk = $("rgSeek"); $("rgTime").textContent = fmt(S.t) + " / " + fmt(T);
    sk.value = T ? Math.round(S.t / T * 1000) : 0; sk.style.setProperty("--p", sk.value / 10 + "%");
  }
  /* Real-time playback: videos play natively, the canvas copies their frames;
     the music player is ducked under the voiceover and under shots that keep
     their own sound, as in the export. */
  function play() {
    if (!ready().length) return;
    stopPreview();
    if (S.t >= total() - 0.05) S.t = 0;
    S.playing = true; $("rgPlay").textContent = "❚❚"; $("rgPlay").classList.add("playing"); S.clock = performance.now() - S.t * 1000; S.regs = duckRegions(); S.plan = voicePlan();
    ready().forEach(function (it) { if (it.kind === "video") it.el.muted = !(hears(it) && rateOf(it) === 1); });   // sped-up or slowed clips play silent
    var mp = $("rgMusicPlayer"); if (S.musicBlob) { mp.currentTime = S.t; mp.volume = musicGain(S.t, S.regs); mp.play().catch(function () {}); }
    requestAnimationFrame(tick);
  }
  function tick(now) {
    if (!S.playing) return;
    S.t = (now - S.clock) / 1000;
    if (S.t >= total()) { stop(); S.t = total(); drawAt(S.t); return; }
    var loc = locate(S.t), on = [loc.a, loc.b].filter(function (x) { return x && x.seg.kind === "video"; });
    ready().forEach(function (it) {   // during a dissolve both videos play; every other one is paused
      if (it.kind !== "video") return;
      var o = on.filter(function (x) { return x.seg === it; })[0];
      if (o) { var r = rateAt(it, o.local); if (it.el.playbackRate !== r) it.el.playbackRate = r; }
      if (o && it.el.paused) { it.el.currentTime = vTime(it, o.local); it.el.play().catch(function () {}); }
      else if (!o && !it.el.paused) it.el.pause();
    });
    if (S.musicBlob) $("rgMusicPlayer").volume = Math.min(1, musicGain(S.t, S.regs));
    if (S.plan.length) {   // the voice plays block by block and stays silent over the cards
      var vp = $("rgVoicePlayer"), blk = S.plan.filter(function (b) { return S.t >= b.at && S.t < b.at + b.dur; })[0];
      if (blk) {
        var want = blk.src0 + S.t - blk.at;
        if (vp.paused || Math.abs(vp.currentTime - want) > 0.25) { vp.currentTime = want; if (vp.paused) vp.play().catch(function () {}); }
      } else if (!vp.paused) vp.pause();
    }
    frame(g, cv.width, cv.height, loc); gridGuide(g, cv.width, cv.height); updateTime();
    requestAnimationFrame(tick);
  }
  function stop() {
    S.playing = false; $("rgPlay").textContent = "▶"; $("rgPlay").classList.remove("playing");
    ready().forEach(function (it) { if (it.kind === "video") it.el.pause(); });
    $("rgMusicPlayer").pause(); $("rgVoicePlayer").pause();
  }

  /* ---------- audio: decoding, ducking, mixing ---------- */
  function decode(blob) { return blob.arrayBuffer().then(function (ab) { return new OfflineAudioContext(2, 1, SR).decodeAudioData(ab); }); }
  function b64Blob(b64, type) { var s = atob(b64), a = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) a[i] = s.charCodeAt(i); return new Blob([a], { type: type }); }
  /* Where each segment sits on the timeline, with the half-dissolves on either side. */
  function positions() {
    var list = segs(), plan = cutPlan(list), acc = 0;
    return list.map(function (s, i) {
      var p = { seg: s, t0: acc, h0: i ? halfAt(list, plan, i - 1) : 0, h1: i < list.length - 1 ? halfAt(list, plan, i) : 0 };
      acc += s.len; return p;
    });
  }
  /* Stretches where the music steps back: under each voiceover line, and under
     shots that keep their original sound. */
  function duckRegions() {
    var r = [];
    voicePlan().forEach(function (b) {
      for (var i = b.a; i <= b.z; i++) { var tm = S.voice.times[i]; r.push({ a: b.at + tm.start - b.src0 - 0.1, b: b.at + tm.end - b.src0 + 0.2, l: DUCK_VOICE }); }
    });
    positions().forEach(function (p) { if (hears(p.seg)) r.push({ a: p.t0, b: p.t0 + p.seg.len, l: DUCK_SOUND }); });
    return r;
  }
  function musicGain(t, regs) {
    var gn = MUSIC_BASE;
    regs.forEach(function (x) {
      var f = t < x.a ? 1 - (x.a - t) / RAMP : t > x.b ? 1 - (t - x.b) / RAMP : 1;
      if (f > 0) gn = Math.min(gn, MUSIC_BASE + (x.l - MUSIC_BASE) * f);
    });
    return gn;
  }
  function ensureAudio(it) {
    if (it.audio) return Promise.resolve(it.audio);
    if (!it.file) return Promise.reject(new Error("no file"));
    return (it.sum ? sumAudio() : decode(it.file)).then(function (b) { it.audio = b; return b; });   // the moments of a summary share one decode
  }
  function setSound(it, inp) {
    it.sound = inp.checked; it.el.muted = !it.sound;
    if (!it.sound) return;
    status("…جارٍ قراءة صوت المقطع");
    ensureAudio(it).then(function () { status(""); }, function () {
      it.sound = false; inp.checked = false; it.el.muted = true;
      status("تعذّر قراءة صوت هذا المقطع — صيغة الصوت غير مدعومة بالمتصفح", true);
    });
  }
  /* The whole soundtrack as one stereo buffer: ducked music, the voiceover, and
     the original sound of the shots that keep it (faded across their dissolves). */
  function mixAudio(T) {
    var len = Math.round(T * SR), L = new Float32Array(len), R = new Float32Array(len), any = false, i, k;
    var regs = duckRegions();
    if (S.music) {
      any = true;
      var m = S.music, mL = m.getChannelData(0), mR = m.numberOfChannels > 1 ? m.getChannelData(1) : mL, n = Math.min(m.length, len), fo = 1.5 * SR, fi = 0.3 * SR;
      for (var o = 0; o < n; o += 256) {
        var gn = musicGain((o + 128) / SR, regs);
        for (i = o; i < Math.min(o + 256, n); i++) { var f = Math.min(1, (n - i) / fo, i / fi) * gn; L[i] += mL[i] * f; R[i] += mR[i] * f; }
      }
    }
    voicePlan().forEach(function (b) {   // each block of the reading at its place, with 10 ms edges so the cuts don't click
      any = true;
      var v = S.voice.buf, vL = v.getChannelData(0), vR = v.numberOfChannels > 1 ? v.getChannelData(1) : vL;
      var s0 = Math.round(b.src0 * SR), n = Math.round(b.dur * SR), d0 = Math.round(b.at * SR), fe = 0.01 * SR;
      for (i = 0; i < n && d0 + i < len && s0 + i < v.length; i++) {
        if (d0 + i < 0) continue;
        var fv = Math.min(1, i / fe, (n - i) / fe); L[d0 + i] += vL[s0 + i] * fv; R[d0 + i] += vR[s0 + i] * fv;
      }
    });
    positions().forEach(function (p) {
      var it = p.seg; if (!hears(it) || !it.audio || rateOf(it) !== 1) return;   // changed speed: the clip stays silent
      any = true;
      var a = it.audio, aL = a.getChannelData(0), aR = a.numberOfChannels > 1 ? a.getChannelData(1) : aL, ar = a.sampleRate;   // a summary's sound is decoded at SUM_SR
      var s0 = Math.max(0, Math.round((p.t0 - p.h0) * SR)), s1 = Math.min(len, Math.round((p.t0 + it.len + p.h1) * SR));
      var f0 = Math.max(1, 2 * p.h0 * SR), f1 = Math.max(1, 2 * p.h1 * SR);
      for (k = s0; k < s1; k++) {
        var at = (it.start + k / SR - p.t0) * ar, src = Math.floor(at), fr = at - src; if (src < 0 || src + 1 >= a.length) continue;
        var fd = Math.min(1, (k - s0) / f0, (s1 - k) / f1);
        L[k] += (aL[src] + (aL[src + 1] - aL[src]) * fr) * fd; R[k] += (aR[src] + (aR[src + 1] - aR[src]) * fr) * fd;
      }
    });
    if (!any) return null;
    var peak = 0; for (i = 0; i < len; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
    if (peak > 0.98) { var sc = 0.98 / peak; for (i = 0; i < len; i++) { L[i] *= sc; R[i] *= sc; } }
    return { L: L, R: R, len: len };
  }

  /* ---------- music ---------- */
  function setMusic(blob, label) {
    S.musicBlob = blob; S.music = null; S.musicLabel = label; S.beats = null; S.musicTrack = null;
    renderTracks();   // any other music clears the ✓ on the bundled list
    var mp = $("rgMusicPlayer");
    if (!blob) {
      mp.hidden = true; mp.removeAttribute("src"); $("rgMusicSt").textContent = noMusicText();
      if (S.mode === "sum") relayout();   // the moments are heard now, at their own speed
      return Promise.resolve();
    }
    mp.src = URL.createObjectURL(blob); mp.hidden = false;
    return decode(blob)
      .then(function (buf) {
        S.music = buf; var bt = detectBeats(buf); S.beats = bt.beats; S.bpm = bt.bpm;
        if (S.mode === "sum") { relayout(); return; }   // the style's speeds come back under music
        if ($("rgBeatSync").checked && snapToBeats()) drawAt(S.t);
        renderClips();
      })
      .catch(function () { $("rgMusicSt").textContent = "تعذّرت قراءة ملف الموسيقى"; S.musicBlob = null; if (S.mode === "sum") relayout(); });
  }
  function noMusicText() { return S.mode === "sum" ? "بدون موسيقى — الريل بصوت الفيديو الأصلي" : "بدون موسيقى"; }
  /* Re-read on every timeline change, so "too short" never outlives the edit that fixed it. */
  function musicNote() {
    if (!S.music) return;
    var short = S.music.duration + 0.3 < total();
    $("rgMusicSt").textContent = "✓ " + S.musicLabel + " · " + S.music.duration.toFixed(1) + " ث · " + Math.round(S.bpm) + " BPM" +
      (short ? " — أقصر من الريل (" + total().toFixed(1) + " ث)، أعد التوليد" : talkReel() ? " · بتنخفض تحت الكلام" : $("rgBeatSync").checked ? " · القطع على الإيقاع" : "");
    $("rgMusicSt").style.color = short ? "var(--accent)" : "";
  }
  /* ---------- bundled music ----------
     Five tracks per style in music/ (see music/index.json), for when there is
     no ElevenLabs credit or no time to generate. ▶ previews a track; clicking
     the row uses it. A bundled choice follows the style: changing the style
     loads the new style's first track (generated or uploaded music stays). */
  var TRACKS = null, trackAudio = new Audio(), trackPlaying = null;
  trackAudio.onended = function () { trackPlaying = null; renderTracks(); };
  function loadTracks() {
    return fetch("music/index.json").then(function (r) { return r.json(); })
      .then(function (j) { TRACKS = j.styles; renderTracks(); })
      .catch(function () { $("rgTracks").innerHTML = '<div class="hint">تعذّر تحميل الموسيقى الجاهزة</div>'; });
  }
  function renderTracks() {
    var box = $("rgTracks"); if (!TRACKS) return; box.innerHTML = "";
    (TRACKS[S.recipe] || []).forEach(function (t) {
      var key = S.recipe + "/" + t.file, row = document.createElement("div");
      row.className = "trk" + (S.musicTrack === key ? " on" : "");
      row.title = t.title + " — " + t.artist;
      row.innerHTML = '<button type="button" title="استماع">' + (trackPlaying === key ? "❚❚" : "▶") + '</button>' +
        '<div class="nm">' + esc(t.title) + ' · <span class="ar">' + esc(t.artist) + '</span></div>' + (S.musicTrack === key ? '<span class="ok">✓</span>' : "");
      row.querySelector("button").onclick = function (e) { e.stopPropagation(); previewTrack(key); };
      row.onclick = function () { if (S.musicTrack !== key) useTrack(S.recipe, t); };
      box.appendChild(row);
    });
  }
  function previewTrack(key) {
    if (trackPlaying === key) { trackAudio.pause(); trackPlaying = null; renderTracks(); return; }
    if (S.playing) stop();
    trackAudio.src = "music/" + key.split("/")[1]; trackAudio.play().catch(function () {});
    trackPlaying = key; renderTracks();
  }
  function stopPreview() { if (trackPlaying) { trackAudio.pause(); trackPlaying = null; renderTracks(); } }
  function useTrack(style, t) {
    var key = style + "/" + t.file;
    $("rgMusicSt").textContent = "…جارٍ تحميل «" + t.title + "»";
    return fetch("music/" + t.file).then(function (r) { return r.blob(); })
      .then(function (b) { return setMusic(b, t.title); })
      .then(function () { if (S.musicBlob) { S.musicTrack = key; renderTracks(); } });
  }
  function findTrack(key) {
    var p = String(key || "").split("/"), list = TRACKS && TRACKS[p[0]];
    return list ? list.filter(function (t) { return t.file === p[1]; })[0] : null;
  }
  function genMusic() {
    var secs = reelLen() + 1, btn = $("rgGenMusic");   // +1 s so the music never runs out early
    btn.disabled = true; $("rgMusicSt").textContent = "…جارٍ توليد موسيقى " + secs + " ثانية";
    fetch(WORKER + "/reels/music", { method: "POST", headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token() },
      body: JSON.stringify({ prompt: MOODS[$("rgMood").value], seconds: secs }) })
      .then(function (r) {
        if (r.ok) return r.blob().then(function (b) { return setMusic(b, "موسيقى مولّدة"); });
        return r.json().catch(function () { return {}; }).then(function (e) {
          $("rgMusicSt").textContent = r.status === 403 ? "توليد الموسيقى متاح حالياً لـ Owner وComms فقط — يمكنك رفع ملف موسيقى" : (e.error || "تعذّر توليد الموسيقى");
        });
      })
      .catch(function () { $("rgMusicSt").textContent = "تعذّر الاتصال بخدمة الموسيقى"; })
      .then(function () { btn.disabled = false; });
  }

  /* ---------- beats ----------
     Generated music never keeps exactly the BPM it was asked for, so the beat
     grid is measured: an onset curve (rises in overall and low-band energy),
     the tempo from its autocorrelation (biased toward ~110 BPM to avoid
     half/double tempo), the phase that lands most beats on onsets, and each
     beat nudged to the strongest onset within ±35 ms. */
  function detectBeats(buf) {
    var x = buf.getChannelData(0), x2 = buf.numberOfChannels > 1 ? buf.getChannelData(1) : x, hop = 512, n = Math.floor(x.length / hop), fps = SR / hop;
    var en = new Float32Array(n), lo = new Float32Array(n), o = new Float32Array(n), lp = 0, i, k;
    for (i = 0; i < n; i++) {
      var e = 0, el = 0;
      for (k = i * hop; k < (i + 1) * hop; k++) { var s = (x[k] + x2[k]) * 0.5; lp += 0.028 * (s - lp); e += s * s; el += lp * lp; }   // one-pole low-pass ≈ 200 Hz
      en[i] = Math.log(1 + 1000 * e / hop); lo[i] = Math.log(1 + 1000 * el / hop);
    }
    for (i = 1; i < n; i++) o[i] = Math.max(0, en[i] - en[i - 1]) + Math.max(0, lo[i] - lo[i - 1]);
    var ac = [], best = -1, lag0 = Math.round(fps * 60 / 180), lag1 = Math.round(fps * 60 / 60), bestLag = lag0;
    for (var lag = lag0 - 1; lag <= lag1 + 1; lag++) {
      var sum = 0; for (i = lag; i < n; i++) sum += o[i] * o[i - lag]; ac[lag] = sum / (n - lag);
      if (lag < lag0 || lag > lag1) continue;
      var wgt = Math.exp(-0.5 * Math.pow(Math.log2(60 * fps / lag / 110) / 0.9, 2));
      if (ac[lag] * wgt > best) { best = ac[lag] * wgt; bestLag = lag; }
    }
    var p = bestLag, den = ac[p - 1] - 2 * ac[p] + ac[p + 1];
    if (den) { var d = (ac[p - 1] - ac[p + 1]) / (2 * den); if (Math.abs(d) < 1) p += d; }   // sub-frame period
    var ph = 0, bestS = -1, t;
    for (var q = 0; q < p; q += 0.5) { var sc = 0; for (t = q; t < n; t += p) sc += o[Math.round(t)] || 0; if (sc > bestS) { bestS = sc; ph = q; } }
    var beats = [];
    for (t = ph; t < n; t += p) { var c = Math.round(t), mx = c; for (k = -3; k <= 3; k++) if ((o[c + k] || 0) > (o[mx] || 0)) mx = c + k; beats.push(mx / fps); }
    return { bpm: 60 * fps / p, beats: beats };
  }
  function nearestBeat(t, tol, grid) {
    var b = null; (grid || S.beats || []).forEach(function (x) { if (Math.abs(x - t) <= tol && (b === null || Math.abs(x - t) < Math.abs(b - t))) b = x; });
    return b;
  }
  /* Move every cut to the nearest beat (the dissolve is centred on the cut, so
     its middle lands on the beat). Cards stay within 0.3 s of their voiceover
     line; a cut stays where it is if moving it would make a segment shorter
     than 1 s or ask a clip for more footage than it has. With a voiceover the
     end card takes up the difference so the reel keeps its length. */
  function snapToBeats() {
    var list = ready(); if (!S.beats || !S.beats.length || list.length < 2 || talkReel()) return false;   // speech is cut at its pauses, not on the beat
    var lens = list.map(function (it) { return it.len; }), endLen = S.endLen;
    snapCuts(list, 0.3);
    if (voiceReady() && !voiceFits()) {   // a card moved onto the voice: put it back and snap only the shot-to-shot cuts
      list.forEach(function (it, i) { it.len = lens[i]; }); S.endLen = endLen;
      snapCuts(list, 0);
    }
    return true;
  }
  function snapCuts(list, cardTol) {
    var period = (S.beats[S.beats.length - 1] - S.beats[0]) / Math.max(1, S.beats.length - 1), st = recipe();
    var grid = S.beats.filter(function (x, i) { return i % st.every === 0; }), minLen = Math.min(1, st.len * 0.6);   // the style cuts on every Nth beat
    var acc = 0, prev = 0, cuts = [];
    list.forEach(function (it, i) {
      acc += it.len;
      var nextIt = list[i + 1], card = it.kind === "card" || (nextIt && nextIt.kind === "card");
      var nb = card ? (cardTol ? nearestBeat(acc, cardTol, grid) : null) : nearestBeat(acc, Math.min(0.6 * st.every, period * st.every * 0.55), grid);
      if (nb === null || nb - prev < minLen) nb = acc;
      if (it.kind === "video" && (nb - prev) * rateOf(it) > srcRoom(it) - 0.15) nb = acc;
      cuts.push(nb); prev = nb;
    });
    prev = 0;
    list.forEach(function (it, i) { it.len = cuts[i] - prev; prev = cuts[i]; if (it.kind === "video") clampItem(it); });
    // a clip that ran out of footage was trimmed above: the end card takes up the difference
    if (S.endLen) S.endLen = Math.max(2, reelLen() - list.reduce(function (s, it) { return s + it.len; }, 0));
  }

  /* ---------- script → voiceover lines and cards ---------- */
  function voiceBudget() { return reelLen() - recipe().end - 3 * (2.8 + VO_GAP) - 1.5; }   // room left for speech beside ~3 silent cards
  function voiceSt(t, err) { var e = $("rgVoiceSt"); e.textContent = t || ""; e.style.color = err ? "var(--accent)" : ""; }
  function lineStat() {
    var words = S.lines.reduce(function (s, l) { return s + (l.voice.trim() ? l.voice.trim().split(/\s+/).length : 0); }, 0);
    var est = words / 2.1, el = $("rgLineStat");
    el.textContent = words + " كلمة · ≈ " + Math.round(est) + " ث من " + Math.round(voiceBudget());
    el.style.color = est > voiceBudget() ? "var(--accent)" : "";
  }
  function renderLines() {
    var box = $("rgLines"); box.innerHTML = "";
    var has = S.lines.length > 0; box.hidden = !has; $("rgLineTools").hidden = !has; $("rgVoiceGen").hidden = !has;
    S.lines.forEach(function (l, i) {
      var row = document.createElement("div"); row.className = "line";
      row.innerHTML = '<span class="n">' + (i + 1) + '</span><div class="f"><textarea data-k="voice" rows="2" placeholder="جملة التعليق">' + esc(l.voice) + '</textarea>' +
        '<textarea data-k="card" rows="1" class="card-in" placeholder="نص كرت (اختياري)">' + esc(l.card) + '</textarea></div><button type="button" title="حذف الجملة">✕</button>';
      var tv = row.querySelector('[data-k="voice"]'), tc = row.querySelector('[data-k="card"]');
      tv.addEventListener("input", function () { l.voice = tv.value; lineStat(); if (S.voice) { S.voice.stale = true; voiceSt("تغيّر نص التعليق — أعد توليد الصوت ليتطابق", true); } });
      tc.addEventListener("input", function () {   // live text on the matching card; adding/removing a card re-arranges on blur
        l.card = tc.value;
        S.items.forEach(function (it) { if (it.kind === "card" && it.line === i) it.text = l.card; });
        drawAt(S.t);
      });
      tc.addEventListener("change", function () {
        var had = S.items.some(function (it) { return it.kind === "card" && it.line === i; });
        if (S.voice && !S.voice.stale && had !== !!l.card.trim()) arrange(); else renderClips();
      });
      row.querySelector("button").onclick = function () {
        S.lines.splice(i, 1); renderLines(); lineStat();
        if (S.voice) { S.voice.stale = true; voiceSt("تغيّرت الجمل — أعد توليد الصوت ليتطابق", true); }
      };
      box.appendChild(row);
    });
    if (has) lineStat();
  }
  function draft() {
    var txt = $("rgScript").value.trim(), btn = $("rgDraft");
    if (!txt) { voiceSt("اكتب السكريبت أولاً", true); return; }
    btn.disabled = true; voiceSt("…جارٍ صياغة النص");
    fetch(WORKER + "/reels/script", { method: "POST", headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token() },
      body: JSON.stringify({ script: txt, seconds: Math.round(voiceBudget()) }) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (r) {
        if (!r.ok) { voiceSt(r.d.error || "تعذّرت الصياغة", true); return; }
        S.lines = r.d.lines.map(function (l) { return { voice: l.voice, card: l.card || "" }; });
        renderLines(); voiceSt("راجع الجمل ونصوص الكروت وعدّلها، ثم ولّد التعليق الصوتي");
      })
      .catch(function () { voiceSt("تعذّر الاتصال بخدمة الصياغة", true); })
      .then(function () { btn.disabled = false; });
  }
  function setVoice(data, times, dur) {
    var blob = b64Blob(data, "audio/mpeg");
    return decode(blob).then(function (buf) {
      S.voice = { data: data, blob: blob, buf: buf, times: times, dur: dur || buf.duration, stale: false };
      var vp = $("rgVoicePlayer"); vp.src = URL.createObjectURL(blob); vp.hidden = false; $("rgArrange").hidden = false;
    });
  }
  function genVoice() {
    var lines = S.lines.map(function (l) { return l.voice.trim(); }).filter(Boolean), btn = $("rgVoiceGen");
    if (!lines.length) return;
    if (lines.length !== S.lines.length) { voiceSt("في جملة فاضية — اكتبها أو احذفها", true); return; }
    btn.disabled = true; voiceSt("…جارٍ توليد التعليق الصوتي بصوت مازن لاوند");
    fetch(WORKER + "/reels/voice", { method: "POST", headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token() },
      body: JSON.stringify({ lines: lines }) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (r) {
        if (!r.ok) { voiceSt(r.d.error || "تعذّر توليد التعليق", true); return; }
        return setVoice(r.d.audio, r.d.lines, r.d.duration).then(function () {
          voiceSt("✓ تعليق صوتي · " + S.voice.dur.toFixed(1) + " ث"); arrange();
        });
      })
      .catch(function () { voiceSt("تعذّر الاتصال بخدمة التعليق الصوتي", true); })
      .then(function () { btn.disabled = false; });
  }

  /* ---------- arrange: lay the voiceover over the shots ----------
     Cards are read in silence: the reel shows a card alone (music up), then
     the voice picks up after it and never says the card's words. So the
     continuous reading is cut into blocks — one from the first line, and one
     from every line that has a card — and each block plays right after its
     card. The minute is shared: cards, the blocks, and any time left over
     spread evenly after each block, so shots linger before the next card. */
  function cardLen(text) { var w = text.trim().split(/\s+/).length; return Math.max(2.2, Math.min(CARD_MAX, 1.4 + 0.3 * w)); }
  function voiceBlocks() {
    var T = S.voice.times, out = [];
    S.lines.forEach(function (l, i) { if (i === 0 || l.card.trim()) out.push({ a: i, z: i, card: l.card.trim() }); else out[out.length - 1].z = i; });
    out.forEach(function (b) { b.src0 = Math.max(0, T[b.a].start - 0.06); b.src1 = Math.min(S.voice.buf.duration, T[b.z].end + 0.15); b.dur = b.src1 - b.src0; });
    return out;
  }
  /* Where each block plays, read off the timeline as it is now (after beat
     snapping or a manual edit): just after its card, else VO_OFFSET in. */
  function voicePlan() {
    if (!voiceReady()) return [];
    var pos = positions(), blocks = voiceBlocks(), prevEnd = 0;
    blocks.forEach(function (b) {
      var p = b.card ? pos.filter(function (x) { return x.seg.kind === "card" && x.seg.line === b.a; })[0] : null;
      b.at = p ? p.t0 + p.seg.len + VO_GAP : b.a === 0 ? VO_OFFSET : prevEnd + 0.3;
      prevEnd = b.at + b.dur;
    });
    return blocks;
  }
  /* Every block ends before the next card starts, and the last before the end card. */
  function voiceFits() {
    var plan = voicePlan(), pos = positions();
    return plan.every(function (b, k) {
      var nx = plan[k + 1], limit;
      if (nx && nx.card) { var p = pos.filter(function (x) { return x.seg.kind === "card" && x.seg.line === nx.a; })[0]; limit = p ? p.t0 : Infinity; }
      else if (!nx) { var endP = pos[pos.length - 1]; limit = endP ? endP.t0 : Infinity; }
      else limit = Infinity;
      return b.at + b.dur <= limit + 0.02;
    });
  }
  function arrange() {
    if (!S.voice) return;
    if (S.items.some(function (it) { return it.missing; })) { voiceSt("أضف الملفات الناقصة أولاً", true); return; }
    if (S.voice.times.length !== S.lines.length) { voiceSt("عدد الجمل تغيّر — أعد توليد الصوت أولاً", true); return; }
    var shots = S.items.filter(function (it) { return it.kind !== "card" && !it.skip; }), skipped = S.items.filter(function (it) { return it.skip; });
    var C = reelLen() - recipe().end, blocks = voiceBlocks(), wins = [], gaps = [], t = 0;
    function lead(b) { return b.card ? VO_GAP : b.a === 0 ? VO_OFFSET : 0.3; }
    var need = blocks.reduce(function (s, b) { return s + (b.card ? cardLen(b.card) : 0) + lead(b) + b.dur; }, 0), slack = C - need;
    if (slack < 0) { voiceSt("التعليق مع الكروت " + need.toFixed(1) + " ث — أطول من الريل بـ " + (-slack).toFixed(1) + " ث. اختصر الجمل أو الكروت وأعد توليد الصوت.", true); return; }
    blocks.forEach(function (b) {
      if (b.card) { var cl = cardLen(b.card); wins.push({ s: t, e: t + cl, text: b.card, line: b.a }); t += cl; }
      var e = t + lead(b) + b.dur + slack / blocks.length; gaps.push({ s: t, e: e }); t = e;
    });
    gaps[gaps.length - 1].e = C;
    if (!shots.length) { voiceSt("✓ التعليق جاهز — أضف اللقطات ثم اضغط «توزيع على اللقطات»"); return; }
    if (shots.length < gaps.length) { voiceSt("الريل بحاجة " + gaps.length + " لقطات على الأقل (عندك " + shots.length + ")", true); return; }
    assignSpeeds(shots);
    var G = gaps.reduce(function (s, x) { return s + x.e - x.s; }, 0);
    var use = shots.slice(0, Math.max(gaps.length, Math.min(shots.length, Math.round(G / recipe().len))));
    var counts = gaps.map(function () { return 1; });
    for (var k = gaps.length; k < use.length; k++) {
      var j = 0; gaps.forEach(function (x, gi) { if ((x.e - x.s) / counts[gi] > (gaps[j].e - gaps[j].s) / counts[j]) j = gi; });
      counts[j]++;
    }
    var pieces = [], si = 0, short = 0, pool = shots.slice(use.length);
    gaps.forEach(function (x, gi) {
      var mine = use.slice(si, si + counts[gi]); si += counts[gi];
      var sh = fill(x.e - x.s, mine);
      while (sh > 0.05 && pool.length) { mine.push(pool.shift()); sh = fill(x.e - x.s, mine); }   // clips ran short: bring in an unused shot
      short += sh;
      pieces.push({ s: x.s, items: mine });
    });
    use = [].concat.apply([], pieces.map(function (p) { return p.items; }));
    wins.forEach(function (w) { var c = newCard(w.text); c.len = w.e - w.s; c.line = w.line; pieces.push({ s: w.s, items: [c] }); });
    pieces.sort(function (a, b) { return a.s - b.s; });
    var off = pool;
    off.forEach(function (it) { it.off = true; }); use.forEach(function (it) { it.off = false; });
    S.items = [].concat.apply([], pieces.map(function (p) { return p.items; })).concat(off, skipped);
    S.endLen = reelLen() - S.items.filter(function (it) { return !it.off; }).reduce(function (s, it) { return s + it.len; }, 0);
    var synced = $("rgBeatSync").checked && snapToBeats();
    stop(); S.t = 0; renderClips(); drawAt(0);
    voiceSt("✓ تم توزيع " + S.lines.length + " جمل على " + use.length + " لقطة و" + wins.length + " كروت" + (synced ? " · القطع على الإيقاع" : "") +
      (off.length ? " · " + off.length + " لقطات خارج الريل (الوقت ما بيكفي)" : "") + (short > 0.05 ? " · المقاطع أقصر من المطلوب بـ " + short.toFixed(1) + " ث" : ""), off.length > 0 || short > 0.05);
  }
  /* Share len among the shots of one stretch: equal parts, except clips too
     short for their part, which take all they have and pass on the rest.
     Returns the time no shot could cover. */
  function fill(len, shots) {
    var free = shots.slice(), rest = len;
    function cap(it) { return it.kind === "video" ? Math.max(1, (srcRoom(it) - 0.15) / rateOf(it)) : Infinity; }
    while (free.length) {
      var share = rest / free.length, capped = free.filter(function (it) { return cap(it) < share; });
      if (!capped.length) { free.forEach(function (it) { it.len = share; clampItem(it); }); return 0; }
      capped.forEach(function (it) { it.len = cap(it); clampItem(it); rest -= it.len; });
      free = free.filter(function (it) { return capped.indexOf(it) < 0; });
    }
    return Math.max(0, rest);
  }

  /* Without a voiceover the reel still keeps its length: text cards keep their
     length and the shots share the rest in their order, about the style's shot
     length each (shots that do not fit wait at the end, marked "خارج الريل"). */
  function fitReel() {
    var shots = S.items.filter(function (it) { return !it.missing && !it.skip && it.kind !== "card"; });
    var cards = S.items.filter(function (it) { return !it.missing && it.kind === "card"; });
    var skipped = S.items.filter(function (it) { return it.skip; });
    if (!shots.length) { S.endLen = null; return 0; }
    if (talkReel()) {   // spoken thoughts keep their own length: the reel is as long as they are
      assignSpeeds(shots);
      shots.forEach(function (it) { it.off = false; if (it.talk && it.hi != null) it.len = it.hi - it.lo; clampItem(it); });
      S.items = S.items.filter(function (it) { return !it.skip; }).concat(skipped); S.endLen = null;
      return 0;
    }
    var room = Math.max(1.5, reelLen() - recipe().end - cards.reduce(function (s, c) { return s + c.len; }, 0));
    assignSpeeds(shots);
    var n = S.mode === "sum" ? shots.length : Math.max(1, Math.min(shots.length, Math.round(room / recipe().len))), use = shots.slice(0, n), pool = shots.slice(n);   // a summary already chose its count
    var sh = fill(room, use);
    while (sh > 0.05 && pool.length) { use.push(pool.shift()); sh = fill(room, use); }
    use.forEach(function (it) { it.off = false; }); pool.forEach(function (it) { it.off = true; });
    S.items = S.items.filter(function (it) { return !it.off && !it.skip; }).concat(pool, skipped);
    S.endLen = reelLen() - ready().reduce(function (s, it) { return s + it.len; }, 0);
    return sh;
  }
  function voiceReady() { return !!(S.voice && !S.voice.stale && S.voice.times.length === S.lines.length); }
  /* Re-lay the whole reel after shots or cards come and go: over the
     voiceover when there is one, otherwise evenly; then onto the beat. */
  function relayout() {
    if (voiceReady()) { arrange(); return; }
    fitReel();
    if ($("rgBeatSync").checked) snapToBeats();
    stop(); renderClips(); S.t = Math.min(S.t, total()); drawAt(S.t);
  }

  /* ---------- shot picker ----------
     Looks at every shot on the device (nothing is uploaded): sharpness (the
     variance of the Laplacian on a small grey copy — shaky or out-of-focus
     footage scores low), exposure, and a 64-bit difference hash to spot
     look-alikes. It keeps the best of each look-alike group, sets aside
     blurred and badly lit shots, and keeps as many of the strongest as fit the
     minute at the style's shot length, in the user's order. Set-aside shots stay in the
     list and come back with ↺. */
  var PICK_W = 192;
  function seekTo(el, t) {
    return new Promise(function (r) {
      if (Math.abs(el.currentTime - t) < 0.001 && el.readyState >= 2) { r(); return; }
      el.addEventListener("seeked", r, { once: true }); el.currentTime = t;
    });
  }
  function measure(el, sw, sh) {
    var w = PICK_W, h = Math.max(8, Math.round(PICK_W * sh / sw)), i;
    var x = new OffscreenCanvas(w, h).getContext("2d", { willReadFrequently: true });
    x.drawImage(el, 0, 0, w, h);
    var d = x.getImageData(0, 0, w, h).data, gy = new Float32Array(w * h), sum = 0;
    for (i = 0; i < w * h; i++) { gy[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]; sum += gy[i]; }
    var n = 0, m = 0, m2 = 0;
    for (var y = 1; y < h - 1; y++) for (var c = 1; c < w - 1; c++) {
      var k = y * w + c, lap = 4 * gy[k] - gy[k - 1] - gy[k + 1] - gy[k - w] - gy[k + w];
      n++; m += lap; m2 += lap * lap;
    }
    var hx = new OffscreenCanvas(9, 8).getContext("2d", { willReadFrequently: true });
    hx.drawImage(el, 0, 0, 9, 8);
    var hd = hx.getImageData(0, 0, 9, 8).data, bits = [];
    for (var r = 0; r < 8; r++) for (var q = 0; q < 8; q++) { var a = (r * 9 + q) * 4, b = a + 4; bits.push(hd[a] + hd[a + 1] + hd[a + 2] > hd[b] + hd[b + 1] + hd[b + 2] ? 1 : 0); }
    return { sharp: n ? m2 / n - (m / n) * (m / n) : 0, bright: sum / (w * h), hash: bits };
  }
  /* A clip is judged by its sharpest of three moments (one soft frame should
     not sink a good clip); its look-alike hash comes from the middle one. */
  function analyse(it) {
    if (it.kind !== "video") return Promise.resolve(measure(it.el, it.w, it.h));
    var res = [];
    return [0.2, 0.5, 0.8].reduce(function (p, f) {
      return p.then(function () { return seekTo(it.el, Math.min(it.srcDur - 0.05, it.srcDur * f)); })
              .then(function () { res.push(measure(it.el, it.w, it.h)); });
    }, Promise.resolve()).then(function () {
      var best = res.slice().sort(function (a, b) { return b.sharp - a.sharp; })[0];
      return { sharp: best.sharp, bright: best.bright, hash: res[1].hash };
    });
  }
  function hamming(a, b) { var d = 0; for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) d++; return d; }
  function pickShots() {
    var shots = S.items.filter(function (it) { return !it.missing && it.kind !== "card"; }), btn = $("rgPick"), done = 0;
    if (shots.length < 2) { status("أضف لقطات أولاً", true); return; }
    stop(); btn.disabled = true;
    thumbQueue = thumbQueue.catch(function () {}).then(function () {   // shares the queue with thumbnails: one seek per video at a time
      return shots.reduce(function (p, it) {
        return p.then(function () { return analyse(it); }).then(function (q) { it.q = q; status("…جارٍ فحص اللقطات " + (++done) + " / " + shots.length); });
      }, Promise.resolve());
    });
    thumbQueue.then(function () { decide(shots); }, function () { status("تعذّر فحص اللقطات", true); })
      .then(function () { btn.disabled = false; });
  }
  function decide(shots) {
    var sharp = shots.map(function (it) { return it.q.sharp; }).sort(function (a, b) { return a - b; }), med = sharp[Math.floor(sharp.length / 2)] || 1;
    shots.forEach(function (it) {
      var q = it.q; it.why = "";
      q.score = Math.min(2, q.sharp / med) - (q.bright < 40 || q.bright > 220 ? 0.6 : 0);
      if (q.bright < 40) it.why = "معتمة";   // before sharpness: a dark frame also has little detail
      else if (q.bright > 220) it.why = "فاتحة كتير";
      else if (q.sharp < 0.35 * med) it.why = "ضبابية أو مهزوزة";
    });
    var groups = [];
    shots.forEach(function (it) {
      var gr = groups.filter(function (x) { return hamming(x[0].q.hash, it.q.hash) <= 10; })[0];
      if (gr) gr.push(it); else groups.push([it]);
    });
    groups.forEach(function (gr) {
      gr.slice().sort(function (a, b) { return b.q.score - a.q.score; }).slice(1).forEach(function (it) { if (!it.why) it.why = "بتشبه لقطة أوضح منها"; });
    });
    var cardTime = voiceReady() ? voiceBlocks().reduce(function (s, b) { return s + (b.card ? cardLen(b.card) : 0); }, 0)
                                : S.items.filter(function (it) { return it.kind === "card"; }).reduce(function (s, c) { return s + c.len; }, 0);
    var N = Math.max(1, Math.round((reelLen() - recipe().end - cardTime) / recipe().len));
    var good = shots.filter(function (it) { return !it.why; }).sort(function (a, b) { return b.q.score - a.q.score; });
    good.slice(N).forEach(function (it) { it.why = "أضعف من غيرها"; });
    shots.forEach(function (it) { it.skip = !!it.why; });
    relayout();
    var count = function (w) { return shots.filter(function (it) { return it.why === w; }).length; };
    var kept = shots.length - shots.filter(function (it) { return it.skip; }).length;
    var parts = [["ضبابية", count("ضبابية أو مهزوزة")], ["متشابهة", count("بتشبه لقطة أوضح منها")], ["إضاءة", count("معتمة") + count("فاتحة كتير")], ["أضعف", count("أضعف من غيرها")]]
      .filter(function (p) { return p[1]; }).map(function (p) { return p[1] + " " + p[0]; });
    status("✓ اخترت " + kept + " من " + shots.length + " لقطة" + (parts.length ? " · استبعدت: " + parts.join("، ") : "") + " — ↺ بيرجّع أي لقطة");
  }

  /* ---------- summary: one reel from a long video ----------
     Everything is read on the device. The video is sampled every dt seconds
     (at most SUM_MAX samples) on a tiny copy: exposure, sharpness, colour, the
     change since the last sample (motion, and where in the frame it happens),
     brightness and hue histograms (a jump in either marks a scene cut) and a
     look-alike hash; the soundtrack, when it can be decoded, adds loud
     noise-like stretches (applause, cheering) as a hint of what mattered.
     Scenes are scored, the best window of each is a candidate, and the
     strongest candidates that are neither near each other nor look-alikes
     become the reel's shots: the very best opens the reel, the rest follow in
     the video's order. With music, the music is the only sound; without
     it, every moment keeps its own sound (and its own speed). Each shot keeps its moment
     (center) and its scene (lo…hi) whatever length the timeline gives it, and
     drawMedia slides the frame along the focus track
     (motion, else detail) so a wide picture keeps its action in the 9:16 crop. */
  var SUM_W = 96, SUM_MAX = 1200, SUM_SEGS = 40, SUM_AUDIO_MAX = 400 * 1048576, SUM_SR = 24000;
  function sumSt(t, err) { var e = $("rgSumSt"); e.textContent = t || ""; e.style.color = err ? "var(--accent)" : ""; }
  function sumBar(p) { $("rgSumBar").hidden = p == null; $("rgSumFill").style.width = Math.round((p || 0) * 100) + "%"; }
  function median(a) { var s = a.filter(function (x) { return isFinite(x); }).sort(function (x, y) { return x - y; }); return s.length ? s[Math.floor(s.length / 2)] : 0; }
  /* The shot's focus (0 left … 1 right) at source time t, between samples. */
  function focusAt(t) {
    var f = S.sum.fx, i = Math.max(0, Math.min(f.length - 1, t / S.sum.dt)), a = Math.floor(i), b = Math.min(f.length - 1, a + 1);
    return f[a] + (f[b] - f[a]) * (i - a);
  }
  /* Another element on the same file for each shot (a dissolve shows two moments at once). */
  function sumEl(i) {
    var D = S.sumData; if (D.els[i]) return Promise.resolve(D.els[i]);
    return new Promise(function (res, rej) {
      var v = document.createElement("video"); v.muted = true; v.playsInline = true; v.preload = "auto";
      v.onloadeddata = function () { D.els[i] = v; res(v); }; v.onerror = function () { rej(new Error(D.m.file.name)); }; v.src = D.m.url;
    });
  }
  function setLong(file) {
    if (!file) return;
    stop(); $("rgAnalyse").disabled = true; sumSt("…جارٍ فتح الفيديو");
    loadMedia(file).then(function (m) {
      if (m.kind !== "video") throw new Error(file.name);
      $("rgLongName").textContent = file.name; $("rgLongInfo").textContent = "المدة " + fmt(m.srcDur) + " · ⁦" + m.w + "×" + m.h + "⁩";   // isolated so RTL does not flip it to h×w
      var miss = S.items.filter(function (it) { return it.missing && it.sum && it.name === file.name; });
      S.sumData = { m: m, els: [m.el], samples: null };
      $("rgAnalyse").disabled = false;
      if (miss.length) {   // re-link a reopened project: every moment gets its own element on the file
        return Promise.all(miss.map(function (it, i) {
          return sumEl(i).then(function (el) { Object.assign(it, { el: el, url: m.url, file: file, w: m.w, h: m.h, srcDur: m.srcDur, fps: m.fps, missing: false }); clampItem(it); });
        })).then(function () { sumSt("✓ رجعت " + miss.length + " لحظة من الفيديو" + (S.talkGoal ? " · هدف الريل: " + S.talkGoal : "") + " — «تحليل وتلخيص» بيعيد الاختيار"); relayout(); });
      }
      S.items = S.items.filter(function (it) { return it.kind === "card"; }); S.sum = null; relayout();
      sumSt(m.srcDur < reelLen() * 1.5 ? "الفيديو قصير على التلخيص — الأفضل «إنشاء ريل»، أو اضغط «تحليل وتلخيص» على كل حال" : "اختار الطول والأسلوب واضغط «تحليل وتلخيص»", m.srcDur < reelLen() * 1.5);
    }).catch(function () { sumSt("تعذّر فتح الفيديو — صيغة غير مدعومة بالمتصفح", true); });
  }
  function analyseLong() {
    var D = S.sumData; if (!D) return;
    var btn = $("rgAnalyse"); btn.disabled = true; stop();
    var job = D.samples ? Promise.resolve() : thumbQueue.catch(function () {}).then(function () {   // shares the queue: a re-linked moment may use the same element
      return sampleAudio(D).then(function () { return sampleFrames(D); });
    });
    thumbQueue = job.catch(function () {});
    job.then(function () {
      sumBar(null);
      if (!D.speech && D.pcm) D.speech = speechSegs(D.pcm);
      if ($("rgSumKind").value === "talk") return buildTalk();
      return buildSummary().then(function () {   // footage full of speech is better told by its words
        if (D.speech && D.speech.ratio > 0.4 && !S.musicBlob) sumSt($("rgSumSt").textContent + " · الفيديو فيه كلام كتير — جرّب «كلام وأفكار كاملة»");
      });
    })
      .catch(function (e) { sumBar(null); sumSt("تعذّر تحليل الفيديو: " + (e && e.message || e), true); })
      .then(function () { btn.disabled = false; });
  }
  /* The long video's sound, decoded once (mono, SUM_SR) for the analysis and
     for every moment that keeps it; rejects when the file is too big to
     decode at once or has no readable sound. */
  function sumAudio() {
    var D = S.sumData; if (!D) return Promise.reject(new Error("no video"));
    if (D.pcm) return Promise.resolve(D.pcm);
    if (D.m.file.size > SUM_AUDIO_MAX) return Promise.reject(new Error("big"));
    return D.pcmJob || (D.pcmJob = D.m.file.arrayBuffer()
      .then(function (ab) { return new OfflineAudioContext(1, 1, SUM_SR).decodeAudioData(ab); })
      .then(function (buf) { D.pcm = buf; return buf; }, function (e) { D.pcmJob = null; throw e; }));
  }
  /* Loudness and zero-crossing rate per sample (the rate as at 8 kHz); none without readable sound. */
  function sampleAudio(D) {
    var m = D.m; D.dt = Math.max(0.5, m.srcDur / SUM_MAX); D.n = Math.floor((m.srcDur - 0.1) / D.dt) + 1; D.aud = null;
    if (m.file.size > SUM_AUDIO_MAX) return Promise.resolve();
    sumSt("…جارٍ قراءة صوت الفيديو"); sumBar(0);
    return sumAudio().then(function (buf) {
      var x = buf.getChannelData(0), sr = buf.sampleRate, db = new Float32Array(D.n), zc = new Float32Array(D.n);
      for (var i = 0; i < D.n; i++) {
        var a = Math.floor(i * D.dt * sr), b = Math.min(x.length, Math.floor((i + 1) * D.dt * sr)), e = 0, z = 0;
        for (var k = a + 1; k < b; k++) { e += x[k] * x[k]; if ((x[k] >= 0) !== (x[k - 1] >= 0)) z++; }
        db[i] = 20 * Math.log10(Math.sqrt(e / Math.max(1, b - a)) + 1e-5); zc[i] = z / Math.max(1, b - a) * sr / 8000;
      }
      D.aud = { db: db, zc: zc };
    }).catch(function () { D.aud = null; });
  }
  function sampleFrames(D) {
    var m = D.m, el = m.el, w = SUM_W, h = Math.max(8, Math.round(SUM_W * m.h / m.w)), N = w * h, out = [], prev = null, prevHist = null;
    var x = new OffscreenCanvas(w, h).getContext("2d", { willReadFrequently: true }), hx = new OffscreenCanvas(9, 8).getContext("2d", { willReadFrequently: true });
    var t0 = performance.now();
    function one(i) {
      if (i >= D.n) { D.samples = out; return Promise.resolve(); }
      return seekTo(el, Math.min(m.srcDur - 0.05, i * D.dt)).then(function () {
        x.drawImage(el, 0, 0, w, h);
        var d = x.getImageData(0, 0, w, h).data, gy = new Float32Array(N), hist = new Float32Array(28), sum = 0, col = 0, k;   // 16 luma bins, then 12 hue bins
        for (k = 0; k < N; k++) {
          var r = d[k * 4], gg = d[k * 4 + 1], b = d[k * 4 + 2], y = 0.299 * r + 0.587 * gg + 0.114 * b;
          gy[k] = y; sum += y; hist[Math.min(15, y >> 4)]++; col += Math.abs(r - gg) + Math.abs((r + gg) / 2 - b);
          var hi3 = Math.max(r, gg, b), ch = hi3 - Math.min(r, gg, b);
          if (ch > 20) hist[16 + Math.min(11, Math.floor(2 * (hi3 === r ? ((gg - b) / ch + 6) % 6 : hi3 === gg ? (b - r) / ch + 2 : (r - gg) / ch + 4)))]++;
        }
        var n = 0, mm = 0, m2 = 0, ex = 0, ew = 0;
        for (var yy = 1; yy < h - 1; yy++) for (var c = 1; c < w - 1; c++) {
          k = yy * w + c; var lap = 4 * gy[k] - gy[k - 1] - gy[k + 1] - gy[k - w] - gy[k + w];
          n++; mm += lap; m2 += lap * lap; ex += Math.abs(lap) * c; ew += Math.abs(lap);
        }
        var mot = 0, mx = 0, mw = 0, mc = 0, hd = 2;
        if (prev) {
          for (k = 0; k < N; k++) { var dd = Math.abs(gy[k] - prev[k]); mot += dd; if (dd > 12) { mx += dd * (k % w); mw += dd; mc++; } }
          var hl = 0, hh = 0; for (k = 0; k < 16; k++) hl += Math.abs(hist[k] - prevHist[k]) / N;
          for (k = 16; k < 28; k++) hh += Math.abs(hist[k] - prevHist[k]) / N;
          hd = Math.max(hl, hh);   // a cut changes the brightness, or only the colours
        }
        hx.drawImage(x.canvas, 0, 0, 9, 8);
        var hp = hx.getImageData(0, 0, 9, 8).data, bits = [];
        for (var rr = 0; rr < 8; rr++) for (var q = 0; q < 8; q++) { var o = (rr * 9 + q) * 4; bits.push(hp[o] + hp[o + 1] + hp[o + 2] > hp[o + 4] + hp[o + 5] + hp[o + 6] ? 1 : 0); }
        out.push({ t: i * D.dt, bright: sum / N, sharp: n ? m2 / n - (mm / n) * (mm / n) : 0, col: col / N, mot: prev ? mot / N : 0, hd: hd,
                   fx: mc > N * 0.02 ? mx / mw / (w - 1) : null, ex: ew ? ex / ew / (w - 1) : 0.5, hash: bits });
        prev = gy; prevHist = hist;
        if (i % 10 === 0) {
          var p = (i + 1) / D.n, left = (performance.now() - t0) / 1000 / p * (1 - p);
          sumBar(p); sumSt("…جارٍ تحليل الفيديو " + Math.round(p * 100) + "%" + (i > 30 ? " · باقي تقريباً " + fmt(left) : ""));
        }
        return one(i + 1);
      });
    }
    return one(0).then(function () { scoreSamples(D); });
  }
  /* Scenes, a score per sample, and the focus track. */
  function scoreSamples(D) {
    var sm = D.samples, n = sm.length, i, dur = D.m.srcDur, trim = Math.min(10, dur * 0.03);
    sm.forEach(function (s, j) { s.cut = j === 0 || s.hd > 0.5 || s.mot > 35; });
    sm.forEach(function (s, j) { if (s.cut) { s.fx = null; s.mot = sm[j + 1] && !sm[j + 1].cut ? sm[j + 1].mot : 0; } });   // a cut is not motion
    var scenes = []; for (i = 0; i < n; i++) { if (sm[i].cut) scenes.push([i, i + 1]); else scenes[scenes.length - 1][1] = i + 1; }
    var mMot = Math.max(0.5, median(sm.map(function (s) { return s.mot; }))), mSh = Math.max(1, median(sm.map(function (s) { return s.sharp; }))), mCol = Math.max(1, median(sm.map(function (s) { return s.col; })));
    var A = D.aud, mDb = A ? median(Array.from(A.db)) : 0;
    sm.forEach(function (s, j) {
      var mo = Math.min(s.mot / mMot, 3) / 3, sh = Math.min(s.sharp / mSh, 2) / 2, co = Math.min(s.col / mCol, 2) / 2, au = 0;
      if (A && j < A.db.length) au = Math.max(0, Math.min(1, (A.db[j] - mDb - 3) / 9)) * (A.zc[j] > 0.25 ? 1 : 0.5);
      s.score = 0.45 * mo + 0.35 * sh + 0.2 * co + 0.35 * au;
      s.still = s.mot < 0.2 * mMot;
      if (s.still) s.score -= 0.25;                // a slide, or someone talking we will not hear
      if (s.sharp < 0.35 * mSh) s.score -= 0.4;    // blurred or shaking
      if (s.bright < 35 || s.bright > 225 || s.t < trim || s.t > dur - trim) s.score = -1;   // dark, blown out, or the intro / outro
    });
    var R = Math.max(1, Math.round(1.5 / D.dt)), fx = new Float32Array(n);
    scenes.forEach(function (sc) {   // smooth within each scene only, so the frame jumps with the cut and glides otherwise
      for (var j = sc[0]; j < sc[1]; j++) {
        var su = 0, ws = 0;
        for (var k = Math.max(sc[0], j - R); k <= Math.min(sc[1] - 1, j + R); k++) { var wt = sm[k].fx != null ? 1 : 0.3; su += (sm[k].fx != null ? sm[k].fx : sm[k].ex) * wt; ws += wt; }
        fx[j] = ws ? su / ws : 0.5;
      }
    });
    D.scenes = scenes; S.sum = { name: D.m.file.name, dt: D.dt, fx: fx };
  }
  /* Pick the moments for the current style and length, and lay them out. */
  function buildSummary() {
    var D = S.sumData, sm = D.samples, st = recipe();
    var cards = S.items.map(function (it, i) { return { it: it, i: i }; }).filter(function (x) { return x.it.kind === "card"; });
    var room = reelLen() - st.end - cards.reduce(function (s, x) { return s + x.it.len; }, 0);
    var N = Math.max(1, Math.min(SUM_SEGS, Math.round(room / st.len)));
    var rate = { fast: 1.3, light: 1.25, gentle: 0.8, slow: 0.65, ramp: 1.25 }[st.speed] || 1;   // the style's average clip speed
    var trim = Math.min(10, D.m.srcDur * 0.03);
    D.scenes.forEach(function (sc) { sc.lo = Math.max(trim, sc[0] * D.dt); sc.hi = Math.min(D.m.srcDur - trim, (sc[1] - 1) * D.dt + 0.01); });   // seconds surely inside the scene
    var win = Math.max(1, Math.round(st.len * 1.3 / D.dt)), pre = [0], still = [0];
    sm.forEach(function (s, i) { pre[i + 1] = pre[i] + s.score; still[i + 1] = still[i] + (s.still ? 1 : 0); });
    function mean(a, b) { return (pre[b] - pre[a]) / (b - a) - ((still[b] - still[a]) / (b - a) > 0.5 ? 1 : 0); }   // mostly still: never a moment
    var cands = [];
    D.scenes.forEach(function (sc) {
      var a = sc[0], b = sc[1];
      if (sc.hi - sc.lo < 0.5) return;   // a flash between two cuts, or all intro / outro
      if (b - a <= win) { cands.push({ c: (a + b - 1) / 2, sc: sc, score: mean(a, b) }); return; }
      for (var c0 = a; c0 < b - win + 1; c0 += 3 * win) {   // a long scene gives one candidate per three shot-lengths
        var best = c0, bs = -Infinity;
        for (var p = c0; p <= Math.min(b - win, c0 + 3 * win - 1); p++) { var v = mean(p, p + win); if (v > bs) { bs = v; best = p; } }
        cands.push({ c: best + (win - 1) / 2, sc: sc, score: bs });
      }
    });
    cands.forEach(function (x) { x.t = x.c * D.dt; x.hash = sm[Math.round(x.c)].hash; });
    cands.sort(function (a, b) { return b.score - a.score; });
    /* Enough moments for the style's pace, and more while their scenes are too
       short to fill the length between them (a moment never runs past its cut). */
    var gap = Math.max(st.len * 1.3, (D.m.srcDur * 0.94) / (N * 2)), picked = [], cover = 0;
    function enough() { return picked.length >= SUM_SEGS || (picked.length >= N && cover >= room); }
    [[gap, true], [st.len * 1.3, false]].forEach(function (pass) {   // spread out and different first; if that leaves too few, only not overlapping
      cands.forEach(function (x) {
        if (enough() || x.score < -0.2 || picked.indexOf(x) >= 0) return;
        if (picked.some(function (p) { return Math.abs(p.t - x.t) < pass[0] || (pass[1] && hamming(p.hash, x.hash) <= 8); })) return;
        picked.push(x); cover += Math.min(st.len, (x.sc.hi - x.sc.lo) / rate);
      });
    });
    if (!picked.length) { sumSt("ما لقيت لحظات واضحة بهالفيديو — جرّب فيديو تاني", true); return Promise.resolve(); }
    picked.forEach(function (x) {   // moments sharing a scene split it halfway between them
      var mates = picked.filter(function (y) { return y.sc === x.sc; }).sort(function (a, b) { return a.t - b.t; }), k = mates.indexOf(x);
      x.lo = k ? (mates[k - 1].t + x.t) / 2 : x.sc.lo; x.hi = k < mates.length - 1 ? (x.t + mates[k + 1].t) / 2 : x.sc.hi;
      x.t = Math.max(x.lo, Math.min(x.hi, x.t));
    });
    var hook = picked[0];
    picked.sort(function (a, b) { return a.t - b.t; });
    picked.splice(picked.indexOf(hook), 1); picked.unshift(hook);
    sumSt("…جارٍ تجهيز اللقطات");
    return Promise.all(picked.map(function (x, i) { return sumEl(i); })).then(function (els) {
      var m = D.m;
      var shots = picked.map(function (x, i) {
        return { id: nextId++, name: m.file.name, kind: "video", el: els[i], url: m.url, file: m.file, w: m.w, h: m.h, srcDur: m.srcDur, fps: m.fps,
                 rot: 0, tint: false, sound: false, missing: false, sum: true, center: x.t, lo: x.lo, hi: x.hi, start: 0, len: st.len };
      });
      cards.forEach(function (x) { shots.splice(Math.min(x.i, shots.length), 0, x.it); });   // the user's own text cards keep their place
      S.items = shots; S.endLen = null; S.t = 0;
      relayout();
      var T = total();
      sumSt("✓ اخترت " + picked.length + " لحظة من فيديو مدته " + fmt(m.srcDur) + " · أقوى لحظة بالبداية" +
            (T < reelLen() - 0.5 ? " · اللحظات الواضحة بتكفي لريل " + Math.round(T) + " ث بس — جرّب طول أقصر" : ""), T < reelLen() - 0.5);
    });
  }
  /* ---------- summary from speech ----------
     For interviews and talks the reel is made of whole spoken thoughts. The
     soundtrack is split at its pauses (speechSegs); Gemini transcribes each
     segment, then from that text names the reel's goal and returns runs of
     consecutive segments that each make a complete thought, in the order of
     the goal's structure (/reels/moments). A moment's text is the transcript
     of its segments. Every
     moment starts and ends on a pause, so no word is cut. Without Gemini (no
     access, busy, over the daily cap) the runs are picked on the device:
     whole sentences between longer pauses, where the speech is steady and the
     picture good — clean cuts, but no understanding of what is said. */
  var TALK_FRAME = 0.02, TALK_GAP = 0.4, TALK_SEG_MAX = 12;
  function speechSegs(buf) {
    var x = buf.getChannelData(0), sr = buf.sampleRate, hop = Math.round(TALK_FRAME * sr), n = Math.floor(x.length / hop), db = new Float32Array(n), i, k;
    for (i = 0; i < n; i++) { var e = 0; for (k = i * hop; k < (i + 1) * hop; k++) e += x[k] * x[k]; db[i] = 10 * Math.log10(e / hop + 1e-10); }
    var sorted = Array.from(db).sort(function (a, b) { return a - b; }), floor = sorted[Math.floor(n * 0.1)] || -100, loud = sorted[Math.floor(n * 0.95)] || 0;
    var thr = Math.max(floor + 10, loud - 30, -55);   // above the room's noise, within 30 dB of the loud parts
    var runs = [], a = -1;
    for (i = 0; i <= n; i++) { var on = i < n && db[i] > thr; if (on && a < 0) a = i; else if (!on && a >= 0) { runs.push([a, i]); a = -1; } }
    var gap = Math.round(TALK_GAP / TALK_FRAME), merged = [];
    runs.forEach(function (r) { var last = merged[merged.length - 1]; if (last && r[0] - last[1] < gap) last[1] = r[1]; else merged.push(r.slice()); });
    merged = merged.filter(function (r) { return (r[1] - r[0]) * TALK_FRAME >= 0.25; });
    var segs = [], edge = Math.round(3 / TALK_FRAME);
    (function split(list) {   // a long stretch without a pause is split at its quietest moment
      list.forEach(function (r) {
        if ((r[1] - r[0]) * TALK_FRAME <= TALK_SEG_MAX) { segs.push(r); return; }
        var m = r[0] + edge; for (var f = r[0] + edge; f < r[1] - edge; f++) if (db[f] < db[m]) m = f;
        split([[r[0], m], [m + 1, r[1]]]);
      });
    })(merged);
    var spoken = 0;
    segs = segs.map(function (r) { spoken += r[1] - r[0]; return [r[0] * TALK_FRAME, r[1] * TALK_FRAME]; });
    return { segs: segs, ratio: n ? spoken / n : 0 };
  }
  /* The soundtrack as Ogg Opus (24 kb/s mono: about 11 MB an hour), to send to Gemini. */
  var OGG_CRC = (function () {
    var t = new Uint32Array(256);
    for (var i = 0; i < 256; i++) { var r = i << 24; for (var j = 0; j < 8; j++) r = r & 0x80000000 ? (r << 1) ^ 0x04c11db7 : r << 1; t[i] = r >>> 0; }
    return t;
  })();
  function oggPage(packets, granule, seq, flags) {
    var lace = [], size = 0;
    packets.forEach(function (p) { var n = p.length; while (n >= 255) { lace.push(255); n -= 255; } lace.push(n); size += p.length; });
    var page = new Uint8Array(27 + lace.length + size), dv = new DataView(page.buffer), o = 27 + lace.length, c = 0, i;
    page.set([79, 103, 103, 83]); page[5] = flags;   // "OggS"
    dv.setUint32(6, granule % 4294967296, true); dv.setUint32(10, Math.floor(granule / 4294967296), true);
    dv.setUint32(14, 0x52474e31, true); dv.setUint32(18, seq, true); page[26] = lace.length; page.set(lace, 27);
    packets.forEach(function (p) { page.set(p, o); o += p.length; });
    for (i = 0; i < page.length; i++) c = ((c << 8) ^ OGG_CRC[((c >>> 24) ^ page[i]) & 255]) >>> 0;
    dv.setUint32(22, c, true);
    return page;
  }
  function speechOgg(buf) {
    var sr = buf.sampleRate, x = buf.getChannelData(0), packets = [], failed = null, PRE = 312;
    var enc = new AudioEncoder({ output: function (c) { var d = new Uint8Array(c.byteLength); c.copyTo(d); packets.push({ d: d, n: c.duration ? Math.round(c.duration * 0.048) : 960 }); },
                                 error: function (e) { failed = e; } });
    enc.configure({ codec: "opus", sampleRate: sr, numberOfChannels: 1, bitrate: 24000 });
    function feed(o) {
      if (failed) return Promise.reject(failed);
      if (o >= x.length) return enc.flush();
      var n = Math.min(sr, x.length - o);
      var ad = new AudioData({ format: "f32-planar", sampleRate: sr, numberOfFrames: n, numberOfChannels: 1, timestamp: Math.round(o / sr * 1e6), data: x.slice(o, o + n) });
      enc.encode(ad); ad.close();
      if (o % (sr * 60) === 0) sumSt("…جارٍ تجهيز الصوت " + Math.round(o / x.length * 100) + "%");
      return (enc.encodeQueueSize > 20 ? yieldTask() : Promise.resolve()).then(function () { return feed(o + n); });
    }
    return feed(0).then(function () {
      enc.close();
      var head = new Uint8Array(19), hv = new DataView(head.buffer), te = new TextEncoder(), vendor = te.encode("reels-gen");
      head.set(te.encode("OpusHead")); head[8] = 1; head[9] = 1; hv.setUint16(10, PRE, true); hv.setUint32(12, sr, true);
      var tags = new Uint8Array(16 + vendor.length), tv = new DataView(tags.buffer);
      tags.set(te.encode("OpusTags")); tv.setUint32(8, vendor.length, true); tags.set(vendor, 12);
      var pages = [oggPage([head], 0, 0, 2), oggPage([tags], 0, 1, 0)], seq = 2, gran = PRE, group = [], laces = 0;
      packets.forEach(function (p, i) {
        var l = Math.floor(p.d.length / 255) + 1;
        if (laces + l > 255) { pages.push(oggPage(group, gran, seq++, 0)); group = []; laces = 0; }
        group.push(p.d); laces += l; gran += p.n;
        if (i === packets.length - 1) pages.push(oggPage(group, gran, seq++, 4));
      });
      return new Blob(pages, { type: "audio/ogg" });
    });
  }
  function askMoments(D, room) {
    var meta = new TextEncoder().encode(JSON.stringify({ seconds: Math.round(room), segments: D.speech.segs.map(function (s) { return [+s[0].toFixed(2), +s[1].toFixed(2)]; }) }));
    var hdr = new Uint8Array(4); new DataView(hdr.buffer).setUint32(0, meta.length);
    return fetch(WORKER + "/reels/moments", { method: "POST", headers: { "Authorization": "Bearer " + token(), "Content-Type": "application/octet-stream" }, body: new Blob([hdr, meta, D.ogg]) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { if (!r.ok) throw new Error(d.error || "HTTP " + r.status); return d; }); });
  }
  /* Whole sentences on the device: runs that start and end on a real pause,
     4–15 s, with no long silence inside; scored on how full of speech they
     are, how good the picture is, and how clearly they end. */
  function localThoughts(D, room) {
    var segs = D.speech.segs, sm = D.samples, cands = [];
    function vis(a, b) { var s = 0, n = 0; for (var i = Math.floor(a / D.dt); i <= Math.min(sm.length - 1, Math.floor(b / D.dt)); i++) { s += Math.max(-0.5, sm[i].score); n++; } return n ? s / n : 0; }
    for (var i = 0; i < segs.length; i++) {
      if (i && segs[i][0] - segs[i - 1][1] < 0.7) continue;
      var said = 0;
      for (var j = i; j < segs.length; j++) {
        if (j > i && segs[j][0] - segs[j - 1][1] > 1.2) break;
        said += segs[j][1] - segs[j][0];
        var len = segs[j][1] - segs[i][0]; if (len > 15) break;
        var after = j + 1 < segs.length ? segs[j + 1][0] - segs[j][1] : 3;
        if (len >= 4 && after >= 0.7) cands.push({ from: i + 1, to: j + 1, a: segs[i][0], b: segs[j][1], score: said / len + 0.5 * vis(segs[i][0], segs[j][1]) + 0.15 * Math.min(after, 2) });
      }
    }
    cands.sort(function (x, y) { return y.score - x.score; });
    var picked = [], total = 0;
    cands.forEach(function (c) {
      if (total >= room - 3 || total + (c.b - c.a) > room) return;
      if (picked.some(function (p) { return c.a < p.b + 2 && c.b > p.a - 2; })) return;
      picked.push(c); total += c.b - c.a;
    });
    return picked.sort(function (x, y) { return x.a - y.a; }).map(function (c) { return { from: c.from, to: c.to, text: "", why: "" }; });
  }
  function buildTalk() {
    var D = S.sumData, st = recipe();
    if (!D.speech || !D.speech.segs.length) { sumSt(D.pcm ? "ما لقيت كلام بالفيديو — جرّب «لقطات على الإيقاع»" : "تعذّر قراءة صوت الفيديو (الملف أكبر من " + Math.round(SUM_AUDIO_MAX / 1048576) + " MB أو صيغة الصوت غير مدعومة)", true); return Promise.resolve(); }
    var cards = S.items.map(function (it, i) { return { it: it, i: i }; }).filter(function (x) { return x.it.kind === "card"; });
    var room = reelLen() - st.end - cards.reduce(function (s, x) { return s + x.it.len; }, 0);
    sumSt("…جارٍ تجهيز الصوت");
    return (D.ogg ? Promise.resolve() : speechOgg(D.pcm).then(function (o) { D.ogg = o; }))
      .then(function () { sumSt("…Gemini عم يفرّغ الكلام، وبعدين بيختار أفكار كاملة (فيديو ساعة ممكن ياخد دقيقتين)"); return askMoments(D, room); })
      .then(function (d) {
        var tr = Array.isArray(d.transcript) ? d.transcript : [];
        D.transcript = tr; D.goal = d.goal || ""; D.topic = d.topic || "";
        (d.moments || []).forEach(function (x) { x.text = tr.slice(x.from - 1, x.to).filter(Boolean).join(" "); });   // the words as transcribed, segment by segment
        return { list: d.moments || [], topic: d.topic || "", goal: d.goal || "", ai: true };
      },
            function (e) { return { list: localThoughts(D, room), ai: false, err: e && e.message || String(e) }; })
      .then(function (res) {
        var segs = D.speech.segs, used = {}, list = [], said = 0;
        res.list.forEach(function (x) {   // whole runs only, never the same words twice
          if (!(x.from >= 1 && x.to >= x.from && x.to <= segs.length)) return;
          for (var k = x.from; k <= x.to; k++) if (used[k]) return;
          for (k = x.from; k <= x.to; k++) used[k] = true;
          list.push(x); said += segs[x.to - 1][1] - segs[x.from - 1][0];
        });
        while (said > room + 2 && list.length > 2) {   // too long: drop from the middle, keep the opening and the close
          var cut = list.splice(list.length - 2, 1)[0]; said -= segs[cut.to - 1][1] - segs[cut.from - 1][0];
        }
        if (!list.length) { sumSt(res.ai ? "Gemini ما لقى كلام واضح بالفيديو — جرّب «لقطات على الإيقاع»" : "ما لقيت جمل واضحة بالفيديو", true); return; }
        sumSt("…جارٍ تجهيز اللحظات");
        return Promise.all(list.map(function (x, i) { return sumEl(i); })).then(function (els) {
          var m = D.m;
          var shots = list.map(function (x, i) {
            var f = x.from - 1, t = x.to - 1;   // a breath before the first word and after the last, short of the next voice
            var lo = Math.max(f ? segs[f - 1][1] + 0.05 : 0, segs[f][0] - 0.15), hi = Math.min(t + 1 < segs.length ? segs[t + 1][0] - 0.05 : m.srcDur - 0.05, segs[t][1] + 0.25);
            return { id: nextId++, name: m.file.name, kind: "video", el: els[i], url: m.url, file: m.file, w: m.w, h: m.h, srcDur: m.srcDur, fps: m.fps,
                     rot: 0, tint: false, sound: false, missing: false, sum: true, talk: true, say: x.text || "", role: x.why || "",
                     lo: lo, hi: hi, center: (lo + hi) / 2, start: lo, len: hi - lo };
          });
          cards.forEach(function (x) { shots.splice(Math.min(x.i, shots.length), 0, x.it); });
          S.items = shots; S.t = 0;
          relayout();
          sumSt((res.ai ? "✓ " + (res.goal ? "هدف الريل: " + res.goal + " · " : "") + "اختار Gemini " + list.length + " أفكار كاملة" + (res.topic ? " — " + res.topic : "")
                        : "Gemini ما اشتغل (" + res.err + ") — اخترت " + list.length + " جمل كاملة على السكتات، بس بدون فهم للمحتوى") +
                " · " + fmt(total()), !res.ai);
        });
      });
  }
  function kindHint() {
    $("rgSumKindHint").textContent = $("rgSumKind").value === "talk"
      ? "Gemini بيسمع الكلام وبيختار أفكار كاملة بدون ما يقطع جملة — صوت الفيديو بيترفع لـ Google لهالغرض وبينحذف بعدها؛ والموسيقى، إذا اخترتها، بتنخفض تحت الكلام"
      : "لقطات قصيرة على إيقاع الموسيقى؛ بدون موسيقى بيضل صوت الفيديو الأصلي";
  }
  /* "Make a reel" and "summarise a video" share the timeline; switching clears it. */
  function setMode(mode) {
    S.mode = mode === "sum" ? "sum" : "create"; $("rgMode").value = S.mode;
    var sum = S.mode === "sum";
    kindHint();
    $("rgSumField").hidden = !sum; $("rgFilesField").hidden = sum; $("rgPick").hidden = sum;
    if (!S.musicBlob) $("rgMusicSt").textContent = sum ? "لا موسيقى بعد — بدونها الريل بصوت الفيديو الأصلي" : "لا موسيقى بعد";
    $("rgEmpty").innerHTML = sum ? "ارفع فيديو طويل واضغط<br>«تحليل وتلخيص»" : "أضف صوراً أو مقاطع فيديو<br>لتظهر المعاينة هنا";
    try { localStorage.setItem("rg_mode", S.mode); } catch (e) {}
  }

  /* ---------- cover ----------
     A clean picture for the reel's cover: the shot under the playhead at full
     size, with no logo and no text (Instagram puts its own title on it). On a
     text card or the end card it takes the next shot, else the one before; in
     a dissolve, whichever shot shows more. The optional guide darkens what
     Instagram's 3:4 profile grid crops off. */
  function gridGuide(g, w, h) {
    if (!$("rgGrid").checked) return;
    var band = (h - w * 4 / 3) / 2;
    g.save(); g.fillStyle = "rgba(0,0,0,.55)"; g.fillRect(0, 0, w, band); g.fillRect(0, h - band, w, band);
    g.strokeStyle = "rgba(255,255,255,.85)"; g.setLineDash([6, 5]); g.lineWidth = 1.5;
    g.strokeRect(0.75, band, w - 1.5, h - 2 * band); g.restore();
  }
  function coverShot() {
    var loc = locate(S.t), x = loc.b && loc.b.alpha > 0.5 ? loc.b : loc.a;
    if (x.seg.kind === "image" || x.seg.kind === "video") return { it: x.seg, local: x.local };
    var list = ready(), i = list.indexOf(x.seg); if (i < 0) i = list.length;
    var shots = list.filter(function (it) { return it.kind !== "card"; });
    var it = list.slice(i + 1).filter(function (it) { return it.kind !== "card"; })[0] || shots[shots.length - 1];
    return it ? { it: it, local: 0 } : null;
  }
  function exportCover() {
    var c = coverShot();
    if (!c) { status("ما في لقطة للغلاف — أضف صورة أو مقطع", true); return; }
    stop(); var oc = new OffscreenCanvas(W, H), og = oc.getContext("2d"), it = c.it;
    seekEl(it, c.local).then(function () {
      og.fillStyle = "#000"; og.fillRect(0, 0, W, H);
      mediaLayer(og, W, H, it, c.local, 0);   // the style's look, still without logo or text
      return oc.convertToBlob({ type: "image/jpeg", quality: 0.92 });
    }).then(function (blob) {
      var a = document.createElement("a");
      a.download = fileName().replace(/^Reel_/, "Cover_").replace(/\.mp4$/, ".jpg"); a.href = URL.createObjectURL(blob); a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 10000);
      status("✓ تم حفظ صورة الغلاف من اللقطة " + (S.items.indexOf(it) + 1) + " — بدون شعار ولا نص");
      drawAt(S.t);
    }).catch(function (e) { status("تعذّر حفظ الغلاف: " + (e && e.message || e), true); });
  }

  /* ---------- export ---------- */
  function exportMp4() {
    if (typeof VideoEncoder === "undefined" || typeof Mp4Muxer === "undefined") { status("المتصفح لا يدعم التصدير. استخدم Chrome أو Edge.", true); return; }
    var T = total();
    if (S.lines.length && !voiceReady() &&
        !confirm(S.voice ? "نص التعليق تغيّر بعد توليد الصوت، فالصوت والكروت ما بيطابقوا النص. تصدير على كل حال؟"
                         : "التعليق الصوتي لسا ما تولّد، فالريل رح يطلع بلا صوت مازن وبلا كروت السكريبت. تصدير على كل حال؟")) return;
    if (!talkReel() && Math.abs(T - reelLen()) > 0.1 && confirm("طول الريل " + T.toFixed(1) + " ث مش " + reelLen() + ". ضبطه على " + reelLen() + " ث قبل التصدير؟")) relayout();
    stop(); status("…تحضير الصوت");
    Promise.all(ready().filter(hears).map(ensureAudio))
      .then(runExport, function () {
        if (S.mode !== "sum") { status("تعذّر قراءة الصوت الأصلي لأحد المقاطع — ألغِ «الصوت الأصلي» له", true); return; }
        if (confirm("تعذّر قراءة صوت الفيديو (الملف أكبر من " + Math.round(SUM_AUDIO_MAX / 1048576) + " MB أو صيغة الصوت غير مدعومة). تصدير بدون صوت؟")) runExport();
        else status("أضف موسيقى، أو صدّر بدون صوت", true);
      });
  }
  function runExport() {
    S.exporting = true;
    var btn = $("rgExport"), bar = $("rgBar"), fill = $("rgBarFill"), T = total(), frames = Math.round(T * FPS), list = ready();
    btn.disabled = true; bar.hidden = false; fill.style.width = "0"; status("…جارٍ التصدير");
    var mix = mixAudio(frames / FPS), hasAudio = !!mix, t0 = performance.now();
    var muxer = new Mp4Muxer.Muxer({ target: new Mp4Muxer.ArrayBufferTarget(), fastStart: "in-memory",
      video: { codec: "avc", width: W, height: H, frameRate: FPS },
      audio: hasAudio ? { codec: "aac", numberOfChannels: 2, sampleRate: 44100 } : undefined });
    var venc = new VideoEncoder({ output: function (c, m) { muxer.addVideoChunk(c, m); }, error: function (e) { fail(e); } });
    venc.configure({ codec: "avc1.640028", width: W, height: H, bitrate: VIDEO_BPS, framerate: FPS });
    var oc = new OffscreenCanvas(W, H), og = oc.getContext("2d"), f = 0;
    function fail(e) { S.exporting = false; btn.disabled = false; bar.hidden = true; status("خطأ بالتصدير: " + (e && e.message || e), true); }
    function step() {
      if (f >= frames) return finish();
      var t = f / FPS, loc = locate(t);
      return seekLoc(loc).then(function () {
        frame(og, W, H, loc);
        var vf = new VideoFrame(oc, { timestamp: Math.round(f * 1e6 / FPS), duration: Math.round(1e6 / FPS) });
        venc.encode(vf, { keyFrame: f % (FPS * 2) === 0 }); vf.close(); f++;
        if (f % 10 === 0) { fill.style.width = Math.round(f / frames * 92) + "%"; status("…جارٍ التصدير " + Math.round(f / frames * 100) + "%"); }
        return (venc.encodeQueueSize > 8 || f % 10 === 0) ? yieldTask().then(step) : step();
      });
    }
    function finish() {
      return venc.flush().then(function () {
        if (!hasAudio) return;
        var aenc = new AudioEncoder({ output: function (c, m) { muxer.addAudioChunk(c, m); }, error: function (e) { fail(e); } });
        aenc.configure({ codec: "mp4a.40.2", sampleRate: 44100, numberOfChannels: 2, bitrate: 160000 });
        var len = mix.len, L = mix.L, R = mix.R;
        for (var off = 0; off < len; off += 1024) {
          var n = Math.min(1024, len - off), buf = new Float32Array(n * 2);
          buf.set(L.subarray(off, off + n), 0); buf.set(R.subarray(off, off + n), n);
          var ad = new AudioData({ format: "f32-planar", sampleRate: 44100, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round(off / 44100 * 1e6), data: buf });
          aenc.encode(ad); ad.close();
        }
        return aenc.flush();
      }).then(function () {
        muxer.finalize();
        var blob = new Blob([muxer.target.buffer], { type: "video/mp4" }), a = document.createElement("a");
        a.download = fileName(); a.href = URL.createObjectURL(blob); a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 10000);
        var secs = (performance.now() - t0) / 1000;
        fill.style.width = "100%"; S.exporting = false; btn.disabled = false;
        status("✓ تم التصدير خلال " + Math.round(secs) + " ث · " + (blob.size / 1048576).toFixed(1) + " MB");
        setTimeout(function () { bar.hidden = true; }, 1500); drawAt(S.t);
      });
    }
    Promise.resolve().then(step).catch(fail);
  }
  /* Let the page breathe between frames. A message channel, not setTimeout:
     browsers throttle timers to ~1/s in a background tab, which would stall an
     export the user switched away from. */
  var yq = [], ych = new MessageChannel();
  ych.port1.onmessage = function () { var r = yq.shift(); if (r) r(); };
  function yieldTask() { return new Promise(function (r) { yq.push(r); ych.port2.postMessage(0); }); }
  function fileName() {
    var first = (ready().filter(function (it) { return it.kind === "card" && it.text.trim(); })[0] || {}).text || "";
    var title = (project().name + " " + first.replace(/\s+/g, " ")).trim().replace(/[\\/:*?"<>|؟?]/g, "").slice(0, 60);
    var d = new Date(), p = function (n) { return (n < 10 ? "0" : "") + n; };
    return "Reel_" + title + "_" + p(d.getMonth() + 1) + p(d.getDate()) + d.getFullYear() + ".mp4";
  }

  /* ---------- device speed test (5 s synthetic reel) ---------- */
  function bench() {
    if (typeof VideoEncoder === "undefined") { status("المتصفح لا يدعم التصدير. استخدم Chrome أو Edge.", true); return; }
    status("…جارٍ اختبار السرعة");
    var enc = new VideoEncoder({ output: function () {}, error: function () {} }), oc = new OffscreenCanvas(W, H), og = oc.getContext("2d"), n = FPS * 5, t0 = performance.now(), f = 0;
    enc.configure({ codec: "avc1.640028", width: W, height: H, bitrate: VIDEO_BPS, framerate: FPS });
    (function loop() {
      for (var i = 0; i < 5 && f < n; i++, f++) {
        var grd = og.createLinearGradient(0, 0, W, H); grd.addColorStop(0, NAVY); grd.addColorStop(1, "hsl(" + (f * 3) + ",60%,50%)");
        og.fillStyle = grd; og.fillRect(0, 0, W, H); og.save(); og.globalAlpha = 0.6; textCard(og, W, H, { text: "اختبار السرعة" }, f / FPS); og.restore();
        var vf = new VideoFrame(oc, { timestamp: f * 40000 }); enc.encode(vf); vf.close();
      }
      if (f < n) { setTimeout(loop, 0); return; }
      enc.flush().then(function () { var x = 5 / ((performance.now() - t0) / 1000); status("سرعة جهازك: " + x.toFixed(1) + "× الوقت الحقيقي — ريل دقيقة بحدود " + Math.max(1, Math.round(60 / x)) + " ث (للصور؛ الفيديو أبطأ)"); });
    })();
  }

  /* ---------- projects (settings only; media is re-linked by file name) ---------- */
  function saveProject() {
    var d = { app: "reels-gen", v: 3, recipe: S.recipe, project: S.project, mode: S.mode, sumLen: +$("rgSumLen").value, sumKind: $("rgSumKind").value,
              talkGoal: S.sumData && S.sumData.goal || S.talkGoal || "", talkTopic: S.sumData && S.sumData.topic || S.talkTopic || "",
              sum: S.sum ? { name: S.sum.name, dt: S.sum.dt, fx: Array.from(S.sum.fx, function (x) { return Math.round(x * 1000) / 1000; }) } : null,   // the crop follows this track once the video is back
              beatSync: $("rgBeatSync").checked, endLen: S.endLen, musicTrack: S.musicTrack, script: $("rgScript").value, lines: S.lines,
              voice: S.voice ? { data: S.voice.data, times: S.voice.times, dur: S.voice.dur } : null,   // the paid-for voiceover travels with the project
              items: S.items.map(function (it) {
                return it.kind === "card" ? { kind: "card", text: it.text, len: it.len, line: it.line }
                                          : { name: it.name, kind: it.kind, start: it.start, len: it.len, rot: it.rot, tint: it.tint, sound: !!it.sound, off: !!it.off, skip: !!it.skip, why: it.why || "",
                                              sum: !!it.sum, center: it.center != null ? it.center : null, lo: it.hi != null ? it.lo : null, hi: it.hi != null ? it.hi : null,
                                              talk: !!it.talk, say: it.say || "", role: it.role || "" };
              }) };
    var a = document.createElement("a"); a.download = "Reel_project_" + project().name + ".json";
    a.href = URL.createObjectURL(new Blob([JSON.stringify(d)], { type: "application/json" })); a.click();
    status("✓ تم حفظ المشروع (الإعدادات والنصوص — الملفات تُضاف من جهازك عند الفتح)");
  }
  function openProject(d) {
    if (!d || d.app !== "reels-gen" || !Array.isArray(d.items)) { status("الملف ليس مشروع Reels Gen", true); return; }
    stop(); setProject(PROJECTS[d.project] ? d.project : "disc");   // projects saved before the picker were DISC reels
    if (d.sumKind) $("rgSumKind").value = d.sumKind === "talk" ? "talk" : "shots";
    S.talkGoal = String(d.talkGoal || ""); S.talkTopic = String(d.talkTopic || "");
    setMode(d.mode); if (d.sumLen) $("rgSumLen").value = String(d.sumLen);
    S.sumData = null; $("rgAnalyse").disabled = true; sumSt(""); $("rgLongName").textContent = "اسحب الفيديو هنا أو اضغط للاختيار";
    S.sum = d.sum && Array.isArray(d.sum.fx) ? { name: String(d.sum.name || ""), dt: +d.sum.dt || 1, fx: Float32Array.from(d.sum.fx) } : null;
    setStyle(RECIPES[d.recipe] ? d.recipe : OLD_RECIPES[d.recipe] || project().style);
    S.items = [];
    d.items.forEach(function (x) {
      if (x.kind === "card") { var c = newCard(String(x.text || "")); c.len = +x.len || CARD_LEN; if (x.line != null) c.line = +x.line; S.items.push(c); return; }
      if (d.v === 1 && x.text && String(x.text).trim()) S.items.push(newCard(String(x.text)));   // v1 captions sat on the shot; they become a card before it
      S.items.push({ id: nextId++, name: String(x.name || ""), kind: x.kind, start: +x.start || 0, len: +x.len || recipe().len, rot: +x.rot || 0, tint: !!x.tint, sound: !!x.sound, off: !!x.off, skip: !!x.skip, why: String(x.why || ""), missing: true,
                     sum: !!x.sum, center: x.center != null ? +x.center : undefined, lo: x.hi != null ? +x.lo : undefined, hi: x.hi != null ? +x.hi : undefined,
                     talk: !!x.talk, say: String(x.say || ""), role: String(x.role || "") });
    });
    $("rgBeatSync").checked = d.beatSync !== false; S.endLen = +d.endLen || null;
    $("rgScript").value = d.script || ""; S.lines = Array.isArray(d.lines) ? d.lines.map(function (l) { return { voice: String(l.voice || ""), card: String(l.card || "") }; }) : [];
    renderLines(); S.voice = null; $("rgVoicePlayer").hidden = true; $("rgArrange").hidden = true; voiceSt("");
    if (d.voice && d.voice.data) setVoice(d.voice.data, d.voice.times || [], d.voice.dur).then(function () { voiceSt("✓ تعليق صوتي · " + S.voice.dur.toFixed(1) + " ث"); }, function () { voiceSt("تعذّرت قراءة التعليق المحفوظ", true); });
    var mt = findTrack(d.musicTrack); if (mt) useTrack(d.musicTrack.split("/")[0], mt);   // a bundled track comes back by itself
    S.t = 0; renderClips(); drawAt(0);
    var longName = (S.items.filter(function (it) { return it.sum; })[0] || {}).name;
    status(S.mode === "sum" && longName ? "✓ تم فتح المشروع — أضف الفيديو «" + longName + "» من «الفيديو الطويل» ليُربط"
                                        : "✓ تم فتح المشروع — أضف الملفات (" + S.items.length + ") من «المواد» وستُربط بأسمائها");
  }

  /* A style sets the music mood too (the music is not regenerated). */
  function setStyle(key) {
    S.recipe = RECIPES[key] ? key : "question"; $("rgRecipe").value = S.recipe;
    $("rgStyleHint").textContent = recipe().hint; $("rgMood").value = recipe().mood;
    stopPreview(); renderTracks();
  }
  /* Load both logos of the chosen project; a late load from an earlier pick is dropped. */
  function setProject(key) {
    S.project = key; $("rgProject").value = key; S.logo = null; S.logoNavy = null;
    var p = project();
    document.documentElement.style.setProperty("--accent", p.accent);
    [["logo", p.onDark], ["logoNavy", p.onLight]].forEach(function (x) {
      var im = new Image();
      im.onload = function () { if (S.project !== key) return; S[x[0]] = im; if (cv) { renderClips(); drawAt(S.t); } };
      im.src = x[1];
    });
  }

  /* ---------- wiring ---------- */
  function wire() {
    cv = $("rgCanvas"); g = cv.getContext("2d");
    $("rgFiles").addEventListener("change", function (e) { addFiles(e.target.files); e.target.value = ""; });
    var drop = $("rgDrop");
    ["dragenter", "dragover"].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add("over"); }); });
    ["dragleave", "drop"].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove("over"); }); });
    drop.addEventListener("drop", function (e) { addFiles(e.dataTransfer.files); });
    $("rgRecipe").innerHTML = Object.keys(RECIPES).map(function (k, i) { return '<option value="' + k + '">' + (i + 1) + ". " + RECIPES[k].name + "</option>"; }).join("");
    function applyStyle(key) {   // re-lay the reel for the style's pace and speeds (text cards keep their length)
      var bundled = !!S.musicTrack;
      setStyle(key); S.endLen = null;
      if (S.mode === "sum" && S.sumData && S.sumData.samples && !talkReel()) buildSummary();   // a new pace needs a new count of moments
      else { S.items.forEach(function (it) { if (it.kind !== "card" && !it.talk) { it.len = recipe().len; clampItem(it); } }); relayout(); }
      if (bundled && TRACKS && TRACKS[S.recipe]) useTrack(S.recipe, TRACKS[S.recipe][0]);   // keep the music in step with the style
    }
    $("rgRecipe").addEventListener("change", function () { applyStyle(this.value); });
    $("rgDraft").onclick = draft;
    $("rgVoiceGen").onclick = genVoice;
    $("rgArrange").onclick = arrange;
    $("rgAddLine").onclick = function () { S.lines.push({ voice: "", card: "" }); renderLines(); var t = $("rgLines").querySelectorAll('[data-k="voice"]'); t[t.length - 1].focus(); if (S.voice) S.voice.stale = true; };
    $("rgBeatSync").addEventListener("change", function () {
      if (this.checked) { if (snapToBeats()) { renderClips(); drawAt(S.t); } }
      else if (S.voice && !S.voice.stale) arrange();   // back to the unsnapped layout
    });
    $("rgAddCard").onclick = function () {
      S.items.push(newCard()); if (!voiceReady()) relayout(); else { stop(); renderClips(); }
      var tas = $("rgClips").querySelectorAll("textarea"); if (tas.length) tas[tas.length - 1].focus();
    };
    $("rgPlay").onclick =function () { if (S.playing) { stop(); drawAt(S.t); } else play(); };
    $("rgSeek").addEventListener("input", function () { stop(); S.t = this.value / 1000 * total(); drawAt(S.t); });
    $("rgGenMusic").onclick = genMusic;
    $("rgMusicFile").addEventListener("change", function (e) { var f = e.target.files[0]; if (f) setMusic(f, f.name); e.target.value = ""; });
    $("rgNoMusic").onclick = function () { setMusic(null); };
    $("rgProject").addEventListener("change", function () { setProject(this.value); applyStyle(project().style); });
    $("rgMode").addEventListener("change", function () {
      if (S.items.length && !confirm("تبديل نوع العمل بيمسح اللقطات الحالية. متابعة؟")) { this.value = S.mode; return; }
      stop(); S.items = []; S.sum = null; S.sumData = null; S.endLen = null; S.t = 0;
      $("rgAnalyse").disabled = true; sumSt(""); $("rgLongName").textContent = "اسحب الفيديو هنا أو اضغط للاختيار"; $("rgLongInfo").textContent = "MP4 · MOV · WEBM — المعالجة على جهازك، لا شيء يُرفع";
      setMode(this.value); relayout();
    });
    $("rgLongFile").addEventListener("change", function (e) { setLong(e.target.files[0]); e.target.value = ""; });
    var longDrop = $("rgLongDrop");
    ["dragenter", "dragover"].forEach(function (ev) { longDrop.addEventListener(ev, function (e) { e.preventDefault(); longDrop.classList.add("over"); }); });
    ["dragleave", "drop"].forEach(function (ev) { longDrop.addEventListener(ev, function (e) { e.preventDefault(); longDrop.classList.remove("over"); }); });
    longDrop.addEventListener("drop", function (e) { setLong(e.dataTransfer.files[0]); });
    $("rgAnalyse").onclick = analyseLong;
    $("rgSumKind").addEventListener("change", function () { kindHint(); if (S.sumData) sumSt("اضغط «تحليل وتلخيص» للتلخيص بهالطريقة"); });
    $("rgSumLen").addEventListener("change", function () {
      if (talkReel()) sumSt("اضغط «تحليل وتلخيص» لتختار الأفكار على الطول الجديد");   // a new length needs a new choice of thoughts
      else if (S.sumData && S.sumData.samples) buildSummary(); else { S.endLen = null; relayout(); }
    });
    $("rgExport").onclick = exportMp4;
    $("rgCover").onclick = exportCover;
    $("rgGrid").addEventListener("change", function () { drawAt(S.t); });
    $("rgPick").onclick = pickShots;
    $("rgBench").onclick = bench;
    $("rgSave").onclick = saveProject;
    $("rgOpen").addEventListener("change", function (e) {
      var f = e.target.files[0]; if (!f) return; var r = new FileReader();
      r.onload = function () { try { openProject(JSON.parse(r.result)); } catch (err) { status("ملف غير صالح", true); } };
      r.readAsText(f); e.target.value = "";
    });
    window.addEventListener("beforeunload", function (e) { if (S.exporting) { e.preventDefault(); e.returnValue = ""; } });
    var lastMode = "create"; try { lastMode = localStorage.getItem("rg_mode") || "create"; } catch (e) {}
    setMode(lastMode);
    setProject($("rgProject").value); setStyle(project().style);
    loadTracks();
    renderClips(); drawAt(0);
  }

  checkAccess().then(function () {
    $("rgGate").hidden = true; $("rgApp").hidden = false;
    return document.fonts.load("700 92px 'Somar Sans'");
  }).then(wire).catch(function (e) {
    if (["no session", "session", "denied"].indexOf(e.message) < 0) $("rgGateMsg").textContent = "تعذّر تحميل الأداة: " + e.message;
  });
})();
