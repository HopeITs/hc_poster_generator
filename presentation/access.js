/* Presentation Maker — who may use it: the "presentation-maker" project;
   the Owner and the Comms Manager always. No session sends the user to the
   projects page; a session without the tool rejects with "denied". */
(function () {
  "use strict";
  var SLUG = "presentation-maker";
  // ../tool-access.js: at once from the kept answer, checked again behind
  window.pmAccess = function () { return hcToolAccess(SLUG, "pm"); };
})();
