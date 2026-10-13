// Browser security tests (local Hardhat chain + local build only).
//   npm run e2e -- security
// A check named as the secure behaviour that FAILS marks a confirmed finding.
const { execFileSync } = require("child_process");
const fs = require("fs");
const http = require("http");
const path = require("path");
const { ethers } = require("ethers");
const { abi } = require("../web/src/contract.json");
const { createHarness, cspSafeContext, SHOTS } = require("./helpers");

const ALLOWANCE = ethers.parseEther("0.005");

/** A MetaMask stand-in that logs every request and can start on the wrong chain. */
function loggingShim(rpc, account, startChainHex) {
  return `(() => {
  const RPC = ${JSON.stringify(rpc)};
  window.__log = [];
  window.__delayMs = 0;
  let chainOverride = ${JSON.stringify(startChainHex || null)};
  const listeners = {};
  const provider = {
    isMetaMask: true,
    async request({ method, params }) {
      window.__log.push({ method, params: params || [], wrongChain: Boolean(chainOverride) });
      if (method === "eth_requestAccounts") { localStorage.setItem("shim:ok", "1"); return [${JSON.stringify(account)}]; }
      if (method === "eth_accounts") return localStorage.getItem("shim:ok") ? [${JSON.stringify(account)}] : [];
      if (method === "eth_chainId" && chainOverride) return chainOverride;
      if (method === "net_version" && chainOverride) return String(parseInt(chainOverride, 16));
      if (method === "wallet_switchEthereumChain") { chainOverride = null; (listeners.chainChanged || []).forEach((f) => f("0x7a69")); return null; }
      if (method === "wallet_addEthereumChain") return null;
      if (method === "eth_sendTransaction" && window.__delayMs) await new Promise((r) => setTimeout(r, window.__delayMs));
      // Simulates a front-runner who copies the pending create (same claim key) and lands first.
      if (method === "eth_sendTransaction" && window.__frontRunFrom) {
        const tx = params[0];
        await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: [{ from: window.__frontRunFrom, to: tx.to, data: tx.data, value: tx.value }] }) });
      }
      const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: params || [] }) });
      const j = await r.json();
      if (j.error) { const e = new Error(j.error.message); e.code = j.error.code; e.data = j.error.data; throw e; }
      // Simulates a wallet/relay that broadcasts the transaction but then reports an error (e.g. a timeout).
      if (method === "eth_sendTransaction" && window.__failAfterSend) { const e = new Error("Request timed out"); e.code = -32603; throw e; }
      return j.result;
    },
    on(ev, fn) { (listeners[ev] ||= []).push(fn); },
    removeListener() {},
  };
  const info = { uuid: "00000000-0000-4000-8000-0000000000aa", name: "MetaMask", rdns: "io.metamask", icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>" };
  window.__setChain = (hex) => { chainOverride = hex; (listeners.chainChanged || []).forEach((f) => f(hex)); };
  window.ethereum = provider;
  const announce = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info, provider }) }));
  window.addEventListener("eip6963:requestProvider", announce);
  announce();
})();`;
}

exports.run = async ({ app, rpc, contract, distDir }) => {
  const h = await createHarness({ rpc });
  const { browser, check, section, errors, connect, sendReady, call } = h;
  const provider = new ethers.JsonRpcProvider(rpc);
  const iface = new ethers.Interface(abi);
  const [senderAddr, , thirdAddr] = await h.accounts();
  const signer = await provider.getSigner(senderAddr);
  const lc = new ethers.Contract(contract, abi, signer);

  // Every network request from every page, to look for leaked secrets and third parties.
  const requests = [];
  const cspMessages = [];
  const watch = (page) => {
    page.on("request", (r) => requests.push({ url: r.url(), method: r.method(), headers: r.headers(), body: r.postData() || "" }));
    // Every CSP violation is reported on the console. frame-ancestors refusals are the framing test working.
    page.on("console", (m) => /Content Security Policy|Refused to (load|connect|execute|apply|frame)/i.test(m.text()) && !/frame-ancestors/i.test(m.text()) && cspMessages.push(m.text().slice(0, 200)));
  };
  const [, , , , , frontRunner] = await h.accounts();

  async function makeLink(amount = "1", note) {
    const w = ethers.Wallet.createRandom();
    const now = (await provider.getBlock("latest")).timestamp;
    await (await lc.create(w.address, now + 7 * 86400, ALLOWANCE, { value: ethers.parseEther(amount) + ALLOWANCE })).wait();
    const m = note == null ? "" : `&m=${encodeURIComponent(note)}`;
    return { w, id: w.address, url: `${app}claim/${w.address}#k=${w.privateKey.slice(2)}${m}` };
  }

  async function page(opts = {}) {
    const p = await h.newPage(opts);
    watch(p);
    return p;
  }

  async function shimPage({ account = senderAddr, startChain, viewport = { width: 1280, height: 900 } } = {}) {
    const ctx = cspSafeContext(await browser.newContext({ viewport }));
    await ctx.addInitScript(loggingShim(rpc, account, startChain));
    const p = await ctx.newPage();
    p.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    watch(p);
    return p;
  }

  try {
    // ------------------------------------------------------------------
    section("XSS and injection through the message (#m=)");
    const payloads = [
      `<img src=x onerror="window.__xss=1">`,
      `<script>window.__xss=1</script>`,
      `"><svg/onload=window.__xss=1>`,
      `javascript:window.__xss=1`,
      `<a href="javascript:window.__xss=1">claim here</a>`,
      `{{constructor.constructor('window.__xss=1')()}}`,
      `<iframe srcdoc="<script>parent.__xss=1</script>">`,
    ];
    const xssLink = await makeLink("1");
    let p = await page();
    for (const payload of payloads) {
      await p.goto(`${xssLink.url}&m=${encodeURIComponent(payload)}`);
      await p.waitForSelector("#claimNote", { timeout: 15000 });
      const rendered = await p.textContent("#claimNote blockquote");
      const injected = await p.evaluate(() => ({
        flag: window.__xss === 1,
        nodes: document.querySelectorAll("#claimNote img, #claimNote script, #claimNote svg, #claimNote iframe, #claimNote a").length,
      }));
      check(`payload rendered as inert text: ${payload.slice(0, 32)}`, rendered === payload && !injected.flag && injected.nodes === 0);
    }
    await p.goto(`${app}#k=${xssLink.w.privateKey.slice(2)}&m=${encodeURIComponent(payloads[0])}`);
    await p.waitForSelector("#claimNote", { timeout: 15000 });
    check("legacy /#k= link: payload inert after redirect", !(await p.evaluate(() => window.__xss === 1)) && new URL(p.url()).origin === new URL(app).origin);

    const bidi = "Thanks ‮gnp.exe‬ ​hidden​";
    await p.goto(`${xssLink.url}&m=${encodeURIComponent(bidi)}`);
    await p.waitForSelector("#claimNote");
    check("bidi / zero-width control characters are removed and the visible text kept (L-5)", (await p.textContent("#claimNote blockquote")) === "Thanks gnp.exe hidden");
    check("the claim page marks the message as unverified (L-5)", /aren't checked by LinkCash/.test(await p.textContent("#claimNote")));

    const long = "A".repeat(100000);
    const t0 = Date.now();
    await p.goto(`${xssLink.url}&m=${long}`);
    await p.waitForSelector("#claimNote", { timeout: 20000 });
    const shown = (await p.textContent("#claimNote blockquote")).length;
    console.log(`INFO  100,000-character message rendered ${shown} characters in ${Date.now() - t0} ms`);
    check("messages longer than the 140-character limit are cut on the claim page", shown <= 140, `rendered ${shown}`);

    // My links renders stored notes; same-origin data, but check the sink anyway.
    await p.evaluate((note) => {
      localStorage.setItem("linkcash:links", JSON.stringify([{ claimKey: "0x000000000000000000000000000000000000dEaD", privateKey: "0x" + "11".repeat(32), amount: "1000000000000000000", expiry: 4102444800, created: Date.now(), note }]));
    }, payloads[0]);
    await p.goto(`${app}links`);
    await p.waitForSelector(".link-item");
    check("stored note rendered as text on My links", !(await p.evaluate(() => window.__xss === 1)) && (await p.$(".link-item img")) === null);
    await p.evaluate(() => localStorage.removeItem("linkcash:links"));
    await p.context().close();

    // ------------------------------------------------------------------
    section("Malformed URLs, traversal and navigation");
    p = await page();
    const route = async (path) => {
      await p.goto(`${app}${path}`);
      await p.waitForTimeout(800);
      return { h1: ((await p.textContent("h1").catch(() => null)) || "").trim(), path: new URL(p.url()).pathname };
    };
    const routeErrors = [];
    p.on("pageerror", (e) => routeErrors.push(e.message));
    p.on("console", (m) => m.type() === "error" && routeErrors.push(m.text().split(/\r?\n/)[0]));
    let r = await route("claim/%E0%A4%A");
    check("malformed percent-encoding in /claim/ shows a page, not a blank screen", r.h1.length > 0, `h1="${r.h1}"`);
    r = await route("links/%");
    check("malformed percent-encoding in /links/ shows a page, not a blank screen", r.h1.length > 0, `h1="${r.h1}"`);
    console.log(`INFO  errors thrown by malformed URLs: ${[...new Set(routeErrors)].join(" | ")}`);
    for (const bad of ["/claim/%E0%A4%A", "/links/%"]) {
      await p.goto(app);
      await p.waitForSelector("h1");
      await p.evaluate((u) => {
        history.pushState(null, "", u);
        dispatchEvent(new PopStateEvent("popstate"));
      }, bad);
      await p.waitForTimeout(600);
      const h1 = ((await p.textContent("h1").catch(() => "")) || "").trim();
      check(`in-app navigation to ${bad} shows the 404 page instead of crashing (L-1)`, /doesn't exist/i.test(h1), `h1="${h1}"`);
    }
    r = await route("claim/..%2F..%2Fsend");
    check("encoded traversal in a claim ID is rejected", /isn't valid/i.test(r.h1), `h1="${r.h1}"`);
    r = await route("claim/0x0000000000000000000000000000000000000001/extra");
    check("extra path segments fall through to the 404 page", /doesn't exist/i.test(r.h1), `h1="${r.h1}"`);
    r = await route("links/javascript:alert(1)");
    check("javascript: as a link ID is treated as invalid", /isn't a valid link id/i.test(r.h1), `h1="${r.h1}"`);
    const other = await makeLink("1");
    await p.goto(`${app}claim/${xssLink.id}#k=${other.w.privateKey.slice(2)}`);
    await p.waitForTimeout(800);
    check("a secret from another link is rejected (ID/secret mismatch)", /isn't valid/i.test(await p.textContent("h1")));
    await p.goto(`${app}#k=${"zz".repeat(32)}`);
    await p.waitForTimeout(800);
    check("legacy link with a garbage secret is rejected", /isn't valid/i.test(await p.textContent("h1")));
    await p.goto(`${app}?next=https://evil.example/&redirect=https://evil.example/`);
    await p.waitForTimeout(500);
    check("no open redirect via query parameters", new URL(p.url()).origin === new URL(app).origin);

    // ------------------------------------------------------------------
    section("Query-string tampering");
    for (const bad of ["1e30", "-5", "<script>", "0.0000001", "NaN", "0x10"]) {
      await p.goto(`${app}send?amount=${encodeURIComponent(bad)}`);
      await p.waitForSelector('input[name="amount"]');
      check(`/send?amount=${bad} is not carried into the form`, (await p.inputValue('input[name="amount"]')) === "");
    }
    await p.goto(`${app}links/${other.id}?created=1`);
    await p.waitForTimeout(1500);
    check("?created=1 on a link this browser didn't create does not show the success banner", (await p.$("#createdBanner")) === null);
    await p.context().close();

    // ------------------------------------------------------------------
    section("Create: what is signed matches what is shown; wrong chain; double submit");
    p = await shimPage({ startChain: "0x1" });
    await p.goto(`${app}send?amount=12.5`);
    await p.click("#reviewBtn");
    await connect(p);
    await sendReady(p);
    const switchedOnConnect = (await p.evaluate(() => window.__log)).some((x) => x.method === "wallet_switchEthereumChain");
    console.log(`INFO  wallet starting on chain 1 was asked to switch while connecting: ${switchedOnConnect}`);
    await p.evaluate(() => window.__setChain("0x1"));
    await p.waitForTimeout(1500);
    const wrongChainShown = (await p.textContent(".send-aside")).includes("Different network");
    check("wallet on another network is flagged before paying", wrongChainShown);
    await p.click("#reviewBtn");
    await p.waitForSelector("#review[open]");
    const reviewText = await p.textContent("#review");
    await p.evaluate(() => (window.__delayMs = 1500));
    await p.dblclick("#confirmCreateBtn");
    await p.waitForURL(/\/links\/0x[0-9a-fA-F]{40}\?created=1/, { timeout: 30000 }).catch(() => {});
    const log = await p.evaluate(() => window.__log);
    const sends = log.filter((x) => x.method === "eth_sendTransaction");
    check("double-clicking Create sends exactly one transaction", sends.length === 1, `${sends.length} sent`);
    const switchIdx = log.map((x) => x.method).lastIndexOf("wallet_switchEthereumChain");
    const sendIdx = log.findIndex((x) => x.method === "eth_sendTransaction");
    check("after the user changes network, Create asks to switch back before sending", sends.length > 0 && sends.every((x) => !x.wrongChain) && switchIdx >= 0 && switchIdx < sendIdx);
    check("the wallet is never asked to sign a message or typed data", !log.some((x) => /^(personal_sign|eth_sign|eth_signTypedData)/.test(x.method)));
    if (sends[0]) {
      const tx = sends[0].params[0];
      const parsed = iface.parseTransaction({ data: tx.data, value: tx.value });
      const createdId = new URL(p.url()).pathname.split("/").pop();
      const stored = await p.evaluate(() => JSON.parse(localStorage.getItem("linkcash:links") || "[]"));
      check("transaction goes to the configured contract", tx.to.toLowerCase() === contract.toLowerCase());
      check("transaction calls create()", parsed.name === "create");
      check("value = shown amount + 0.005 allowance", BigInt(tx.value) === ethers.parseEther("12.5") + ALLOWANCE && reviewText.includes("12.50"));
      check("allowance argument = 0.005 USDC", parsed.args[2] === ALLOWANCE);
      check("claim key in the transaction = the link that was saved and opened", parsed.args[0].toLowerCase() === createdId.toLowerCase() && stored.some((s) => s.claimKey.toLowerCase() === createdId.toLowerCase()));
      const rec = stored.find((s) => s.claimKey.toLowerCase() === createdId.toLowerCase());
      check("saved key really controls the on-chain claim key", rec && new ethers.Wallet(rec.privateKey).address.toLowerCase() === createdId.toLowerCase());
      console.log("INFO  claim keys for open links are stored unencrypted in localStorage (linkcash:links → privateKey)");
    }
    await p.context().close();

    // ------------------------------------------------------------------
    section("Claim: recipient handling, duplicate clicks, secrets never leave the page");
    const claimLink = await makeLink("3", "Audit claim");
    p = await page({ wallet: thirdAddr });
    const before = requests.length;
    await p.goto(claimLink.url);
    await p.waitForSelector("#claimBtn");
    check("amount shown equals the on-chain amount", (await p.textContent("#claimAmount")) === "3.00" && (await lc.links(claimLink.id)).amount === ethers.parseEther("3"));
    await p.click('[data-mode="existing"]');
    // Since L-4 these are refused before anything is sent, so the Claim button is disabled.
    await p.fill('input[name="recipient"]', ethers.ZeroAddress);
    check("zero-address recipient is refused before sending (L-4)", (await p.isDisabled("#claimBtn")) && /zero address/i.test(await p.textContent("main")) && (await p.$("#claimSuccess")) === null);
    await p.fill('input[name="recipient"]', contract);
    check("the LinkCash contract as recipient is refused before sending (L-4)", (await p.isDisabled("#claimBtn")) && /LinkCash contract/i.test(await p.textContent("main")));
    // A contract that accepts payments: warned, but still allowed.
    const deployed = await (await signer.sendTransaction({ data: "0x6001600c60003960016000f300" })).wait();
    await p.fill('input[name="recipient"]', deployed.contractAddress);
    await p.waitForSelector("#contractWarning", { timeout: 10000 }).catch(() => {});
    check("a smart-contract recipient gets a warning but can still be chosen (L-4)", Boolean(await p.$("#contractWarning")) && !(await p.isDisabled("#claimBtn")));
    const badChecksum = thirdAddr.slice(0, 2) + thirdAddr.slice(2).split("").map((c, i) => (i % 2 ? c.toUpperCase() : c.toLowerCase())).join("");
    if (badChecksum !== ethers.getAddress(thirdAddr) && badChecksum.toLowerCase() !== badChecksum) {
      await p.fill('input[name="recipient"]', badChecksum);
      await p.locator('input[name="recipient"]').blur();
      check("mixed-case address with a bad checksum is rejected", await p.isDisabled("#claimBtn"));
    }
    await p.fill('input[name="recipient"]', claimLink.id);
    const warnsSelf = /own address|link's address|claim key/i.test(await p.textContent("main"));
    check("entering the link's own address as recipient is blocked or warned", warnsSelf || (await p.isDisabled("#claimBtn")));
    await p.click('[data-mode="new"]');
    await p.click("#genBtn");
    const phrase = (await p.locator(".phrase li").allTextContents()).join(" ");
    await p.check("#savedChk");
    await p.dblclick("#claimBtn");
    await p.waitForSelector("#claimSuccess", { timeout: 30000 });
    const nonce = await provider.getTransactionCount(claimLink.id);
    check("double-clicking Claim sends one claim transaction", nonce === 1, `claim key nonce ${nonce}`);
    const newAddr = (await p.textContent("#claimSuccess")).match(/0x[0-9a-fA-F]{4}…[0-9a-fA-F]{4}/)?.[0];
    const claimedTo = (await lc.queryFilter(lc.filters.LinkClaimed(claimLink.id)))[0]?.args.recipient;
    check("funds went to the wallet shown on screen", claimedTo && newAddr && claimedTo.startsWith(newAddr.slice(0, 6)) && claimedTo.endsWith(newAddr.slice(-4)));
    const keyHex = claimLink.w.privateKey.slice(2).toLowerCase();
    const leaked = requests.slice(before).filter((q) => (q.url + q.body + JSON.stringify(q.headers)).toLowerCase().includes(keyHex));
    check("the link secret never appears in any network request (URL, body or headers)", leaked.length === 0, leaked.map((q) => q.url).join(", "));
    const phraseLeak = requests.slice(before).filter((q) => (q.url + q.body).includes(phrase));
    check("the new wallet's recovery phrase never appears in any network request", phrase.split(" ").length === 12 && phraseLeak.length === 0);
    check("no request carries a Referer containing the # fragment", !requests.slice(before).some((q) => (q.headers.referer || "").includes("#")));
    const storageDump = await p.evaluate(async () => {
      const out = JSON.stringify(localStorage) + JSON.stringify(sessionStorage);
      const dbs = indexedDB.databases ? (await indexedDB.databases()).map((d) => d.name).join(",") : "";
      return out + dbs;
    });
    check("the claim page stores neither the link secret nor the recovery phrase", !storageDump.toLowerCase().includes(keyHex) && !storageDump.includes(phrase));
    check("error text never contains the secret", !((await p.textContent("main")) || "").toLowerCase().includes(keyHex));
    await p.context().close();

    // ------------------------------------------------------------------
    section("Dropped transaction while creating");
    p = await shimPage();
    await p.goto(`${app}send?amount=2`);
    await p.click("#reviewBtn");
    await connect(p);
    await sendReady(p);
    await call("evm_setAutomine", [false]);
    await p.click("#reviewBtn");
    await p.click("#confirmCreateBtn");
    await p.waitForFunction(() => window.__log.some((x) => x.method === "eth_sendTransaction"), null, { timeout: 15000 });
    await p.waitForTimeout(800);
    const pending = await call("eth_getBlockByNumber", ["pending", false]);
    for (const hsh of pending?.transactions || []) await call("hardhat_dropTransaction", [hsh]);
    await call("evm_mine");
    await call("evm_setAutomine", [true]);
    await p.waitForTimeout(4000);
    check("a dropped create never shows success", (await p.$("#createdBanner")) === null && new URL(p.url()).pathname === "/send");
    await p.goto(`${app}links`);
    await p.waitForFunction(() => document.querySelector(".link-item") && document.querySelector(".link-item").dataset.state !== "loading");
    const graceState = await p.getAttribute(".link-item", "data-state");
    check("within the grace period a dropped create shows as Confirming (L-3)", graceState === "confirming", `state=${graceState}`);
    // "Eventually": move the page clock past the 10-minute grace period.
    await p.clock.setFixedTime(new Date(Date.now() + 11 * 60 * 1000));
    await p.reload();
    await p.waitForSelector(".link-item");
    await p.waitForFunction(() => document.querySelector(".link-item")?.dataset.state !== "loading");
    const droppedState = await p.getAttribute(".link-item", "data-state");
    console.log(`INFO  dropped create shows in My links as "${droppedState}" after the grace period`);
    check("a dropped create can eventually be cleared from My links", ["failed", "notsent"].includes(droppedState) && Boolean(await p.$('.link-item button:has-text("Remove")')), `state=${droppedState}`);
    await p.context().close();

    // ------------------------------------------------------------------
    section("Wallet reports an error after the transaction was broadcast");
    p = await shimPage();
    await p.goto(`${app}send?amount=4`);
    await p.click("#reviewBtn");
    await connect(p);
    await sendReady(p);
    await p.evaluate(() => (window.__failAfterSend = true));
    await p.click("#reviewBtn");
    await p.click("#confirmCreateBtn");
    await p.waitForSelector("#createError", { timeout: 15000 }).catch(() => {});
    const sent = (await p.evaluate(() => window.__log)).find((x) => x.method === "eth_sendTransaction");
    if (sent) {
      const lost = iface.parseTransaction({ data: sent.params[0].data, value: sent.params[0].value }).args[0];
      await new Promise((res) => setTimeout(res, 1000));
      const funded = (await lc.links(lost)).sender !== ethers.ZeroAddress;
      const kept = (await p.evaluate(() => JSON.parse(localStorage.getItem("linkcash:links") || "[]"))).some((s) => s.claimKey.toLowerCase() === lost.toLowerCase());
      console.log(`INFO  after a post-broadcast wallet error: link funded on-chain=${funded}, key kept in this browser=${kept}`);
      check("if the wallet errors after broadcasting, the funded link's key is not deleted", !funded || kept);
      await p.waitForURL(/\/links\/0x/, { timeout: 15000 }).catch(() => {});
      check("the funded link is recovered from the chain and opened, not retried (M-1)", new URL(p.url()).pathname.toLowerCase() === `/links/${lost.toLowerCase()}`);
      const sendCount = (await p.evaluate(() => window.__log)).filter((x) => x.method === "eth_sendTransaction").length;
      check("no second transaction after the ambiguous error (M-1)", sendCount === 1, `${sendCount} sent`);
    } else check("post-broadcast error scenario ran", false, "no transaction was sent");
    await p.context().close();

    section("Wallet errors after broadcasting and the transaction is still pending (M-1)");
    p = await shimPage();
    await p.goto(`${app}send?amount=6`);
    await p.click("#reviewBtn");
    await connect(p);
    await sendReady(p);
    await call("evm_setAutomine", [false]);
    await p.evaluate(() => (window.__failAfterSend = true));
    await p.click("#reviewBtn");
    await p.click("#confirmCreateBtn");
    await p.waitForSelector("#createUnresolved", { timeout: 20000 }).catch(() => {});
    check("an unresolved create explains the situation (M-1)", /couldn't confirm/i.test((await p.textContent("#createUnresolved").catch(() => "")) || ""));
    check("no Try again after an unresolved create; Check its status instead (M-1)", (await p.$("#confirmCreateBtn")) === null && Boolean(await p.$("#checkStatusBtn")));
    const pendingSend = (await p.evaluate(() => window.__log)).find((x) => x.method === "eth_sendTransaction");
    const pendingKey = pendingSend && iface.parseTransaction({ data: pendingSend.params[0].data, value: pendingSend.params[0].value }).args[0];
    const storedPending = await p.evaluate(() => JSON.parse(localStorage.getItem("linkcash:links") || "[]"));
    check("the unresolved link's key is kept and marked unresolved (M-1)", storedPending.some((r) => r.claimKey.toLowerCase() === pendingKey?.toLowerCase() && r.unresolved === true && r.privateKey));
    await p.evaluate(() => (window.__failAfterSend = false));
    await p.goto(`${app}send`);
    await p.waitForSelector("h1");
    check("the send page warns about the unconfirmed link before another payment (M-1)", Boolean(await p.$("#unresolvedNotice")));
    await call("evm_mine");
    await call("evm_setAutomine", [true]);
    await p.goto(`${app}links`);
    await p.waitForFunction(() => document.querySelector(".link-item") && ![...document.querySelectorAll(".link-item")].some((x) => x.dataset.state === "loading"));
    const pendingRow = await p.evaluate((k) => [...document.querySelectorAll(".link-item")].find((x) => x.querySelector(`a[href$="${k}"]`))?.dataset.state, pendingKey);
    const reconciled = (await p.evaluate(() => JSON.parse(localStorage.getItem("linkcash:links") || "[]"))).find((r) => r.claimKey === pendingKey);
    check("once mined, My links resolves it from the chain as waiting (M-1)", pendingRow === "waiting" && reconciled?.unresolved === false && Boolean(reconciled?.txHash), `state=${pendingRow}`);
    await p.goto(`${app}send`);
    await p.waitForSelector("h1");
    check("the warning clears once the link is resolved (M-1)", (await p.$("#unresolvedNotice")) === null);
    await p.context().close();

    section("Claim key already used on-chain (L-7)");
    p = await shimPage();
    await p.goto(`${app}send?amount=7`);
    await p.click("#reviewBtn");
    await connect(p);
    await sendReady(p);
    await p.evaluate((a) => (window.__frontRunFrom = a), frontRunner);
    await p.click("#reviewBtn");
    await p.click("#confirmCreateBtn");
    await p.waitForSelector("#createError", { timeout: 20000 }).catch(() => {});
    check("a key conflict is explained and nothing is claimed to be locked (L-7)", /already used/i.test((await p.textContent("#createError").catch(() => "")) || ""));
    check("Try again is offered for a conflict (nothing of yours was locked) (L-7)", (await p.textContent("#confirmCreateBtn").catch(() => "")) === "Try again");
    const firstKey = iface.parseTransaction({ data: (await p.evaluate(() => window.__log)).find((x) => x.method === "eth_sendTransaction").params[0].data }).args[0];
    await p.evaluate(() => (window.__frontRunFrom = null));
    await p.click("#confirmCreateBtn");
    await p.waitForURL(/\/links\/0x[0-9a-fA-F]{40}\?created=1/, { timeout: 30000 }).catch(() => {});
    await p.waitForSelector("#createdBanner", { timeout: 15000 }).catch(() => {});
    const secondKey = new URL(p.url()).pathname.split("/").pop();
    check(
      "the retry uses a fresh key and succeeds (L-7)",
      /^0x[0-9a-fA-F]{40}$/.test(secondKey) && secondKey.toLowerCase() !== firstKey.toLowerCase() && Boolean(await p.$("#createdBanner")),
      `url=${new URL(p.url()).pathname} error=${(await p.textContent("#createError").catch(() => "")) || ""} unresolved=${(await p.textContent("#createUnresolved").catch(() => "")) || ""}`,
    );
    check("the conflicting key belongs to the front-runner, not the user (L-7)", (await lc.links(firstKey)).sender.toLowerCase() === frontRunner.toLowerCase());
    await p.goto(`${app}links`);
    await p.waitForFunction(() => document.querySelector(".link-item") && ![...document.querySelectorAll(".link-item")].some((x) => x.dataset.state === "loading"));
    const conflictRow = await p.evaluate((k) => [...document.querySelectorAll(".link-item")].find((x) => x.querySelector(`a[href$="${k}"]`)), firstKey);
    const conflictState = await p.evaluate((k) => [...document.querySelectorAll(".link-item")].find((x) => x.querySelector(`a[href$="${k}"]`))?.dataset.state, firstKey);
    check("My links shows the conflicting attempt as Not sent, removable (L-7)", conflictRow !== null && conflictState === "conflict");
    await p.context().close();

    // ------------------------------------------------------------------
    section("Browser hardening: headers, framing, third parties");
    const res = await fetch(app);
    const hdr = (n) => res.headers.get(n);
    const html = await res.text();
    console.log(`INFO  preview server headers: CSP=${hdr("content-security-policy")} XFO=${hdr("x-frame-options")} XCTO=${hdr("x-content-type-options")} Referrer-Policy=${hdr("referrer-policy")}`);
    check("a Content-Security-Policy is defined (header or meta)", Boolean(hdr("content-security-policy")) || /http-equiv=["']Content-Security-Policy/i.test(html));
    check("a Referrer-Policy is defined (header or meta)", Boolean(hdr("referrer-policy")) || /name=["']referrer/i.test(html));
    check("no inline event handlers in index.html", !/\son[a-z]+=/i.test(html));
    const metaCsp = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)?.[1] || "";
    const scriptSrc = (metaCsp.match(/script-src ([^;]+)/) || [])[1] || "";
    check("CSP script-src allows only this site: no unsafe-inline, unsafe-eval, data: or wildcards (M-2)", scriptSrc.trim() === "'self'", scriptSrc);
    check("CSP limits network access to this site and the chain RPC (M-2)", /connect-src 'self' http:\/\/127\.0\.0\.1:8545(;|$)/.test(metaCsp), metaCsp.match(/connect-src [^;]+/)?.[0]);
    check("built pages contain no inline scripts (M-2)", !/<script(?![^>]*\bsrc=)[^>]*>/i.test(html));
    check("host headers include frame-ancestors 'none' and X-Frame-Options (L-6)", /frame-ancestors 'none'/.test(hdr("content-security-policy") || "") && hdr("x-frame-options") === "DENY");
    check("no-referrer policy in the page and the headers (L-9)", /name="referrer" content="no-referrer"/.test(html) && hdr("referrer-policy") === "no-referrer");
    // The framing parent must not have a CSP of its own (our builds forbid framing anything).
    const parentServer = http.createServer((req, res) => res.end("<!doctype html><title>other site</title><body></body>")).listen(4192);
    const parent = "http://127.0.0.1:4192/";
    const frameApp = async (src, sandbox) => {
      const fp = await page();
      const errs = [];
      fp.on("pageerror", (e) => errs.push(e.message));
      await fp.goto(parent);
      await fp.evaluate(([s, sb]) => {
        const f = document.createElement("iframe");
        f.src = s;
        if (sb) f.setAttribute("sandbox", sb);
        f.width = "800";
        f.height = "600";
        document.body.prepend(f);
      }, [src, sandbox]);
      await fp.waitForTimeout(3000);
      const child = fp.frames().find((fr) => fr.url().startsWith(app));
      const len = child ? await child.evaluate(() => document.body.innerText.length).catch(() => -1) : -1;
      await fp.context().close();
      return { len, errs: [...new Set(errs)] };
    };
    const framedRes = await frameApp(`${app}claim/${other.id}`);
    check("the app refuses to load inside another site's frame (clickjacking)", framedRes.len <= 0, `parent ${new URL(parent).origin}, framed text length ${framedRes.len}`);
    // Hosts that can't send headers (GitHub Pages): the page itself refuses to show the app when framed.
    const plain = http
      .createServer((req, res) => {
        const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".woff": "font/woff" };
        let file = path.join(distDir, decodeURIComponent(new URL(req.url, "http://x").pathname));
        if (!file.startsWith(distDir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(distDir, "index.html");
        res.setHeader("Content-Type", types[path.extname(file)] || "application/octet-stream");
        fs.createReadStream(file).pipe(res);
      })
      .listen(4191);
    const plainApp = "http://localhost:4191/";
    const fb = await page();
    await fb.goto(plainApp);
    await fb.waitForSelector("h1", { timeout: 15000 }).catch(() => {});
    check("without security headers, the app still loads normally when not framed (L-6 fallback)", /send dollars/i.test((await fb.textContent("h1").catch(() => "")) || ""));
    await fb.goto(parent);
    await fb.evaluate((src) => {
      const f = document.createElement("iframe");
      f.src = src;
      f.width = "800";
      f.height = "600";
      document.body.prepend(f);
    }, plainApp);
    await fb.waitForTimeout(3000);
    const fbChild = fb.frames().find((fr) => fr.url().startsWith(plainApp));
    const fbText = fbChild ? await fbChild.evaluate(() => document.body.innerText.trim()).catch(() => "") : "";
    check("without security headers, a framed page shows only an 'open in its own window' link (L-6 fallback)", fbText === "Open LinkCash in its own window", JSON.stringify(fbText.slice(0, 60)));
    await fb.context().close();
    plain.close();
    parentServer.close();

    // Blocked browser storage (strict privacy settings): reading localStorage throws.
    const sp = await page();
    await sp.context().addInitScript(() => {
      for (const name of ["localStorage", "sessionStorage"])
        Object.defineProperty(window, name, {
          configurable: true,
          get() {
            throw new DOMException("Access is denied for this document.", "SecurityError");
          },
        });
    });
    const spErrors = [];
    sp.on("pageerror", (e) => spErrors.push(e.message));
    await sp.goto(app);
    await sp.waitForTimeout(2500);
    check("the app still renders when browser storage is blocked (L-2)", /send dollars/i.test((await sp.textContent("h1").catch(() => "")) || ""), spErrors.join(" | "));
    await sp.click('[data-testid="rk-connect-button"]').catch(() => {});
    await sp.waitForTimeout(800);
    check("the wallet picker still opens with storage blocked (L-2)", Boolean(await sp.$("[aria-modal]")), spErrors.join(" | "));
    await sp.context().close();

    const viteConfig = fs.readFileSync(path.join(__dirname, "..", "web", "vite.config.js"), "utf8");
    const bundle = fs.readdirSync(path.join(distDir, "assets")).filter((n) => n.endsWith(".js")).map((n) => fs.readFileSync(path.join(distDir, "assets", n), "utf8")).join("");
    check("the dev-only config write endpoint is gone from the config and the bundle (M-3)", !viteConfig.includes("__linkcash") && !/writeFileSync\([^)]*config\.js/.test(viteConfig) && !bundle.includes("__linkcash"));
    const ignored = (name) => {
      try {
        execFileSync("git", ["check-ignore", "-q", name], { cwd: path.join(__dirname, "..") });
        return true;
      } catch {
        return false;
      }
    };
    const secretNames = ["UTC--2026-01-01T00-00-00.0Z--abc", "secrets.json", "mnemonic.txt", "deployer.json", "wallet.keystore", ".env.production", "key.pem", "linkcash-wallet-abc123.txt"];
    check("secret file formats are git-ignored (L-12)", secretNames.every(ignored), secretNames.filter((n) => !ignored(n)).join(", "));
    const origin = new URL(app).origin;
    const third = [...new Set(requests.map((q) => new URL(q.url).host).filter((x) => !x.startsWith("localhost") && !x.startsWith("127.0.0.1") && x))];
    console.log(`INFO  third-party hosts contacted during these tests: ${third.join(", ") || "none"}`);
    check("no wallet-address lookups are sent to third parties (e.g. enhanced-provider.rainbow.me)", !third.some((x) => x.includes("rainbow.me")));
    check("only expected third parties contacted (Google Fonts)", third.every((x) => ["fonts.googleapis.com", "fonts.gstatic.com"].includes(x)), third.join(","));
    check("no third-party requests at all: fonts are self-hosted (L-10)", third.length === 0, third.join(","));
    check("no Content Security Policy violations in any flow (M-2)", cspMessages.length === 0, cspMessages.slice(0, 3).join(" | "));
    void origin;
  } catch (e) {
    check("unexpected error", false, e.message.split("\n")[0]);
  }
  console.log(`INFO  screenshots in ${SHOTS}`);
  check("no page errors", errors.filter((e) => e.startsWith("pageerror")).length === 0, errors.filter((e) => e.startsWith("pageerror")).slice(0, 3).join(" | "));
  return h.finish("Security");
};
