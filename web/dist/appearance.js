// Apply before React and CSS load; theme.test.tsx checks provider parity.
(function () {
  var mode = "system";
  try {
    var stored = window.localStorage.getItem("mnemon-appearance");
    if (stored === "light" || stored === "dark") mode = stored;
  } catch (_) {}
  var dark = false;
  if (mode === "system") {
    try {
      dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    } catch (_) {}
  }
  var resolved = mode === "system" ? (dark ? "dark" : "light") : mode;
  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.colorScheme = resolved;
})();
