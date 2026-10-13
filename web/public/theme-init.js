// Runs before first paint and before any app code (loaded as a file so the
// CSP needs no inline scripts).
(function () {
  var root = document.documentElement;

  // When the browser blocks site storage (for example "block all cookies"),
  // merely reading window.localStorage throws, and some libraries don't guard
  // against that. Fall back to in-memory storage for this visit instead.
  ["localStorage", "sessionStorage"].forEach(function (name) {
    try {
      window[name].getItem("linkcash:probe");
    } catch (e) {
      var data = {};
      var memory = {
        getItem: function (k) {
          return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null;
        },
        setItem: function (k, v) {
          data[k] = String(v);
        },
        removeItem: function (k) {
          delete data[k];
        },
        clear: function () {
          data = {};
        },
        key: function (i) {
          return Object.keys(data)[i] || null;
        },
        get length() {
          return Object.keys(data).length;
        },
      };
      try {
        Object.defineProperty(window, name, { configurable: true, value: memory });
      } catch (e2) {}
    }
  });

  // Apply the saved light/dark choice, or the system setting.
  var theme;
  try {
    theme = localStorage.getItem("linkcash:theme");
  } catch (e) {}
  if (theme !== "light" && theme !== "dark") theme = window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  root.dataset.theme = theme;

  // Fallback for hosts that can't send `frame-ancestors`: when another site
  // frames this page, the app isn't shown (see mount.jsx).
  var framed = false;
  try {
    framed = window.top !== window.self && window.top.location.origin !== window.location.origin;
  } catch (e) {
    framed = true;
  }
  if (framed) root.setAttribute("data-framed", "");
})();
