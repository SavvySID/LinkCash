import react from "@vitejs/plugin-react";
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import { defineConfig, loadEnv } from "vite";

// RPC endpoints the app talks to (keep in sync with src/config.js).
const RPC = { local: "http://127.0.0.1:8545", arc: "https://rpc.mainnet.arc.io" };

// Only needed if VITE_WALLETCONNECT_PROJECT_ID is set (hosts from Reown's CSP
// guidance). Not exercised by the tests: re-check them when enabling QR login.
const WALLETCONNECT = {
  connect: [
    "https://rpc.walletconnect.org",
    "https://rpc.walletconnect.com",
    "https://relay.walletconnect.org",
    "https://relay.walletconnect.com",
    "wss://relay.walletconnect.org",
    "wss://relay.walletconnect.com",
    "https://pulse.walletconnect.org",
    "https://api.web3modal.org",
    "https://keys.walletconnect.org",
  ],
  frame: ["https://verify.walletconnect.org", "https://verify.walletconnect.com"],
  img: ["https://walletconnect.org", "https://walletconnect.com", "https://secure.walletconnect.org"],
};

/** Content Security Policy for a build. Scripts only from this site; no inline scripts or eval. */
function contentSecurityPolicy(env) {
  const local = env.VITE_CHAIN === "local";
  const wc = Boolean(env.VITE_WALLETCONNECT_PROJECT_ID);
  const directives = {
    "default-src": ["'self'"],
    "script-src": ["'self'"],
    // RainbowKit writes its theme into a <style> element, so inline styles are
    // allowed. Inline and injected scripts are not.
    "style-src": ["'self'", "'unsafe-inline'"],
    "font-src": ["'self'"],
    "img-src": ["'self'", "data:", "blob:", ...(wc ? WALLETCONNECT.img : [])],
    "connect-src": ["'self'", local ? RPC.local : RPC.arc, ...(wc ? WALLETCONNECT.connect : [])],
    "frame-src": wc ? WALLETCONNECT.frame : ["'none'"],
    "worker-src": ["'none'"],
    "object-src": ["'none'"],
    "base-uri": ["'none'"],
    "form-action": ["'none'"],
    "manifest-src": ["'self'"],
  };
  const policy = Object.entries(directives).map(([name, values]) => `${name} ${values.join(" ")}`);
  if (!local) policy.push("upgrade-insecure-requests");
  return policy.join("; ");
}

/**
 * Response headers for hosts that support them (Netlify and Cloudflare Pages
 * read dist/_headers). A <meta> CSP can't set frame-ancestors, so framing
 * protection needs these headers; GitHub Pages can't send them.
 */
function headersFile(env) {
  const local = env.VITE_CHAIN === "local";
  const headers = [
    ["Content-Security-Policy", `${contentSecurityPolicy(env)}; frame-ancestors 'none'`],
    ["X-Frame-Options", "DENY"],
    ["X-Content-Type-Options", "nosniff"],
    ["Referrer-Policy", "no-referrer"],
    ["Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()"],
    ...(local ? [] : [["Strict-Transport-Security", "max-age=63072000; includeSubDomains"]]),
  ];
  return `/*\n${headers.map(([k, v]) => `  ${k}: ${v}`).join("\n")}\n`;
}

/** Puts the CSP into both HTML pages (build only: the dev server needs inline scripts) and writes dist/_headers. */
function securityPolicy(env) {
  let outDir;
  return {
    name: "linkcash-security-policy",
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    transformIndexHtml: {
      order: "pre",
      handler(html, ctx) {
        const tag = /<meta http-equiv="Content-Security-Policy" content="__LINKCASH_CSP__">\r?\n?/;
        if (!tag.test(html)) throw new Error(`${ctx.filename} is missing the CSP placeholder`);
        return ctx.server ? html.replace(tag, "") : html.replace(tag, (m) => m.replace("__LINKCASH_CSP__", contentSecurityPolicy(env)));
      },
    },
    closeBundle() {
      writeFileSync(resolve(outDir, "_headers"), headersFile(env));
    },
    // `vite preview` behaves like the production host: same headers, and the
    // SPA fallback page for paths it can't decode.
    configurePreviewServer(server) {
      const file = resolve(server.config.root, server.config.build.outDir, "_headers");
      const headers = existsSync(file)
        ? readFileSync(file, "utf8")
            .split("\n")
            .filter((l) => l.startsWith("  "))
            .map((l) => l.trim().split(/:\s(.*)/s).slice(0, 2))
        : [];
      server.middlewares.use((req, res, next) => {
        for (const [k, v] of headers) res.setHeader(k, v);
        try {
          decodeURI(req.url);
        } catch {
          res.statusCode = 404;
          res.setHeader("Content-Type", "text/html");
          const outDir = resolve(server.config.root, server.config.build.outDir);
          return res.end(readFileSync(resolve(outDir, existsSync(resolve(outDir, "404.html")) ? "404.html" : "index.html")));
        }
        next();
      });
    },
  };
}

// Static hosts serve real files only. Copying index.html to 404.html lets
// GitHub Pages hand deep links like /claim/0x… to the app (Netlify/Vercel:
// add a rewrite of /* to /index.html instead). Cloudflare Pages (which sets
// CF_PAGES=1 in its builds) skips the copy: without a 404.html it serves
// index.html for app routes with status 200, as a single-page app.
function spaFallback() {
  let outDir;
  return {
    name: "linkcash-spa-fallback",
    apply: "build",
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      if (process.env.CF_PAGES) return;
      copyFileSync(resolve(outDir, "index.html"), resolve(outDir, "404.html"));
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, __dirname, "VITE_"), ...process.env };
  return {
    plugins: [react(), securityPolicy(env), spaFallback()],
    // Absolute paths so nested routes (/claim/…) load their assets. For a
    // GitHub Pages project site, build with VITE_BASE=/<repo>/.
    base: process.env.VITE_BASE || "/",
    build: {
      rollupOptions: {
        input: {
          main: resolve(__dirname, "index.html"),
          deploy: resolve(__dirname, "deploy.html"),
        },
      },
    },
  };
});
