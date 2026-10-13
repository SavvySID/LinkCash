// Light/dark theme. The choice lives on <html data-theme>, which an inline
// script in index.html/deploy.html sets before first paint. A choice made with
// the switch is remembered; until then the theme follows the system setting.
import { useSyncExternalStore } from "react";

const KEY = "linkcash:theme";
const root = document.documentElement;
const media = typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : null;
const listeners = new Set();

function saved() {
  try {
    const t = localStorage.getItem(KEY);
    return t === "light" || t === "dark" ? t : null;
  } catch {
    return null;
  }
}

function apply(theme) {
  root.dataset.theme = theme;
  listeners.forEach((l) => l());
}

if (root.dataset.theme !== "light" && root.dataset.theme !== "dark") apply(saved() ?? (media?.matches ? "dark" : "light"));
media?.addEventListener?.("change", (e) => {
  if (!saved()) apply(e.matches ? "dark" : "light");
});

export const getTheme = () => (root.dataset.theme === "dark" ? "dark" : "light");

export function setTheme(theme) {
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    // Storage blocked: the switch still works for this visit.
  }
  apply(theme);
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const useTheme = () => useSyncExternalStore(subscribe, getTheme, () => "light");
