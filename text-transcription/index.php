<?php
/**
 * Text Transcription — the text in images and PDF files, as editable text.
 * «تفريغ النص» reads them with Gemini through the auth Worker
 * (/transcribe/images); the images are sent to Google for that and deleted
 * right after. Image types: plain text, card or document (as fields), invoice.
 * Strict CSP applies (no inline script); access is checked by app.js against
 * the user's projects ("text-transcription"), like Thumbnail Gen and Reels Gen.
 */
?>
<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Text Transcription</title>
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
  .layout{display:grid;grid-template-columns:360px 1fr;gap:18px;align-items:start;}
  @media(max-width:900px){.layout{grid-template-columns:1fr;}}
  .sec{font-size:13px;font-weight:800;color:var(--ink);margin:0 0 8px;}
  .field{margin-bottom:16px;}
  .hint{font-size:11px;font-weight:500;color:var(--muted);line-height:1.6;}
  select{width:100%;border:1px solid var(--line);border-radius:10px;padding:9px 11px;padding-inline-end:38px;font-family:inherit;font-size:14px;color:var(--ink);cursor:pointer;-webkit-appearance:none;appearance:none;
    background:#fff url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1 1.5l5 5 5-5' fill='none' stroke='%23414042' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") no-repeat left 14px center;}
  select:focus,textarea:focus{outline:2px solid var(--red);outline-offset:1px;border-color:var(--red);}
  .drop{border:2px dashed var(--line);border-radius:12px;background:var(--fill);padding:18px 14px;text-align:center;cursor:pointer;display:block;transition:.15s;}
  .drop:hover,.drop.over{border-color:var(--red);background:#fff;}
  .drop .t{font-weight:700;color:var(--ink);font-size:14px;} .drop .h{font-size:11px;color:var(--muted);margin-top:3px;}
  .drop input{display:none;}
  .btn{width:100%;background:var(--navy);color:#fff;border:none;border-radius:12px;padding:13px 18px;font-family:inherit;font-weight:800;font-size:15px;cursor:pointer;transition:.15s;}
  .btn:disabled{opacity:.55;cursor:not-allowed;}
  .btn-line{background:#fff;color:var(--ink);border:1.5px solid var(--line);border-radius:9px;padding:9px 12px;font-family:inherit;font-size:13px;font-weight:700;cursor:pointer;transition:.15s;white-space:nowrap;text-align:center;}
  .btn-line:hover{border-color:var(--red);color:var(--red);}
  .btn-line:disabled{opacity:.5;cursor:not-allowed;}
  .btn-line.wide{width:100%;margin-top:8px;}
  .row{display:flex;gap:8px;align-items:center;} .row > *{flex:1;min-width:0;}
  .status{font-size:12px;font-weight:700;color:var(--muted);min-height:18px;margin-top:10px;text-align:center;line-height:1.6;}
  .status.err{color:var(--red);}
  .bar{height:6px;background:var(--fill);border-radius:999px;overflow:hidden;margin-top:9px;}
  .bar i{display:block;height:100%;width:0;background:var(--red);transition:width .2s;}
  .engines{border-top:1px solid var(--line);margin-top:16px;padding-top:14px;}
  /* results */
  .res-head{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:12px;flex-wrap:wrap;}
  .res-head .row{flex:0 0 auto;}
  .items{display:flex;flex-direction:column;gap:14px;}
  .item{display:grid;grid-template-columns:150px 1fr;gap:14px;border:1px solid var(--line);border-radius:14px;padding:12px;background:#fff;}
  @media(max-width:620px){.item{grid-template-columns:1fr;}}
  .item .pic{position:relative;border-radius:9px;overflow:hidden;background:var(--fill);align-self:start;}
  .item .pic img{display:block;width:100%;height:auto;max-height:220px;object-fit:contain;cursor:zoom-in;}
  /* a PDF: a tile with its name, opening the file */
  .item .pdf{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;width:100%;aspect-ratio:3/4;max-height:220px;border:none;background:var(--fill);cursor:pointer;font-family:inherit;padding:10px;}
  .item .pdf b{background:var(--red);color:#fff;font-size:13px;font-weight:900;border-radius:6px;padding:4px 10px;letter-spacing:.04em;}
  .item .pdf span{font-size:11px;font-weight:700;color:var(--ink);direction:ltr;word-break:break-all;text-align:center;max-height:4.5em;overflow:hidden;}
  .item .pdf:hover b{background:var(--navy);}
  /* …and once its first page is drawn: the page itself, a badge with the page count */
  .item .pdf.page{position:relative;aspect-ratio:auto;max-height:none;padding:0;background:#fff;border:1px solid var(--line);border-radius:9px;overflow:hidden;}
  .item .pdf.page img{display:block;width:100%;height:auto;max-height:220px;object-fit:contain;object-position:top;cursor:pointer;}
  .item .pdf.page b{position:absolute;bottom:6px;inset-inline-end:6px;font-size:11px;padding:2px 8px;box-shadow:0 2px 6px rgba(0,0,0,.2);}
  .item .num{position:absolute;top:6px;inset-inline-start:6px;background:rgba(0,0,0,.6);color:#fff;font-size:11px;font-weight:800;border-radius:999px;padding:1px 8px;}
  .item .body{display:flex;flex-direction:column;gap:8px;min-width:0;}
  .item .meta{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:11px;font-weight:700;color:var(--muted);}
  .tag{border-radius:999px;padding:2px 9px;font-size:11px;font-weight:800;background:var(--fill);color:var(--ink);}
  .tag.gem{background:#fdecec;color:var(--red);}
  .warn{color:var(--red);}
  .item textarea{width:100%;min-height:140px;resize:vertical;border:1px solid var(--line);border-radius:10px;padding:10px 12px;font-family:inherit;font-size:14px;line-height:1.75;color:var(--ink);background:#fff;unicode-bidi:plaintext;}
  /* a document: its fields, each label and value editable, then the full text folded away */
  .doc-type{font-size:13px;font-weight:800;color:var(--ink);}
  .fields{width:100%;border-collapse:collapse;font-size:14px;}
  .fields td{border-bottom:1px solid var(--fill);padding:3px 0;vertical-align:middle;}
  .fields td.l{width:34%;padding-inline-end:8px;}
  .fields td.c{width:1%;padding-inline-start:6px;}
  .fields textarea{width:100%;min-height:0;resize:vertical;border:1px solid transparent;border-radius:7px;padding:6px 8px;font-family:inherit;font-size:14px;line-height:1.6;color:var(--ink);background:transparent;unicode-bidi:plaintext;}
  .fields textarea:hover{border-color:var(--line);}
  .fields textarea:focus{outline:2px solid var(--red);outline-offset:0;background:#fff;}
  .fields input{width:100%;border:1px solid transparent;border-radius:7px;padding:6px 8px;font-family:inherit;font-size:14px;color:var(--ink);background:transparent;unicode-bidi:plaintext;}
  .fields td.l input{font-weight:700;color:var(--muted);font-size:13px;}
  .fields input:hover{border-color:var(--line);}
  .fields input:focus{outline:2px solid var(--red);outline-offset:0;background:#fff;}
  .fields button{border:1px solid var(--line);background:#fff;border-radius:7px;padding:4px 9px;font-family:inherit;font-size:12px;font-weight:700;color:var(--ink);cursor:pointer;}
  .fields button:hover{border-color:var(--red);color:var(--red);}
  details.full summary{cursor:pointer;font-size:12px;font-weight:700;color:var(--muted);margin:2px 0 6px;}
  .item .tools{display:flex;gap:6px;flex-wrap:wrap;}
  .item .tools button{flex:0 0 auto;}
  .empty{padding:34px;text-align:center;color:var(--muted);font-size:14px;border:2px dashed var(--line);border-radius:14px;line-height:1.8;}
  .gate{max-width:520px;margin:60px auto;text-align:center;}
  .gate p{font-size:15px;font-weight:700;color:var(--ink);}
  /* the consent box before images leave for Gemini (in the page: some browsers suppress confirm()) */
  .ask{position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:30;padding:20px;}
  .ask .box{background:#fff;border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,.25);max-width:460px;width:100%;padding:22px 24px;}
  .ask h2{margin:0 0 10px;font-size:16px;font-weight:900;color:var(--ink);}
  .ask p{margin:0 0 8px;font-size:13px;line-height:1.8;color:var(--text);}
  .ask .row{margin-top:16px;}
  .zoom{position:fixed;inset:0;background:rgba(0,0,0,.82);display:flex;align-items:center;justify-content:center;z-index:20;cursor:zoom-out;padding:24px;}
  .zoom img{max-width:100%;max-height:100%;border-radius:8px;}
  .foot{position:fixed;bottom:24px;left:0;right:0;z-index:-1;text-align:center;direction:ltr;font-size:11px;font-weight:500;color:#848484;padding:0 12px;pointer-events:none;}   /* z-index -1: fixed in place, behind anything that scrolls over it */
</style>
</head>
<body>
  <div class="topbar">
    <a class="back" href="../">→ المشاريع</a>
    <div class="brand"><h1>Text Transcription</h1><span class="badge">NEW</span></div>
  </div>

  <div class="wrap">
    <div class="card gate" id="ttGate"><p id="ttGateMsg">…جارٍ التحقّق من الصلاحية</p></div>

    <div class="layout" id="ttApp" hidden>
      <div class="card">
        <div class="field">
          <div class="sec">الملفات <span class="hint">صور أو PDF — أو الصق صورة بـ Ctrl+V</span></div>
          <label class="drop" id="ttDrop">
            <div class="t">اسحب الصور أو ملفات PDF هنا أو اضغط للاختيار</div>
            <div class="h">JPG · PNG · WEBP · PDF</div>
            <input type="file" id="ttFiles" accept="image/*,application/pdf,.pdf" multiple>
          </label>
        </div>
        <div class="field">
          <div class="sec">لغة النص</div>
          <select id="ttLang">
            <option value="ara+eng">عربي وإنكليزي</option>
            <option value="ara">عربي</option>
            <option value="eng">English</option>
          </select>
        </div>
        <div class="field">
          <div class="sec">نوع الصورة</div>
          <select id="ttKind">
            <option value="text">نص عادي</option>
            <option value="doc">بطاقة أو وثيقة — خانات</option>
            <option value="invoice">فاتورة — للمحاسبة</option>
          </select>
          <div class="hint" id="ttKindHint" style="margin-top:6px"></div>
        </div>
        <div class="engines">
          <button type="button" class="btn" id="ttGemini" disabled>تفريغ النص</button>
          <div class="hint" style="margin-top:6px">الصور بتنقرأ عند Google (Gemini) وبتنحذف من عندهم بعدها مباشرة، والأداة ما بتخزّن شي.</div>
        </div>
        <div class="bar" id="ttBar" hidden><i id="ttBarFill"></i></div>
        <div class="status" id="ttStatus"></div>
      </div>

      <div class="card">
        <div class="res-head">
          <div class="sec" style="margin:0">النصوص <span class="hint" id="ttCount"></span></div>
          <div class="row">
            <button type="button" class="btn-line" id="ttCopyAll" disabled>نسخ الكل</button>
            <button type="button" class="btn-line" id="ttSave" disabled>تنزيل TXT</button>
            <button type="button" class="btn-line" id="ttCsv" disabled title="كل البطاقات بجدول واحد: سطر لكل بطاقة">تنزيل Excel</button>
            <button type="button" class="btn-line" id="ttClear" disabled>مسح الكل</button>
          </div>
        </div>
        <div class="items" id="ttItems"><div class="empty">لا صور بعد — أضف صوراً من اليمين،<br>ثم اضغط «تفريغ النص»</div></div>
      </div>
    </div>
  </div>

  <script src="app.js" defer></script>

  <div class="foot">HC Generator, a project by Christian Hope Center. © 2026 All Rights Reserved.</div>
</body>
</html>
