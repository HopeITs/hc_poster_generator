<?php
/**
 * Meeting Transcription — a meeting's recording, word for word, as editable text.
 * The recording is decoded and compressed on the device, split into overlapping
 * ten-minute parts, and each part is read by Gemini through the auth Worker
 * (/meet/transcribe); the audio is sent to Google for that and deleted right
 * after. Strict CSP applies (no inline script); access is checked by app.js
 * against the user's projects ("meeting-transcription"), like Text Transcription.
 */
?>
<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Meeting Transcription</title>
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
  textarea{width:100%;resize:vertical;border:1px solid var(--line);border-radius:10px;padding:9px 11px;font-family:inherit;font-size:13px;line-height:1.7;color:var(--ink);background:#fff;}
  textarea:focus{outline:2px solid var(--red);outline-offset:1px;border-color:var(--red);}
  .drop{border:2px dashed var(--line);border-radius:12px;background:var(--fill);padding:18px 14px;text-align:center;cursor:pointer;display:block;transition:.15s;}
  .drop:hover,.drop.over{border-color:var(--red);background:#fff;}
  .drop .t{font-weight:700;color:var(--ink);font-size:14px;word-break:break-word;} .drop .h{font-size:11px;color:var(--muted);margin-top:3px;}
  .drop input{display:none;}
  .btn{width:100%;background:var(--navy);color:#fff;border:none;border-radius:12px;padding:13px 18px;font-family:inherit;font-weight:800;font-size:15px;cursor:pointer;transition:.15s;}
  .btn:disabled{opacity:.55;cursor:not-allowed;}
  .btn-line{background:#fff;color:var(--ink);border:1.5px solid var(--line);border-radius:9px;padding:9px 12px;font-family:inherit;font-size:13px;font-weight:700;cursor:pointer;transition:.15s;white-space:nowrap;text-align:center;}
  .btn-line:hover{border-color:var(--red);color:var(--red);}
  .btn-line:disabled{opacity:.5;cursor:not-allowed;}
  .row{display:flex;gap:8px;align-items:center;} .row > *{flex:1;min-width:0;}
  .status{font-size:12px;font-weight:700;color:var(--muted);min-height:18px;margin-top:10px;text-align:center;line-height:1.6;}
  .status.err{color:var(--red);}
  .bar{height:6px;background:var(--fill);border-radius:999px;overflow:hidden;margin-top:9px;}
  .bar i{display:block;height:100%;width:0;background:var(--red);transition:width .2s;}
  audio{width:100%;margin-top:10px;}
  /* the transcript: one line per segment — time (plays the recording from there), speaker, words */
  .res-head{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:12px;flex-wrap:wrap;}
  .res-head .row{flex:0 0 auto;}
  .segs{display:flex;flex-direction:column;gap:6px;}
  .seg{display:grid;grid-template-columns:58px 120px 1fr;gap:10px;align-items:start;border-bottom:1px solid var(--fill);padding:6px 0;}
  @media(max-width:620px){.seg{grid-template-columns:52px 1fr;} .seg .who{grid-column:2;}}
  .seg .t{border:1px solid var(--line);background:#fff;border-radius:7px;padding:3px 6px;font-family:inherit;font-size:12px;font-weight:700;color:var(--navy);cursor:pointer;direction:ltr;}
  .seg .t:hover{border-color:var(--red);color:var(--red);}
  .seg .who{font-size:13px;font-weight:800;color:var(--ink);padding-top:4px;}
  .seg .say{font-size:15px;line-height:1.85;color:var(--ink);border-radius:7px;padding:2px 6px;outline:none;unicode-bidi:plaintext;}
  .seg .say:hover{background:var(--fill);}
  .seg .say:focus{background:#fff;outline:2px solid var(--red);}
  .part{font-size:11px;font-weight:800;color:var(--muted);margin:10px 0 2px;}
  .empty{padding:34px;text-align:center;color:var(--muted);font-size:14px;border:2px dashed var(--line);border-radius:14px;line-height:1.8;}
  .gate{max-width:520px;margin:60px auto;text-align:center;}
  .gate p{font-size:15px;font-weight:700;color:var(--ink);}
  /* the consent box before the recording leaves for Gemini (in the page: some browsers suppress confirm()) */
  .ask{position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:30;padding:20px;}
  .ask .box{background:#fff;border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,.25);max-width:460px;width:100%;padding:22px 24px;}
  .ask h2{margin:0 0 10px;font-size:16px;font-weight:900;color:var(--ink);}
  .ask p{margin:0 0 8px;font-size:13px;line-height:1.8;color:var(--text);}
  .ask .row{margin-top:16px;}
  .foot{position:fixed;bottom:24px;left:0;right:0;z-index:-1;text-align:center;direction:ltr;font-size:11px;font-weight:500;color:#848484;padding:0 12px;pointer-events:none;}   /* z-index -1: fixed in place, behind anything that scrolls over it */
</style>
</head>
<body>
  <div class="topbar">
    <a class="back" href="../">→ المشاريع</a>
    <div class="brand"><h1>Meeting Transcription</h1><span class="badge">BETA</span></div>
  </div>

  <div class="wrap">
    <div class="card gate" id="mtGate"><p id="mtGateMsg">…جارٍ التحقّق من الصلاحية</p></div>

    <div class="layout" id="mtApp" hidden>
      <div class="card">
        <div class="field">
          <div class="sec">تسجيل الاجتماع</div>
          <label class="drop" id="mtDrop">
            <div class="t" id="mtName">اسحب التسجيل هنا أو اضغط للاختيار</div>
            <div class="h" id="mtInfo">M4A · MP3 · WAV · OGG · MP4 — الضغط على جهازك قبل الإرسال</div>
            <input type="file" id="mtFile" accept="audio/*,video/*,.m4a,.mp3,.wav,.ogg,.opus,.mp4,.webm">
          </label>
          <audio id="mtPlayer" controls preload="metadata" hidden></audio>
        </div>
        <div class="field">
          <div class="sec">أسماء ومصطلحات <span class="hint">اختياري — بتساعد بكتابة الأسماء صح</span></div>
          <textarea id="mtNames" rows="3" placeholder="مثلاً: أسماء الحاضرين، Study Zone، LEAP…"></textarea>
        </div>
        <button type="button" class="btn" id="mtGo" disabled>تفريغ الاجتماع</button>
        <div class="hint" style="margin-top:6px">الصوت بينقرأ عند Google (Gemini) وبينحذف من عندهم بعدها مباشرة، والأداة ما بتخزّن شي. كل 10 دقايق بتاخد تقريباً دقيقة.</div>
        <div class="bar" id="mtBar" hidden><i id="mtBarFill"></i></div>
        <div class="status" id="mtStatus"></div>
      </div>

      <div class="card">
        <div class="res-head">
          <div class="sec" style="margin:0">التفريغ <span class="hint" id="mtCount"></span></div>
          <div class="row">
            <button type="button" class="btn-line" id="mtCopy" disabled>نسخ الكل</button>
            <button type="button" class="btn-line" id="mtTxt" disabled>تنزيل .txt</button>
          </div>
        </div>
        <div class="segs" id="mtSegs"><div class="empty">لا تفريغ بعد — ارفع تسجيل الاجتماع<br>واضغط «تفريغ الاجتماع»</div></div>
      </div>
    </div>
  </div>

  <script src="app.js" defer></script>
  <script src="../presence.js" data-tool="meeting-transcription" defer></script>

  <div class="foot">HC Generator, a project by Christian Hope Center. © <?= date('Y') ?> All Rights Reserved.</div>
</body>
</html>
