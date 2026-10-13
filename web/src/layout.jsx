// Site chrome shared by every page: navbar, footer, contract notice.
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useEffect, useState } from "react";
import { chain, CONTRACT_ADDRESS, REPO_URL } from "./config";
import { MoonIcon, SunIcon } from "./icons";
import { addressUrl } from "./linkcash";
import { Link, useLocation, withBase } from "./router";
import { setTheme, useTheme } from "./theme";

const NAV = [
  { to: "/", label: "Home" },
  { to: "/#how-it-works", label: "How it works" },
  { to: "/send", label: "Create link" },
  { to: "/links", label: "My links" },
];

function isActive(to, path) {
  if (to.includes("#")) return false;
  if (to === "/") return path === "/";
  return path === to || path.startsWith(`${to}/`);
}

export function Logo() {
  return (
    <Link className="logo" to="/" aria-label="LinkCash home">
      <svg viewBox="0 0 64 64" width="30" height="30" aria-hidden="true">
        <rect width="64" height="64" rx="16" fill="currentColor" />
        <path d="M27 37a9 9 0 0 0 12.7 0l7-7a9 9 0 0 0-12.7-12.7l-2 2" fill="none" stroke="#fff" strokeWidth="5" strokeLinecap="round" />
        <path d="M37 27a9 9 0 0 0-12.7 0l-7 7a9 9 0 0 0 12.7 12.7l2-2" fill="none" stroke="#fff" strokeWidth="5" strokeLinecap="round" />
      </svg>
      <span>LinkCash</span>
    </Link>
  );
}

export function Navbar() {
  const { path, hash } = useLocation();
  const [open, setOpen] = useState(false);
  const theme = useTheme();
  const dark = theme === "dark";
  const toggleTheme = () => setTheme(dark ? "light" : "dark");

  useEffect(() => setOpen(false), [path, hash]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const links = NAV.map((item) => (
    <Link key={item.to} to={item.to} className="nav-link" aria-current={isActive(item.to, path) ? "page" : undefined}>
      {item.label}
    </Link>
  ));

  return (
    <header className={path === "/" ? "navbar navbar-dark" : "navbar"}>
      <div className="container nav-inner">
        <Logo />
        <nav className="nav-links" aria-label="Main">
          {links}
        </nav>
        <div className="nav-actions">
          <button
            type="button"
            className="theme-toggle"
            aria-pressed={dark}
            aria-label="Dark mode"
            title={dark ? "Switch to light mode" : "Switch to dark mode"}
            onClick={toggleTheme}
          >
            {dark ? <SunIcon size={20} /> : <MoonIcon size={20} />}
          </button>
          <ConnectButton
            showBalance={false}
            chainStatus="icon"
            accountStatus={{ smallScreen: "avatar", largeScreen: "address" }}
            label="Connect wallet"
          />
          <Link to="/send" className="btn btn-primary btn-sm nav-cta">
            Send USDC
          </Link>
          <button
            type="button"
            className="menu-btn"
            aria-expanded={open}
            aria-controls="mobile-menu"
            aria-label={open ? "Close menu" : "Open menu"}
            onClick={() => setOpen((o) => !o)}
          >
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              {open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
            </svg>
          </button>
        </div>
      </div>
      {open && (
        <nav id="mobile-menu" className="mobile-menu" aria-label="Main">
          {links}
          <button type="button" className="menu-theme" role="switch" aria-checked={dark} onClick={toggleTheme}>
            Dark mode
            <span className="switch" aria-hidden="true" />
          </button>
          <Link to="/send" className="btn btn-primary btn-block">
            Send USDC
          </Link>
        </nav>
      )}
    </header>
  );
}

export function ContractNotice() {
  if (CONTRACT_ADDRESS) return null;
  return (
    <div className="contract-notice" role="status">
      <div className="container">
        <strong>Setup needed.</strong> No LinkCash contract is configured for {chain.name} yet, so payments are turned off.{" "}
        <a href={withBase("/deploy.html")}>Deploy the contract</a>
      </div>
    </div>
  );
}

/** Shown in place of app pages when no contract address is configured. */
export function NotConfigured({ what = "Payments" }) {
  return (
    <div className="panel problem">
      <h2>{what} aren't available yet</h2>
      <p className="hint">
        This copy of LinkCash doesn't have a contract address for {chain.name}, so it can't read or create payment links. If you run
        this site, deploy the contract and set its address in <code>src/config.js</code>.
      </p>
      <a className="btn btn-secondary" href={withBase("/deploy.html")}>
        Go to the deploy page
      </a>
    </div>
  );
}

export function Footer() {
  return (
    <footer className="site-footer">
      <div className="container footer-grid">
        <nav aria-label="Footer">
          <p className="footer-heading">Product</p>
          <Link to="/">Home</Link>
          <Link to="/#how-it-works">How it works</Link>
          <Link to="/send">Create link</Link>
          <Link to="/links">My links</Link>
          <Link to="/#faq">Common questions</Link>
        </nav>
        <div className="footer-col">
          <p className="footer-heading">Resources</p>
          <a href="https://www.arc.io" target="_blank" rel="noopener">
            Arc
          </a>
          <a href="https://docs.arc.io" target="_blank" rel="noopener">
            Arc docs
          </a>
          {CONTRACT_ADDRESS && (
            <a href={addressUrl(CONTRACT_ADDRESS)} target="_blank" rel="noopener">
              Contract on explorer
            </a>
          )}
          {REPO_URL && (
            <a href={REPO_URL} target="_blank" rel="noopener">
              Source code
            </a>
          )}
        </div>
        <div className="footer-col">
          <p className="footer-heading">For developers</p>
          <a href={withBase("/deploy.html")}>Deploy the contract</a>
        </div>
      </div>
      <div className="container footer-brand-row">
        <Logo />
        <p>Send USDC to anyone with a link, on {chain.name}.</p>
      </div>
      <div className="container footer-legal">
        <p>
          LinkCash is an independent, unaudited proof of concept. It isn't affiliated with or endorsed by Circle or Arc. Payments are
          final once claimed. Use small amounts, and keep your links and recovery phrases private. Nothing here is financial advice.
        </p>
      </div>
    </footer>
  );
}

export function Layout({ children, hideNotice }) {
  return (
    <div className="site">
      {/* Focus main without touching the URL fragment (claim links keep their secret there). */}
      <a
        className="skip-link"
        href="#main"
        onClick={(e) => {
          e.preventDefault();
          document.getElementById("main")?.focus();
        }}
      >
        Skip to content
      </a>
      <Navbar />
      {!hideNotice && <ContractNotice />}
      <main id="main" tabIndex={-1}>
        {children}
      </main>
      <Footer />
    </div>
  );
}
