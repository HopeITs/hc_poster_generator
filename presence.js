/* Presence, for the dashboard: while a page of HC Generator is shown, a beat
   to the Worker every minute saying which tool it is (POST /presence). A visit
   is one stretch of a page shown on screen: hiding or closing the tab ends it
   (sendBeacon, which carries the token in its body as it cannot set a
   header), and showing it again starts a new one, so time in a hidden tab
   never counts. A tool page names itself with data-tool on this script tag;
   the main page switches with hcPresence.tool(name) as its views change. */
(function () {
  "use strict";
  var WORKER = "https://studyzone-auth.ct-aleppo3.workers.dev", TOKEN_KEY = "sz_auth_token", BEAT = 60000;
  var me = document.currentScript, tool = (me && me.getAttribute("data-tool")) || null, visit = null;
  if (window.top !== window) return;   // a page inside another (Flipbook's preview): its host already reports

  function token() { try { return localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY); } catch (e) { return null; } }
  function newId() {
    var b = crypto.getRandomValues(new Uint8Array(12)), s = "";
    for (var i = 0; i < b.length; i++) s += (b[i] < 16 ? "0" : "") + b[i].toString(16);
    return s;
  }
  function beat() {
    var t = token(); if (!tool || !t || document.hidden) return;
    if (!visit) visit = newId();
    fetch(WORKER + "/presence", { method: "POST", headers: { "Authorization": "Bearer " + t, "Content-Type": "application/json" },
      body: JSON.stringify({ visit: visit, tool: tool }), keepalive: true }).catch(function () {});
  }
  function end() {
    var t = token(); if (!visit || !t) { visit = null; return; }
    var body = JSON.stringify({ visit: visit, tool: tool, end: true, token: t });
    visit = null;
    try { if (navigator.sendBeacon(WORKER + "/presence", new Blob([body], { type: "text/plain" }))) return; } catch (e) {}
    fetch(WORKER + "/presence", { method: "POST", body: body, keepalive: true }).catch(function () {});
  }

  setInterval(beat, BEAT);
  document.addEventListener("visibilitychange", function () { if (document.hidden) end(); else beat(); });
  window.addEventListener("pagehide", end);
  window.hcPresence = { tool: function (name) { if (name === tool) { beat(); return; } end(); tool = name; beat(); } };
  beat();
})();
