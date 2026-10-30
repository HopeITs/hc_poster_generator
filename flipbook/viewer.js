/* Flipbook — the book viewer (from hc-flipbook, 2026-10-30): pages turned
   with page-flip, drawn by PDF.js 3.11.174, with contents, thumbnails,
   search, zoom and sharing. Libraries are in vendor/ (no CDN: strict CSP).
   A file opened on this device comes from IndexedDB ("hc-flipbook"), put
   there by app.js; it has no share link, so the share button is hidden. */
(() => {
'use strict';
pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const Q = new URLSearchParams(location.search);
$$('button.ic').forEach(b => b.setAttribute('aria-label', b.title));

/* وضع المعاينة المصغّرة داخل الصفحة الرئيسية */
const EMBED = Q.get('embed') === '1';
if (EMBED) document.documentElement.classList.add('embed');

/* نوع الورق: لامع أو مطفي (يمكن تغييره مباشرة من الصفحة الرئيسية عبر postMessage) */
let paper = 'matte';
function setPaper(p){
  paper = p === 'glossy' ? 'glossy' : 'matte';
  document.documentElement.classList.toggle('paper-glossy', paper === 'glossy');
  document.documentElement.classList.toggle('paper-matte', paper === 'matte');
}
setPaper(Q.get('paper'));
window.addEventListener('message', e => {
  if (e.origin !== location.origin || !e.data || e.data.type !== 'hcfb-paper') return;
  setPaper(e.data.value);
});
// اللمعة تتحرك عكس المؤشر كما ينعكس الضوء على ورق لامع
window.addEventListener('mousemove', e => {
  if (paper !== 'glossy') return;
  $('#zoomLayer').style.setProperty('--gx', (80 - e.clientX / innerWidth * 60).toFixed(1) + '%');
}, { passive: true });

/* ================= الحالة =================
   leaves: صفحات الكتاب المنطقية بالترتيب (1..n). صفحة PDF المزدوجة (Spread) تُقسم إلى ورقتين.
   ترتيب العرض داخل PageFlip معكوس في الكتب العربية (RTL). */
let pdf, leaves = [], n = 0, rtl = false, pf = null, els = [], ratio = .707;
let srcUrl = null, localBlob = null, title = '', portraitMode = false;
const urls = [], have = [], need = [], linked = new Set(), annCache = new Map(), textCache = new Map();
let queue = [], busy = false, Z = 1, tx = 0, ty = 0, sound = true;
try { sound = localStorage.getItem('hcfb-sound') !== '0'; } catch (e) {}

/* slots: ترتيب العناصر داخل PageFlip. كل خانة رقم صفحة منطقية أو -1 لصفحة فارغة شفافة.
   الصفحة الفارغة بجانب الغلاف تجعله يُقلَّب كورقة عادية مرنة بدل الغلاف «الصلب» في المكتبة. */
let slots = [], dispOf = [];
const logAt = i => i >= 0 && i < slots.length ? slots[i] : -1;
function buildSlots(){
  const order = Array.from({ length: n }, (_, i) => rtl ? n - 1 - i : i);
  if (portraitMode) slots = order;
  else if (!rtl){ slots = [-1, ...order]; if (slots.length % 2) slots.push(-1); }      // الغلاف يمينًا
  else slots = (n % 2 ? [] : [-1]).concat(order, [-1]);                               // الغلاف يسارًا
  dispOf = []; slots.forEach((k, i) => { if (k >= 0) dispOf[k] = i; });
}
const visibleLogical = () => visibleDisp().map(logAt).filter(k => k >= 0).sort((a, b) => a - b);
const curLog = () => visibleLogical()[0] || 0;

/* ================= أدوات عامة ================= */
function toast(m){ const t = $('#toast'); t.textContent = m; t.classList.add('show'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 2600); }
function prog(f){ $('#progBar').style.width = Math.round(f * 100) + '%'; }
function fail(msg){ $('#loadText').textContent = msg; $('.prog').classList.add('hidden'); }

/* ================= التحميل ================= */
async function start(){
  rtl = Q.get('rtl') === '1';
  const split = Q.get('split') || 'auto';
  let src;
  if (Q.get('local') === '1'){
    const f = await idbGet('local').catch(() => null);
    if (!f) return fail('لم يُعثر على الملف. ارجع إلى الصفحة الرئيسية وارفعه من جديد.');
    localBlob = URL.createObjectURL(f.data);
    $('#tShare').style.display = 'none';   // a file on this device has no link to share
    src = { data: new Uint8Array(await f.data.arrayBuffer()) };
    title = f.name || '';
  } else if (Q.get('pdf')){
    srcUrl = Q.get('pdf');
    src = { url: srcUrl };
  } else { location.replace('./'); return; }

  try {
    const task = pdfjsLib.getDocument({ ...src, isEvalSupported: false });
    task.onProgress = p => p.total && prog(p.loaded / p.total * .8);
    pdf = await task.promise;
  } catch (e) {
    console.error(e);
    return fail('تعذّر فتح الملف. تأكد أن ملف PDF على نفس موقع العارض أو أن خادمه يسمح بالوصول (CORS).');
  }

  // أحجام الصفحات لتحديد الصفحات المزدوجة
  const sizes = [];
  for (let p = 1; p <= pdf.numPages; p++){
    const v = (await pdf.getPage(p)).getViewport({ scale: 1 });
    sizes.push({ w: v.width, h: v.height });
    prog(.8 + .2 * p / pdf.numPages);
  }
  const rs = sizes.map(s => s.w / s.h), minR = Math.min(...rs);
  const isSpread = r => split === '1' ? r > 1 : split === '0' ? false : (minR < 1 && r > minR * 1.6);
  sizes.forEach((s, i) => {
    const p = i + 1;
    if (isSpread(rs[i])){
      const halves = rtl ? ['R', 'L'] : ['L', 'R'];
      halves.forEach(h => leaves.push({ p, half: h, w: s.w / 2, h: s.h }));
    } else leaves.push({ p, half: null, w: s.w, h: s.h });
  });
  n = leaves.length;
  const base = leaves.find(l => l.w / l.h < 1.2) || leaves[0];
  ratio = base.w / base.h;
  document.documentElement.style.setProperty('--ratio', ratio);

  if (!title){
    try { const md = await pdf.getMetadata(); title = md.info && md.info.Title || ''; } catch (e) {}
  }
  title = Q.get('title') || title || decodeURIComponent((srcUrl || 'كتاب').split('/').pop().split('?')[0]).replace(/\.pdf$/i, '');
  $('#bookTitle').textContent = title;
  $('#bookSub').textContent = Q.get('subtitle') || '';
  document.title = title + ' | مركز الرجاء المسيحي';
  $('#slider').max = n;
  // شريط التنقل يتبع اتجاه قراءة الكتاب
  $('#bottom').dir = rtl ? 'rtl' : 'ltr';

  const h =location.hash.match(/page\/(\d+)/);
  const startPage = clampPage(+(h && h[1]) || +Q.get('page') || 1);
  buildBook(startPage);
  buildThumbs();
  loadOutline();
  await waitFor(() => urls[startPage - 1]);
  $('#loading').classList.add('hidden');
}
function clampPage(p){ return Math.min(Math.max(p | 0, 1), n); }
function waitFor(fn, max = 15000){ return new Promise(r => { const t0 = Date.now(); const t = setInterval(() => { if (fn() || Date.now() - t0 > max){ clearInterval(t); r(); } }, 50); }); }

/* ================= بناء الكتاب ================= */
/* تأثير الصفحات:
   magazine صفحات مرنة · book غلاف مقوّى صلب وسميك · album كل الأوراق صلبة وسميكة · notebook دفتر بحلقات معدنية
   onepage صفحة واحدة تُقلَّب · slider شرائح أفقية · cards بطاقات مكدّسة · coverflow عرض دوّار ثلاثي الأبعاد */
const EFFECTS = ['magazine', 'book', 'album', 'notebook', 'onepage', 'slider', 'cards', 'coverflow'];
const effect = EFFECTS.includes(Q.get('effect')) ? Q.get('effect') : 'magazine';
const DECK = ['slider', 'cards', 'coverflow'].includes(effect);       // بلا تقليب: عارض شرائح
document.documentElement.classList.add('fx-' + effect);
// أوراق الدفتر: hard = مقوّاة تدور حول الحلقات بغلاف سميك (مثل الكتاب) · soft = مرنة تنثني (مثل المجلة)
const nbHard = effect === 'notebook' && Q.get('pages') !== 'soft';
if (effect === 'notebook') document.documentElement.classList.add(nbHard ? 'nb-hard' : 'nb-soft');
if (effect === 'book' || effect === 'album' || nbHard) document.documentElement.classList.add('fx-hard');

function wantPortrait(){
  if (DECK || effect === 'onepage') return true;
  const zl = $('#zoomLayer');
  return zl.clientWidth < zl.clientHeight * ratio * 1.25;   // لا تتسع صفحتان بشكل مريح
}
/* الورقة الواحدة في PageFlip = خانة فردية (وجه) + الخانة التالية (ظهر) */
const leafPartner = s => portraitMode ? s : (s % 2 ? s + 1 : s - 1);
function buildBook(startPage){
  const zl = $('#zoomLayer');
  if (pf){ try { pf.destroy(); } catch (e) {} pf = null; }
  const old = $('#book'); if (old) old.remove();
  const book = document.createElement('div'); book.id = 'book';
  zl.prepend(book);
  portraitMode = wantPortrait();
  book.classList.toggle('portrait', portraitMode);
  buildSlots();
  // الأوراق الصلبة: غلافا الكتاب (مع ظهريهما) في «كتاب»، وكل الأوراق في «ألبوم»
  const hard = new Set();
  if (effect === 'book' || nbHard) for (const k of [0, n - 1]){ const s = dispOf[k]; hard.add(s); if (logAt(leafPartner(s)) >= 0) hard.add(leafPartner(s)); }
  els = [];
  slots.forEach((k, i) => {
    const d = document.createElement('div');
    if (k < 0){ d.className = 'page blank'; book.appendChild(d); els.push(d); return; }
    // في وضع الصفحتين: الخانات الزوجية يسار والفردية يمين
    d.className = 'page ' + (i % 2 ? 'side-r' : 'side-l') + (urls[k] ? ' ready' : '');
    if (hard.has(i)) d.classList.add('board');
    // الدفتر: الورقة تدور حول الحلقات ولا تنثني فوق الكعب، فتبقى الحلقات فوقها بشكل صحيح
    if (hard.has(i) || effect === 'album' || nbHard) d.dataset.density = 'hard';
    d.dataset.k = k;
    d.innerHTML = '<div class="ph"><span class="spin"></span></div><img alt="" draggable="false"><div class="fold"></div>';
    if (urls[k]) d.querySelector('img').src = urls[k];
    book.appendChild(d); els.push(d);
    linked.delete(k);
  });
  if (DECK){
    book.classList.add('deck', 'deck-' + effect);
    pf = new Deck(book, els, effect, dispOf[startPage - 1]);
    pf.on('flip', onFlip);
    pf.on('changeState', e => { if (e.data === 'flipping' && effect === 'cards') flipSound(); });
    els.forEach(e => linked.has(+e.dataset.k) || addLinks(+e.dataset.k));
    setTimeout(onFlip, 30);
    return;
  }
  const L =leaves.find(l => l.w / l.h < 1.2) || leaves[0];
  pf = new St.PageFlip(book, {
    width: Math.round(L.w), height: Math.round(L.h), size: 'stretch',
    minWidth: portraitMode ? Math.ceil(zl.clientWidth / 2) + 1 : 100, maxWidth: 4000, minHeight: 100, maxHeight: 6000,
    showCover: false, usePortrait: true, mobileScrollSupport: false, autoSize: true,
    maxShadowOpacity: paper === 'glossy' ? .7 : .5, flippingTime: 850, drawShadow: true, showPageCorners: true, swipeDistance: 20,
    startPage: dispOf[startPage - 1]
  });
  pf.loadFromHTML(els);
  if (blankObserver) blankObserver.disconnect();
  blankObserver = new MutationObserver(syncBlankClip);
  blankObserver.observe(book, { attributes: true, attributeFilter: ['style', 'class'], subtree: true });
  pf.on('flip', onFlip);
  pf.on('changeState', e => {
    if (e.data === 'flipping'){
      flipSound();
      // يبدأ انزلاق الكتاب مع بداية التقليب نحو موضع الصفحتين التاليتين
      if (flipDir) centerBook(visibleDisp()[0] + 2 * flipDir);
    }
    if (e.data === 'read'){ flipDir = 0; centerBook(); }   // يشمل إلغاء السحب قبل اكتماله
  });
  els.forEach(e => e.dataset.k == null || linked.has(+e.dataset.k) || addLinks(+e.dataset.k));
  book.style.transition = 'none';                        // لا انزلاق عند الفتح الأول
  setTimeout(() => { onFlip(); setTimeout(() => { book.style.transition = ''; }, 60); }, 30);
}

/* الغلاف في المنتصف (مثل Heyzine): عندما تظهر صفحة واحدة فقط (الغلاف الأمامي أو الخلفي)
   يُزاح الكتاب نصف صفحة ليتوسط الشاشة، ويعود عند فتحه. */
let flipDir = 0;                     // اتجاه التقليب الجاري: -1 نحو اليسار، 1 نحو اليمين
function centerBook(a = visibleDisp()[0]){
  const book = $('#book'); if (!book || !pf) return;
  let x = 0;
  if (!portraitMode && pf.getOrientation() !== 'portrait'){
    const l = logAt(a), r = logAt(a + 1);
    // كل الصفحات بالعرض نفسه؛ الصفحة الهدف قد لا تكون مرسومة بعد عند القفز المباشر
    const pw = els.map(e => parseFloat(e.style.width) || e.offsetWidth).find(v => v > 0) || 0;
    if (l < 0 && r >= 0) x = -pw / 2;          // صفحة يمنى وحدها
    else if (r < 0 && l >= 0) x = pw / 2;      // صفحة يسرى وحدها
  }
  book.style.transform = x ? `translateX(${x.toFixed(1)}px)` : '';
}
/* عارض الشرائح (slider / cards / coverflow): نفس واجهة PageFlip التي يستخدمها باقي الكود
   (getCurrentPageIndex, flip, turnToPage, on ...)، والصفحات تتحرك بتحويلات CSS. */
class Deck {
  constructor(book, els, mode, start){
    this.book = book; this.els = els; this.mode = mode; this.h = {}; this.state = 'read';
    this.cur = this.pos = Math.max(0, Math.min(start || 0, els.length - 1));
    this.onResize = () => this.layout();
    window.addEventListener('resize', this.onResize);
    // النقر على صفحة جانبية ينقل إليها
    els.forEach((e, i) => e.addEventListener('click', () => { if (!this.moved && i !== this.cur) this.flip(i); }));
    // السحب بالفأرة أو اللمس
    book.addEventListener('pointerdown', e => {
      if (Z !== 1 || e.target.closest('.lnk') || (e.pointerType === 'mouse' && e.button !== 0)) return;
      this.drag = { x: e.clientX, pos: this.pos, t: performance.now() }; this.moved = false;
    });
    this.onMove = e => {
      if (!this.drag || pinch) return;
      const dx = e.clientX - this.drag.x;
      if (Math.abs(dx) > 6){ this.moved = true; book.classList.add('dragging'); }
      if (this.moved){ this.pos = this.drag.pos - dx / this.step(); this.layout(); }
    };
    this.onUp = e => {
      if (!this.drag) return;
      const dx = e.clientX - this.drag.x, d = this.drag; this.drag = null;
      book.classList.remove('dragging');
      if (!this.moved) return;
      const fast = Math.abs(dx) / (performance.now() - d.t) > .4;
      let target = Math.round(this.pos);
      if (target === this.cur && (fast || Math.abs(dx) > 40)) target = this.cur + (dx < 0 ? 1 : -1);
      this.flip(target);
      setTimeout(() => { this.moved = false; }, 50);
    };
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('pointercancel', this.onUp);
    book.classList.add('instant'); this.layout();
    requestAnimationFrame(() => setTimeout(() => book.classList.remove('instant'), 50));
  }
  on(ev, cb){ (this.h[ev] = this.h[ev] || []).push(cb); }
  emit(ev, data){ (this.h[ev] || []).forEach(f => f({ data })); }
  getCurrentPageIndex(){ return this.cur; }
  getPageCount(){ return this.els.length; }
  getOrientation(){ return 'portrait'; }
  getState(){ return this.state; }
  userMove(){}
  flipNext(){ this.flip(this.cur + 1); }
  flipPrev(){ this.flip(this.cur - 1); }
  turnToPage(i){ this.go(i, false); }
  flip(i){ this.go(i, true); }
  go(i, anim){
    i = Math.max(0, Math.min(i, this.els.length - 1));
    const changed = i !== this.cur;
    this.book.classList.toggle('instant', !anim);
    this.cur = i; this.pos = i;
    if (changed){ this.state = 'flipping'; this.emit('changeState', 'flipping'); }
    this.layout();
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.book.classList.remove('instant');
      this.state = 'read';
      if (changed) this.emit('flip', i);
      this.emit('changeState', 'read');
    }, anim ? 480 : 0);
  }
  size(){
    const W = this.book.clientWidth, H = this.book.clientHeight;
    let h = H * .94, w = h * ratio;
    const maxW = W * (this.mode === 'coverflow' ? .46 : this.mode === 'slider' ? .72 : .62);
    if (w > maxW){ w = maxW; h = w / ratio; }
    return { w, h, W, H };
  }
  step(){ const { w, W } = this.size(); return this.mode === 'coverflow' ? w * .55 : this.mode === 'cards' ? Math.min(W * .5, w * 1.2) : w + 28; }
  layout(){
    const { w, h, W, H } = this.size(), s = rtl ? -1 : 1;
    this.els.forEach((e, i) => {
      const d = i - this.pos, a = Math.abs(d), st = e.style;
      let tf = '', op = 1, z = 1000 - Math.round(a * 10);
      if (this.mode === 'slider'){
        tf = `translateX(${d * (w + 28)}px)`;
        op = a > 2.5 ? 0 : 1;
      } else if (this.mode === 'cards'){
        // e: موقع البطاقة بالنسبة لترتيب القراءة (سالب = قُرئت وطارت)
        const r = d * s;
        if (r < 0){ tf = `translateX(${d * (W * .55 + w * .6)}px) rotate(${d * 9}deg)`; op = Math.max(0, 1 + r * .9); }
        else { tf = `translate(${s * r * 16}px, ${r * 12}px) scale(${1 - r * .045})`; op = r > 3.5 ? 0 : 1; }
        z = r < 0 ? 2000 + Math.round(r * 10) : 1000 - Math.round(r * 10);
      } else {
        const c = Math.max(-1, Math.min(1, d));
        const x = Math.sign(d) * (Math.min(a, 1) * w * .58 + Math.max(a - 1, 0) * w * .26);
        tf = `translateX(${x}px) translateZ(${-Math.min(a, 1) * 160 - Math.max(a - 1, 0) * 40}px) rotateY(${-c * 52}deg)`;
        op = a > 4.5 ? 0 : 1;
      }
      Object.assign(st, { position: 'absolute', display: a > 6 ? 'none' : 'block', width: w + 'px', height: h + 'px',
        left: (W - w) / 2 + 'px', top: (H - h) / 2 + 'px', transform: tf, opacity: op, zIndex: z });
      e.classList.toggle('current', i === this.cur);
    });
  }
  destroy(){
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
    window.removeEventListener('pointercancel', this.onUp);
    this.book.remove();
  }
}

/* اتجاه السحب باليد: من أي جهة من كعب الكتاب بدأ */
function dirFromPoint(x){
  const blk = $('#book .stf__block'); if (!blk) return 0;
  const r = blk.getBoundingClientRect();
  return x > r.left + r.width / 2 ? 1 : -1;
}
const flipLeft = () => { if (!pf) return; flipDir = -1; pf.flipPrev(); };
const flipRight = () => { if (!pf) return; flipDir = 1; pf.flipNext(); };

/* عند تقليب الصفحة الأولى أو الأخيرة تكون «الصفحة السفلية» هي الصفحة الفارغة الشفافة.
   PageFlip لا يقص الصفحة التي تُقلَّب، بل يرسم الصفحة السفلية فوقها مقصوصة بشكل المثلث المكشوف؛
   ولأن الفارغة شفافة كانت الصفحة الأصلية تظهر من خلالها. هنا نقص المثلث نفسه من الصفحة الأصلية
   فيظهر ما تحت الكتاب، كما لو أن آخر ورقة ترتفع عن الطاولة. */
let blankObserver = null;
const clipped = new Set(), lastClip = new WeakMap();
/* خلل في PageFlip: الورقة الصلبة على الجهة اليسرى تُرسم عند حافة الحاوية (x = 0) بدل حافة الكتاب،
   فتنفصل عن الكعب عندما يكون الكتاب أضيق من حاويته (وهو حالنا دائمًا). نصحّح موضعها قبل الرسم. */
function fixHardPos(){
  const simple = els.find(e => e.classList.contains('--simple') && e.style.display === 'block');
  let spine = null, top = 0, pw = 0;
  if (simple){
    pw = parseFloat(simple.style.width) || 0; top = parseFloat(simple.style.top) || 0;
    spine = (parseFloat(simple.style.left) || 0) + (simple.classList.contains('--left') ? pw : 0);
  }
  for (const e of els){
    const tr = e.style.transform || '';
    if (e.style.display !== 'block' || !/rotateY/.test(tr) || e.classList.contains('--simple')) continue;
    const m = /translate3d\(([-\d.e+]+)px,\s*([-\d.e+]+)px/.exec(tr); if (!m) continue;
    const w = parseFloat(e.style.width) || pw;
    let sp = spine;
    if (sp == null){ const blk = $('#book .stf__block'); if (!blk) continue; sp = blk.clientWidth / 2; }
    const x = e.classList.contains('--left') ? sp - w : sp;
    if (Math.abs(+m[1] - x) < .5 && Math.abs(+m[2] - top) < .5) continue;
    e.style.transform = tr.replace(m[0], `translate3d(${x.toFixed(2)}px, ${top}px`);
  }
}

function syncBlankClip(){
  if (effect === 'book' || effect === 'album' || effect === 'notebook') fixHardPos();
  const want = new Map();
  for (const b of els){
    if (!b.classList.contains('blank') || b.style.display !== 'block') continue;
    const m = /polygon\(([^)]*)\)/.exec(b.style.clipPath || ''); if (!m) continue;
    const tr = b.style.transform || '';
    const rot = /rotate\(([-\d.e+]+)rad\)/.exec(tr);
    if (rot && Math.abs(+rot[1]) > 1e-6) continue;
    const t = /translate3d\(([-\d.e+]+)px,\s*([-\d.e+]+)px/.exec(tr);
    const side = b.classList.contains('--right') ? '--right' : '--left';
    const target = els.find(e => e !== b && !e.classList.contains('blank') && e.style.display === 'block'
      && e.classList.contains('--simple') && e.classList.contains(side));
    if (!target) continue;
    const dx = (t ? +t[1] : 0) - (parseFloat(target.style.left) || 0);
    const dy = (t ? +t[2] : 0) - (parseFloat(target.style.top) || 0);
    const pw = target.offsetWidth, ph = target.offsetHeight, M = 20;
    // نقاط على حافة الصفحة تُمدّ للخارج حتى تُقص حافة الأوراق المكدّسة معها
    const out = (v, max) => v <= 1 ? v - M : v >= max - 1 ? v + M : v;
    const pts = [...m[1].matchAll(/(-?[\d.]+(?:e[-+]?\d+)?)px\s+(-?[\d.]+(?:e[-+]?\d+)?)px/g)]
      .map(p => out(+p[1] + dx, pw).toFixed(2) + ' ' + out(+p[2] + dy, ph).toFixed(2));
    if (pts.length < 3) continue;
    // المستطيل الخارجي أوسع من الصفحة بهامش حتى يبقى ظل حافة الأوراق ظاهرًا
    want.set(target, `path(evenodd, "M${-M} ${-M} H${pw + M} V${ph + M} H${-M} Z M${pts.join(' L')} Z")`);
  }
  for (const e of clipped){
    if (want.has(e)) continue;
    clipped.delete(e); lastClip.delete(e);
    if (e.classList.contains('--simple')) e.style.clipPath = '';
  }
  want.forEach((v, e) => {
    if (lastClip.get(e) === v && e.style.clipPath) return;   // لا تكتب القيمة نفسها (تجنّب حلقة المراقب)
    lastClip.set(e, v); clipped.add(e); e.style.clipPath = v;
  });
}

function onFlip(){
  if (!pf) return;
  updateUI();
  centerBook();
  layoutDepth();
  setTimeout(layoutDepth, 120);     // بعد أن يضع PageFlip الصفحات في أماكنها الجديدة
  schedule();
  history.replaceState(null, '', location.pathname + location.search + '#page/' + (curLog() + 1));
}

/* الصفحات الظاهرة الآن (بترتيب العرض) */
function visibleDisp(){
  const i = pf.getCurrentPageIndex();
  if (portraitMode || pf.getOrientation() === 'portrait') return [i];
  const a = i - (i % 2);
  return a + 1 < slots.length ? [a, a + 1] : [a];
}

function updateUI(){
  const vis = visibleLogical().map(k => k + 1);
  $('#pageInfo').textContent = (vis.length > 1 ? vis[0] + '-' + vis[1] : vis[0]) + ' / ' + n;
  $('#slider').value = vis[0];
  $$('.th.cur').forEach(t => t.classList.remove('cur'));
  vis.forEach(p => { const t = $(`.th[data-k="${p - 1}"]`); if (t) t.classList.add('cur'); });
  const vd = visibleDisp(), a = vd[0], b = vd[vd.length - 1];
  $('#navL').disabled = slots.slice(0, a).every(k => k < 0);
  $('#navR').disabled = slots.slice(b + 1).every(k => k < 0);
}

/* سماكة الصفحات: حواف أوراق مكدّسة تُرسم كظلال على الصفحة الخارجية نفسها،
   فتتحرك معها دائمًا ولا تنفصل عنها عند تغيّر الحجم. الصنف dl-N / dr-N = عرض الحافة بالبكسل. */
const DEPTH_MAX = 10;
(function depthCss(){
  // --bd: حافة الغلاف المقوّى · --drop: ظل الكتاب في الأوضاع الصلبة (بدل filter الذي يفسد الدوران ثلاثي الأبعاد)
  let css = '.page{box-shadow:var(--bd,0 0 transparent),var(--sl,0 0 transparent),var(--sr,0 0 transparent),var(--drop,0 0 transparent)}';
  for (let w = 1; w <= DEPTH_MAX; w++){
    const layer = (i, dir) => `${dir * i}px 0 0 ${i === w ? 'var(--edge-out)' : i % 2 ? 'var(--edge-a)' : 'var(--edge-b)'}`;
    const L = [], R = [];
    for (let i = 1; i <= w; i++){ L.push(layer(i, -1)); R.push(layer(i, 1)); }
    css += `.page.dl-${w}{--sl:${L.join(',')}}.page.dr-${w}{--sr:${R.join(',')}}`;
  }
  const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s);
})();
function layoutDepth(){
  layoutRings();
  els.forEach(e => [...e.classList].forEach(c => /^d[lr]-\d+$/.test(c) && e.classList.remove(c)));
  if (!pf || portraitMode || pf.getOrientation() === 'portrait') return;
  const vis = visibleDisp().filter(i => logAt(i) >= 0);
  if (!vis.length) return;
  const a = vis[0], b = vis[vis.length - 1];
  const count = (from, to) => slots.slice(from, to).filter(k => k >= 0).length;
  // أوراق الألبوم سميكة: حافة أعرض لكل ورقة
  const per = effect === 'album' ? 1.2 : 3;
  const w = c => c <= 0 ? 0 : Math.max(2, Math.min(DEPTH_MAX, Math.round(c / per)));
  const put = (i, side, c) => { const px = w(c); if (px && els[i] && logAt(i) >= 0) els[i].classList.add(side + px); };
  const lc = count(0, a), rc = count(b + 1);
  put(a, 'dl-', lc); put(b, 'dr-', rc);
  // الصفحات التي تنكشف تحت الورقة عند ثني الزاوية أو التقليب تأخذ حافتها مسبقًا
  put(a - 2, 'dl-', lc - 2); put(b + 2, 'dr-', rc - 2);
}

/* حلقات الدفتر: عمود من الحلقات المعدنية على كعب الصفحات الظاهرة */
/* الموضع يُحسب من هندسة الكتاب نفسها (الكعب = منتصف مساحة PageFlip، وارتفاع الصفحة من أبعادها)
   لا من الحدود الظاهرة للصفحات: الصفحة التي تدور ثلاثي الأبعاد تكبر حدودها مؤقتًا فتقفز الحلقات.
   الحلقات داخل مساحة الصفحات: فوق الصفحات الثابتة والسفلية، وفي الورق المرن تحت الورقة التي تُقلَّب. */
function layoutRings(){
  if (effect !== 'notebook' || DECK || !pf) return;
  const blk = $('#book .stf__block'); if (!blk) return;
  let rings = $('#rings');
  if (!rings){ blk.insertAdjacentHTML('beforeend', '<div id="rings" aria-hidden="true"></div>'); rings = $('#rings'); }
  const ref = els.find(e => e.classList.contains('--simple') && e.style.display === 'block' && !e.classList.contains('blank'))
    || els.find(e => parseFloat(e.style.height) > 0);
  if (!ref){ rings.style.display = 'none'; return; }
  const ph = parseFloat(ref.style.height) || 0, top = parseFloat(ref.style.top) || 0;
  const x = portraitMode || pf.getOrientation() === 'portrait' ? (parseFloat(ref.style.left) || 0) : blk.clientWidth / 2;
  Object.assign(rings.style, { display: 'block', left: x + 'px', top: top + ph * .03 + 'px', height: ph * .94 + 'px' });
}

/* حدود الصفحات الظاهرة فعلًا على الشاشة (بدون الصفحات الفارغة) */
function bookRect(){
  const rects = visibleDisp().filter(i => logAt(i) >= 0).map(i => els[i].getBoundingClientRect()).filter(r => r.width > 0);
  if (!rects.length) return null;
  const left = Math.min(...rects.map(r => r.left)), right = Math.max(...rects.map(r => r.right));
  return { left, right, top: rects[0].top, bottom: rects[0].bottom, height: rects[0].height, pageW: rects[0].width };
}

/* ثني الزاوية عند المرور: PageFlip يُظهره في مساحة كبيرة (خُمس قطر الصفحة) ولا يمكن ضبطها،
   لذلك نمرّر حركة الفأرة إليه فقط عندما يكون المؤشر داخل زاوية خارجية صغيرة. */
const CORNER = 0.13;                 // نسبة من عرض الصفحة
let mouseDown = false, cornerOn = false;
// بالفأرة: الضغط والسحب يبدأ التقليب فقط من الزوايا، فالنقر داخل الصفحة لا يقلبها
// (ويبقى النقر المزدوج للتكبير والروابط يعملان). اللمس على الجوال غير متأثر.
window.addEventListener('mousedown', e => {
  if (pf && Z === 1 && e.target.closest && e.target.closest('#book') && !cornerHit(e.clientX, e.clientY, 1.4)){
    e.stopPropagation(); return;
  }
  mouseDown = true;
  if (pf && e.target.closest && e.target.closest('#book')) flipDir = dirFromPoint(e.clientX);
}, true);
window.addEventListener('touchstart', e => {
  if (pf && e.touches.length === 1 && e.target.closest && e.target.closest('#book')) flipDir = dirFromPoint(e.touches[0].clientX);
}, { capture: true, passive: true });
window.addEventListener('mouseup', () => { mouseDown = false; }, true);
function cornerHit(x, y, grow = 1){
  const r = bookRect(); if (!r) return false;
  const cs = Math.max(28, Math.min(90, r.pageW * CORNER)) * grow;
  const vx = (x >= r.left && x <= r.left + cs) || (x <= r.right && x >= r.right - cs);
  const vy = (y >= r.top && y <= r.top + cs) || (y <= r.bottom && y >= r.bottom - cs);
  return vx && vy;
}
window.addEventListener('mousemove', e => {
  if (!pf || mouseDown) return;                 // السحب باليد يعمل كالمعتاد
  e.stopPropagation();                           // لا تصل الحركة إلى PageFlip مباشرة
  if (Z !== 1 || !/read|fold_corner/.test(pf.getState())) return;
  const blk = $('#book .stf__block'); if (!blk) return;
  const hit = cornerHit(e.clientX, e.clientY);
  if (!hit && !cornerOn) return;
  cornerOn = hit;
  const b = blk.getBoundingClientRect();
  pf.userMove(hit ? { x: e.clientX - b.left, y: e.clientY - b.top } : { x: -1e5, y: -1e5 }, false);
}, true);
document.addEventListener('mouseleave', () => { if (cornerOn && pf){ cornerOn = false; pf.userMove({ x: -1e5, y: -1e5 }, false); } });

/* ================= الرسم بدقة عالية ================= */
function pageCssH(){
  const b = $('#book'); if (!b) return 800;
  const W = b.clientWidth, H = b.clientHeight;
  let pw = portraitMode ? W : W / 2, ph = pw / ratio;
  return Math.min(ph, H);
}
function basePx(){ return Math.min(2600, Math.ceil(pageCssH() * Math.min(window.devicePixelRatio || 1, 2.5))); }
function want(k, px){ if (k >= 0 && k < n && (need[k] || 0) < px) need[k] = px; }

function schedule(){
  if (!pf) return;
  const base = basePx();
  const vis = visibleLogical();
  if (!vis.length) return;
  const order = [...vis];
  vis.forEach(k => want(k, Math.min(4200, base * Z)));
  for (let d = 1; d <= 6; d++) for (const k of [vis[0] - d, vis[vis.length - 1] + d]) if (k >= 0 && k < n){ want(k, base); order.push(k); }
  queue = order.concat(queue.filter(k => !order.includes(k)));
  pump();
}
async function pump(){
  if (busy) return; busy = true;
  while (queue.length){
    const k = queue.shift();
    if (!((have[k] || 0) < (need[k] || 0) * .95)) continue;
    try { await renderLeaf(k, need[k]); } catch (e) { console.warn('render', k, e); have[k] = need[k]; }
  }
  busy = false;
}
async function renderLeaf(k, px){
  const L = leaves[k];
  const page = await pdf.getPage(L.p);
  const v1 = page.getViewport({ scale: 1 });
  const scale = Math.min(px / v1.height, 8000 / v1.width, 6000 / v1.height);
  const vp = page.getViewport({ scale });
  const c = document.createElement('canvas');
  c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
  const ctx = c.getContext('2d', { alpha: false });
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  await page.render({ canvasContext: ctx, viewport: vp, intent: 'display', annotationMode: pdfjsLib.AnnotationMode.ENABLE_FORMS }).promise;
  // ورقة واحدة أو نصفا صفحة مزدوجة
  const targets = L.half ? leaves.map((l, i) => i).filter(i => leaves[i].p === L.p) : [k];
  for (const t of targets){
    let out = c;
    if (leaves[t].half){
      const hw = Math.floor(c.width / 2);
      out = document.createElement('canvas'); out.width = hw; out.height = c.height;
      out.getContext('2d').drawImage(c, leaves[t].half === 'L' ? 0 : c.width - hw, 0, hw, c.height, 0, 0, hw, c.height);
    }
    const blob = await new Promise(r => out.toBlob(r, 'image/jpeg', .92));
    setLeafImage(t, URL.createObjectURL(blob), c.height);
  }
  c.width = c.height = 0;
  page.cleanup();
}
function setLeafImage(k, url, px){
  const old = urls[k];
  urls[k] = url; have[k] = Math.max(have[k] || 0, px);
  const el = els[dispOf[k]];
  if (el){
    const img = el.querySelector('img');
    const done = () => { el.classList.add('ready'); if (old) setTimeout(() => URL.revokeObjectURL(old), 1500); };
    img.onload = done; img.src = url;
  }
  const th = $(`.th[data-k="${k}"] .im`);
  if (th) th.style.backgroundImage = `url(${url})`;
}

/* ================= روابط PDF التفاعلية ================= */
async function annotations(p){
  if (!annCache.has(p)) annCache.set(p, pdf.getPage(p).then(pg => pg.getAnnotations({ intent: 'display' })).catch(() => []));
  return annCache.get(p);
}
async function addLinks(k){
  linked.add(k);
  const L = leaves[k], page = await pdf.getPage(L.p), v1 = page.getViewport({ scale: 1 });
  const anns = (await annotations(L.p)).filter(a => a.subtype === 'Link' && (a.url || a.dest || a.unsafeUrl));
  const el = els[dispOf[k]]; if (!el) return;
  el.querySelectorAll('.lnk').forEach(a => a.remove());
  for (const a of anns){
    const [x1, y1, x2, y2] = v1.convertToViewportRectangle(a.rect);
    let l = Math.min(x1, x2), r = Math.max(x1, x2), t = Math.min(y1, y2), b = Math.max(y1, y2);
    let W = v1.width;
    if (L.half){
      const mid = W / 2, cx = (l + r) / 2;
      if ((L.half === 'L') !== (cx < mid)) continue;   // الرابط في النصف الآخر
      if (L.half === 'R'){ l -= mid; r -= mid; }
      W = mid; l = Math.max(0, l); r = Math.min(W, r);
    }
    const link = document.createElement('a');
    link.className = 'lnk';
    Object.assign(link.style, { left: l / W * 100 + '%', top: t / v1.height * 100 + '%', width: (r - l) / W * 100 + '%', height: (b - t) / v1.height * 100 + '%' });
    const url = a.url || a.unsafeUrl;
    if (url){ link.href = url; link.target = '_blank'; link.rel = 'noopener'; link.title = url; }
    else {
      link.href = '#'; link.title = 'انتقال إلى صفحة';
      link.onclick = async e => { e.preventDefault(); const k2 = await destToLeaf(a.dest); if (k2 != null) goTo(k2 + 1); };
    }
    // منع PageFlip من اعتبار النقرة سحبًا للصفحة
    ['mousedown', 'touchstart', 'pointerdown'].forEach(ev => link.addEventListener(ev, e => e.stopPropagation(), { passive: true }));
    el.appendChild(link);
  }
}
async function destToLeaf(dest){
  try {
    if (typeof dest === 'string') dest = await pdf.getDestination(dest);
    if (!Array.isArray(dest)) return null;
    const p = (typeof dest[0] === 'object' ? await pdf.getPageIndex(dest[0]) : dest[0]) + 1;
    const ls = leaves.map((l, i) => i).filter(i => leaves[i].p === p);
    if (ls.length < 2) return ls[0];
    const v = (await pdf.getPage(p)).getViewport({ scale: 1 });
    const x = typeof dest[2] === 'number' ? dest[2] : 0;
    const half = x < v.viewBox[2] / 2 ? 'L' : 'R';
    return ls.find(i => leaves[i].half === half);
  } catch (e) { return null; }
}

/* ================= التنقل ================= */
function goTo(p, animate = true){
  if (Z !== 1) resetZoom();
  const idx = dispOf[clampPage(p) - 1];
  if (visibleDisp().includes(idx)) return;
  const cur = pf.getCurrentPageIndex();
  if (animate && Math.abs(idx - cur) <= 3 && pf.getState() === 'read') pf.flip(idx);
  else { pf.turnToPage(idx); onFlip(); }
}

/* ================= التكبير والتحريك ================= */
const zl = $('#zoomLayer'), stage = $('#stage');
function clampPan(){
  const W = zl.clientWidth, H = zl.clientHeight;
  const mx = W * (Z - 1) / 2 + 40, my = H * (Z - 1) / 2 + 40;
  tx = Math.max(-mx, Math.min(mx, tx)); ty = Math.max(-my, Math.min(my, ty));
}
let zoomTimer;
function setZoom(z, cx, cy){
  z = Math.max(1, Math.min(4, z));
  const r = zl.getBoundingClientRect();
  // ثبّت النقطة تحت المؤشر أثناء التكبير
  const ox = (cx ?? r.left + r.width / 2) - (r.left + r.width / 2);
  const oy = (cy ?? r.top + r.height / 2) - (r.top + r.height / 2);
  tx = ox - (ox - tx) * (z / Z); ty = oy - (oy - ty) * (z / Z);
  Z = z; if (Z === 1){ tx = ty = 0; }
  clampPan(); applyZoom();
  clearTimeout(zoomTimer); zoomTimer = setTimeout(schedule, 250);
}
function applyZoom(){
  zl.style.transform = Z === 1 ? '' : `translate(${tx}px,${ty}px) scale(${Z})`;
  zl.classList.toggle('zoomed', Z > 1);
  stage.classList.toggle('can-pan', Z > 1);
  const badge = $('#zoomBadge');
  badge.textContent = Math.round(Z * 100) + '%';
  badge.classList.toggle('hidden', Z === 1);
  $('#tZoomOut').disabled = Z === 1;
  if (Z === 1) setTimeout(layoutDepth, 300);
}
function resetZoom(){ setZoom(1); }

// سحب الصفحة المكبّرة
let pan = null;
stage.addEventListener('pointerdown', e => {
  if (Z === 1 || e.target.closest('.glass,#panel,.lnk')) return;
  pan = { x: e.clientX, y: e.clientY, tx, ty, moved: false };
  stage.setPointerCapture(e.pointerId); stage.classList.add('panning'); zl.classList.add('dragging');
});
stage.addEventListener('pointermove', e => {
  if (!pan || pinch) return;
  tx = pan.tx + e.clientX - pan.x; ty = pan.ty + e.clientY - pan.y;
  if (Math.abs(e.clientX - pan.x) + Math.abs(e.clientY - pan.y) > 4) pan.moved = true;
  clampPan(); applyZoom();
});
const endPan = () => { if (!pan) return; pan = null; stage.classList.remove('panning'); zl.classList.remove('dragging'); };
stage.addEventListener('pointerup', endPan); stage.addEventListener('pointercancel', endPan);

// نقر مزدوج للتكبير أو الرجوع
stage.addEventListener('dblclick', e => {
  if (e.target.closest('.glass,#panel')) return;
  Z > 1 ? resetZoom() : setZoom(2.2, e.clientX, e.clientY);
});
// Ctrl + العجلة (أو العجلة أثناء التكبير)
stage.addEventListener('wheel', e => {
  if (e.target.closest('#panel')) return;
  if (!e.ctrlKey && Z === 1) return;
  e.preventDefault();
  if (e.ctrlKey) setZoom(Z * Math.exp(-e.deltaY * .0025), e.clientX, e.clientY);
  else { tx -= e.deltaX; ty -= e.deltaY; clampPan(); zl.classList.add('dragging'); applyZoom(); clearTimeout(stage._w); stage._w = setTimeout(() => zl.classList.remove('dragging'), 120); }
}, { passive: false });
// تكبير بإصبعين على الجوال
let pinch = null;
stage.addEventListener('touchstart', e => {
  if (e.touches.length === 2){
    e.stopPropagation(); e.preventDefault();
    const [a, b] = e.touches;
    pinch = { d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), z: Z };
    zl.classList.add('dragging');
  }
}, { capture: true, passive: false });
stage.addEventListener('touchmove', e => {
  if (!pinch || e.touches.length !== 2) return;
  e.stopPropagation(); e.preventDefault();
  const [a, b] = e.touches;
  const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  setZoom(pinch.z * d / pinch.d, (a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2);
}, { capture: true, passive: false });
stage.addEventListener('touchend', e => { if (pinch && e.touches.length < 2){ pinch = null; zl.classList.remove('dragging'); } }, { capture: true });

/* ================= اللوحة الجانبية ================= */
function openPanel(tab){
  $('#panel').classList.add('open');
  $$('.tab').forEach(t => t.setAttribute('aria-selected', t.dataset.tab === tab));
  $$('.pane').forEach(p => p.classList.toggle('hidden', p.dataset.pane !== tab));
  if (tab === 'search') setTimeout(() => $('#sInput').focus(), 50);
  if (tab === 'thumbs'){ const c = $('.th.cur'); if (c) c.scrollIntoView({ block: 'center' }); }
}
const closePanel = () => $('#panel').classList.remove('open');
$$('.tab').forEach(t => t.onclick = () => openPanel(t.dataset.tab));
$('#panelClose').onclick = closePanel;
$('#tToc').onclick = () => openPanel('toc');
$('#tThumbs').onclick = () => openPanel('thumbs');
$('#tSearch').onclick = () => openPanel('search');

function buildThumbs(){
  const g = $('#thumbGrid'); g.innerHTML = '';
  const io = new IntersectionObserver(es => es.forEach(en => {
    if (!en.isIntersecting) return;
    const k = +en.target.dataset.k; io.unobserve(en.target);
    if (!urls[k]){ want(k, 300); queue.push(k); pump(); }
  }), { root: g.parentElement, rootMargin: '200px' });
  for (let k = 0; k < n; k++){
    const b = document.createElement('button');
    b.className = 'th'; b.dataset.k = k;
    b.innerHTML = `<div class="im"${urls[k] ? ` style="background-image:url(${urls[k]})"` : ''}></div><span>${k + 1}</span>`;
    b.onclick = () => { goTo(k + 1, false); if (innerWidth < 720) closePanel(); };
    g.appendChild(b); io.observe(b);
  }
}

async function loadOutline(){
  const box = $('#tocBox');
  let outline = null;
  try { outline = await pdf.getOutline(); } catch (e) {}
  if (!outline || !outline.length){
    box.innerHTML = '<div class="empty">لا يحتوي هذا الملف على فهرس. استخدم تبويب «الصفحات».</div>';
    return;
  }
  const make = async items => {
    const ul = document.createElement('ul'); ul.className = 'toc';
    for (const it of items){
      const li = document.createElement('li');
      const k = await destToLeaf(it.dest);
      const b = document.createElement('button');
      b.innerHTML = `<span></span>${k != null ? `<bdi>${k + 1}</bdi>` : ''}`;
      b.firstChild.textContent = it.title;
      if (k != null) b.onclick = () => { goTo(k + 1); if (innerWidth < 720) closePanel(); };
      else if (it.url) b.onclick = () => window.open(it.url, '_blank', 'noopener');
      li.appendChild(b);
      if (it.items && it.items.length) li.appendChild(await make(it.items));
      ul.appendChild(li);
    }
    return ul;
  };
  box.innerHTML = ''; box.appendChild(await make(outline));
}

/* ================= البحث ================= */
const norm = s => s.toLowerCase().replace(/[ً-ٰٟـ]/g, '').replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/\s+/g, ' ');
async function leafTexts(p){
  if (!textCache.has(p)) textCache.set(p, (async () => {
    const page = await pdf.getPage(p), v = page.getViewport({ scale: 1 }), tc = await page.getTextContent();
    const parts = { L: [], R: [], all: [] };
    tc.items.forEach(it => { if (!it.str) return; parts.all.push(it.str); (it.transform[4] < v.viewBox[2] / 2 ? parts.L : parts.R).push(it.str); });
    return { L: parts.L.join(' '), R: parts.R.join(' '), all: parts.all.join(' ') };
  })());
  return textCache.get(p);
}
$('#sForm').onsubmit = async e => {
  e.preventDefault();
  const q = norm($('#sInput').value.trim()), box = $('#sResults');
  if (q.length < 2){ box.innerHTML = '<div class="empty">اكتب حرفين على الأقل.</div>'; return; }
  box.innerHTML = '<div class="empty"><span class="spin" style="display:inline-block"></span></div>';
  const results = [];
  for (let k = 0; k < n && results.length < 150; k++){
    const L = leaves[k], t = await leafTexts(L.p);
    const raw = L.half ? t[L.half] : t.all, low = norm(raw);
    let i = low.indexOf(q);
    while (i >= 0 && results.length < 150){
      results.push({ k, snip: low.slice(Math.max(0, i - 40), i + q.length + 40), q });
      i = low.indexOf(q, i + q.length);
    }
  }
  box.innerHTML = results.length ? `<div class="note" style="margin-bottom:6px">${results.length} نتيجة</div>` : '<div class="empty">لا توجد نتائج.</div>';
  results.forEach(r => {
    const b = document.createElement('button'); b.className = 'res';
    const s = r.snip, i = s.indexOf(r.q);
    b.innerHTML = `<small>صفحة <bdi>${r.k + 1}</bdi></small><span></span>`;
    const span = b.querySelector('span');
    span.append('…' + s.slice(0, i)); const m = document.createElement('mark'); m.textContent = s.slice(i, i + r.q.length); span.append(m, s.slice(i + r.q.length) + '…');
    b.onclick = () => { goTo(r.k + 1); if (innerWidth < 720) closePanel(); };
    box.appendChild(b);
  });
};

/* ================= صوت التقليب ================= */
let actx;
function flipSound(){
  if (!sound) return;
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const sr = actx.sampleRate, dur = .45, len = Math.floor(sr * dur);
    const buf = actx.createBuffer(1, len, sr), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++){
      const t = i / len;
      const env = Math.min(1, t * 18) * Math.pow(1 - t, 1.6) * (0.65 + 0.35 * Math.sin(t * Math.PI * 3));
      d[i] = (Math.random() * 2 - 1) * env;
    }
    const s = actx.createBufferSource(); s.buffer = buf;
    const hp = actx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 900;
    const lp = actx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(5200, actx.currentTime); lp.frequency.linearRampToValueAtTime(1800, actx.currentTime + dur);
    const g = actx.createGain(); g.gain.value = .35;
    s.connect(hp).connect(lp).connect(g).connect(actx.destination); s.start();
  } catch (e) {}
}
function paintSound(){ $('#tSound').classList.toggle('on', sound); $('#tSound .wave').style.display = sound ? '' : 'none'; }

/* ================= المشاركة ================= */
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
function shareUrl(withPage){
  const u = new URL(location.href); u.hash = withPage ? 'page/' + (curLog() + 1) : '';
  return u.toString().replace(/#$/, '');
}
async function openShare(){
  const body = $('#shareBody');
  if (!srcUrl){
    body.innerHTML = `<p class="note" style="margin-top:12px">هذا الكتاب مفتوح من ملف على جهازك فقط، لذلك لا يملك رابطًا عامًا.
      لنشره: ارفع ملف PDF إلى موقع المركز ثم أضفه إلى المكتبة أو افتحه برابطه.</p>`;
  } else {
    const link = shareUrl(false), linkP = shareUrl(true);
    const embed = `<iframe src="${link}" width="100%" height="640" style="border:0;max-width:100%" allow="fullscreen" allowfullscreen loading="lazy" title="${esc(title)}"></iframe>`;
    const enc = encodeURIComponent;
    body.innerHTML = `
      <h3>الرابط</h3>
      <div class="row"><input class="field" readonly value="${esc(link)}"><button class="btn" data-copy="${esc(link)}">نسخ</button></div>
      <h3>رابط الصفحة الحالية (<bdi>${curLog() + 1}</bdi>)</h3>
      <div class="row"><input class="field" readonly value="${esc(linkP)}"><button class="btn ghost" data-copy="${esc(linkP)}">نسخ</button></div>
      <h3>مشاركة مباشرة</h3>
      <div class="row">
        <a class="btn ghost" target="_blank" rel="noopener" href="https://wa.me/?text=${enc(title + ' ' + link)}">واتساب</a>
        <a class="btn ghost" target="_blank" rel="noopener" href="https://www.facebook.com/sharer/sharer.php?u=${enc(link)}">فيسبوك</a>
        <a class="btn ghost" target="_blank" rel="noopener" href="https://x.com/intent/post?url=${enc(link)}&text=${enc(title)}">X</a>
        <a class="btn ghost" href="mailto:?subject=${enc(title)}&body=${enc(link)}">بريد</a>
      </div>
      <h3>كود التضمين في أي موقع</h3>
      <textarea class="field" readonly>${esc(embed)}</textarea>
      <div class="row" style="margin-top:8px"><button class="btn" data-copy="${esc(embed)}">نسخ كود التضمين</button></div>
      <h3>رمز QR</h3><div id="qr"></div>`;
    body.querySelectorAll('[data-copy]').forEach(b => b.onclick = () => navigator.clipboard.writeText(b.dataset.copy).then(() => toast('تم النسخ'), () => toast('انسخ يدويًا')));
    body.querySelectorAll('input.field,textarea').forEach(t => t.onclick = () => t.select());
    try {
      if (!window.QRCode) await new Promise((r, j) => { const s = document.createElement('script'); s.src = 'vendor/qrcode.min.js'; s.onload = r; s.onerror = j; document.head.appendChild(s); });
      new QRCode($('#qr'), { text: link, width: 264, height: 264, colorDark: '#414042', colorLight: '#ffffff' });
    } catch (e) { $('#qr').remove(); }
  }
  $('#shareModal').classList.remove('hidden');
  $('#shareClose').focus();
}
const closeShare = () => $('#shareModal').classList.add('hidden');

/* ================= أحداث الأزرار ================= */
$('#navL').onclick = flipLeft;     // اليسار دائمًا = الورقة اليسرى
$('#navR').onclick = flipRight;
$('#bStart').onclick = () => goTo(1, false);
$('#bEnd').onclick = () => goTo(n, false);
$('#slider').oninput = e => goTo(+e.target.value, false);
$('#tZoomIn').onclick = () => setZoom(Z + .5);
$('#tZoomOut').onclick = () => setZoom(Z - .5 < 1.25 ? 1 : Z - .5);
$('#tSound').onclick = () => { sound = !sound; paintSound(); try { localStorage.setItem('hcfb-sound', sound ? '1' : '0'); } catch (e) {} };
$('#tFull').onclick = () => document.fullscreenElement ? document.exitFullscreen() : (document.documentElement.requestFullscreen || (() => {})).call(document.documentElement);
$('#tShare').onclick = openShare;
$('#shareClose').onclick = closeShare;
$('#shareModal').onclick = e => { if (e.target.id === 'shareModal') closeShare(); };
$('#tDownload').onclick = () => {
  const a = document.createElement('a'); a.href = srcUrl || localBlob; a.download = title + '.pdf'; a.target = '_blank'; a.rel = 'noopener'; a.click();
};
document.addEventListener('keydown', e => {
  if (!pf || /INPUT|TEXTAREA/.test(e.target.tagName)) return;
  if (e.key === 'ArrowLeft'){ if (Z === 1) flipLeft(); }
  else if (e.key === 'ArrowRight'){ if (Z === 1) flipRight(); }
  else if (e.key === 'Home') goTo(1, false);
  else if (e.key === 'End') goTo(n, false);
  else if (e.key === '+' || e.key === '=') setZoom(Z + .5);
  else if (e.key === '-') setZoom(Z - .5 < 1.25 ? 1 : Z - .5);
  else if (e.key === '0') resetZoom();
  else if (e.key === 'Escape'){ if (!$('#shareModal').classList.contains('hidden')) closeShare(); else if ($('#panel').classList.contains('open')) closePanel(); else resetZoom(); }
});
window.addEventListener('hashchange', () => { const h = location.hash.match(/page\/(\d+)/); if (h && pf && +h[1] !== curLog() + 1) goTo(+h[1], false); });
let rz;
window.addEventListener('resize', () => {
  clearTimeout(rz);
  rz = setTimeout(() => {
    if (!pf) return;
    resetZoom();
    if (wantPortrait() !== portraitMode) buildBook(curLog() + 1);   // تبديل صفحة واحدة/صفحتين
    else { if (pf.layout) pf.layout(); layoutDepth(); schedule(); }
  }, 180);
});

/* IndexedDB: ملف مرفوع من الصفحة الرئيسية */
function idb(){ return new Promise((res, rej) => { const r = indexedDB.open('hc-flipbook', 2); r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains('files')) r.result.createObjectStore('files'); }; r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
async function idbGet(key){ const db = await idb(); return new Promise((res, rej) => { const q = db.transaction('files').objectStore('files').get(key); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); }

paintSound();
fbAccess().then(start, e => { if (e && e.message === 'denied') fail('لا تملك صلاحية الوصول إلى هذه الأداة.'); });
})();
