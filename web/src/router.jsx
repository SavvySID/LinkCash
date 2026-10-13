// Minimal History API router: paths, params, <Link>, back/forward.
// Paths are app-relative ("/send"); the Vite base (e.g. "/LinkCash/" on
// GitHub Pages) is added and stripped here.
import { createContext, useContext, useEffect, useState } from "react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const NAV_EVENT = "linkcash:navigate";
let routerMounted = false;

export const withBase = (to) => BASE + to;

function readLocation() {
  const p = location.pathname;
  const path = (BASE && p.startsWith(BASE) ? p.slice(BASE.length) : p).replace(/\/+$/, "") || "/";
  return { path, search: location.search, hash: location.hash };
}

/** Navigate within the app. Falls back to a full page load on pages without a router (deploy.html). */
export function navigate(to, { replace = false } = {}) {
  if (!routerMounted) {
    location.href = withBase(to);
    return;
  }
  history[replace ? "replaceState" : "pushState"](null, "", withBase(to));
  window.dispatchEvent(new Event(NAV_EVENT));
}

const LocationContext = createContext(null);

export function Router({ children }) {
  const [loc, setLoc] = useState(readLocation);
  useEffect(() => {
    routerMounted = true;
    const update = () => setLoc(readLocation());
    window.addEventListener("popstate", update);
    window.addEventListener("hashchange", update);
    window.addEventListener(NAV_EVENT, update);
    return () => {
      routerMounted = false;
      window.removeEventListener("popstate", update);
      window.removeEventListener("hashchange", update);
      window.removeEventListener(NAV_EVENT, update);
    };
  }, []);
  return <LocationContext.Provider value={loc}>{children}</LocationContext.Provider>;
}

export const useLocation = () => useContext(LocationContext) ?? readLocation();

/** matchRoute("/claim/:id", "/claim/0xabc") → { id: "0xabc" } | null */
export function matchRoute(pattern, path) {
  const a = pattern.split("/");
  const b = path.split("/");
  if (a.length !== b.length) return null;
  const params = {};
  for (let i = 0; i < a.length; i++) {
    if (a[i].startsWith(":")) {
      try {
        params[a[i].slice(1)] = decodeURIComponent(b[i]);
      } catch {
        return null; // malformed percent-encoding
      }
    } else if (a[i] !== b[i]) return null;
  }
  return params;
}

export function Link({ to, onClick, ...props }) {
  return (
    <a
      href={withBase(to)}
      {...props}
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented || !routerMounted || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || props.target) return;
        e.preventDefault();
        navigate(to);
      }}
    />
  );
}

/** Scroll to the #section on navigation, otherwise to the top. */
export function useScrollOnNavigate(loc) {
  useEffect(() => {
    const id = loc.hash.slice(1);
    const el = id && !id.includes("=") ? document.getElementById(id) : null;
    if (el) el.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    else window.scrollTo(0, 0);
  }, [loc.path, loc.hash]);
}
