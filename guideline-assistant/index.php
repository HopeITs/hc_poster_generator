<?php
/**
 * Guidelines Assistant — صفحة الأداة (هيكل مبدئي).
 * تُخدَم من نفس الأصل، فتخضع لـ CSP الصارم في .htaccess:
 *  - لا سكربت inline هنا (سكربتات الأداة تُحمَّل كملفّ خارجي app.js لاحقًا).
 *  - أنماط inline مسموحة (style-src 'unsafe-inline').
 * TODO(auth): التحقّق من جلسة الدخول قبل عرض الأداة (لاحقًا).
 */
?>
<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Guidelines Assistant</title>
<style>
  @font-face{font-family:'Somar Sans';font-weight:400;src:url('fonts/SomarSans-Regular.otf') format('opentype');font-display:swap;}
  @font-face{font-family:'Somar Sans';font-weight:500;src:url('fonts/SomarSans-Medium.otf') format('opentype');font-display:swap;}
  @font-face{font-family:'Somar Sans';font-weight:600;src:url('fonts/SomarSans-SemiBold.otf') format('opentype');font-display:swap;}
  @font-face{font-family:'Somar Sans';font-weight:700;src:url('fonts/SomarSans-Bold.otf') format('opentype');font-display:swap;}
  @font-face{font-family:'Somar Sans';font-weight:900;src:url('fonts/SomarSans-Black.otf') format('opentype');font-display:swap;}

  :root{
    --red:#be1f24; --ink:#414042; --text:#58595b; --muted:#6f6e71;
    --line:#d3d3d5; --fill:#f4f4f5; --bg:#eef1f3; --card:#fff;
  }
  *{box-sizing:border-box;}
  body{margin:0;background:var(--bg);color:var(--text);
    font-family:'Somar Sans',system-ui,sans-serif;direction:rtl;
    -webkit-font-smoothing:antialiased;min-height:100vh;}

  .topbar{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:14px;max-width:900px;margin:0 auto;padding:22px 20px 6px;}
  .back{display:inline-flex;align-items:center;gap:7px;background:#fff;border:1px solid var(--line);
    border-radius:10px;padding:9px 14px;color:var(--ink);font-family:inherit;font-weight:700;font-size:13px;
    text-decoration:none;transition:.15s;white-space:nowrap;}
  .back:hover{background:var(--red);border-color:var(--red);color:#fff;}
  .back{justify-self:start;}
  .brand{display:flex;align-items:center;gap:9px;justify-content:center;grid-column:2;}
  .brand h1{margin:0;font-size:20px;font-weight:900;color:var(--red);letter-spacing:-.01em;}

  .wrap{max-width:900px;margin:0 auto;padding:14px 20px 40px;}
  .card{background:var(--card);border-radius:18px;box-shadow:0 10px 40px rgba(0,0,0,.08);
    padding:26px 28px;margin-bottom:18px;}

  .tasks{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:14px;}
  .task{border:1px solid #e7e3e3;border-radius:13px;padding:16px 18px;position:relative;overflow:hidden;}
  .task::before{content:"";position:absolute;inset-block:0;inset-inline-start:0;width:3px;background:var(--red);}
  .task .n{font-size:11px;font-weight:800;color:var(--red);letter-spacing:.08em;}
  .task h3{margin:5px 0 6px;font-size:16px;font-weight:800;color:var(--ink);}
  .task p{margin:0;font-size:13px;line-height:1.7;color:var(--text);}

  .sec-title{font-size:14px;font-weight:800;color:var(--ink);margin:0 0 12px;}

  /* upload */
  .drop{border:2px dashed var(--line);border-radius:14px;background:var(--fill);
    padding:30px 20px;text-align:center;cursor:pointer;display:block;transition:.15s;}
  .drop:hover{border-color:var(--red);background:#fff;}
  .drop .ic{font-size:30px;line-height:1;margin-bottom:8px;color:var(--red);}
  .drop .t{font-weight:700;color:var(--ink);font-size:15px;}
  .drop .h{font-size:12px;color:var(--muted);margin-top:5px;}
  .drop input{display:none;}

  /* option chips */
  .opts{display:flex;flex-wrap:wrap;gap:10px;}
  .chk{display:inline-flex;align-items:center;gap:8px;border:1px solid var(--line);border-radius:10px;
    padding:9px 14px;font-size:13px;font-weight:600;color:var(--ink);background:#fff;cursor:pointer;user-select:none;}
  .chk input{width:16px;height:16px;accent-color:var(--red);margin:0;cursor:pointer;}
  .chk.all{border-style:dashed;}

  .startrow{display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-top:4px;}
  .btn{background:var(--red);color:#fff;border:none;border-radius:12px;padding:14px 26px;
    font-family:inherit;font-weight:800;font-size:15px;cursor:pointer;transition:.15s;}
  .btn:disabled{opacity:.5;cursor:not-allowed;}
  .soon{font-size:12px;color:var(--muted);}

  /* status + review */
  .status{font-size:14px;font-weight:700;color:var(--ink);min-height:20px;}
  .status.err{color:var(--red);}
  .drop.over{border-color:var(--red);background:#fff;}
  .spinner{display:inline-block;width:15px;height:15px;border:2px solid var(--line);border-top-color:var(--red);border-radius:50%;animation:ga-spin .7s linear infinite;vertical-align:-2px;margin-inline-end:7px;}
  @keyframes ga-spin{to{transform:rotate(360deg);}}
  @media(prefers-reduced-motion:reduce){.spinner{animation:none;}}
  .rev-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px;flex-wrap:wrap;}
  .rev-head .t{font-size:16px;font-weight:800;color:var(--ink);}
  .rev-head .s{font-size:12px;color:var(--muted);direction:rtl;}
  .rev-row{display:grid;grid-template-columns:148px 1fr;gap:12px;align-items:start;padding:12px;border:1px solid #e7e3e3;border-radius:11px;margin-bottom:10px;}
  .rev-role{font-family:inherit;font-size:12px;font-weight:700;color:var(--ink);border:1px solid var(--line);border-radius:8px;padding:9px 8px;background:var(--fill);cursor:pointer;}
  .rev-text{width:100%;border:1px solid var(--line);border-radius:8px;padding:9px 11px;font-family:inherit;font-size:14px;line-height:1.7;color:var(--ink);resize:vertical;min-height:44px;direction:rtl;background:#fff;overflow:hidden;}
  .rev-text:focus,.rev-role:focus{outline:2px solid var(--red);outline-offset:1px;border-color:var(--red);}
  .rev-row.tbl{align-items:center;}
  .rev-tag{font-size:12px;font-weight:800;color:var(--muted);align-self:center;text-align:center;}
  .rev-tblwrap{overflow-x:auto;}
  .rev-tbl{border-collapse:collapse;width:100%;font-size:13px;}
  .rev-tbl td{border:1px solid var(--line);padding:6px 9px;color:var(--ink);white-space:nowrap;}
  /* Fixed in place like the other tools, behind anything that scrolls over it. */
  body{padding-bottom:70px;}
  .foot{position:fixed;bottom:24px;left:0;right:0;z-index:-1;text-align:center;direction:ltr;
    font-size:11px;font-weight:500;color:#848484;padding:0 12px;pointer-events:none;}
</style>
</head>
<body>

  <div class="topbar">
    <a class="back" href="../">→ المشاريع</a>
    <div class="brand">
      <h1>Guidelines Assistant</h1>
    </div>
  </div>

  <div class="wrap">

    <!-- المهمّتان -->
    <div class="card">
      <div class="tasks">
        <div class="task">
          <div class="n">المهمّة 1</div>
          <h3>تدقيق المحتوى</h3>
          <p>تصحيح لغويّ وإملائيّ لكامل نصّ المستند، مع الحفاظ على المعنى والأسماء والأرقام.</p>
        </div>
        <div class="task">
          <div class="n">المهمّة 2</div>
          <h3>التنسيق وفق الضوابط</h3>
          <p>إعادة تلبيس المحتوى بخطوط البيت وألوانه على ترويسة المحافظة المختارة.</p>
        </div>
      </div>
    </div>

    <!-- الرفع -->
    <div class="card">
      <div class="sec-title">1 · ارفع الملفّ</div>
      <label class="drop" id="gaDrop">
        <div class="ic">↥</div>
        <div class="t">اسحب ملفًّا هنا أو اضغط للاختيار</div>
        <div class="h">Word · نصّ · صورة · PDF</div>
        <input type="file" id="gaFile" accept=".docx,.txt,.md,.png,.jpg,.jpeg,.webp,.pdf">
      </label>
      <div id="gaStatus" class="status" style="margin-top:14px"></div>
    </div>

    <!-- المحافظات -->
    <div class="card">
      <div class="sec-title">2 · اختر المحافظة (واحدة أو أكثر أو الكل)</div>
      <div class="opts">
        <label class="chk all"><input type="checkbox" id="gaGovAll"><span>كل المحافظات</span></label>
        <label class="chk"><input type="checkbox" class="ga-gov" value="DMS"><span>دمشق</span></label>
        <label class="chk"><input type="checkbox" class="ga-gov" value="HMS"><span>حمص</span></label>
        <label class="chk"><input type="checkbox" class="ga-gov" value="LAT"><span>اللاذقية</span></label>
        <label class="chk"><input type="checkbox" class="ga-gov" value="ALP"><span>حلب</span></label>
      </div>
    </div>

    <!-- الإخراج -->
    <div class="card">
      <div class="sec-title">3 · صيغة الإخراج</div>
      <div class="opts">
        <label class="chk"><input type="checkbox" class="ga-fmt" value="docx" checked><span>Word</span></label>
        <label class="chk"><input type="checkbox" class="ga-fmt" value="pdf"><span>PDF</span></label>
      </div>
    </div>

    <!-- المراجعة -->
    <div class="card" id="gaReviewCard" hidden>
      <div class="rev-head">
        <span class="t">مراجعة النتيجة</span>
        <span class="s" id="gaReviewSub"></span>
      </div>
      <div id="gaReview"></div>
      <div class="startrow" style="margin-top:16px">
        <button class="btn" id="gaGenerate">توليد المستند</button>
        <span class="status" id="gaGenStatus"></span>
      </div>
    </div>

  </div>

  <script src="app.js" defer></script>

  <div class="foot">HC Generator, a project by Christian Hope Center. © <?= date('Y') ?> All Rights Reserved.</div>

</body>
</html>
