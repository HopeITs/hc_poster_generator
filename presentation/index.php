<?php
/**
 * Presentation Maker — presentations on the projects' brand, laid out like
 * PowerPoint: a ribbon (ملف / الرئيسية / تصميم), the slides in a column, the
 * slide in the middle edited in place (click a text to type, a photo to pick
 * one), and a status bar. Exports an editable PowerPoint (pptxgenjs, vendor/)
 * or a PDF (the slides painted on a canvas, then pdf-lib). The layouts live in
 * slides.js. Everything happens in the browser; photos never leave the
 * device. Strict CSP applies (no inline script); access is checked by
 * access.js against the user's projects ("presentation-maker"), and the
 * Owner and the Comms Manager always have it.
 */
?>
<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Presentation Maker</title>
<style>
  @font-face{font-family:'Somar Sans';font-weight:400;src:url('../guideline-assistant/fonts/SomarSans-Regular.otf') format('opentype');font-display:swap;}
  @font-face{font-family:'Somar Sans';font-weight:700;src:url('../guideline-assistant/fonts/SomarSans-Bold.otf') format('opentype');font-display:block;}
  @font-face{font-family:'Somar Sans';font-weight:900;src:url('../guideline-assistant/fonts/SomarSans-Black.otf') format('opentype');font-display:swap;}
  :root{--red:#be1f24;--red-d:#a51b1f;--ink:#414042;--text:#58595b;--muted:#6f6e71;--line:#d3d3d5;--soft:#e3e3e5;--fill:#f4f4f5;--work:#e9eaec;}
  *{box-sizing:border-box;}
  [hidden]{display:none !important;}
  html,body{height:100%;}
  body{margin:0;background:var(--work);color:var(--ink);font-family:'Somar Sans',system-ui,sans-serif;direction:rtl;-webkit-font-smoothing:antialiased;overflow:hidden;}
  button,select,input{font-family:inherit;}
  .gate{height:100%;display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:700;}
  .app{height:100%;display:flex;flex-direction:column;}

  /* the title bar */
  .bar{height:44px;flex:0 0 auto;background:var(--red);color:#fff;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:0 16px;}
  .bar a{color:#fff;text-decoration:none;font-size:13px;font-weight:700;padding:6px 10px;border-radius:6px;background:rgba(255,255,255,.14);white-space:nowrap;}
  .bar a:hover{background:rgba(255,255,255,.24);}
  .bar .name{display:flex;align-items:center;gap:10px;font-size:14px;min-width:0;}
  .bar .name b{font-weight:900;direction:ltr;}
  .bar .name span{font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
  .bar .st{font-size:12px;font-weight:700;opacity:.9;white-space:nowrap;}
  .bar .qa{display:flex;align-items:center;gap:6px;}
  .bar .ic{width:32px;height:32px;border:0;border-radius:6px;background:transparent;color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;}
  .bar .ic:hover{background:rgba(255,255,255,.18);}
  .bar .ic svg{width:18px;height:18px;}
  .bar .present{border:0;background:#fff;color:var(--red);font-size:13px;font-weight:900;padding:6px 16px;border-radius:999px;cursor:pointer;white-space:nowrap;}
  .bar .present:hover{background:var(--fill);}

  /* the tabs and the ribbon */
  .tabs{height:38px;flex:0 0 auto;background:#fff;display:flex;align-items:flex-end;gap:4px;padding:0 12px;}
  .tab{border:0;border-bottom:3px solid transparent;background:transparent;color:var(--ink);font-size:13px;font-weight:700;padding:7px 16px 6px;cursor:pointer;}
  .tab.on{border-bottom-color:var(--red);color:var(--red);font-weight:900;}
  .tab.file{background:var(--red);color:#fff;border-radius:6px 6px 0 0;border-bottom-color:transparent;padding:7px 18px;}
  .tab.file.on{background:var(--red-d);color:#fff;}
  .ribbon{height:104px;flex:0 0 auto;background:#fff;border-top:1px solid var(--soft);border-bottom:1px solid var(--line);display:flex;align-items:stretch;padding:6px 10px 0;overflow-x:auto;overflow-y:hidden;}
  .grp{display:flex;flex-direction:column;justify-content:space-between;padding:0 12px;border-left:1px solid var(--soft);flex:0 0 auto;}
  .grp.end{border-left:0;border-right:1px solid var(--soft);margin-right:auto;}
  .grp.ctx{background:var(--fill);}
  .grp .row{display:flex;gap:10px;align-items:flex-start;}
  .grp .col{display:flex;flex-direction:column;gap:3px;padding-top:2px;}
  .grp-l{text-align:center;font-size:11px;color:var(--muted);padding-bottom:4px;white-space:nowrap;}
  .grp.ctx .grp-l{color:var(--red);font-weight:700;}
  .big{min-width:76px;height:72px;border:1px solid var(--line);background:var(--fill);border-radius:8px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;color:var(--ink);font-size:12px;font-weight:700;cursor:pointer;padding:0 10px;}
  .big:hover:not(:disabled){border-color:var(--red);color:var(--red);}
  .big.red{background:var(--red);border-color:var(--red);color:#fff;}
  .big.red:hover:not(:disabled){background:var(--red-d);color:#fff;}
  .big.open{border-color:var(--red);background:var(--work);color:var(--red);}
  .big svg{width:26px;height:26px;}
  .sm{border:0;background:transparent;text-align:right;font-size:12px;font-weight:700;color:var(--ink);padding:5px 8px;border-radius:6px;cursor:pointer;display:flex;gap:6px;align-items:center;white-space:nowrap;}
  .sm svg{width:16px;height:16px;flex:0 0 auto;}
  .sm:hover:not(:disabled){background:var(--fill);color:var(--red);}
  .sm:disabled,.big:disabled{opacity:.4;cursor:default;}
  .grp.ctx .sm.add{color:var(--red);}
  .fld{display:flex;flex-direction:column;gap:4px;font-size:11px;font-weight:700;color:var(--muted);}
  .fld select,.fld input{border:1px solid var(--line);border-radius:7px;padding:6px 9px;font-size:13px;color:var(--ink);background:#fff;min-width:170px;}
  .fld select:focus,.fld input:focus{outline:2px solid var(--red);outline-offset:1px;border-color:var(--red);}

  /* the slides column, the slide and the status bar */
  .body{flex:1;display:flex;min-height:0;}
  .side{width:214px;flex:0 0 auto;background:var(--fill);border-left:1px solid var(--line);padding:14px 12px;display:flex;flex-direction:column;gap:12px;overflow-y:auto;}
  .th{display:flex;gap:8px;align-items:flex-start;border:0;background:none;padding:0;cursor:pointer;text-align:right;}
  .th .n{width:16px;font-size:12px;font-weight:700;color:var(--muted);padding-top:2px;text-align:center;flex:0 0 auto;}
  .th .box{position:relative;width:160px;aspect-ratio:16/9;background:#fff;box-shadow:0 1px 4px rgba(0,0,0,.18);overflow:hidden;pointer-events:none;}
  .th.on .box{outline:3px solid var(--red);outline-offset:2px;}
  .th.on .n{color:var(--red);}
  .th.drop .box{box-shadow:0 -4px 0 var(--red),0 1px 4px rgba(0,0,0,.18);}
  .plus{margin-right:24px;height:40px;border:1.5px dashed #c8c8cb;background:transparent;border-radius:6px;font-size:12px;font-weight:700;color:var(--ink);cursor:pointer;flex:0 0 auto;}
  .plus:hover{border-color:var(--red);color:var(--red);}
  .work{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;min-width:0;padding:20px;}
  .stage{position:relative;background:#fff;box-shadow:0 6px 24px rgba(0,0,0,.14);overflow:hidden;}
  .tip{margin:0;font-size:13px;color:var(--muted);text-align:center;}
  .notes{flex:0 0 auto;height:64px;resize:none;border:1px solid var(--line);border-radius:6px;background:#fff;padding:8px 12px;font-family:inherit;font-size:13px;color:var(--ink);line-height:1.6;}
  .notes:focus{outline:2px solid var(--red);outline-offset:1px;border-color:var(--red);}
  .show{position:fixed;inset:0;z-index:50;background:#000;cursor:pointer;overflow:hidden;}
  .show .slide{position:absolute;}
  .status{height:30px;flex:0 0 auto;background:var(--fill);border-top:1px solid var(--line);display:flex;align-items:center;justify-content:space-between;padding:0 16px;font-size:12px;color:var(--text);}

  /* a slide, drawn from slides.js's shapes */
  .slide{position:absolute;top:0;left:0;width:960px;height:540px;transform-origin:0 0;overflow:hidden;font-family:'Somar Sans',system-ui,sans-serif;}
  .slide > *{position:absolute;box-sizing:border-box;}
  .slide .tx{display:flex;flex-direction:column;white-space:pre-wrap;overflow:hidden;}
  .slide .im{object-fit:cover;display:block;}
  .slide .noimg{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;color:#fff;font-size:13px;font-weight:700;text-align:center;}
  .slide .ed{cursor:text;outline:none;overflow:visible;}
  .slide .ed:hover{box-shadow:0 0 0 1px rgba(65,64,66,.35);}
  .slide .ed:focus{box-shadow:0 0 0 2px var(--red);}
  .slide .ed:empty::before{content:attr(data-ph);opacity:.45;}
  .slide .pick{cursor:pointer;}
  .slide .pick:hover{box-shadow:inset 0 0 0 3px var(--red);}
  .slide .pick.sel{box-shadow:inset 0 0 0 3px var(--red);}

  /* «شريحة جديدة» */
  .gallery{position:fixed;top:182px;right:26px;width:640px;max-width:calc(100vw - 40px);background:#fff;border:1px solid var(--line);border-radius:10px;box-shadow:0 16px 40px rgba(0,0,0,.22);padding:16px;z-index:20;}
  .gallery h3{margin:0 0 12px;font-size:13px;font-weight:900;}
  .gallery .grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;}
  .gallery button{border:1.5px solid var(--soft);background:#fff;border-radius:8px;padding:8px;cursor:pointer;font-size:13px;font-weight:700;color:var(--ink);}
  .gallery button:hover{border-color:var(--red);}
  .gallery .box{position:relative;width:100%;aspect-ratio:16/9;background:#fff;box-shadow:0 1px 4px rgba(0,0,0,.18);overflow:hidden;margin-bottom:7px;pointer-events:none;}

  @media(max-width:760px){
    .side{width:130px;padding:10px 8px;}
    .th .box{width:100px;}
    .bar .st{display:none;}
  }
</style>
</head>
<body>
  <div class="gate" id="pmGate"><p id="pmGateMsg">…جارٍ التحقّق من الصلاحية</p></div>

  <div class="app" id="pmApp" hidden>
    <header class="bar">
      <div class="qa">
        <a href="../">→ المشاريع</a>
        <button type="button" class="ic" id="pmUndo" title="تراجع (Ctrl+Z)" aria-label="تراجع"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 7h-6a5 5 0 0 0 0 10h4"/><path d="M12 4l3 3-3 3" /></svg></button>
        <button type="button" class="ic" id="pmRedo" title="إعادة (Ctrl+Y)" aria-label="إعادة"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 7h6a5 5 0 0 1 0 10h-4"/><path d="M12 4L9 7l3 3"/></svg></button>
      </div>
      <div class="name"><b>Presentation Maker</b><span id="pmBarDeck"></span></div>
      <div class="qa">
        <span class="st" id="pmStatus" role="status"></span>
        <button type="button" class="present" id="pmPresent" title="عرض (F5 من البداية)">عرض ▶</button>
      </div>
    </header>

    <nav class="tabs" aria-label="تبويبات الشريط">
      <button type="button" class="tab file" data-tab="file">ملف</button>
      <button type="button" class="tab on" data-tab="home">الرئيسية</button>
      <button type="button" class="tab" data-tab="design">تصميم</button>
    </nav>

    <section class="ribbon" id="rbHome" aria-label="الرئيسية">
      <div class="grp">
        <div class="row">
          <button type="button" class="big" id="pmNew" aria-expanded="false"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="5" width="18" height="12" rx="1.5"/><path d="M12 8v6M9 11h6"/></svg><span>شريحة جديدة ▾</span></button>
          <div class="col">
            <button type="button" class="sm" id="pmDup"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="8" y="8" width="12" height="12" rx="1.5"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/></svg>نسخ الشريحة</button>
            <button type="button" class="sm" id="pmDel"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>حذف الشريحة</button>
          </div>
        </div>
        <span class="grp-l">الشرائح</span>
      </div>
      <div class="grp">
        <div class="col">
          <button type="button" class="sm" id="pmPrev">→ نقل لقدّام</button>
          <button type="button" class="sm" id="pmNext">نقل لورا ←</button>
        </div>
        <span class="grp-l">الترتيب</span>
      </div>
      <div class="grp ctx" id="pmListGrp" hidden>
        <div class="col">
          <button type="button" class="sm add" id="pmItemAdd"></button>
          <button type="button" class="sm" id="pmItemDel"></button>
        </div>
        <span class="grp-l" id="pmListName"></span>
      </div>
      <div class="grp">
        <div class="col">
          <button type="button" class="sm" id="pmPhoto">تغيير الصورة</button>
          <button type="button" class="sm" id="pmPhotoDel">إزالة الصورة</button>
        </div>
        <span class="grp-l">الصورة</span>
      </div>
      <div class="grp end">
        <div class="row">
          <button type="button" class="big red" data-act="pptx"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg><span>PowerPoint</span></button>
          <button type="button" class="big" data-act="pdf"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg><span>PDF</span></button>
        </div>
        <span class="grp-l">تنزيل</span>
      </div>
    </section>

    <section class="ribbon" id="rbFile" aria-label="ملف" hidden>
      <div class="grp">
        <div class="row">
          <button type="button" class="big" id="pmNew2"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 3h8l4 4v14H6z"/><path d="M12 10v6M9 13h6"/></svg><span>عرض جديد</span></button>
          <button type="button" class="big" id="pmSave"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M5 4h11l3 3v13H5z"/><path d="M8 4v5h7V4M8 20v-6h8v6"/></svg><span>حفظ مشروع</span></button>
          <label class="big"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 7h6l2 2h10v10H3z"/></svg><span>فتح مشروع</span><input type="file" id="pmOpen" accept=".json,application/json" hidden></label>
        </div>
        <span class="grp-l">المشروع</span>
      </div>
      <div class="grp">
        <div class="row">
          <button type="button" class="big red" data-act="pptx"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg><span>PowerPoint</span></button>
          <button type="button" class="big" data-act="pdf"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg><span>PDF</span></button>
        </div>
        <span class="grp-l">تنزيل</span>
      </div>
    </section>

    <section class="ribbon" id="rbDesign" aria-label="تصميم" hidden>
      <div class="grp">
        <div class="row" style="padding-top:4px">
          <label class="fld">المشروع
            <select id="pmBrand">
              <option value="hope-center">Hope Center</option>
              <option disabled>Study Zone · قريباً</option>
              <option disabled>DISC · قريباً</option>
              <option disabled>Children University · قريباً</option>
              <option disabled>LEAP · قريباً</option>
            </select>
          </label>
          <label class="fld">اللغة
            <select id="pmLang">
              <option value="ar">عربي — من اليمين</option>
              <option value="en">English — من اليسار</option>
            </select>
          </label>
          <label class="fld">عنوان العرض <input type="text" id="pmDeck" maxlength="80" placeholder="بيطلع فوق كل شريحة"></label>
        </div>
        <span class="grp-l">العرض</span>
      </div>
    </section>

    <div class="body">
      <aside class="side" id="pmStrip" aria-label="الشرائح"></aside>
      <main class="work" id="pmWork">
        <div class="stage" id="pmStage"></div>
        <textarea class="notes" id="pmNotes" placeholder="اكبس لتضيف ملاحظات المقدّم — بتطلع بملف PowerPoint تحت الشريحة" aria-label="ملاحظات المقدّم" dir="auto"></textarea>
        <p class="tip">اكبس على أي نص لتعدّله مكانه، أو على مكان الصورة لتختار صورة</p>
      </main>
    </div>

    <footer class="status">
      <span id="pmWhere"></span>
      <span id="pmLangBrand"></span>
    </footer>

    <div class="gallery" id="pmGallery" role="dialog" aria-label="شريحة جديدة" hidden>
      <h3>اختر نوع الشريحة</h3>
      <div class="grid" id="pmGalleryGrid"></div>
    </div>
    <input type="file" id="pmPhotoFile" accept="image/*" hidden>
    <div class="show" id="pmShow" hidden></div>
  </div>

  <script src="access.js" defer></script>
  <script src="../vendor/pdf-lib.min.js" defer></script>
  <script src="vendor/pptxgen.bundle.js" defer></script>
  <script src="slides.js" defer></script>
  <script src="app.js" defer></script>
  <script src="../presence.js" data-tool="presentation-maker" defer></script>
</body>
</html>
