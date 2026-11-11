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
<style>@view-transition{navigation:auto;}
  @font-face{font-family:'Somar Sans';font-weight:400;src:url('../guideline-assistant/fonts/SomarSans-Regular.otf') format('opentype');font-display:swap;}
  @font-face{font-family:'Somar Sans';font-weight:500;src:url('../guideline-assistant/fonts/SomarSans-Medium.otf') format('opentype');font-display:swap;}
  @font-face{font-family:'Somar Sans';font-weight:600;src:url('../guideline-assistant/fonts/SomarSans-SemiBold.otf') format('opentype');font-display:swap;}
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
  .big.tr.on{border-color:#6e7175;background:var(--soft);box-shadow:inset 0 0 0 1px #6e7175;}
  .big svg{width:26px;height:26px;}
  .sm{border:0;background:transparent;text-align:right;font-size:12px;font-weight:700;color:var(--ink);padding:5px 8px;border-radius:6px;cursor:pointer;display:flex;gap:6px;align-items:center;white-space:nowrap;}
  .sm svg{width:16px;height:16px;flex:0 0 auto;}
  .sm:hover:not(:disabled){background:var(--fill);color:var(--red);}
  .sm:disabled,.big:disabled{opacity:.4;cursor:default;}
  .grp.ctx .sm.add{color:var(--red);}
  /* «الخط» and «الفقرة» */
  .fmt{display:flex;flex-direction:column;gap:6px;padding-top:4px;}
  .frow{display:flex;align-items:center;gap:2px;}
  .face{height:28px;line-height:26px;box-sizing:border-box;padding:0 10px;border:1px solid var(--line);border-radius:6px;background:var(--fill);font-size:12px;font-weight:700;color:var(--ink);direction:ltr;white-space:nowrap;margin-left:4px;}
  .wsel,.size{height:28px;box-sizing:border-box;border:1px solid var(--line);border-radius:6px;background:#fff;font-family:inherit;font-size:12px;color:var(--ink);padding:0 6px;}
  .wsel{width:96px;margin-left:4px;direction:ltr;}
  .size{width:56px;text-align:center;direction:ltr;margin-left:4px;}
  .wsel:focus,.size:focus{outline:2px solid var(--red);outline-offset:1px;border-color:var(--red);}
  .fb{height:28px;min-width:28px;border:0;border-radius:5px;background:transparent;color:var(--ink);font-family:inherit;font-size:14px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:1px;padding:0 4px;}
  .fb svg{width:17px;height:17px;}
  .fb sup{font-size:7px;}
  .fb em{font-style:normal;font-size:9px;color:var(--muted);}
  .fb:hover:not(:disabled){background:var(--fill);}
  .fb.on{background:var(--soft);box-shadow:inset 0 0 0 1px #8a8d91;}
  .fb:disabled,.wsel:disabled,.size:disabled{opacity:.4;cursor:default;}
  .fb .ic2{display:inline-flex;flex-direction:column;align-items:center;line-height:1;}
  .fb .ic2 svg{width:15px;height:15px;}
  .fb .bar{display:block;width:16px;height:4px;margin-top:1px;border:1px solid rgba(0,0,0,.15);}
  .frow .sep{width:1px;height:18px;background:var(--line);margin:0 4px;}
  .menu{position:fixed;z-index:40;background:#fff;border:1px solid var(--line);border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.16);padding:6px;display:flex;flex-direction:column;min-width:150px;}
  .menu button{border:0;background:transparent;text-align:right;font-family:inherit;font-size:13px;color:var(--ink);padding:7px 10px;border-radius:5px;cursor:pointer;}
  .menu button:hover{background:var(--fill);}
  .menu button.on{font-weight:900;color:var(--red);}
  .menu.sw{flex-direction:row;flex-wrap:wrap;gap:6px;min-width:0;width:170px;}
  .menu.sw button{width:26px;height:26px;padding:0;border:1px solid rgba(0,0,0,.18);border-radius:5px;}
  .menu.sw button:hover{outline:2px solid #6e7175;outline-offset:1px;}
  .menu.sw button.none{background:linear-gradient(135deg,#fff 45%,#be1f24 46%,#be1f24 54%,#fff 55%) !important;}
  .fld{display:flex;flex-direction:column;gap:4px;font-size:11px;font-weight:700;color:var(--muted);}
  .fld select,.fld input{border:1px solid var(--line);border-radius:7px;padding:6px 9px;font-size:13px;color:var(--ink);background:#fff;min-width:170px;}
  .fld select:focus,.fld input:focus{outline:2px solid var(--red);outline-offset:1px;border-color:var(--red);}

  /* the slides column, the slide and the status bar */
  .body{flex:1;display:flex;min-height:0;}
  .side{width:214px;flex:0 0 auto;background:var(--fill);border-left:1px solid var(--line);padding:14px 12px;display:flex;flex-direction:column;gap:12px;overflow-y:auto;}
  .th{display:flex;gap:8px;align-items:flex-start;border:0;background:none;padding:0;cursor:pointer;text-align:right;}
  .th .n{width:16px;font-size:12px;font-weight:700;color:var(--muted);padding-top:2px;text-align:center;flex:0 0 auto;display:flex;flex-direction:column;align-items:center;gap:4px;}
  .th .n .trm{font-size:11px;color:#6e7175;line-height:1;}
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
  .show .slide{position:absolute;background:#fff;}
  .status{height:30px;flex:0 0 auto;background:var(--fill);border-top:1px solid var(--line);display:flex;align-items:center;justify-content:space-between;padding:0 16px;font-size:12px;color:var(--text);}

  /* a slide, drawn from slides.js's shapes */
  .slide{position:absolute;top:0;left:0;width:960px;height:540px;transform-origin:0 0;overflow:hidden;font-family:'Somar Sans',system-ui,sans-serif;}
  .slide > *{position:absolute;box-sizing:border-box;}
  .slide .tx{display:flex;flex-direction:column;white-space:pre-wrap;overflow:hidden;}
  .slide .im{object-fit:cover;display:block;}
  .slide .noimg{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;color:#fff;font-size:13px;font-weight:700;text-align:center;}
  .slide .ed{cursor:text;outline:none;overflow:visible;}
  .slide .ed:hover,.slide .pick:hover{box-shadow:0 0 0 1px #6e7175;}
  .slide .ed:focus{box-shadow:none;}
  .slide .ed:empty::before{content:attr(data-ph);opacity:.45;}
  .slide .pick{cursor:pointer;}
  .slide .pick.im{cursor:grab;touch-action:none;user-select:none;}
  .slide .pick.panning{cursor:grabbing;}
  .slide .hd{position:absolute;pointer-events:none;box-shadow:0 0 0 calc(1.5px / var(--k)) #6e7175;}
  .slide .hd i{position:absolute;width:calc(9px / var(--k));height:calc(9px / var(--k));margin:calc(-4.5px / var(--k)) 0 0 calc(-4.5px / var(--k));background:#fff;border:calc(1.5px / var(--k)) solid #6e7175;border-radius:50%;box-sizing:border-box;pointer-events:auto;touch-action:none;}
  .slide .hd i[data-h="nw"]{left:0;top:0;cursor:nwse-resize;}
  .slide .hd i[data-h="n"]{left:50%;top:0;cursor:ns-resize;}
  .slide .hd i[data-h="ne"]{left:100%;top:0;cursor:nesw-resize;}
  .slide .hd i[data-h="e"]{left:100%;top:50%;cursor:ew-resize;}
  .slide .hd i[data-h="se"]{left:100%;top:100%;cursor:nwse-resize;}
  .slide .hd i[data-h="s"]{left:50%;top:100%;cursor:ns-resize;}
  .slide .hd i[data-h="sw"]{left:0;top:100%;cursor:nesw-resize;}
  .slide .hd i[data-h="w"]{left:0;top:50%;cursor:ew-resize;}

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
      <button type="button" class="tab" data-tab="trans">انتقالات</button>
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
          <button type="button" class="sm" id="pmPrev">→ نقل للأمام</button>
          <button type="button" class="sm" id="pmNext">نقل للخلف ←</button>
        </div>
        <span class="grp-l">الترتيب</span>
      </div>
      <div class="grp" id="pmFontGrp">
        <div class="fmt">
          <div class="frow">
            <span class="face" title="خط الهوية ثابت">Somar Sans</span>
            <select id="pmWeight" class="wsel" aria-label="وزن الخط">
              <option value="400">Regular</option><option value="500">Medium</option><option value="600">SemiBold</option><option value="700">Bold</option><option value="900">Black</option>
            </select>
            <input id="pmSize" class="size" list="pmSizes" inputmode="decimal" aria-label="حجم الخط">
            <datalist id="pmSizes"><option value="8"><option value="9"><option value="10"><option value="10.5"><option value="11"><option value="12"><option value="14"><option value="16"><option value="18"><option value="20"><option value="24"><option value="28"><option value="32"><option value="36"><option value="40"><option value="44"><option value="48"><option value="54"><option value="60"><option value="66"><option value="72"><option value="80"><option value="88"><option value="96"></datalist>
            <button type="button" class="fb" id="fGrow" title="تكبير الخط (Ctrl+])" aria-label="تكبير الخط"><b>A</b><sup>▲</sup></button>
            <button type="button" class="fb" id="fShrink" title="تصغير الخط (Ctrl+[)" aria-label="تصغير الخط"><b style="font-size:12px">A</b><sup>▼</sup></button>
            <button type="button" class="fb" id="fClear" title="مسح التنسيق" aria-label="مسح التنسيق"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M5 18l7-12 4 7"/><path d="M14 20h7"/><path d="M15 14l5 5M20 14l-5 5"/></svg></button>
          </div>
          <div class="frow">
            <button type="button" class="fb" id="fBold" title="عريض (Ctrl+B)" aria-label="عريض"><b>B</b></button>
            <button type="button" class="fb" id="fItalic" title="مائل (Ctrl+I)" aria-label="مائل"><i style="font-family:Georgia,serif">I</i></button>
            <button type="button" class="fb" id="fUnder" title="تسطير (Ctrl+U)" aria-label="تسطير"><u>U</u></button>
            <button type="button" class="fb" id="fShadow" title="ظل النص" aria-label="ظل النص"><b style="text-shadow:1.5px 1.5px 0 #b5b7ba">S</b></button>
            <button type="button" class="fb" id="fStrike" title="يتوسطه خط" aria-label="يتوسطه خط"><s>ab</s></button>
            <button type="button" class="fb dd" id="fSpace" title="تباعد الأحرف" aria-label="تباعد الأحرف"><span style="letter-spacing:1px">AV</span><em>▾</em></button>
            <button type="button" class="fb dd" id="fCase" title="حالة الأحرف" aria-label="حالة الأحرف">Aa<em>▾</em></button>
            <button type="button" class="fb dd" id="fHl" title="لون التظليل" aria-label="لون التظليل"><span class="ic2"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M9 14l-3 3v2h5l3-3"/><path d="M9 14l7-7 3 3-7 7z"/></svg><span class="bar"></span></span><em>▾</em></button>
            <button type="button" class="fb dd" id="fColor" title="لون الخط" aria-label="لون الخط"><span class="ic2"><b>A</b><span class="bar"></span></span><em>▾</em></button>
          </div>
        </div>
        <span class="grp-l">الخط</span>
      </div>
      <div class="grp" id="pmParaGrp">
        <div class="fmt">
          <div class="frow">
            <button type="button" class="fb" id="pBul" title="تعداد نقطي" aria-label="تعداد نقطي"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M10 6h10M10 12h10M10 18h10"/><circle cx="5" cy="6" r="1" fill="currentColor"/><circle cx="5" cy="12" r="1" fill="currentColor"/><circle cx="5" cy="18" r="1" fill="currentColor"/></svg></button>
            <button type="button" class="fb" id="pNum" title="تعداد رقمي" aria-label="تعداد رقمي"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M10 6h10M10 12h10M10 18h10"/><path d="M4 4.5l1.5-1V8" stroke-width="1.4"/><path d="M3.8 10.5c.4-.6 2.4-.8 2.2.6-.1.7-2.2 1.9-2.2 2.4H6" stroke-width="1.4"/></svg></button>
            <button type="button" class="fb" id="pIndL" title="إنقاص المسافة البادئة" aria-label="إنقاص المسافة البادئة"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 5h16M11 10h9M11 14h9M4 19h16"/><path d="M8 9l-3 3 3 3"/></svg></button>
            <button type="button" class="fb" id="pIndM" title="زيادة المسافة البادئة" aria-label="زيادة المسافة البادئة"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 5h16M11 10h9M11 14h9M4 19h16"/><path d="M5 9l3 3-3 3"/></svg></button>
            <button type="button" class="fb dd" id="pLh" title="تباعد الأسطر" aria-label="تباعد الأسطر"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M11 6h9M11 12h9M11 18h9"/><path d="M5 4v16M3 6l2-2 2 2M3 18l2 2 2-2"/></svg><em>▾</em></button>
          </div>
          <div class="frow">
            <button type="button" class="fb" id="pRight" title="محاذاة لليمين" aria-label="محاذاة لليمين"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 6h16M10 10h10M4 14h16M10 18h10"/></svg></button>
            <button type="button" class="fb" id="pCenter" title="توسيط" aria-label="توسيط"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 6h16M7 10h10M4 14h16M7 18h10"/></svg></button>
            <button type="button" class="fb" id="pLeft" title="محاذاة لليسار" aria-label="محاذاة لليسار"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 6h16M4 10h10M4 14h16M4 18h10"/></svg></button>
            <button type="button" class="fb" id="pJust" title="ضبط" aria-label="ضبط"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 6h16M4 10h16M4 14h16M4 18h16"/></svg></button>
            <span class="sep"></span>
            <button type="button" class="fb" id="pRtl" title="من اليمين لليسار" aria-label="من اليمين لليسار"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M14 4v16M18 4v16M18 4h-6a3.5 3.5 0 0 0 0 7h2"/><path d="M8 15l-3 2.5L8 20"/></svg></button>
            <button type="button" class="fb" id="pLtr" title="من اليسار لليمين" aria-label="من اليسار لليمين"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M8 4v16M12 4v16M12 4H6a3.5 3.5 0 0 0 0 7h2"/><path d="M16 15l3 2.5-3 2.5"/></svg></button>
          </div>
        </div>
        <span class="grp-l">الفقرة</span>
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

    <section class="ribbon" id="rbTrans" aria-label="انتقالات" hidden>
      <div class="grp">
        <div class="row">
          <button type="button" class="big" id="pmTrPreview"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="5" width="18" height="13" rx="1.5"/><path d="M10 9l5 2.5-5 2.5z" fill="currentColor"/></svg><span>معاينة</span></button>
        </div>
        <span class="grp-l">معاينة</span>
      </div>
      <div class="grp">
        <div class="row">
          <button type="button" class="big tr" id="pmTrNone" aria-pressed="false"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="5" width="18" height="13" rx="1.5"/></svg><span>بلا</span></button>
          <button type="button" class="big tr" id="pmTrMorph" aria-pressed="false"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="2.5" y="5" width="9" height="7" rx="1"/><rect x="12.5" y="12" width="9" height="7" rx="1" fill="currentColor" fill-opacity=".25"/><path d="M8 14.5c0 2.5 1.5 3.5 3.5 3.5M16 9.5c0-2.5-1.5-3.5-3.5-3.5" stroke-linecap="round"/><path d="M10 16.5l1.5 1.5-1.5 1.5M14 7.5L12.5 6 14 4.5" stroke-linecap="round" stroke-linejoin="round"/></svg><span>Morph</span></button>
        </div>
        <span class="grp-l">الانتقال إلى هذه الشريحة</span>
      </div>
      <div class="grp">
        <div class="row" style="padding-top:4px">
          <label class="fld">المدة
            <select id="pmTrDur">
              <option value="0.5">0.5 ثانية</option><option value="1">1 ثانية</option><option value="1.5">1.5 ثانية</option><option value="2">2 ثانية</option><option value="3">3 ثواني</option>
            </select>
          </label>
          <div class="col" style="padding-top:18px">
            <button type="button" class="sm" id="pmTrAll">تطبيق على الكل</button>
          </div>
        </div>
        <span class="grp-l">التوقيت</span>
      </div>
    </section>

    <div class="body">
      <aside class="side" id="pmStrip" aria-label="الشرائح"></aside>
      <main class="work" id="pmWork">
        <div class="stage" id="pmStage"></div>
        <textarea class="notes" id="pmNotes" placeholder="اكبس لتضيف ملاحظات المقدّم — بتطلع بملف PowerPoint تحت الشريحة" aria-label="ملاحظات المقدّم" dir="auto"></textarea>
        <p class="tip">اكبس على أي نص لتعدّله مكانه · اكبس مرتين على الصورة لتغيّرها، واسحبها لتختار الجزء الظاهر</p>
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
    <div class="menu" id="pmMenu" hidden></div>
  </div>

  <script src="../tool-access.js" defer></script>

  <script src="access.js" defer></script>
  <script src="slides.js" defer></script>
  <script src="app.js" defer></script>
  <script src="../presence.js" data-tool="presentation-maker" defer></script>
</body>
</html>
