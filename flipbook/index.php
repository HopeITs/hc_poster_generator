<?php
/**
 * Flipbook — a PDF as an interactive book whose pages turn (from the
 * hc-flipbook tool, 2026-10-30). The file opens on the device: app.js keeps
 * it in IndexedDB, and viewer.html reads it from there for the preview here
 * and for the full view in a new tab. Strict CSP applies (no inline script,
 * libraries in vendor/); access is checked by access.js against the user's
 * projects ("flipbook"), and the Owner and the Comms Manager always have it.
 */
?>
<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Flipbook</title>
<style>

  @font-face{font-family:'Somar Sans';font-weight:400;src:url('../guideline-assistant/fonts/SomarSans-Regular.otf') format('opentype');font-display:swap;}
  @font-face{font-family:'Somar Sans';font-weight:700;src:url('../guideline-assistant/fonts/SomarSans-Bold.otf') format('opentype');font-display:block;}
  @font-face{font-family:'Somar Sans';font-weight:900;src:url('../guideline-assistant/fonts/SomarSans-Black.otf') format('opentype');font-display:swap;}
  :root{--red:#be1f24;--ink:#414042;--text:#58595b;--muted:#6f6e71;--line:#d3d3d5;--fill:#f4f4f5;--bg:#eef1f3;--card:#fff;--navy:#0a3c55;}
  *{box-sizing:border-box;}
  [hidden]{display:none !important;}
  body{margin:0;background:var(--bg);color:var(--text);font-family:'Somar Sans',system-ui,sans-serif;direction:rtl;-webkit-font-smoothing:antialiased;min-height:100vh;padding-bottom:70px;}
  .topbar{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:14px;max-width:1240px;margin:0 auto;padding:22px 20px 6px;}
  .back{display:inline-flex;align-items:center;gap:7px;background:#fff;border:1px solid var(--line);border-radius:10px;padding:9px 14px;color:var(--ink);font-family:inherit;font-weight:700;font-size:13px;text-decoration:none;transition:.15s;white-space:nowrap;justify-self:start;}
  .back:hover{background:var(--red);border-color:var(--red);color:#fff;}
  .brand{display:flex;align-items:center;gap:8px;justify-content:center;grid-column:2;}
  .brand h1{margin:0;font-size:20px;font-weight:900;color:var(--red);direction:ltr;}
  .badge{background:var(--red);color:#fff;font-size:10px;font-weight:800;letter-spacing:.06em;padding:2px 7px;border-radius:999px;}
  .wrap{max-width:1240px;margin:0 auto;padding:14px 20px 40px;display:grid;gap:18px;}
  .card{background:var(--card);border-radius:18px;box-shadow:0 10px 40px rgba(0,0,0,.08);padding:22px 24px;min-width:0;}
  .layout{display:grid;grid-template-columns:360px 1fr;gap:18px;align-items:stretch;}
  @media(max-width:900px){.layout{grid-template-columns:1fr;}}
  .sec{font-size:13px;font-weight:800;color:var(--ink);margin:0 0 8px;}
  .field{margin-bottom:16px;}
  .hint{font-size:11px;font-weight:500;color:var(--muted);line-height:1.6;}
  select,input[type=number]{width:100%;border:1px solid var(--line);border-radius:10px;padding:9px 11px;font-family:inherit;font-size:14px;color:var(--ink);background:#fff;}
  select{padding-inline-end:38px;cursor:pointer;-webkit-appearance:none;appearance:none;
    background:#fff url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1 1.5l5 5 5-5' fill='none' stroke='%23414042' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") no-repeat left 14px center;}
  select:focus,input:focus{outline:2px solid var(--red);outline-offset:1px;border-color:var(--red);}
  .drop{border:2px dashed var(--line);border-radius:12px;background:var(--fill);padding:22px 14px;text-align:center;cursor:pointer;display:block;transition:.15s;}
  .drop:hover,.drop.over{border-color:var(--red);background:#fff;}
  .drop .t{font-weight:700;color:var(--ink);font-size:14px;} .drop .h{font-size:11px;color:var(--muted);margin-top:3px;}
  .drop input{display:none;}
  .file{display:flex;align-items:center;gap:10px;border:1px solid var(--line);border-radius:12px;padding:10px 12px;background:#fff;}
  .file b{background:var(--red);color:#fff;font-size:12px;font-weight:900;border-radius:6px;padding:4px 8px;letter-spacing:.04em;}
  .file .n{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px;}
  .file .n span:first-child{font-size:13px;font-weight:700;color:var(--ink);direction:ltr;text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
  .file .n span:last-child{font-size:11px;color:var(--muted);}
  .file button{border:1px solid var(--line);background:#fff;border-radius:8px;padding:5px 10px;font-family:inherit;font-size:12px;font-weight:700;color:var(--ink);cursor:pointer;}
  .file button:hover{border-color:var(--red);color:var(--red);}
  .opts{display:flex;flex-direction:column;}
  .opts .status{margin:auto 0 10px;}   /* the note above the button, both at the card's foot */
  .btn{width:100%;background:#f7941d;color:#fff;border:none;border-radius:12px;padding:13px 18px;font-family:inherit;font-weight:800;font-size:15px;cursor:pointer;transition:.15s;}
  .btn:hover{background:#e08a16;}
  .btn:disabled{opacity:.55;cursor:not-allowed;}
  .status{font-size:12px;font-weight:700;color:var(--muted);min-height:18px;margin-top:10px;text-align:center;line-height:1.6;}
  .status.err{color:var(--red);}
  .fxd{margin-top:6px;}
  .view{display:flex;flex-direction:column;}
  .view .sec{text-align:center;}
  .view .empty{flex:1;display:flex;align-items:center;justify-content:center;min-height:420px;}
  .pv{flex:1;min-height:560px;border:0;border-radius:12px;background:var(--fill);width:100%;display:block;}
  .empty{padding:34px;text-align:center;color:var(--muted);font-size:14px;border:2px dashed var(--line);border-radius:14px;line-height:1.8;}
  .gate{max-width:520px;margin:60px auto;text-align:center;}
  .gate p{font-size:15px;font-weight:700;color:var(--ink);}
  .foot{position:fixed;bottom:24px;left:0;right:0;z-index:-1;text-align:center;direction:ltr;font-size:11px;font-weight:500;color:#848484;padding:0 12px;pointer-events:none;}

</style>
</head>
<body>
  <div class="topbar">
    <a class="back" href="../">→ المشاريع</a>
    <div class="brand"><h1>Flipbook</h1><span class="badge">NEW</span></div>
  </div>

  <div class="wrap">
    <div class="card gate" id="fbGate"><p id="fbGateMsg">…جارٍ التحقّق من الصلاحية</p></div>

    <div class="layout" id="fbApp" hidden>
      <div class="card opts">
        <div class="field">
          <div class="sec">الملف</div>
          <label class="drop" id="fbDrop">
            <div class="t">اسحب ملف PDF هنا أو اضغط للاختيار</div>
            <div class="h">الملف بيفتح على جهازك وما بيطلع لأي مكان</div>
            <input type="file" id="fbFile" accept="application/pdf,.pdf">
          </label>
          <div class="file" id="fbFileBox" hidden>
            <b>PDF</b>
            <div class="n"><span id="fbFileName"></span><span id="fbFileMeta"></span></div>
            <button type="button" id="fbRemove">تغيير</button>
          </div>
        </div>
        <div class="field">
          <div class="sec">اتجاه الكتاب <span class="hint" id="fbSuggest" hidden>· مقترح من لغة الملف</span></div>
          <select id="fbDir">
            <option value="1">يمين — للعربي</option>
            <option value="0">يسار — للإنكليزي</option>
          </select>
        </div>
        <div class="field">
          <div class="sec">تأثير الصفحات</div>
          <select id="fbEffect">
            <option value="magazine">مجلة</option>
            <option value="book">كتاب (غلاف مقوّى)</option>
            <option value="album">ألبوم</option>
            <option value="notebook">دفتر بحلقات</option>
            <option value="slider">شرائح</option>
            <option value="cards">بطاقات</option>
            <option value="coverflow">عرض دوّار (Coverflow)</option>
            <option value="onepage">صفحة واحدة</option>
          </select>
          <div class="hint fxd" id="fbFxDesc"></div>
        </div>
        <div class="field" id="fbNbField" hidden>
          <div class="sec">أوراق الدفتر</div>
          <select id="fbNbPages">
            <option value="hard">مقوّاة متل الكتاب</option>
            <option value="soft">مرنة متل المجلة</option>
          </select>
        </div>
        <div class="field">
          <div class="sec">نوع الورق</div>
          <select id="fbPaper">
            <option value="matte">مطفي</option>
            <option value="glossy">لامع</option>
          </select>
        </div>
        <div class="field">
          <div class="sec">الصفحات المزدوجة <span class="hint">(Spread)</span></div>
          <select id="fbSplit">
            <option value="auto">تلقائي</option>
            <option value="1">قسّمها دايماً</option>
            <option value="0">لا تقسّم</option>
          </select>
        </div>
        <div class="status" id="fbStatus"></div>
        <button type="button" class="btn" id="fbOpen" disabled>فتح الكتاب</button>
      </div>

      <div class="card view">
        <div class="sec">المعاينة</div>
        <div class="empty" id="fbEmpty">اختر ملف PDF من اليمين،<br>وبيطلع هون كتاب بتقدر تقلّب صفحاته</div>
        <iframe class="pv" id="fbPv" title="المعاينة" allow="fullscreen" hidden></iframe>
      </div>
    </div>
  </div>

  <script src="access.js" defer></script>
  <script src="vendor/pdf.min.js" defer></script>
  <script src="app.js" defer></script>
  <script src="../presence.js" data-tool="flipbook" defer></script>

  <div class="foot">HC Generator, a project by Christian Hope Center. © <?= date('Y') ?> All Rights Reserved.</div>
</body>
</html>
