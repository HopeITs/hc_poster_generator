<?php
/**
 * Business Card Maker — a Hope Center business card, filled from the staff
 * sheet (through the Worker, by the signed-in email) and editable, shown on a
 * mockup and downloaded as a print-ready A3 PDF: 24 fronts, then 24 backs.
 * Strict CSP applies (no inline script). Access: the "business-card" project;
 * the Owner and the Comms Manager always, and they may make anyone's card.
 */
?>
<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Business Card Maker</title>
<style>@view-transition{navigation:auto;}
  @font-face{font-family:'Somar Sans';font-weight:400;src:url('../guideline-assistant/fonts/SomarSans-Regular.otf') format('opentype');font-display:swap;}
  @font-face{font-family:'Somar Sans';font-weight:500;src:url('../guideline-assistant/fonts/SomarSans-Medium.otf') format('opentype');font-display:block;}
  @font-face{font-family:'Somar Sans';font-weight:600;src:url('../guideline-assistant/fonts/SomarSans-SemiBold.otf') format('opentype');font-display:block;}
  @font-face{font-family:'Somar Sans';font-weight:700;src:url('../guideline-assistant/fonts/SomarSans-Bold.otf') format('opentype');font-display:block;}
  @font-face{font-family:'Somar Sans';font-weight:900;src:url('../guideline-assistant/fonts/SomarSans-Black.otf') format('opentype');font-display:block;}
  :root{--red:#be1f24;--ink:#414042;--text:#58595b;--muted:#6f6e71;--line:#d3d3d5;--fill:#f4f4f5;--bg:#eef1f3;--card:#fff;--ok:#1a8a4a;--warn:#b26a00;}
  *{box-sizing:border-box;}
  [hidden]{display:none !important;}
  body{margin:0;background:var(--bg);color:var(--text);font-family:'Somar Sans',system-ui,sans-serif;direction:rtl;-webkit-font-smoothing:antialiased;min-height:100vh;padding-bottom:70px;}
  .topbar{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:14px;max-width:1240px;margin:0 auto;padding:22px 20px 6px;}
  .back{display:inline-flex;align-items:center;gap:7px;background:#fff;border:1px solid var(--line);border-radius:10px;padding:9px 14px;color:var(--ink);font-family:inherit;font-weight:700;font-size:13px;text-decoration:none;transition:.15s;white-space:nowrap;justify-self:start;}
  .back:hover{background:var(--red);border-color:var(--red);color:#fff;}
  .brand{display:flex;align-items:center;gap:8px;justify-content:center;grid-column:2;}
  .brand h1{margin:0;font-size:20px;font-weight:900;color:var(--red);direction:ltr;}
  .wrap{max-width:1240px;margin:0 auto;padding:14px 20px 40px;}
  .card{background:var(--card);border-radius:18px;box-shadow:0 10px 40px rgba(0,0,0,.08);padding:22px 24px;min-width:0;}
  .layout{display:grid;grid-template-columns:380px 1fr;gap:18px;align-items:start;}
  @media(max-width:900px){.layout{grid-template-columns:1fr;}}
  .form{display:flex;flex-direction:column;gap:16px;}
  .who{background:var(--fill);border-radius:12px;padding:12px 14px;display:flex;flex-direction:column;gap:8px;}
  .who-h{display:flex;align-items:center;justify-content:space-between;gap:8px;}
  .who-h label{font-size:13px;font-weight:800;color:var(--ink);}
  .who-h span{font-size:10.5px;font-weight:700;color:var(--muted);background:#fff;border-radius:999px;padding:2px 9px;}
  .note{display:flex;align-items:center;gap:9px;border:1px solid #e3e5e8;border-radius:12px;padding:9px 12px;font-size:12.5px;line-height:1.6;color:var(--ink);}
  .note svg{flex:0 0 auto;}
  .note.warn{border-color:#f0d9b5;}
  .fields{display:grid;grid-template-columns:1fr 1fr;gap:12px;}
  .f{display:flex;flex-direction:column;gap:5px;min-width:0;}
  .f.full{grid-column:1/-1;}
  .f label{font-size:12px;font-weight:700;color:var(--muted);}
  .f input,.f select,.who input{width:100%;border:1px solid var(--line);border-radius:10px;padding:9px 11px;font-family:inherit;font-size:14px;color:var(--ink);background:#fff;direction:ltr;text-align:left;}
  .f input:focus,.f select:focus,.who input:focus{outline:2px solid var(--red);outline-offset:1px;border-color:var(--red);}
  .f input.bad{border-color:var(--red);}
  .checks{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:5px;font-size:12.5px;color:var(--ink);}
  .checks li{display:flex;align-items:center;gap:8px;}
  .checks i{width:17px;height:17px;border-radius:50%;flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;color:#fff;font-style:normal;font-size:10px;font-weight:900;background:var(--ok);}
  .checks li.warn i{background:var(--warn);}
  .checks li.bad i{background:var(--red);}
  .btn{width:100%;background:var(--red);color:#fff;border:none;border-radius:12px;padding:12px 18px;font-family:inherit;cursor:pointer;transition:.15s;display:flex;flex-direction:column;align-items:center;gap:1px;}
  .btn b{font-size:15px;font-weight:900;} .btn small{font-size:11.5px;opacity:.85;}
  .btn:hover:not(:disabled){background:#a51b1f;}
  .btn:disabled{opacity:.55;cursor:not-allowed;}
  .row2{display:grid;grid-template-columns:1fr 1fr;gap:10px;}
  .btn2{border:1px solid var(--line);border-radius:12px;background:#fff;color:var(--ink);padding:10px;font-family:inherit;font-size:13px;font-weight:700;cursor:pointer;transition:.15s;}
  .btn2:hover:not(:disabled){border-color:var(--red);color:var(--red);}
  .btn2:disabled{opacity:.5;cursor:default;}
  .status{font-size:12px;font-weight:700;color:var(--muted);min-height:18px;text-align:center;line-height:1.6;}
  .status.err{color:var(--red);}
  .view{display:flex;flex-direction:column;gap:14px;}
  .tabs{display:flex;gap:4px;background:var(--fill);border-radius:999px;padding:4px;align-self:flex-start;}
  .tabs button{border:0;border-radius:999px;padding:7px 18px;font-family:inherit;font-size:13.5px;font-weight:700;color:var(--ink);background:transparent;cursor:pointer;}
  .tabs button[aria-selected="true"]{background:var(--red);color:#fff;}
  .stage{border-radius:12px;overflow:hidden;background:#e9eaec;display:flex;align-items:center;justify-content:center;}
  .stage canvas{display:block;max-width:100%;height:auto;}
  .stage.flat{padding:44px;}
  .stage.flat canvas{box-shadow:0 18px 40px rgba(0,0,0,.18);}
  .hint{font-size:11.5px;color:var(--muted);margin:0;}
  .sheet-h{margin:0 0 10px;font-size:14px;font-weight:900;color:var(--ink);}
  .sheet-h span{font-size:11.5px;font-weight:700;color:var(--muted);margin-inline-start:6px;}
  .sheets{display:flex;gap:18px;flex-wrap:wrap;align-items:flex-start;}
  .sheets figure{margin:0;display:flex;flex-direction:column;align-items:center;gap:6px;}
  .sheets canvas{width:150px;height:auto;border:1px solid var(--line);display:block;}
  .sheets figcaption{font-size:12px;font-weight:700;color:var(--ink);}
  .sheets ul{margin:0;padding:0 18px 0 0;font-size:12.5px;line-height:1.9;color:var(--ink);flex:1 1 220px;}
  .gate{max-width:520px;margin:60px auto;text-align:center;}
  .gate p{font-size:15px;font-weight:700;color:var(--ink);}
  .foot{position:fixed;bottom:24px;left:0;right:0;z-index:-1;text-align:center;direction:ltr;font-size:11px;font-weight:500;color:#848484;padding:0 12px;pointer-events:none;}
</style>
</head>
<body>
  <div class="topbar">
    <a class="back" href="../">→ المشاريع</a>
    <div class="brand"><h1>Business Card Maker</h1></div>
  </div>

  <div class="wrap">
    <div class="card gate" id="bcGate"><p id="bcGateMsg">…جارٍ التحقّق من الصلاحية</p></div>

    <div class="layout" id="bcApp" hidden>
      <section class="card form" aria-label="معلومات الكرت">
        <div class="who" id="bcWho" hidden>
          <div class="who-h"><label for="bcPick">الموظف</label><span>للـ Owner والـ Comms Manager</span></div>
          <input id="bcPick" type="search" list="bcStaff" autocomplete="off" placeholder="ابحث بالاسم أو الإيميل">
          <datalist id="bcStaff"></datalist>
        </div>
        <div class="note" id="bcSrc" hidden></div>

        <div class="fields">
          <div class="f full"><label for="bcName">الاسم الكامل</label><input id="bcName" data-k="name" maxlength="60" autocomplete="off"></div>
          <div class="f full"><label for="bcTitle">المسمى الوظيفي</label><input id="bcTitle" data-k="title" maxlength="80" autocomplete="off"></div>
          <div class="f full"><label for="bcPhone">رقم الهاتف</label><input id="bcPhone" data-k="phone" maxlength="30" inputmode="tel" autocomplete="off" placeholder="+963 9xx xxx xxx"></div>
          <div class="f"><label for="bcCity">المدينة</label>
            <select id="bcCity" data-k="city"><option>Aleppo</option><option>Damascus</option><option>Homs</option><option>Latakia</option></select></div>
          <div class="f"><label for="bcStreet">الشارع</label><input id="bcStreet" data-k="street" maxlength="60" autocomplete="off"></div>
          <div class="f full"><label for="bcEmail">الإيميل</label><input id="bcEmail" data-k="email" maxlength="80" autocomplete="off"></div>
        </div>

        <ul class="checks" id="bcChecks" aria-label="فحص قبل التحميل"></ul>

        <button type="button" class="btn" id="bcPdf"><b>تحميل PDF للطباعة</b><small>صفحتين A3 · 24 كرت · CMYK</small></button>
        <div class="row2">
          <button type="button" class="btn2" id="bcSave">حفظ بالأرشيف</button>
          <button type="button" class="btn2" id="bcReset" disabled>رجّع معلومات الجدول</button>
        </div>
        <div class="status" id="bcStatus" role="status"></div>
      </section>

      <section class="view" aria-label="المعاينة">
        <div class="card view">
          <div class="tabs" role="tablist" aria-label="طريقة العرض">
            <button type="button" role="tab" data-v="mock" aria-selected="true">الموكب</button>
            <button type="button" role="tab" data-v="front" aria-selected="false">الوجه</button>
            <button type="button" role="tab" data-v="back" aria-selected="false">الخلف</button>
          </div>
          <div class="stage" id="bcStage"><canvas id="bcCanvas" aria-label="معاينة الكرت"></canvas></div>
          <p class="hint">المعاينة بتتحدّث مع كل حرف بتكتبه بالخانات</p>
        </div>
        <div class="card">
          <h2 class="sheet-h">ملف الطباعة<span>نفس ترتيب ملف InDesign</span></h2>
          <div class="sheets">
            <figure><canvas id="bcSheetF" width="300" height="424"></canvas><figcaption>صفحة 1: الوجه × 24</figcaption></figure>
            <figure><canvas id="bcSheetB" width="300" height="424"></canvas><figcaption>صفحة 2: الخلف × 24</figcaption></figure>
            <ul>
              <li>كرت 85×50 مم، 3 أعمدة × 8 صفوف</li>
              <li>ألوان CMYK متل الملف: أحمر 0/100/100/21، نص أسود 90%</li>
              <li>النص فيكتور بخطوط Somar Sans، مو صورة</li>
              <li>الخلف بنفس أماكن الوجه، والصفحة كلها حمرا</li>
            </ul>
          </div>
        </div>
      </section>
    </div>
  </div>
  <div class="foot">HC Generator, a project by Christian Hope Center. © 2026 All Rights Reserved.</div>

  <script src="../tool-access.js" defer></script>
  <script src="card.js" defer></script>
  <script src="app.js" defer></script>
  <script src="../presence.js" data-tool="business-card" defer></script>
</body>
</html>
