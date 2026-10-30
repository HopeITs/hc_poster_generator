<?php
/**
 * Booklet Maker — a PDF as a booklet to print on both sides and fold.
 * Works in the browser with pdf-lib (../vendor/pdf-lib.min.js): the file
 * never leaves the device. Strict CSP applies (no inline script); access is
 * checked by app.js against the user's projects ("booklet-maker"), and the
 * Owner and the Comms Manager always have it.
 */
?>
<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Booklet Maker</title>
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
  .tog{display:flex;align-items:center;gap:10px;font-size:13px;font-weight:700;color:var(--ink);cursor:pointer;margin-bottom:10px;}
  .tog input{width:17px;height:17px;accent-color:var(--red);margin:0;}
  .tog span{font-weight:500;color:var(--muted);font-size:11px;}
  .opts{display:flex;flex-direction:column;}
  .opts .status{margin:auto 0 10px;}   /* the note above the button, both at the card's foot */
  .btn{width:100%;background:var(--red);color:#fff;border:none;border-radius:12px;padding:13px 18px;font-family:inherit;font-weight:800;font-size:15px;cursor:pointer;transition:.15s;}
  .btn:hover:not(:disabled){background:#a51b1f;}
  .btn:disabled{opacity:.55;cursor:not-allowed;}
  .status{font-size:12px;font-weight:700;color:var(--muted);min-height:18px;margin-top:10px;text-align:center;line-height:1.6;}
  .status.err{color:var(--red);}
  .facts{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-bottom:18px;}
  @media(max-width:620px){.facts{grid-template-columns:repeat(2,minmax(0,1fr));}}
  .fact{background:var(--fill);border-radius:12px;padding:10px 12px;display:flex;flex-direction:column;gap:2px;}
  .fact span{font-size:11px;font-weight:700;color:var(--muted);}
  .fact b{font-size:14px;font-weight:800;color:var(--ink);}
  .sheets{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:12px;}
  .sheet{border:1px solid var(--line);border-radius:14px;padding:10px 12px;display:flex;flex-direction:column;gap:8px;}
  .sheet-n{font-size:12px;font-weight:800;color:var(--ink);}
  .side{display:flex;align-items:center;gap:8px;}
  .side-l{width:28px;font-size:11px;font-weight:700;color:var(--muted);}
  .spread{flex:1;display:grid;grid-template-columns:1fr 1fr;border:1px solid var(--line);border-radius:6px;overflow:hidden;direction:ltr;}
  .pg{height:44px;display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:800;color:var(--ink);background:#fff;}
  .pg + .pg{border-left:1px dashed var(--line);}
  .pg.blank{color:var(--muted);font-size:11px;font-weight:700;background:var(--fill);}
  .empty{padding:34px;text-align:center;color:var(--muted);font-size:14px;border:2px dashed var(--line);border-radius:14px;line-height:1.8;}
  .gate{max-width:520px;margin:60px auto;text-align:center;}
  .gate p{font-size:15px;font-weight:700;color:var(--ink);}
  .mock{position:relative;border-radius:12px;overflow:hidden;background:#e9e9e9;aspect-ratio:2000/1404;}
  .mock canvas{display:block;width:100%;height:100%;}
  .mock-note{position:absolute;inset:auto 0 12px;text-align:center;font-size:12px;font-weight:700;color:var(--muted);pointer-events:none;}
  .flip{display:flex;align-items:center;justify-content:center;gap:14px;margin-top:14px;}
  .flip button{width:42px;height:42px;border-radius:50%;border:1px solid var(--line);background:#fff;color:var(--ink);font-size:18px;font-weight:800;cursor:pointer;transition:.15s;display:flex;align-items:center;justify-content:center;}
  .flip button:hover:not(:disabled){background:var(--red);border-color:var(--red);color:#fff;}
  .flip button:disabled{opacity:.35;cursor:default;}
  .flip span{min-width:190px;text-align:center;font-size:13px;font-weight:700;color:var(--ink);white-space:pre;}
  .foot{position:fixed;bottom:24px;left:0;right:0;z-index:-1;text-align:center;direction:ltr;font-size:11px;font-weight:500;color:#848484;padding:0 12px;pointer-events:none;}
</style>
</head>
<body>
  <div class="topbar">
    <a class="back" href="../">→ المشاريع</a>
    <div class="brand"><h1>Booklet Maker</h1><span class="badge">NEW</span></div>
  </div>

  <div class="wrap">
    <div class="card gate" id="bkGate"><p id="bkGateMsg">…جارٍ التحقّق من الصلاحية</p></div>

    <div class="layout" id="bkApp" hidden>
      <div class="card opts">
        <div class="field">
          <div class="sec">الملف</div>
          <label class="drop" id="bkDrop">
            <div class="t">اسحب ملف PDF هنا أو اضغط للاختيار</div>
            <div class="h">أي مقاس صفحة · الملف ما بيطلع من جهازك</div>
            <input type="file" id="bkFile" accept="application/pdf,.pdf">
          </label>
          <div class="file" id="bkFileBox" hidden>
            <b>PDF</b>
            <div class="n"><span id="bkFileName"></span><span id="bkFileMeta"></span></div>
            <button type="button" id="bkRemove">تغيير</button>
          </div>
        </div>
        <div class="field">
          <div class="sec">اتجاه التجليد</div>
          <select id="bkBinding">
            <option value="right">يمين — للعربي</option>
            <option value="left" selected>يسار — للإنكليزي</option>
          </select>
        </div>
        <div class="field" hidden>   <!-- hidden for now: page numbers and fold marks both off -->
          <label class="tog"><input type="checkbox" id="bkNums">أرقام الصفحات <span>رقم صغير تحت كل صفحة</span></label>
          <label class="tog"><input type="checkbox" id="bkFold">علامة الطيّ <span>خط قصير بنص الورقة فوق وتحت</span></label>
        </div>
        <div class="status" id="bkStatus"></div>
        <button type="button" class="btn" id="bkGo" disabled>DOWNLOAD</button>
      </div>

      <div class="card">
        <div class="sec">ترتيب الأوراق</div>
        <div class="empty" id="bkEmpty">اختر ملف PDF من اليمين،<br>وبتطلع هون طريقة ترتيب صفحاته على الأوراق</div>
        <div id="bkPlan" hidden>
          <div class="facts" id="bkFacts"></div>
          <div class="sheets" id="bkSheets"></div>
          <p class="hint" style="margin:14px 0 0">اطبع على وجهين، والقلب على الحافة القصيرة (<bdi dir="ltr">Flip on short edge</bdi>)، وبعدين رتّب الأوراق فوق بعض متل ما هي واطويها من النص.</p>
        </div>
      </div>
    </div>

    <div class="card" id="bkMock" hidden>
      <div class="sec" style="text-align:center">المعاينة</div>
      <div class="mock"><canvas id="bkCanvas" width="2000" height="1404"></canvas><div class="mock-note" id="bkMockNote"></div></div>
      <div class="flip">
        <button type="button" id="bkRight" aria-label="قلب الصفحات">→</button>
        <span id="bkSpread"></span>
        <button type="button" id="bkLeft" aria-label="قلب الصفحات">←</button>
      </div>
    </div>
  </div>

  <script src="../vendor/pdf-lib.min.js" defer></script>
  <script src="mockup.js" defer></script>
  <script src="app.js" defer></script>
  <script src="../presence.js" data-tool="booklet-maker" defer></script>

  <div class="foot">HC Generator, a project by Christian Hope Center. © <?= date('Y') ?> All Rights Reserved.</div>
</body>
</html>
