// Shared plumbing for the browser test suites (see run.js).
const { chromium } = require("playwright-core");
const fs = require("fs");
const path = require("path");

const SHOTS = path.join(__dirname, "screenshots");

const METAMASK = { name: "MetaMask", rdns: "io.metamask", uuid: "00000000-0000-4000-8000-000000000001" };
const TRUST = { name: "Trust Wallet", rdns: "com.trustwallet.app", uuid: "00000000-0000-4000-8000-000000000002" };

/**
 * Stand-in browser wallets backed by Hardhat's unlocked accounts. Each one
 * behaves like a freshly installed extension (no accounts until the site is
 * approved) and announces itself via EIP-6963. window.ethereum is set to the
 * first wallet, the way an extension that "takes over" the page would.
 * Test-only controls: window.__shim.delayMs delays transaction requests,
 * window.__shim.reject makes them fail as if the user clicked Reject.
 */
function walletShim(rpc, wallets) {
  return `(() => {
  const RPC = ${JSON.stringify(rpc)};
  window.__shim = { delayMs: 0, reject: false };
  const make = (w) => ({
    isMetaMask: w.rdns === "io.metamask",
    async request({ method, params }) {
      const key = "shim:ok:" + w.rdns;
      if (method === "eth_requestAccounts") { localStorage.setItem(key, "1"); return [w.account]; }
      if (method === "eth_accounts") return localStorage.getItem(key) ? [w.account] : [];
      if (method === "wallet_switchEthereumChain" || method === "wallet_addEthereumChain") return null;
      if (method === "eth_sendTransaction") {
        if (window.__shim.delayMs) await new Promise((r) => setTimeout(r, window.__shim.delayMs));
        if (window.__shim.reject) { const e = new Error("User rejected the request."); e.code = 4001; throw e; }
      }
      const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: params || [] }) });
      const j = await r.json();
      if (j.error) { const e = new Error(j.error.message); e.code = j.error.code; e.data = j.error.data; throw e; }
      return j.result;
    },
    on() {}, removeListener() {},
  });
  const providers = ${JSON.stringify(wallets)}.map((w) => ({
    info: { uuid: w.uuid, name: w.name, rdns: w.rdns, icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>" },
    provider: make(w),
  }));
  window.ethereum = providers[0].provider;
  const announce = () => providers.forEach((p) => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze(p) })));
  window.addEventListener("eip6963:requestProvider", announce);
  announce();
})();`;
}

/** Records navigator.share calls instead of opening the OS share sheet. */
const shareStub = `navigator.share = async (data) => { (window.__shared ||= []).push(data); };`;

/**
 * The site's Content Security Policy has no 'unsafe-eval', and Playwright's
 * page.waitForFunction compiles its predicate with eval inside the page, so it
 * is blocked. This polls with page.evaluate instead (it runs over the DevTools
 * protocol), keeping the CSP fully enforced during the tests.
 */
function cspSafeWaits(page) {
  page.waitForFunction = async (fn, arg, options = {}) => {
    const timeout = options.timeout ?? 30000;
    const until = Date.now() + timeout;
    for (;;) {
      const value = await page.evaluate(fn, arg).catch((e) => {
        if (/context was destroyed|navigat|Target closed/i.test(e.message)) return undefined;
        throw e;
      });
      if (value) return value;
      if (Date.now() > until) throw new Error(`waitForFunction: timed out after ${timeout} ms`);
      await page.waitForTimeout(100);
    }
  };
  return page;
}

/** New pages in this context (including ones a test opens later) get CSP-safe waits. */
function cspSafeContext(ctx) {
  ctx.on("page", cspSafeWaits);
  return ctx;
}

exports.METAMASK = METAMASK;
exports.TRUST = TRUST;
exports.SHOTS = SHOTS;
exports.cspSafeContext = cspSafeContext;

exports.createHarness = async ({ rpc }) => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const results = [];
  const errors = [];
  const browser = await chromium.launch({ channel: process.env.E2E_BROWSER || (process.platform === "win32" ? "msedge" : "chrome"), headless: true });

  const call = async (method, params = []) => {
    const j = await (await fetch(rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) })).json();
    if (j.error) throw new Error(JSON.stringify(j.error));
    return j.result;
  };

  return {
    browser,
    results,
    errors,
    call,
    balance: async (a) => Number(BigInt(await call("eth_getBalance", [a, "latest"]))) / 1e18,
    accounts: () => call("eth_accounts"),
    check(name, ok, extra = "") {
      results.push({ name, ok: Boolean(ok) });
      console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? `  (${extra})` : ""}`);
    },
    section: (name) => console.log(`\n— ${name}`),
    /**
     * wallet: address shorthand for a single MetaMask stand-in; wallets: [{ ...METAMASK, account }, …].
     * clockOffsetDays shifts the page's Date.now to match a time-travelled chain.
     */
    async newPage({ wallet, wallets, viewport = { width: 1280, height: 900 }, mobile = false, clockOffsetDays = 0, clipboard = false, share = false } = {}) {
      const ctx = cspSafeContext(await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile }));
      const list = wallets || (wallet ? [{ ...METAMASK, account: wallet }] : null);
      if (list) await ctx.addInitScript(walletShim(rpc, list));
      if (share) await ctx.addInitScript(shareStub);
      if (clipboard) await ctx.grantPermissions(["clipboard-read", "clipboard-write"]);
      const page = await ctx.newPage();
      if (clockOffsetDays) await page.clock.setFixedTime(Date.now() + clockOffsetDays * 86400000);
      page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
      page.on("console", (m) => m.type() === "error" && errors.push(`console: ${m.text()}`));
      return page;
    },
    connect: (page, name = "MetaMask") => page.locator("[aria-modal] button", { hasText: name }).first().click(),
    pathOf: (page) => new URL(page.url()).pathname,
    sendReady: (page) => page.waitForFunction(() => document.querySelector("#reviewBtn")?.textContent === "Review payment", null, { timeout: 15000 }),
    noOverflow: (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    async finish(label) {
      const failed = results.filter((r) => !r.ok).length;
      console.log(`\n${label}: ${results.length - failed}/${results.length} checks passed`);
      await browser.close();
      return { total: results.length, failed };
    },
  };
};
