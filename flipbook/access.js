/* Flipbook — who may use it: the "flipbook" project; the Owner and the
   Comms Manager always. Shared by the tool page (app.js) and the viewer
   (viewer.js). No session sends the user to the projects page; a session
   without the tool rejects with "denied". */
(function () {
  "use strict";
  var SLUG = "flipbook";
  // ../tool-access.js: at once from the kept answer, checked again behind
  window.fbAccess = function () { return hcToolAccess(SLUG, "fb"); };
})();
