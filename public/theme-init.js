// Applies the saved theme before the app draws, so there's no flash of the wrong colours.
(function () {
  var t = "system";
  try { t = localStorage.getItem("orbital.theme") || "system"; } catch (e) { /* storage blocked */ }
  var light = t === "light" || (t === "system" && window.matchMedia && matchMedia("(prefers-color-scheme: light)").matches);
  document.documentElement.classList.toggle("light", light);
})();
