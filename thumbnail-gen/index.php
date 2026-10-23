<?php
/**
 * Thumbnail Gen — HC YouTube thumbnail generator.
 * Served from the same origin, so the strict CSP in .htaccess applies: no inline
 * script here (everything lives in compositor.js / app.js), inline styles are fine.
 * Access: app.js asks the auth Worker for the signed-in user's projects and only
 * shows the tool when "thumbnail-gen" is among them (owner/comms see every project).
 */
?>
<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Thumbnail Gen</title>
<style>
  @font-face{font-family:'Somar Sans';font-weight:400;src:url('../guideline-assistant/fonts/SomarSans-Regular.otf') format('opentype');font-display:swap;}
  @font-face{font-family:'Somar Sans';font-weight:700;src:url('../guideline-assistant/fonts/SomarSans-Bold.otf') format('opentype');font-display:swap;}
  @font-face{font-family:'Somar Sans';font-weight:900;src:url('../guideline-assistant/fonts/SomarSans-Black.otf') format('opentype');font-display:swap;}
  /* The thumbnail's own typeface (licensed for web use by Hope Center). */
  @font-face{font-family:'Avenir Black Oblique';src:url('fonts/Avenir-BlackOblique.ttf') format('truetype');font-display:block;}

  :root{
    --red:#be1f24; --ink:#414042; --text:#58595b; --muted:#6f6e71;
    --line:#d3d3d5; --fill:#f4f4f5; --bg:#eef1f3; --card:#fff;
  }
  *{box-sizing:border-box;}
  [hidden]{display:none !important;}   /* .layout/.card set display, which would beat the attribute */
  body{margin:0;background:var(--bg);color:var(--text);
    font-family:'Somar Sans',system-ui,sans-serif;direction:rtl;
    -webkit-font-smoothing:antialiased;min-height:100vh;}

  .topbar{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:14px;max-width:1240px;margin:0 auto;padding:22px 20px 6px;}
  .back{display:inline-flex;align-items:center;gap:7px;background:#fff;border:1px solid var(--line);
    border-radius:10px;padding:9px 14px;color:var(--ink);font-family:inherit;font-weight:700;font-size:13px;
    text-decoration:none;transition:.15s;white-space:nowrap;justify-self:start;}
  .back:hover{background:var(--red);border-color:var(--red);color:#fff;}
  .brand{display:flex;align-items:center;gap:9px;justify-content:center;grid-column:2;}
  .brand h1{margin:0;font-size:20px;font-weight:900;color:var(--red);letter-spacing:-.01em;direction:ltr;}

  .wrap{max-width:1240px;margin:0 auto;padding:14px 20px 40px;}
  .card{background:var(--card);border-radius:18px;box-shadow:0 10px 40px rgba(0,0,0,.08);padding:22px 24px;}
  /* Both cards share the row height; the controls card is a column whose
     buttons sit at the bottom, level with the preview card's bottom edge. */
  .layout{display:grid;grid-template-columns:340px 1fr;gap:18px;align-items:stretch;}
  .layout > .card:first-child{display:flex;flex-direction:column;}
  .actions{margin-top:auto;padding-top:6px;}
  @media(max-width:900px){.layout{grid-template-columns:1fr;}}

  .field{margin-bottom:16px;}
  .field label.l{display:block;font-size:13px;font-weight:700;color:var(--ink);margin-bottom:7px;}
  .field .hint{font-size:11px;font-weight:500;color:var(--muted);}
  textarea,select{width:100%;border:1px solid var(--line);border-radius:10px;padding:10px 12px;font-family:inherit;font-size:14px;color:var(--ink);background:#fff;}
  textarea{resize:none;height:96px;line-height:1.5;}   /* fixed: room for three lines */
  .en{direction:ltr;text-align:left;font-family:'Avenir Black Oblique','Somar Sans',sans-serif;font-size:16px;}
  textarea:focus,select:focus{outline:2px solid var(--red);outline-offset:1px;border-color:var(--red);}

  .drop{border:2px dashed var(--line);border-radius:12px;background:var(--fill);padding:16px;text-align:center;cursor:pointer;display:block;transition:.15s;}
  .drop:hover,.drop.over{border-color:var(--red);background:#fff;}
  .drop .t{font-weight:700;color:var(--ink);font-size:14px;}
  .drop .h{font-size:11px;color:var(--muted);margin-top:4px;}
  .drop input{display:none;}
  .row{display:flex;align-items:center;gap:10px;}
  .row input[type=range]{flex:1;accent-color:var(--red);}
  .row .v{min-width:44px;font-size:12px;font-weight:700;color:var(--ink);direction:ltr;text-align:center;}
  .link{background:none;border:none;color:var(--muted);font-family:inherit;font-weight:700;font-size:12px;cursor:pointer;text-decoration:underline;padding:0;}
  .link:hover{color:var(--red);}

  .proj-row{display:flex;gap:8px;margin-bottom:9px;}
  .btn-proj{flex:1;text-align:center;background:#fff;color:var(--ink);border:1.5px solid var(--line);border-radius:9px;padding:10px;font-family:inherit;font-size:13px;font-weight:700;cursor:pointer;transition:.15s;}
  .btn-proj:hover{border-color:var(--red);color:var(--red);}
  .btn-proj input{display:none;}
  .btn{width:100%;background:var(--red);color:#fff;border:none;border-radius:12px;padding:14px 20px;font-family:inherit;font-weight:800;font-size:15px;cursor:pointer;transition:.15s;}
  .btn:disabled{opacity:.55;cursor:not-allowed;}
  .status{font-size:12px;font-weight:700;color:var(--muted);min-height:18px;margin-top:10px;text-align:center;}
  .status.err{color:var(--red);}

  .stage{position:relative;border-radius:12px;overflow:hidden;background:#222;aspect-ratio:2000/1125;cursor:grab;touch-action:none;}
  .stage.drag{cursor:grabbing;}
  .stage canvas{display:block;width:100%;height:100%;}
  .stage .busy{position:absolute;inset-inline-start:12px;bottom:10px;background:rgba(0,0,0,.55);color:#fff;font-size:11px;font-weight:700;padding:4px 9px;border-radius:999px;opacity:0;transition:opacity .2s;pointer-events:none;}
  .stage .busy.on{opacity:1;}
  .note{font-size:12px;color:var(--muted);margin-top:10px;text-align:center;position:relative;top:2px;}

  /* ---- Live YouTube mockup (full-width card under the editor) ----
     A YouTube-style page drawn in LTR with the current preview copied into
     every thumbnail slot, so the title can be judged at real feed sizes. */
  .yt{grid-column:1/-1;padding:0;overflow:hidden;direction:ltr;text-align:left;
    --yt-bg:#fff;--yt-fg:#0f0f0f;--yt-sub:#606060;--yt-line:#e5e5e5;--yt-chip:#f2f2f2;--yt-skel:#ececec;
    background:var(--yt-bg);color:var(--yt-fg);font-family:'Segoe UI',Roboto,Arial,sans-serif;transition:background .2s,color .2s;}
  .yt.dark{--yt-bg:#0f0f0f;--yt-fg:#f1f1f1;--yt-sub:#aaa;--yt-line:#272727;--yt-chip:#272727;--yt-skel:#222;}
  .yt-head{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:14px 22px;border-bottom:1px solid var(--yt-line);direction:rtl;font-family:'Somar Sans',system-ui,sans-serif;}
  .yt-head .t{font-size:14px;font-weight:800;color:var(--yt-fg);}
  .yt-mode{display:flex;gap:4px;background:var(--yt-chip);border-radius:999px;padding:3px;}
  .yt-mode button{border:none;background:none;color:var(--yt-sub);font-family:inherit;font-size:12px;font-weight:700;padding:5px 12px;border-radius:999px;cursor:pointer;}
  .yt-mode button.on{background:var(--yt-bg);color:var(--yt-fg);box-shadow:0 1px 3px rgba(0,0,0,.15);}
  .yt-bar{display:flex;align-items:center;gap:16px;padding:10px 22px;}
  .yt-brand{display:flex;align-items:center;gap:4px;font-weight:700;font-size:19px;letter-spacing:-.6px;white-space:nowrap;}
  .yt-brand i{display:inline-block;width:28px;height:20px;background:#f00;border-radius:6px;position:relative;}
  .yt-brand i::after{content:"";position:absolute;left:11px;top:6px;border-left:8px solid #fff;border-top:4px solid transparent;border-bottom:4px solid transparent;}
  .yt-search{flex:1;max-width:560px;margin:0 auto;height:38px;border:1px solid var(--yt-line);border-radius:999px;display:flex;align-items:center;padding:0 16px;color:var(--yt-sub);font-size:14px;}
  .yt-dots{display:flex;gap:10px;}
  .yt-dots span{width:30px;height:30px;border-radius:50%;background:var(--yt-skel);}
  .yt-dots span:last-child{background:#be1f24;}
  .yt-body{display:grid;grid-template-columns:1fr 340px;gap:26px;padding:8px 22px 26px;}
  @media(max-width:900px){.yt-body{grid-template-columns:1fr;}}
  .yt-sec{font-size:13px;font-weight:700;color:var(--yt-sub);margin:6px 0 12px;}
  .yt-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:18px 14px;}
  @media(max-width:700px){.yt-grid{grid-template-columns:1fr;}}
  .yt-thumb{position:relative;aspect-ratio:16/9;border-radius:12px;overflow:hidden;background:var(--yt-skel);}
  .yt-thumb canvas,.yt-thumb img{display:block;width:100%;height:100%;object-fit:cover;}
  .yt-dur{position:absolute;right:6px;bottom:6px;background:rgba(0,0,0,.8);color:#fff;font-size:12px;font-weight:600;padding:1px 4px;border-radius:4px;}
  .yt-meta{display:flex;gap:10px;margin-top:10px;}
  .yt-av{flex:0 0 36px;height:36px;border-radius:50%;background:#be1f24 url('assets/logo.svg') center/26px auto no-repeat;}
  .yt-ttl{font-size:15px;font-weight:600;line-height:1.35;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}
  .yt-sub{font-size:13px;color:var(--yt-sub);margin-top:3px;line-height:1.4;}
  .yt-side .yt-item{display:flex;gap:9px;margin-bottom:12px;}
  .yt-side .yt-thumb{flex:0 0 168px;border-radius:8px;}
  .yt-side .yt-ttl{font-size:14px;}
  .yt-side .yt-sub{font-size:12px;}

  .gate{max-width:520px;margin:60px auto;text-align:center;}
  .gate p{font-size:15px;font-weight:700;color:var(--ink);}
  /* Pinned to the bottom like the copyright on the other pages (.app-copyright:
     bottom 24px); body leaves room for it so content never runs underneath. */
  body{padding-bottom:70px;}
  .foot{position:fixed;bottom:24px;left:0;right:0;z-index:-1;text-align:center;direction:ltr;font-size:11px;font-weight:500;color:#848484;padding:0 12px;pointer-events:none;}   /* z-index -1: fixed in place, behind anything that scrolls over it */
</style>
</head>
<body>

  <div class="topbar">
    <a class="back" href="../">→ المشاريع</a>
    <div class="brand"><h1>Thumbnail Gen</h1></div>
  </div>

  <div class="wrap">
    <div class="card gate" id="tgGate"><p id="tgGateMsg">…جارٍ التحقّق من الصلاحية</p></div>

    <div class="layout" id="tgApp" hidden>
      <div class="card">
        <div class="field">
          <label class="l" for="tgTitle">العنوان <span class="hint">سطر لكل صف — إنكليزي</span></label>
          <textarea id="tgTitle" class="en" rows="3" spellcheck="false">Turning Struggle
into Success</textarea>
        </div>
        <div class="field">
          <label class="l">الصورة <button type="button" class="link" id="tgImgReset" hidden>استعادة الافتراضية</button></label>
          <label class="drop" id="tgDrop">
            <div class="t" id="tgDropT">اسحب صورة هنا أو اضغط للاختيار</div>
            <div class="h">JPG · PNG · WEBP</div>
            <input type="file" id="tgFile" accept="image/*">
          </label>
        </div>
        <div class="field">
          <label class="l" for="tgZoom">التكبير <button type="button" class="link" id="tgPosReset">إعادة الضبط</button></label>
          <div class="row"><input type="range" id="tgZoom" min="100" max="300" step="1" value="100"><span class="v" id="tgZoomV">100%</span></div>
        </div>
        <div class="actions">
          <div class="proj-row">
            <button type="button" class="btn-proj" id="tgSaveBtn">حفظ مشروع</button>
            <label class="btn-proj">فتح مشروع<input type="file" accept=".json,application/json" id="tgProjFile"></label>
          </div>
          <button class="btn" id="tgDownload" disabled>DOWNLOAD</button>
          <div class="status" id="tgStatus"></div>
        </div>
      </div>

      <div class="card">
        <div class="stage" id="tgStage">
          <canvas id="tgCanvas" width="1000" height="563"></canvas>
          <span class="busy" id="tgBusy">…جارٍ المعالجة</span>
        </div>
        <div class="note">اسحب الصورة داخل المعاينة لتحريكها</div>
      </div>

      <!-- Live mockup: every canvas.yt-live is refreshed from the preview by app.js. -->
      <div class="card yt" id="tgYt">
        <div class="yt-head">
          <span class="t">معاينة مباشرة على YouTube</span>
          <div class="yt-mode"><button type="button" id="tgYtLight" class="on">فاتح</button><button type="button" id="tgYtDark">داكن</button></div>
        </div>
        <div class="yt-bar"><span class="yt-brand"><i></i>YouTube</span><div class="yt-search">Search</div><div class="yt-dots"><span></span><span></span></div></div>
        <div class="yt-body">
          <div>
            <div class="yt-sec">Home</div>
            <div class="yt-grid">
              <div>
                <div class="yt-thumb"><canvas class="yt-live"></canvas><span class="yt-dur">12:34</span></div>
                <div class="yt-meta"><span class="yt-av"></span><div><div class="yt-ttl yt-live-title"></div><div class="yt-sub">Christian Hope Center<br>1.2K views • 2 hours ago</div></div></div>
              </div>
              <div>
                <div class="yt-thumb"><img src="assets/mock/video1.jpg" alt=""><span class="yt-dur">8:47</span></div>
                <div class="yt-meta"><span class="yt-av"></span><div><div class="yt-ttl">A Story of Hope Through Hardship</div><div class="yt-sub">Christian Hope Center<br>3.4K views • 1 week ago</div></div></div>
              </div>
              <div>
                <div class="yt-thumb"><img src="assets/mock/video2.jpg" alt=""><span class="yt-dur">6:12</span></div>
                <div class="yt-meta"><span class="yt-av"></span><div><div class="yt-ttl">A Village Reborn After Fire</div><div class="yt-sub">Christian Hope Center<br>5.1K views • 3 weeks ago</div></div></div>
              </div>
            </div>
          </div>
          <div class="yt-side">
            <div class="yt-sec">Up next</div>
            <div class="yt-item">
              <div class="yt-thumb"><canvas class="yt-live"></canvas><span class="yt-dur">12:34</span></div>
              <div><div class="yt-ttl yt-live-title"></div><div class="yt-sub">Christian Hope Center<br>1.2K views • 2 hours ago</div></div>
            </div>
            <div class="yt-item">
              <div class="yt-thumb"><img src="assets/mock/video3.jpg" alt=""><span class="yt-dur">10:05</span></div>
              <div><div class="yt-ttl">Breathing Life Back Into the Stones &amp; Souls</div><div class="yt-sub">Christian Hope Center<br>2.8K views • 1 month ago</div></div>
            </div>
            <div class="yt-item">
              <div class="yt-thumb"><img src="assets/mock/video4.jpg" alt=""><span class="yt-dur">4:38</span></div>
              <div><div class="yt-ttl">Children University Robotics</div><div class="yt-sub">Christian Hope Center<br>1.9K views • 2 months ago</div></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <script src="compositor.js" defer></script>
  <script src="app.js" defer></script>

  <div class="foot">HC Generator, a project by Christian Hope Center. © <?= date('Y') ?> All Rights Reserved.</div>

</body>
</html>
