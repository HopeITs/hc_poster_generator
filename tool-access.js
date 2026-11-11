/* Who may open a tool page, answered at once. The Worker's answer to /me (who
   is signed in and which tools they have) is kept beside the session token, by
   the projects page and by every tool page. A tool that answer allows shows
   straight away, and /me is asked again in the background: a session that has
   ended goes back to the projects page, a tool taken away closes with its
   message. With no answer kept yet, the tool waits for /me as before. The
   Worker still checks every request itself; this only decides what shows first.

   hcToolAccess(slug, prefix) resolves when the tool may show; prefix names the
   page's gate: <prefix>Gate, <prefix>GateMsg and <prefix>App. A refusal
   rejects with Error("denied") after writing the message.

   Also here, for every tool page: «→ المشاريع» (a link to ../) goes back in
   the browser's history when the projects page opened this one, so it comes
   back from the browser's memory instead of loading again. */
(function () {
  "use strict";
  var WORKER = "https://studyzone-auth.ct-aleppo3.workers.dev", TOKEN_KEY = "sz_auth_token", ME_KEY = "hc_me";
  var DENIED = "لا تملك صلاحية الوصول إلى هذه الأداة.";

  function where() { try { return localStorage.getItem(TOKEN_KEY) ? localStorage : sessionStorage.getItem(TOKEN_KEY) ? sessionStorage : null; } catch (e) { return null; } }
  function token() { var s = where(); return s ? s.getItem(TOKEN_KEY) : null; }
  // the answer belongs to this session only: it carries the end of its token
  function readMe(t) { try { var m = JSON.parse(where().getItem(ME_KEY) || "null"); return m && m.tk === t.slice(-16) ? m : null; } catch (e) { return null; } }
  function saveMe(t, d) { try { where().setItem(ME_KEY, JSON.stringify({ tk: t.slice(-16), user: d.user, projects: d.projects || [], project: d.project || null })); } catch (e) {} }
  function dropMe() { try { localStorage.removeItem(ME_KEY); sessionStorage.removeItem(ME_KEY); } catch (e) {} }
  function allows(m, slug) {
    var role = m.user && m.user.role;
    return role === "owner" || role === "comms" || (m.projects || []).some(function (p) { return p.slug === slug && p.status === "ready"; });
  }
  function $(id) { return document.getElementById(id); }
  function deny(prefix) {
    var g = $(prefix + "Gate"), a = $(prefix + "App"), m = $(prefix + "GateMsg");
    if (a) a.hidden = true; if (g) g.hidden = false; if (m) m.textContent = DENIED;
  }

  window.hcToolAccess = function (slug, prefix) {
    var t = token();
    if (!t) { location.href = "../"; return Promise.reject(new Error("session")); }
    var fresh = fetch(WORKER + "/me", { headers: { "Authorization": "Bearer " + t } })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (r) {
        if (!r.ok || !r.d || !r.d.user) { dropMe(); location.href = "../"; throw new Error("session"); }
        saveMe(t, r.d);
        if (!allows(r.d, slug)) { deny(prefix); throw new Error("denied"); }
      });
    var kept = readMe(t);
    if (kept && allows(kept, slug)) { fresh.catch(function () {}); return Promise.resolve(); }   // shown now; a refusal later closes it
    return fresh;
  };

  document.addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest('a[href="../"]');
    if (!a || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    var home = new URL("../", location.href), from;
    try { from = new URL(document.referrer); } catch (x) { return; }
    if (from.origin !== home.origin || from.pathname.replace(/index\.html$/, "") !== home.pathname || history.length < 2) return;
    e.preventDefault(); history.back();
  });
})();
