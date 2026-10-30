/* Flipbook — who may use it: the "flipbook" project; the Owner and the
   Comms Manager always. Shared by the tool page (app.js) and the viewer
   (viewer.js). No session sends the user to the projects page; a session
   without the tool rejects with "denied". */
(function () {
  "use strict";
  var WORKER = "https://studyzone-auth.ct-aleppo3.workers.dev";
  var TOKEN_KEY = "sz_auth_token", SLUG = "flipbook";

  function token() { try { return localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY); } catch (e) { return null; } }

  window.fbAccess = function () {
    var t = token();
    if (!t) { location.href = "../"; return Promise.reject(new Error("session")); }
    return fetch(WORKER + "/me", { headers: { "Authorization": "Bearer " + t } })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (r) {
        if (!r.ok || !r.d || !r.d.user) { location.href = "../"; throw new Error("session"); }
        var role = r.d.user.role, me = (r.d.projects || []).filter(function (p) { return p.slug === SLUG; })[0];
        if (role === "owner" || role === "comms") return;
        if (!me || me.status !== "ready") throw new Error("denied");
      });
  };
})();
