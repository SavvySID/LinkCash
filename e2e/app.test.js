// Site, routing and main-flow checks. Run through e2e/run.js (npm run e2e).
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { createHarness, SHOTS } = require("./helpers");

exports.run = async function run({ app, emptyApp, rpc, demoClaimUrl, distDir }) {
  const h = await createHarness({ rpc });
  const { call, balance, check, section, newPage, connect, pathOf, sendReady, noOverflow, errors } = h;
  const [sender, other] = await h.accounts();
  const phone = { viewport: { width: 390, height: 844 }, mobile: true };

  try {
    // ------------------------------------------------------------------
    section("Site without a contract configured");
    let p = await newPage();
    await p.goto(emptyApp);
    check("landing renders without a contract", (await p.textContent("h1")).includes("Send dollars to anyone with a link"));
    check("setup notice links to deploy page", (await p.getAttribute(".contract-notice a", "href")) === "/deploy.html");
    check("landing keeps How it works + FAQ", (await p.$("#how-it-works")) && (await p.$("#faq")));
    await p.goto(`${emptyApp}send`);
    check("/send explains payments are unavailable", (await p.textContent("main")).includes("aren't available yet"));
    await p.goto(`${emptyApp}claim/0x0000000000000000000000000000000000000001#k=00`);
    check("/claim shows unavailable notice instead of crashing", (await p.textContent("main")).includes("aren't available yet"));
    await p.goto(`${emptyApp}deploy.html`);
    check("deploy page still available", (await p.textContent("h1")) === "Deploy the contract");
    check("deploy page hides its own setup notice", (await p.$(".contract-notice")) === null);
    await p.context().close();

    // ------------------------------------------------------------------
    section("Landing page, navigation and routing");
    check("build includes 404.html fallback for static hosts", fs.existsSync(path.join(distDir, "404.html")));
    p = await newPage({ viewport: { width: 1440, height: 900 } });
    await p.goto(app);
    check("hero headline", (await p.textContent("h1")) === "Send dollars to anyone with a link");
    check("navbar has Home, How it works, Create link, My links", (await p.locator(".nav-links .nav-link").allTextContents()).join("|") === "Home|How it works|Create link|My links");
    check("Home is the active nav item", (await p.getAttribute('.nav-links a[aria-current="page"]', "href")) === "/");
    check("calculator, comparison, steps, link parts, benefits and FAQ render", (await p.$("#heroCalc")) && (await p.$$(".compare-list li")).length === 3 && (await p.$$(".steps-row li")).length === 3 && (await p.$$(".anatomy-key > div")).length === 4 && (await p.$$(".why-item")).length === 4 && (await p.$$(".faq details")).length >= 6);
    await p.fill("#heroCalc input", "12.5");
    check("calculator shows what the recipient gets", (await p.textContent("#heroOut")).trim() === "12.50");
    check("calculator shows the total fees", /≈ [\d.]+ USDC/.test(await p.textContent("#heroCalc .fact-value")));
    await p.click('.pill-toggle button:has-text("Ways to get it back")');
    check("ways toggle switches to getting money back", (await p.textContent("#ways-title")) === "Two ways to get it back");
    check("cost table lists the fees", (await p.$$(".cost-table tbody tr")).length === 5);
    check("live block number from the chain", /block [\d,]+/.test(await p.textContent("#chainLine")));
    await p.click('#heroCalc button[type="submit"]');
    await p.waitForURL((u) => u.pathname === "/send");
    check("calculator carries the amount to /send", (await p.inputValue('input[name="amount"]')) === "12.5");
    await p.goBack();
    await p.waitForURL((u) => u.pathname === "/");
    await p.screenshot({ path: `${SHOTS}/landing-1440.png`, fullPage: true });
    await p.click('.nav-links a:has-text("How it works")');
    await p.waitForFunction(() => location.hash === "#how-it-works");
    check("How it works link targets the section", true);
    await p.click(".faq summary >> nth=0");
    check("FAQ answers expand", await p.isVisible(".faq details[open] .faq-a"));
    const theme = () => p.getAttribute("html", "data-theme");
    check("light theme by default", (await theme()) === "light" && (await p.getAttribute(".theme-toggle", "aria-pressed")) === "false");
    await p.click(".theme-toggle");
    check("theme switch turns on dark mode", (await theme()) === "dark" && (await p.getAttribute(".theme-toggle", "aria-pressed")) === "true");
    await p.reload();
    check("dark mode is remembered after a reload", (await theme()) === "dark");
    await p.screenshot({ path: `${SHOTS}/landing-dark-1440.png`, fullPage: true });
    await p.click(".theme-toggle");
    check("theme switch returns to light mode", (await theme()) === "light");
    await p.click("#heroCreate");
    await p.waitForURL(`${app}send`);
    check("hero CTA navigates to /send", pathOf(p) === "/send");
    check("Create link is the active nav item", (await p.getAttribute('.nav-links a[aria-current="page"]', "href")) === "/send");
    await p.goBack();
    await p.waitForURL((u) => u.pathname === "/");
    check("browser Back returns to landing", (await p.textContent("h1")).startsWith("Send dollars"));
    await p.goForward();
    await p.waitForURL(`${app}send`);
    check("browser Forward returns to /send", (await p.textContent("h1")) === "Create a payment link");
    await p.click('.nav-links a:has-text("My links")');
    await p.waitForURL(`${app}links`);
    check("My links empty state", (await p.textContent("main")).includes("No payment links yet"));
    await p.goto(`${app}definitely-not-a-page`);
    check("unknown route shows designed 404", (await p.textContent("h1")) === "This page doesn't exist");
    await p.click('main a:has-text("Back to home")');
    await p.waitForURL((u) => u.pathname === "/");
    check("404 links back home", true);
    await p.context().close();

    p = await newPage(phone);
    await p.goto(app);
    check("mobile: desktop nav hidden, menu button shown", !(await p.isVisible(".nav-links")) && (await p.isVisible(".menu-btn")));
    await p.click(".menu-btn");
    check("mobile menu opens", (await p.getAttribute(".menu-btn", "aria-expanded")) === "true");
    await p.screenshot({ path: `${SHOTS}/menu-390.png` });
    await p.click("#mobile-menu .menu-theme");
    check("mobile menu has a dark mode switch", (await p.getAttribute("html", "data-theme")) === "dark" && (await p.getAttribute("#mobile-menu .menu-theme", "aria-checked")) === "true");
    await p.screenshot({ path: `${SHOTS}/menu-dark-390.png` });
    await p.click("#mobile-menu .menu-theme");
    check("mobile switch turns dark mode off", (await p.getAttribute("html", "data-theme")) === "light");
    await p.click('#mobile-menu a:has-text("My links")');
    await p.waitForURL(`${app}links`);
    check("mobile menu navigates and closes", (await p.$("#mobile-menu")) === null);
    await p.context().close();

    // ------------------------------------------------------------------
    section("Recipient: claim page");
    p = await newPage(phone);
    await p.goto(demoClaimUrl);
    await p.waitForSelector("#claimAmount");
    check("claim URL opens directly (/claim/:id#k=…)", pathOf(p).startsWith("/claim/0x"));
    check("amount read from chain", (await p.textContent("#claimAmount")) === "25.00");
    check("message comes from this link", (await p.textContent("#claimNote blockquote")) === "Lunch money");
    check("sender shown", (await p.textContent("#claimFrom")).includes("0xf39F"));
    check("explains the sender covered the fee", (await p.textContent(".details")).includes("the sender covered it"));
    check("polished without a wallet connected", (await p.textContent("header")).includes("Connect"));
    await p.screenshot({ path: `${SHOTS}/claim-390.png`, fullPage: true });
    await p.click("#genBtn");
    const newAddr = (await p.textContent("#newAddr")).trim();
    check("new wallet: 12-word phrase", (await p.$$(".phrase li")).length === 12);
    check("claim locked until backup confirmed", await p.isDisabled("#claimBtn"));
    await p.check("#savedChk");
    await p.click("#claimBtn");
    await p.waitForSelector("#claimSuccess", { timeout: 30000 });
    check("success only after confirmation; funds arrived", (await balance(newAddr)) === 25);
    check("explorer link to claim transaction", (await p.$('#claimSuccess a[href*="/tx/0x"]')) !== null);
    await p.reload();
    await p.waitForSelector("#claimStatus");
    check("refreshing a claimed link shows already-claimed", (await p.textContent("#claimStatus")).includes("already been claimed"));
    const legacyUrl = `${app}${new URL(demoClaimUrl).hash}`;
    await p.goto(legacyUrl);
    await p.waitForURL((u) => u.pathname.startsWith("/claim/0x"));
    check("old /#k=… links redirect to /claim/:id", (await p.textContent("#claimStatus")).includes("already been claimed"));
    await p.context().close();

    // ------------------------------------------------------------------
    section("Sender: create a link");
    const s = await newPage({ wallet: sender });
    await s.goto(`${app}send`);
    check("send page asks to connect", (await s.textContent("#reviewBtn")) === "Connect wallet to continue");
    await s.click("#reviewBtn");
    await connect(s);
    await s.waitForFunction(() => document.querySelector("#reviewBtn")?.textContent === "Review payment", null, { timeout: 15000 });
    check("wallet + network shown", (await s.textContent(".wallet-status")).includes("Hardhat (chain 31337)"));
    await s.click("#reviewBtn");
    check("validation: empty", (await s.textContent(".field-error")) === "Enter an amount.");
    const amountError = async (v) => {
      await s.fill('input[name="amount"]', v);
      return s.textContent(".field-error");
    };
    check("validation: negative", (await amountError("-5")) === "The amount can't be negative.");
    check("validation: zero", (await amountError("0")) === "Enter an amount greater than zero.");
    check("validation: not a number", (await amountError("abc")).includes("Enter a number"));
    check("validation: too many decimals", (await amountError("1.1234567")).includes("6 decimal places"));
    await s.fill('input[name="amount"]', "99999999");
    await s.waitForFunction(() => document.querySelector(".field-error")?.textContent.includes("Not enough USDC"));
    check("validation: more than the balance", true);
    await s.fill('input[name="amount"]', "12.5");
    const NOTE = "Rent share\nThanks!  🙏";
    await s.fill('textarea[name="note"]', NOTE);
    await s.check('input[name="expiry"][value="30"]');
    await s.waitForFunction(() => document.querySelector(".summary")?.textContent.includes("≈"), null, { timeout: 15000 });
    check("live network-fee estimate", true);
    await s.screenshot({ path: `${SHOTS}/send-1280.png`, fullPage: true });
    await s.click("#reviewBtn");
    await s.waitForSelector("#review[open]");
    check("review shows the exact message", (await s.textContent("#review .message-text")) === NOTE);
    await s.keyboard.press("Escape");
    await s.waitForSelector("#review:not([open])", { state: "attached" });
    check("Escape closes the review dialog", true);
    await s.click("#reviewBtn");
    await s.click("#confirmCreateBtn");
    await s.waitForSelector("#createdBanner", { timeout: 30000 });
    check("success view at /links/:id?created=1", /^\/links\/0x[0-9a-fA-F]{40}$/.test(pathOf(s)) && s.url().includes("created=1"));
    const link = await s.inputValue("#linkOut");
    check("share link uses /claim/:id#k=", /\/claim\/0x[0-9a-fA-F]{40}#k=[0-9a-f]{64}&m=/.test(link));
    check("success view shows exact message", (await s.textContent(".message-text")) === NOTE);
    check("QR code + copy button", (await s.$("#qrOut img")) && (await s.$("#copyLinkBtn")));
    check("creation transaction linked", (await s.$('a[href*="/tx/0x"]')) !== null);
    await s.screenshot({ path: `${SHOTS}/created-1280.png`, fullPage: true });
    await s.reload();
    await s.waitForSelector("#createdBanner");
    check("refreshing a nested route works", (await s.inputValue("#linkOut")) === link);
    await s.click('.nav-links a:has-text("My links")');
    await s.waitForSelector('#myLinks [data-state="waiting"]');
    check("dashboard lists the link as waiting", true);
    check("summary shows waiting total", (await s.textContent(".stat-grid")).includes("12.50 USDC"));

    // ------------------------------------------------------------------
    section("Recipient claims to an existing wallet");
    const c = await newPage(phone);
    await c.goto(link);
    await c.waitForSelector("#claimAmount");
    check("exact multi-line message", (await c.textContent("#claimNote blockquote")) === NOTE);
    await c.click('[data-mode="existing"]');
    await c.fill('input[name="recipient"]', "0x123");
    await c.locator('input[name="recipient"]').blur();
    check("invalid address explained", (await c.textContent(".field-error")).includes("doesn't look like a wallet address"));
    const before = await balance(other);
    await c.fill('input[name="recipient"]', other);
    await c.click("#claimBtn");
    await c.waitForSelector("#claimSuccess", { timeout: 30000 });
    check("existing wallet received 12.5 USDC", Math.abs((await balance(other)) - before - 12.5) < 1e-9);
    await c.context().close();
    await s.click("text=Refresh");
    await s.waitForSelector('#myLinks [data-state="claimed"]', { timeout: 15000 });
    check("dashboard updates to Claimed", true);
    await s.click('#myLinks [data-state="claimed"] button:has-text("Details")');
    await s.waitForSelector("text=Link details");
    check("details page shows who claimed it", (await s.textContent("main")).includes("Claimed by 0x7099"));
    check("details page links claim transaction", (await s.$('dd a[href*="/tx/0x"] >> nth=1')) !== null);

    // ------------------------------------------------------------------
    section("Take back an unclaimed link");
    await s.goto(`${app}send`);
    await sendReady(s);
    await s.fill('input[name="amount"]', "3");
    await s.click("#reviewBtn");
    check("no message row when message is empty", !(await s.textContent("#review")).includes("Your message"));
    await s.click("#confirmCreateBtn");
    await s.waitForSelector("#createdBanner", { timeout: 30000 });
    const link3 = await s.inputValue("#linkOut");
    check("no message section when empty", (await s.$(".message-text")) === null);
    check("link carries no message param", !link3.includes("m="));
    const c3 = await newPage(phone);
    await c3.goto(link3);
    await c3.waitForSelector("#claimAmount");
    check("another link's message is never shown", (await c3.$("#claimNote")) === null);
    await s.goto(`${app}links`);
    await s.click('#myLinks [data-state="waiting"] button:has-text("Take back")');
    await s.waitForSelector("#reclaim[open]");
    const senderBefore = await balance(sender);
    await s.click("#confirmReclaimBtn");
    await s.waitForSelector("#linksNotice.alert-success", { timeout: 30000 });
    check("money returned to the sender", (await balance(sender)) - senderBefore > 2.999);
    await s.waitForSelector('#myLinks [data-state="reclaimed"]', { timeout: 15000 });
    check("row shows Taken back", true);
    await c3.reload();
    await c3.waitForSelector("#claimStatus");
    check("recipient sees the sender took it back", (await c3.textContent("#claimStatus")).includes("took this payment back"));
    await c3.context().close();
    await s.fill('input[type="search"]', "12.5");
    check("search filters the list", (await s.$$("#myLinks .link-item")).length === 1);
    await s.fill('input[type="search"]', "");
    await s.click('.filter-chips button:has-text("Taken back")');
    check("status filter works", (await s.$$("#myLinks .link-item")).length === 1);
    await s.screenshot({ path: `${SHOTS}/links-1280.png`, fullPage: true });

    // ------------------------------------------------------------------
    section("Bad links and error states");
    const b = await newPage(phone);
    await b.goto(`${app}claim/not-an-address#k=00`);
    await b.waitForSelector("#claimStatus");
    check("invalid link ID", (await b.textContent("#claimStatus h1")) === "This link isn't valid");
    const someKey = "0x" + crypto.randomBytes(32).toString("hex");
    const id = new URL(demoClaimUrl).pathname.split("/").pop();
    await b.goto(`${app}claim/${id}#k=${someKey.slice(2)}`);
    await b.waitForSelector("#claimStatus");
    check("secret that doesn't match the ID is rejected", (await b.textContent("#claimStatus h1")) === "This link isn't valid");
    await b.goto(`${app}claim/0x${crypto.randomBytes(20).toString("hex")}`);
    await b.waitForSelector("#claimStatus");
    check("unknown payment", (await b.textContent("#claimStatus h1")) === "We couldn't find this payment");
    await b.goto(`${app}links/0x1234`);
    check("invalid details ID", (await b.textContent("main h1")) === "That isn't a valid link ID");
    await b.context().close();

    // ------------------------------------------------------------------
    section("Link fee allowance used up → recipient's wallet pays (relayed claim)");
    const z = await newPage({ wallet: sender });
    await z.route("**/assets/*.js", async (route) => {
      const body = await (await route.fetch()).text();
      route.fulfill({ body: body.replace(/(\b[\w$]{1,3})="0\.005"/, '$1="0"'), contentType: "application/javascript" });
    });
    await z.goto(`${app}send`);
    await z.click("#reviewBtn");
    await connect(z);
    await z.waitForFunction(() => document.querySelector("#reviewBtn")?.textContent === "Review payment", null, { timeout: 15000 });
    await z.fill('input[name="amount"]', "4");
    await z.click("#reviewBtn");
    await z.click("#confirmCreateBtn");
    await z.waitForSelector("#createdBanner", { timeout: 30000 });
    const noGas = await z.inputValue("#linkOut");
    await z.goto(noGas);
    await z.waitForSelector("#claimAmount");
    check("explains the wallet pays the fee", (await z.textContent(".details")).includes("Paid by your wallet"));
    const fresh = "0x" + crypto.randomBytes(20).toString("hex");
    await z.click('[data-mode="existing"]');
    await z.fill('input[name="recipient"]', fresh);
    await z.click("#claimBtn");
    await z.waitForSelector("#claimSuccess", { timeout: 30000 });
    check("relayed claim delivered", (await balance(fresh)) === 4);
    await z.context().close();

    // ------------------------------------------------------------------
    section("Refund after expiry from another browser (no link key)");
    await s.goto(`${app}send`);
    await sendReady(s);
    await s.fill('input[name="amount"]', "2");
    await s.check('input[name="expiry"][value="1"]');
    await s.click("#reviewBtn");
    await s.click("#confirmCreateBtn");
    await s.waitForSelector("#createdBanner", { timeout: 30000 });
    const expiringId = pathOf(s).split("/").pop();
    await call("evm_increaseTime", [2 * 86400]);
    await call("evm_mine");
    const r = await newPage({ wallet: sender, clockOffsetDays: 2 });
    await r.goto(`${app}links/${expiringId}`);
    await r.waitForSelector("text=isn't saved in this browser");
    check("details work without the sender's local data", (await r.textContent(".badge")).includes("Expired"));
    check("asks for the sending wallet", (await r.textContent("main")).includes("Connect the wallet that created this link"));
    await r.click("header button:has-text('Connect')");
    await connect(r);
    await r.waitForSelector("#refundBtn", { timeout: 15000 });
    const beforeRefund = await balance(sender);
    await r.click("#refundBtn");
    await r.click("#confirmRefundBtn");
    await r.waitForSelector("#detailsNotice.alert-success", { timeout: 30000 });
    check("contract refund returned the money", (await balance(sender)) - beforeRefund > 1.99);
    await r.waitForSelector(".badge:has-text('Refunded')", { timeout: 15000 });
    check("status becomes Refunded", true);
    await r.context().close();

    // ------------------------------------------------------------------
    section("Deploy utility");
    const d = await newPage({ wallet: sender });
    await d.goto(`${app}deploy.html`);
    check("deploy page uses the shared navbar", (await d.$(".navbar .logo")) !== null);
    // Simulate a browser blocker (e.g. Brave Shields) stopping the page's own
    // chain reads. The wallet still works, so Deploy must stay disabled: the
    // page couldn't confirm the deployment or record the address.
    let blockReads = true;
    const errorsBefore = errors.length;
    await d.route("**/*", (route) => {
      const req = route.request();
      const isRead = req.method() === "POST" && req.url().startsWith(rpc) && /eth_getBalance|eth_estimateGas|eth_gasPrice/.test(req.postData() || "");
      return blockReads && isRead ? route.abort() : route.continue();
    });
    await d.click("#deployBtn");
    await connect(d);
    await d.waitForSelector("#readError", { timeout: 30000 });
    check("blocked RPC: error names the RPC host and blockers", /127\.0\.0\.1:8545/.test(await d.textContent("#readError")) && (await d.textContent("#readError")).includes("Brave Shields"));
    check("blocked RPC: Deploy stays disabled", await d.isDisabled("#deployBtn"));
    blockReads = false;
    await d.click("#readError button");
    errors.splice(errorsBefore); // the deliberately blocked requests log "Failed to load resource"
    await d.waitForSelector("#balanceLine", { timeout: 15000 });
    check("after Try again, the error clears", (await d.$("#readError")) === null);
    const ws = await d.textContent(".wallet-status");
    check("deploy page shows the connected wallet", ws.toLowerCase().includes(sender.slice(0, 6).toLowerCase()));
    check("deploy page shows the network and chain ID", ws.includes("Hardhat (chain 31337)"));
    await d.waitForFunction(() => /USDC$/.test(document.querySelector(".wallet-status > div:nth-child(3) > :last-child")?.textContent || ""));
    check("deploy page shows the wallet's USDC balance", true);
    check("deploy page shows balance and estimated cost before deploying", /Your USDC on Hardhat: [\d,.]+\. Estimated deployment cost: [\d.]+ USDC/.test(await d.textContent("#balanceLine")));
    await d.waitForFunction(() => document.querySelector("#deployBtn")?.textContent === "Deploy" && !document.querySelector("#deployBtn").disabled);
    await d.click("#deployBtn");
    await d.waitForSelector("#deployed", { timeout: 30000 });
    const deployedAt = (await d.textContent("#deployed")).match(/0x[0-9a-fA-F]{40}/)[0];
    check("deploys a contract with code", (await call("eth_getCode", [deployedAt, "latest"])).length > 1000);
    await d.context().close();

    // ------------------------------------------------------------------
    section("Responsive layouts (no horizontal overflow)");
    const detailsUrl = `${app}links/${expiringId}`;
    for (const width of [1440, 768, 390, 375]) {
      const v = await newPage({ wallet: sender, viewport: { width, height: 900 }, mobile: width < 600 });
      for (const [name, url] of [["landing", app], ["send", `${app}send`], ["links", `${app}links`], ["claim", demoClaimUrl], ["details", detailsUrl]]) {
        await v.goto(url);
        await v.waitForSelector("main h1, main .card", { timeout: 15000 });
        await v.waitForTimeout(700);
        check(`${width}px ${name}`, await noOverflow(v));
        if (name === "landing" || name === "claim") await v.screenshot({ path: `${SHOTS}/${name}-${width}.png`, fullPage: true });
      }
      await v.context().close();
    }
    await s.context().close();
  } catch (e) {
    check("unexpected error", false, e.message.split("\n")[0]);
  } finally {
    check("no page or console errors", errors.length === 0, errors.slice(0, 3).join(" | "));
  }
  return h.finish("Site and main flows");
};
