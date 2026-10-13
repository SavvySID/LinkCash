// Shared entry point for index.html and deploy.html.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// Fonts are bundled with the site, so pages make no third-party requests.
import "@fontsource-variable/archivo/wdth.css";
import "@fontsource-variable/inter/wght.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";

/** Renders the app, unless another site has framed the page (theme-init.js sets data-framed). */
export function mount(app) {
  const root = createRoot(document.getElementById("root"));
  if (document.documentElement.hasAttribute("data-framed")) {
    root.render(
      <p className="framed-notice">
        <a href={location.href} target="_top" rel="noopener noreferrer">
          Open LinkCash in its own window
        </a>
      </p>,
    );
    return;
  }
  root.render(<StrictMode>{app}</StrictMode>);
}
