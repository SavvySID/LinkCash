import { useEffect } from "react";
import { Layout } from "./layout";
import { legacyClaimPath } from "./linkcash";
import { mount } from "./mount";
import { ClaimPage } from "./pages/Claim";
import { Landing } from "./pages/Landing";
import { LinkDetailsPage } from "./pages/LinkDetails";
import { LinksPage } from "./pages/Links";
import { NotFound } from "./pages/NotFound";
import { SendPage } from "./pages/Send";
import { Providers } from "./providers";
import { matchRoute, navigate, Router, useLocation, useScrollOnNavigate } from "./router";
import "./style.css";

/*
 * Routes
 *   /                 landing page
 *   /send             create a payment link
 *   /links            the sender's links (this browser)
 *   /links/:id        one link's details; ?created=1 right after creating it
 *   /claim/:id        recipient claim page (secret + message in the #fragment)
 *   /deploy.html      separate deploy utility (its own entry point)
 * Older claim links (/#k=…) are redirected to /claim/:id.
 */
function routeFor({ path, hash }) {
  if (path === "/") return <Landing />;
  if (path === "/send") return <SendPage />;
  if (path === "/links") return <LinksPage />;
  let m;
  if ((m = matchRoute("/links/:id", path))) return <LinkDetailsPage key={m.id} id={m.id} />;
  if ((m = matchRoute("/claim/:id", path))) return <ClaimPage key={m.id + hash} id={m.id} hash={hash} />;
  return <NotFound />;
}

function App() {
  const loc = useLocation();
  useScrollOnNavigate(loc);
  const legacy = loc.path === "/" && new URLSearchParams(loc.hash.slice(1)).has("k");
  useEffect(() => {
    if (legacy) navigate(legacyClaimPath(loc.hash), { replace: true });
  }, [legacy, loc.hash]);

  const title = { "/": "LinkCash · Send dollars with a link", "/send": "Create a payment link · LinkCash", "/links": "My links · LinkCash" }[loc.path];
  useEffect(() => {
    document.title = title || (loc.path.startsWith("/claim/") ? "Claim your payment · LinkCash" : loc.path.startsWith("/links/") ? "Link details · LinkCash" : "Page not found · LinkCash");
  }, [loc.path, title]);

  if (legacy) return null;
  return <Layout>{routeFor(loc)}</Layout>;
}

mount(
  <Providers>
    <Router>
      <App />
    </Router>
  </Providers>,
);
