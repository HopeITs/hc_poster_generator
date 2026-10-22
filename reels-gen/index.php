<?php
/**
 * Reels Gen (Beta) — vertical reels from photos and video clips (or a summary
 * reel of one long video), edited and
 * encoded entirely in the browser (WebCodecs + mp4-muxer). Media is never
 * uploaded: only the script text, the voiceover lines and the music request go
 * to the auth Worker (the Gemini and ElevenLabs keys stay there) — and, for a
 * summary made of speech, the long video's soundtrack, for Gemini to hear.
 * Strict CSP applies (no inline script); access is checked by app.js against the
 * user's projects ("reels-gen"), like Thumbnail Gen.
 */
?>
<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Reels Gen</title>
<style>
  @font-face{font-family:'Somar Sans';font-weight:400;src:url('../guideline-assistant/fonts/SomarSans-Regular.otf') format('opentype');font-display:swap;}
  @font-face{font-family:'Somar Sans';font-weight:700;src:url('../guideline-assistant/fonts/SomarSans-Bold.otf') format('opentype');font-display:block;}
  @font-face{font-family:'Somar Sans';font-weight:900;src:url('../guideline-assistant/fonts/SomarSans-Black.otf') format('opentype');font-display:swap;}

  :root{--ink:#414042;--text:#58595b;--muted:#6f6e71;--line:#d3d3d5;--fill:#f4f4f5;--bg:#eef1f3;--card:#fff;--navy:#0a3c55;--accent:#f99d1c;}   /* --accent: the project colour (titles, hovers, focus, progress, warnings), set by app.js */
  *{box-sizing:border-box;}
  [hidden]{display:none !important;}
  body{margin:0;background:var(--bg);color:var(--text);font-family:'Somar Sans',system-ui,sans-serif;direction:rtl;-webkit-font-smoothing:antialiased;min-height:100vh;padding-bottom:70px;}

  .topbar{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:14px;max-width:1240px;margin:0 auto;padding:22px 20px 6px;}
  .back{display:inline-flex;align-items:center;gap:7px;background:#fff;border:1px solid var(--line);border-radius:10px;padding:9px 14px;color:var(--ink);font-family:inherit;font-weight:700;font-size:13px;text-decoration:none;transition:.15s;white-space:nowrap;justify-self:start;}
  .back:hover{background:var(--accent);border-color:var(--accent);color:#fff;}
  .brand{display:flex;align-items:center;gap:8px;justify-content:center;grid-column:2;}
  .brand h1{margin:0;font-size:20px;font-weight:900;color:var(--accent);direction:ltr;}
  .beta{background:var(--accent);color:#fff;font-size:10px;font-weight:800;letter-spacing:.06em;padding:2px 7px;border-radius:999px;}

  .wrap{max-width:1240px;margin:0 auto;padding:14px 20px 40px;display:grid;gap:18px;}
  .card{background:var(--card);border-radius:18px;box-shadow:0 10px 40px rgba(0,0,0,.08);padding:22px 24px;min-width:0;}
  .layout{display:grid;grid-template-columns:360px 1fr;gap:18px;align-items:stretch;}
  @media(max-width:900px){.layout{grid-template-columns:1fr;}}
  .side{display:flex;flex-direction:column;}

  .sec{font-size:13px;font-weight:800;color:var(--ink);margin:0 0 8px;}
  .field{margin-bottom:16px;}
  .hint{font-size:11px;font-weight:500;color:var(--muted);}
  select,input[type=text],textarea{width:100%;border:1px solid var(--line);border-radius:10px;padding:9px 11px;font-family:inherit;font-size:14px;color:var(--ink);background:#fff;}
  /* Own chevron, 14px in from the left edge (the browser's sits against it); the page is always RTL. */
  select{-webkit-appearance:none;appearance:none;cursor:pointer;padding-inline-end:38px;
    background:#fff url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1 1.5l5 5 5-5' fill='none' stroke='%23414042' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") no-repeat left 14px center;}
  select:focus,input:focus,textarea:focus{outline:2px solid var(--accent);outline-offset:1px;border-color:var(--accent);}
  .row{display:flex;gap:8px;align-items:center;}
  .row > *{min-width:0;}

  .drop{border:2px dashed var(--line);border-radius:12px;background:var(--fill);padding:14px;text-align:center;cursor:pointer;display:block;transition:.15s;}
  .drop:hover,.drop.over{border-color:var(--accent);background:#fff;}
  .drop .t{font-weight:700;color:var(--ink);font-size:14px;} .drop .h{font-size:11px;color:var(--muted);margin-top:3px;}
  .drop input{display:none;}

  .btn{width:100%;background:var(--navy);color:#fff;border:none;border-radius:12px;padding:13px 18px;font-family:inherit;font-weight:800;font-size:15px;cursor:pointer;transition:.15s;}
  .btn:disabled{opacity:.55;cursor:not-allowed;}
  .btn-line{background:#fff;color:var(--ink);border:1.5px solid var(--line);border-radius:9px;padding:9px 12px;font-family:inherit;font-size:13px;font-weight:700;cursor:pointer;transition:.15s;white-space:nowrap;text-align:center;}
  .btn-line:hover{border-color:var(--accent);color:var(--accent);}
  .btn-line:disabled{opacity:.5;cursor:not-allowed;}
  .btn-line input{display:none;}
  .proj-row{display:flex;gap:8px;margin-bottom:9px;} .proj-row > *{flex:1;}
  .actions{margin-top:auto;padding-top:6px;}
  .status{font-size:12px;font-weight:700;color:var(--muted);min-height:18px;margin-top:9px;text-align:center;}
  .status.err{color:var(--accent);}
  .bar{height:6px;background:var(--fill);border-radius:999px;overflow:hidden;margin-top:9px;}
  .bar i{display:block;height:100%;width:0;background:var(--accent);transition:width .2s;}
  .music-st{font-size:12px;color:var(--muted);margin-top:6px;min-height:16px;}
  /* critic report: one block per hearing; the kept one is marked */
  .critic{margin-top:8px;max-height:260px;overflow-y:auto;display:flex;flex-direction:column;gap:6px;}
  .crit{border:1px solid var(--line);border-radius:10px;padding:7px 9px;font-size:12px;line-height:1.6;color:var(--ink);background:var(--fill);}
  .crit.kept{border-color:var(--accent);box-shadow:inset 0 0 0 1px var(--accent);background:#fff;}
  .crit ul{margin:4px 0 0;padding-inline-start:18px;}
  audio{width:100%;height:34px;margin-top:6px;}

  /* preview */
  /* The screen is 899px tall in both kinds of work, 74px under the card's top:
     the size that fills the card of "إنشاء ريل" down to 95px above its bottom
     (a taller side column, as in a summary, only adds room below). Its width
     follows 9:16; on one column (phones) the width decides instead. */
  .pv{display:flex;flex-direction:column;align-items:center;gap:12px;padding-top:74px;padding-bottom:95px;}
  .screen{position:relative;flex:none;height:899px;aspect-ratio:9/16;max-width:100%;background:#111;border-radius:14px;overflow:hidden;}
  @media(max-width:900px){.pv{padding-top:22px;padding-bottom:22px;} .screen{flex:none;width:min(100%,360px,40.5vh);height:auto;min-height:0;}}   /* width first, so a narrow phone keeps 9:16 */
  .screen canvas{display:block;width:100%;height:100%;}
  .screen .empty{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;text-align:center;color:#aaa;font-size:14px;padding:30px;line-height:1.7;}
  .transport{display:flex;flex-direction:row-reverse;align-items:center;gap:10px;width:var(--sw,360px);max-width:100%;}   /* as wide as .screen (--sw, kept by app.js); reversed in RTL: play on its left edge, time on its right */
  .transport button{width:27px;height:27px;padding:0;border-radius:50%;border:none;background:var(--navy);color:#fff;font-size:11px;line-height:27px;cursor:pointer;flex:0 0 auto;}
  #rgPlay:not(.playing){padding-left:2px;}   /* nudges ▶ 1px right so it looks centred; ❚❚ stays put */
  /* Seek bar: a thin K50 grey line (K50 = #939598) running left to right from the
     play button; the played part fills up to --p, which app.js keeps in step with the playhead. */
  .transport input[type=range]{flex:1;direction:ltr;-webkit-appearance:none;appearance:none;height:3px;border-radius:999px;cursor:pointer;
    background:linear-gradient(to right,#939598 var(--p,0%),#dcdcde var(--p,0%));}
  .transport input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:12px;height:12px;border-radius:50%;background:#939598;border:none;}
  .transport input[type=range]::-moz-range-thumb{width:12px;height:12px;border-radius:50%;background:#939598;border:none;}
  .transport input[type=range]:focus{outline:none;}
  .transport input[type=range]:focus-visible{outline:2px solid #939598;outline-offset:4px;}
  .transport .t{font-size:12px;font-weight:700;color:var(--ink);direction:ltr;min-width:84px;text-align:right;font-variant-numeric:tabular-nums;}

  /* clip list */
  .clips-head{display:flex;justify-content:space-between;align-items:baseline;gap:10px;margin-bottom:12px;}
  .clips{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:14px;}
  .clip{border:1px solid var(--line);border-radius:14px;padding:10px;display:flex;flex-direction:column;gap:8px;background:#fff;min-width:0;}
  .clip.missing{border-style:dashed;background:var(--fill);}
  .clip .thumb{position:relative;aspect-ratio:9/16;border-radius:9px;overflow:hidden;background:#222;}
  .clip .thumb canvas{width:100%;height:100%;display:block;}
  .clip .num{position:absolute;top:6px;inset-inline-start:6px;background:rgba(0,0,0,.6);color:#fff;font-size:11px;font-weight:800;border-radius:999px;padding:1px 8px;}
  .clip .kind{position:absolute;bottom:6px;inset-inline-start:6px;background:rgba(0,0,0,.6);color:#fff;font-size:10px;font-weight:700;border-radius:6px;padding:1px 6px;direction:ltr;}
  .clip textarea{resize:none;height:56px;font-size:13px;line-height:1.5;}
  .clip label.l{font-size:11px;font-weight:700;color:var(--muted);display:block;margin-bottom:2px;}
  .clip input[type=number]{width:100%;border:1px solid var(--line);border-radius:8px;padding:6px 8px;font-family:inherit;font-size:13px;direction:ltr;}
  .clip .tools{display:flex;gap:5px;flex-wrap:wrap;}
  .clip .tools button{flex:1;border:1px solid var(--line);background:#fff;border-radius:8px;padding:5px 0;font-size:13px;cursor:pointer;color:var(--ink);}
  .clip .tools button:hover{border-color:var(--accent);color:var(--accent);}
  .chk{display:flex;align-items:center;gap:6px;font-size:12px;font-weight:700;color:var(--ink);cursor:pointer;}
  .chk input{accent-color:var(--navy);width:15px;height:15px;margin:0;}
  .btn-line.wide{width:100%;margin-top:6px;}
  #rgScript{resize:vertical;line-height:1.6;font-size:13px;}
  .lines{margin-top:8px;max-height:360px;overflow-y:auto;display:flex;flex-direction:column;gap:8px;padding-inline-end:2px;}
  .line{display:flex;gap:6px;align-items:flex-start;border:1px solid var(--line);border-radius:10px;padding:7px;background:var(--fill);}
  .line .n{flex:0 0 auto;width:20px;height:20px;border-radius:50%;background:var(--navy);color:#fff;font-size:11px;font-weight:800;display:flex;align-items:center;justify-content:center;margin-top:4px;}
  .line .f{flex:1;min-width:0;display:flex;flex-direction:column;gap:5px;}
  .line textarea{resize:none;font-size:13px;line-height:1.5;padding:6px 8px;}
  .line textarea.card-in{background:#ebeaf0;color:#105063;font-weight:700;}
  .line button{flex:0 0 auto;border:none;background:none;color:var(--muted);cursor:pointer;font-size:13px;padding:4px;}
  .line button:hover{color:var(--accent);}
  .line-tools{margin-top:6px;justify-content:space-between;}
  .clip.off{opacity:.5;}
  .tracks{display:flex;flex-direction:column;gap:6px;margin-bottom:8px;}
  .trk{display:flex;align-items:center;gap:8px;border:1px solid var(--line);border-radius:10px;padding:6px 8px;cursor:pointer;background:#fff;transition:.15s;}
  .trk:hover{border-color:var(--accent);}
  .trk.on{border-color:var(--accent);box-shadow:inset 0 0 0 1px var(--accent);}
  .trk button{width:26px;height:26px;border-radius:50%;border:none;background:var(--navy);color:#fff;font-size:10px;line-height:26px;padding:0;cursor:pointer;flex:0 0 auto;}
  .trk .nm{flex:1;min-width:0;font-size:12px;font-weight:700;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;direction:ltr;text-align:left;}
  .trk .ar{font-weight:500;color:var(--muted);}
  .trk .ok{flex:0 0 auto;font-size:12px;color:var(--accent);font-weight:900;}
  .clip[draggable="true"]{cursor:grab;}
  .clip.dragging{opacity:.35;}
  .clip.drop-before{box-shadow:inset -4px 0 0 var(--accent);}
  .clip.drop-after{box-shadow:inset 4px 0 0 var(--accent);}
  .clip.is-card{background:#f7f7fa;border-color:#c9d6dd;}
  .clips-head .row{gap:12px;}
  .no-clips{padding:26px;text-align:center;color:var(--muted);font-size:14px;border:2px dashed var(--line);border-radius:14px;}

  .gate{max-width:520px;margin:60px auto;text-align:center;}
  .gate p{font-size:15px;font-weight:700;color:var(--ink);}
  .foot{position:fixed;bottom:24px;left:0;right:0;z-index:-1;text-align:center;direction:ltr;font-size:11px;font-weight:500;color:#848484;padding:0 12px;pointer-events:none;}   /* z-index -1: fixed in place, behind anything that scrolls over it */
</style>
</head>
<body>

  <div class="topbar">
    <a class="back" href="../">→ المشاريع</a>
    <div class="brand"><h1>Reels Gen</h1><span class="beta">BETA</span></div>
  </div>

  <div class="wrap">
    <div class="card gate" id="rgGate"><p id="rgGateMsg">…جارٍ التحقّق من الصلاحية</p></div>

    <div id="rgApp" hidden style="display:grid;gap:18px">
      <div class="layout">
        <div class="card side">
          <div class="field">
            <div class="sec">نوع العمل</div>
            <select id="rgMode">
              <option value="create">إنشاء ريل</option>
              <option value="sum">تلخيص فيديو لريل</option>
            </select>
          </div>
          <div class="field">
            <div class="sec">اسم المشروع</div>
            <select id="rgProject">
              <option value="sz">Study Zone</option>
              <option value="leap">LEAP</option>
              <option value="disc" selected>DISC</option>
              <option value="cu">Children University</option>
            </select>
          </div>
          <div class="field">
            <div class="sec">الأسلوب</div>
            <select id="rgRecipe"></select>
            <div class="hint" id="rgStyleHint" style="margin-top:6px"></div>
          </div>
          <div class="field" id="rgSumField" hidden>
            <div class="sec">الفيديو الطويل <span class="hint">فيديو واحد يتلخّص بريل — بموسيقى، أو بصوته الأصلي بدونها</span></div>
            <label class="drop" id="rgLongDrop">
              <div class="t" id="rgLongName">اسحب الفيديو هنا أو اضغط للاختيار</div>
              <div class="h" id="rgLongInfo">MP4 · MOV · WEBM — المعالجة على جهازك، لا شيء يُرفع</div>
              <input type="file" id="rgLongFile" accept="video/*">
            </label>
            <select id="rgSumKind" style="margin-top:8px">
              <option value="shots">لقطات على الإيقاع — فعاليات وحركة</option>
              <option value="talk">كلام وأفكار كاملة — مقابلات وكلمات</option>
            </select>
            <div class="hint" id="rgSumKindHint" style="margin-top:4px"></div>
            <label class="chk" id="rgCriticRow" style="margin-top:6px"><input type="checkbox" id="rgCriticOn" checked> ناقد بيسمع الريل كمشاهد ويحسّنه (دقيقة زيادة تقريباً)</label>
            <div class="row" style="margin-top:8px">
              <select id="rgSumLen">
                <option value="30">ريل 30 ثانية</option>
                <option value="45">ريل 45 ثانية</option>
                <option value="60">ريل 60 ثانية</option>
              </select>
              <button type="button" class="btn-line" id="rgAnalyse" disabled>توليد</button>
            </div>
            <div class="bar" id="rgSumBar" hidden><i id="rgSumFill"></i></div>
            <div class="music-st" id="rgSumSt"></div>
            <div class="critic" id="rgCritic" hidden></div>
          </div>
          <div class="field" id="rgFilesField">
            <div class="sec">المواد <span class="hint">صور ومقاطع فيديو</span></div>
            <label class="drop" id="rgDrop">
              <div class="t">اسحب الصور والمقاطع هنا أو اضغط للاختيار</div>
              <div class="h">JPG · PNG · MP4 · MOV — المعالجة على جهازك، لا شيء يُرفع</div>
              <input type="file" id="rgFiles" accept="image/*,video/*" multiple>
            </label>
          </div>
          <!-- Hidden for now; the script/voiceover code still runs and comes back by removing "hidden". -->
          <div class="field" id="rgVoiceField" hidden>
            <div class="sec">السكريبت والتعليق الصوتي <span class="hint">ريل دقيقة · صوت مازن لاوند</span></div>
            <textarea id="rgScript" rows="5" placeholder="اكتب فكرة الريل أو السكريبت بكلماتك — الأداة بتصيغه بلهجة سورية بسيطة وبتطلّع منه نصوص الكروت"></textarea>
            <button type="button" class="btn-line wide" id="rgDraft">صياغة النص</button>
            <div class="lines" id="rgLines" hidden></div>
            <div class="row line-tools" id="rgLineTools" hidden>
              <button type="button" class="btn-line" id="rgAddLine">+ جملة</button>
              <span class="hint" id="rgLineStat"></span>
            </div>
            <button type="button" class="btn-line wide" id="rgVoiceGen" hidden>توليد التعليق الصوتي</button>
            <audio id="rgVoicePlayer" controls hidden></audio>
            <button type="button" class="btn-line wide" id="rgArrange" hidden>توزيع على اللقطات</button>
            <div class="music-st" id="rgVoiceSt"></div>
          </div>
          <div class="field">
            <div class="sec">الموسيقى <span class="hint">جاهزة للأسلوب — اضغط ▶ للاستماع، واضغط على المقطوعة لاستعمالها</span></div>
            <div class="tracks" id="rgTracks"><div class="hint">…جارٍ تحميل الموسيقى</div></div>
            <div class="hint" style="margin:2px 0 6px">أو ولّد موسيقى جديدة:</div>
            <div class="row">
              <select id="rgMood">
                <option value="hopeful">ملهمة ومتفائلة</option>
                <option value="warm">هادئة ودافئة (للمقابلات)</option>
                <option value="upbeat">حيوية ومرحة</option>
                <option value="energetic">حماسية شبابية</option>
                <option value="documentary">وثائقية هادئة</option>
                <option value="cinematic">سينمائية</option>
                <option value="nostalgic">حنين (لو-فاي)</option>
                <option value="playful">مرحة للأطفال</option>
                <option value="corporate">عملية خفيفة</option>
              </select>
              <button type="button" class="btn-line" id="rgGenMusic">توليد</button>
            </div>
            <div class="row" style="margin-top:6px">
              <label class="btn-line" style="flex:1">رفع ملف موسيقى<input type="file" id="rgMusicFile" accept="audio/*"></label>
              <button type="button" class="btn-line" id="rgNoMusic">بدون</button>
            </div>
            <audio id="rgMusicPlayer" controls hidden></audio>
            <label class="chk" style="margin-top:8px"><input type="checkbox" id="rgBeatSync" checked> قصّ اللقطات على إيقاع الموسيقى</label>
            <div class="music-st" id="rgMusicSt">لا موسيقى بعد — بدونها المقاطع بصوتها الأصلي</div>
          </div>
          <div class="actions">
            <div class="proj-row">
              <button type="button" class="btn-line" id="rgSave">حفظ مشروع</button>
              <label class="btn-line">فتح مشروع<input type="file" id="rgOpen" accept=".json,application/json"></label>
            </div>
            <button class="btn" id="rgExport" disabled>تصدير الفيديو MP4</button>
            <button type="button" class="btn-line wide" id="rgCover" title="اللقطة اللي تحت المؤشر بالمعاينة، بدون شعار ولا نص">حفظ صورة الغلاف (JPG)</button>
            <div class="bar" id="rgBar" hidden><i id="rgBarFill"></i></div>
            <div class="status" id="rgStatus"></div>
            <div style="text-align:center;margin-top:4px"><button type="button" class="btn-line" id="rgBench" style="border:none;font-size:11px;color:var(--muted);text-decoration:underline;padding:2px">اختبار سرعة الجهاز</button></div>
          </div>
        </div>

        <div class="card pv">
          <div class="screen">
            <canvas id="rgCanvas" width="540" height="960"></canvas>
            <div class="empty" id="rgEmpty">أضف صوراً أو مقاطع فيديو<br>لتظهر المعاينة هنا</div>
          </div>
          <div class="transport">
            <button type="button" id="rgPlay" title="تشغيل / إيقاف">▶</button>
            <input type="range" id="rgSeek" min="0" max="1000" value="0">
            <span class="t" id="rgTime">0:00 / 0:00</span>
          </div>
          <label class="chk"><input type="checkbox" id="rgGrid"> قصّ الغلاف بشبكة البروفايل (3:4)</label>
        </div>
      </div>

      <div class="card">
        <div class="clips-head">
          <div class="sec" style="margin:0">اللقطات <span class="hint" id="rgCount"></span></div>
          <div class="row"><span class="hint">كروت النص للجذب وللانتقال بين الأفكار فقط · اسحب أي لقطة أو كرت لتغيير الترتيب · «+ نص» يضيف كرتاً قبل اللقطة · ↻ تدوير · ⊘ استبعاد</span>
          <button type="button" class="btn-line" id="rgPick" title="بيفحص اللقطات على جهازك ويستبعد الضبابية والمتشابهة">اختيار أفضل اللقطات</button>
          <button type="button" class="btn-line" id="rgAddCard">+ كرت نص</button></div>
        </div>
        <div class="clips" id="rgClips"><div class="no-clips">لا لقطات بعد — ابدأ بإضافة المواد من اليمين</div></div>
      </div>
    </div>
  </div>

  <script src="vendor/mp4-muxer.js" defer></script>
  <script src="app.js" defer></script>

  <div class="foot">HC Generator, a project by Christian Hope Center. © 2026 All Rights Reserved.</div>
</body>
</html>
