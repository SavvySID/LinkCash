// Audit checks: wallet selection, pending/failed transactions, success only
// after confirmation, message handling, malformed links, expiry, mobile, and
// the contract's own view of every outcome. Run through e2e/run.js.
const { Interface, zeroPadValue } = require("ethers");
const { abi } = require("../web/src/contract.json");
const { createHarness, METAMASK, TRUST, SHOTS } = require("./helpers");

const iface = new Interface(abi);
const short = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`.toLowerCase();
/** Case-insensitive "text shows this short address" (the UI shows checksummed addresses). */
const shows = (text, address) => (text || "").toLowerCase().includes(short(address));
const storedLinks = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("linkcash:links") || "[]"));

exports.run = async function run({ app, rpc, contract }) {
  const h = await createHarness({ rpc });
  const { call, balance, check, section, newPage, connect, pathOf, sendReady, noOverflow, errors } = h;
  const [sender, other, third] = await h.accounts();
  const phone = { viewport: { width: 390, height: 844 }, mobile: true };

  // The contract's own view of a link, independent of the UI.
  const onChain = async (id) => {
    const out = await call("eth_call", [{ to: contract, data: iface.encodeFunctionData("links", [id]) }, "latest"]);
    const [linkSender, expiry, settled, amount] = iface.decodeFunctionResult("links", out);
    return { sender: linkSender, expiry: Number(expiry), settled, amount };
  };
  const outcomeOf = async (id) => {
    for (const name of ["LinkClaimed", "LinkRefunded"]) {
      const logs = await call("eth_getLogs", [{ address: contract, fromBlock: "0x0", topics: [iface.getEvent(name).topicHash, zeroPadValue(id, 32)] }]);
      if (logs.length) return { event: name, ...iface.parseLog(logs[0]).args.toObject() };
    }
    return null;
  };
  const automine = (on) => call("evm_setAutomine", [on]);

  async function createVia(page, { amount, days = 7, note = "" }) {
    await page.goto(`${app}send`);
    await sendReady(page);
    await page.fill('input[name="amount"]', amount);
    if (note) await page.fill('textarea[name="note"]', note);
    await page.check(`input[name="expiry"][value="${days}"]`);
    await page.click("#reviewBtn");
    await page.click("#confirmCreateBtn");
    await page.waitForSelector("#createdBanner", { timeout: 30000 });
    return { link: await page.inputValue("#linkOut"), id: pathOf(page).split("/").pop() };
  }

  try {
    // ------------------------------------------------------------------
    section("Wallet selection with two extensions installed");
    // Trust Wallet owns window.ethereum here, the situation that originally hijacked the connect button.
    const w = await newPage({ wallets: [{ ...TRUST, account: third }, { ...METAMASK, account: sender }] });
    await w.goto(`${app}send`);
    await w.click("#reviewBtn");
    await w.waitForSelector("text=Connect a Wallet");
    const modal = await w.textContent("[aria-modal]");
    check("picker lists both installed wallets", modal.includes("MetaMask") && modal.includes("Trust Wallet"));
    await w.waitForTimeout(400);
    await w.screenshot({ path: `${SHOTS}/audit-wallet-picker.png` });
    await connect(w, "MetaMask");
    await sendReady(w);
    const mmText = await w.textContent(".wallet-status");
    check("choosing MetaMask connects MetaMask's account", shows(mmText, sender) && !shows(mmText, third), mmText);
    await w.click('[data-testid="rk-account-button"]');
    await w.click('[data-testid="rk-disconnect-button"]');
    await w.waitForFunction(() => document.querySelector("#reviewBtn")?.textContent === "Connect wallet to continue");
    check("disconnect returns to the connect state", true);
    await w.click("#reviewBtn");
    await connect(w, "Trust Wallet");
    await sendReady(w);
    const trustText = await w.textContent(".wallet-status");
    check("choosing Trust Wallet connects Trust's account", shows(trustText, third) && !shows(trustText, sender), trustText);
    await w.context().close();

    // ------------------------------------------------------------------
    section("Create: pending states, and success only after confirmation");
    const s = await newPage({ wallet: sender, clipboard: true, share: true });
    await s.goto(`${app}send`);
    await s.click("#reviewBtn");
    await connect(s);
    await sendReady(s);
    await s.fill('input[name="amount"]', "5");
    await s.fill('textarea[name="note"]', "Pending check");
    await s.evaluate(() => (window.__shim.delayMs = 1500));
    await automine(false);
    await s.click("#reviewBtn");
    await s.click("#confirmCreateBtn");
    await s.waitForSelector("#review >> text=Confirm the transaction in your wallet");
    check("asks the user to confirm in the wallet", true);
    check("confirm button busy and disabled", (await s.getAttribute("#confirmCreateBtn", "aria-busy")) === "true" && (await s.isDisabled("#confirmCreateBtn")));
    check("dialog can't be dismissed while pending", (await s.$("#review .icon-btn")) === null);
    await s.waitForSelector("#review >> text=Waiting for confirmation", { timeout: 15000 });
    const pendingStore = await storedLinks(s);
    const pendingId = pendingStore.find((l) => l.note === "Pending check")?.claimKey;
    const other1 = await s.context().newPage();
    await other1.goto(`${app}links`);
    await other1.waitForSelector('#myLinks [data-state="confirming"]', { timeout: 15000 });
    check("My links shows the unconfirmed link as Confirming", true);
    await other1.close();
    await s.waitForTimeout(1200);
    check("no success view before the block is mined", pathOf(s) === "/send" && (await s.$("#createdBanner")) === null);
    check("transaction link offered while pending", (await s.$('#review a[href*="/tx/0x"]')) !== null);
    check("contract has nothing yet", !(await onChain(pendingId)).sender || /^0x0+$/.test((await onChain(pendingId)).sender));
    await call("evm_mine");
    await automine(true);
    await s.evaluate(() => (window.__shim.delayMs = 0));
    await s.waitForSelector("#createdBanner", { timeout: 30000 });
    check("success view appears once mined", pathOf(s) === `/links/${pendingId}`);
    const pendingLink = await s.inputValue("#linkOut");

    // ------------------------------------------------------------------
    section("Copy and share controls");
    await s.click("#copyLinkBtn");
    check("Copy link puts the exact link on the clipboard", (await s.evaluate(() => navigator.clipboard.readText())) === pendingLink);
    check("Copy link confirms visually", (await s.textContent("#copyLinkBtn")).includes("Copied"));
    await s.click('button:has-text("Share…")');
    const shared = await s.evaluate(() => window.__shared?.[0]);
    check("Share hands the exact link to the OS share sheet", shared?.url === pendingLink && shared?.text.includes("5.00 USDC"));
    check("QR download is a real image", (await s.getAttribute('a[download="linkcash-payment-qr.gif"]', "href")).startsWith("data:image/gif"));

    // ------------------------------------------------------------------
    section("Claim: pending state, success only after confirmation, contract state");
    const r = await newPage(phone);
    await r.goto(pendingLink);
    await r.waitForSelector("#claimAmount");
    await r.click('[data-mode="existing"]');
    await r.fill('input[name="recipient"]', other);
    const otherBefore = await h.balance(other);
    await automine(false);
    await r.click("#claimBtn");
    await r.waitForSelector("text=Waiting for Hardhat to confirm", { timeout: 15000 });
    check("claim shows a pending state", (await r.getAttribute("#claimBtn", "aria-busy")) === "true");
    await r.waitForTimeout(1200);
    check("no success before the block is mined", (await r.$("#claimSuccess")) === null);
    check("no funds moved yet", (await balance(other)) === otherBefore);
    await call("evm_mine");
    await automine(true);
    await r.waitForSelector("#claimSuccess", { timeout: 30000 });
    check("success after confirmation; funds arrived", Math.abs((await balance(other)) - otherBefore - 5) < 1e-9);
    const settled = await onChain(pendingId);
    const outcome = await outcomeOf(pendingId);
    check("contract: link settled", settled.settled === true);
    check("contract: LinkClaimed to the chosen wallet", outcome?.event === "LinkClaimed" && outcome.recipient.toLowerCase() === other.toLowerCase());
    await s.goto(`${app}links/${pendingId}`);
    await s.waitForSelector(".badge");
    check("sender's details page agrees: Claimed by recipient", (await s.textContent("main")).toLowerCase().includes(`claimed by ${short(other)}`));
    await r.context().close();

    // ------------------------------------------------------------------
    section("Rejected and failed transactions");
    await s.goto(`${app}send`);
    await sendReady(s);
    await s.fill('input[name="amount"]', "1");
    await s.fill('textarea[name="note"]', "Rejected in wallet");
    await s.evaluate(() => (window.__shim.reject = true));
    await s.click("#reviewBtn");
    await s.click("#confirmCreateBtn");
    await s.waitForSelector("#createError");
    check("rejection explained", (await s.textContent("#createError")).includes("You cancelled the request in your wallet. Nothing was sent."));
    check("dialog stays open with Try again", (await s.textContent("#confirmCreateBtn")) === "Try again");
    check("rejected link not left in My links", !(await storedLinks(s)).some((l) => l.note === "Rejected in wallet"));
    await s.evaluate(() => (window.__shim.reject = false));
    await s.click("#confirmCreateBtn");
    await s.waitForSelector("#createdBanner", { timeout: 30000 });
    check("Try again after a rejection succeeds", true);

    // ------------------------------------------------------------------
    section("Messages");
    const MESSAGES = [
      ["no message", ""],
      ["short", "Thanks!"],
      ["punctuation and Unicode", `Rent & bills = 50% off? "Yes" — #1 + a+b=c; café ñ 日本語 עברית 🎉👍🏽 <b>not html</b>`],
      ["longest allowed (140)", "L".repeat(20) + " ".repeat(5) + "x".repeat(115)],
    ];
    const made = [];
    for (const [i, [label, note]] of MESSAGES.entries()) {
      const amount = `${i + 1}.${i + 1}${i + 1}`;
      made.push({ label, note, amount, ...(await createVia(s, { amount, note })) });
    }
    for (const m of made) {
      check(`${m.label}: link carries the message only if there is one`, m.note ? m.link.includes("&m=") : !m.link.includes("m="));
    }
    const recipient = await newPage(phone);
    for (const m of made) {
      await recipient.goto(m.link);
      await recipient.waitForSelector("#claimAmount");
      const note = await recipient.$("#claimNote blockquote");
      check(`${m.label}: recipient sees exactly the sender's text`, m.note ? (await note?.textContent()) === m.note : note === null);
      check(`${m.label}: amount belongs to this link`, (await recipient.textContent("#claimAmount")) === Number(m.amount).toFixed(2));
    }
    await recipient.goto(made[1].link);
    await recipient.waitForSelector("#claimNote");
    await recipient.goto(made[2].link);
    await recipient.waitForSelector("#claimNote");
    check("switching links shows the second link's message", (await recipient.textContent("#claimNote blockquote")) === made[2].note);
    await recipient.goBack();
    await recipient.waitForFunction((t) => document.querySelector("#claimNote blockquote")?.textContent === t, made[1].note);
    check("Back shows the first link's message again", true);
    await recipient.goto(made[0].link);
    await recipient.waitForSelector("#claimAmount");
    check("a link without a message never inherits one", (await recipient.$("#claimNote")) === null);
    await recipient.context().close();
    for (const m of made) {
      await s.goto(`${app}links/${m.id}`);
      await s.waitForSelector(".badge");
      const t = await s.$(".message-text");
      check(`${m.label}: sender's details page shows the same text`, m.note ? (await t?.textContent()) === m.note : t === null);
    }
    await s.goto(`${app}links`);
    await s.waitForSelector('#myLinks [data-state="waiting"]');
    const unicodeRow = s.locator("#myLinks .link-item", { hasText: `${made[2].amount} USDC` });
    check("My links shows the exact message for that row", (await unicodeRow.locator(".li-note").getAttribute("title")) === made[2].note);
    await unicodeRow.locator('button:has-text("Copy link")').click();
    check("My links Copy link copies that link (message intact)", (await s.evaluate(() => navigator.clipboard.readText())) === made[2].link);
    await s.goto(`${app}send`);
    await sendReady(s);
    await s.locator('textarea[name="note"]').pressSequentially("y".repeat(160));
    check("message is capped at 140 characters", (await s.inputValue('textarea[name="note"]')).length === 140);
    check("counter shows 140/140", (await s.textContent(".hint-split")).includes("140/140"));

    // ------------------------------------------------------------------
    section("Malformed and invalid links");
    const valid = new URL(made[1].link);
    const id = made[1].id;
    const k = new URLSearchParams(valid.hash.slice(1)).get("k");
    const b = await newPage(phone);
    const expectTitle = async (url, title, label) => {
      await b.goto(url);
      await b.waitForSelector("main h1");
      check(label, (await b.textContent("main h1")).includes(title), await b.textContent("main h1"));
    };
    await b.goto(`${app}claim/${id}`);
    await b.waitForSelector("#claimStatus");
    check("link without its secret: explained, amount still shown", (await b.textContent("#claimStatus")).includes("missing its secret part") && (await b.textContent("#claimAmount")) === "2.22");
    check("link without its secret: no claim button", (await b.$("#claimBtn")) === null);
    await expectTitle(`${app}claim/${id}#k=`, "This link isn't valid", "empty secret");
    await expectTitle(`${app}claim/${id}#k=${k.slice(0, 63)}`, "This link isn't valid", "truncated secret");
    await expectTitle(`${app}claim/${id}#k=${"z".repeat(64)}`, "This link isn't valid", "non-hex secret");
    await expectTitle(`${app}claim/0x123#k=${k}`, "This link isn't valid", "malformed ID");
    await expectTitle(`${app}#k=nonsense`, "This link isn't valid", "malformed old-style link");
    await expectTitle(`${app}claim`, "This page doesn't exist", "/claim without an ID is a 404");
    await expectTitle(`${app}claim/${id}/extra#k=${k}`, "This page doesn't exist", "extra path segments are a 404");
    await b.goto(`${app}claim/${id.toLowerCase()}#k=${k}&utm_source=x`);
    await b.waitForSelector("#claimAmount");
    check("lower-case ID and extra parameters still work", (await b.textContent("#claimAmount")) === "2.22" && (await b.$("#claimBtn")) !== null);
    await b.goto(pendingLink);
    await b.waitForSelector("#claimStatus");
    check("already-claimed link", (await b.textContent("#claimStatus")).includes("already been claimed"));
    await b.context().close();

    // ------------------------------------------------------------------
    section("Expiry: claim late, take back, refund, and contention");
    const e1 = await createVia(s, { amount: "6", days: 1, note: "late claim" });
    const e2 = await createVia(s, { amount: "7", days: 1 });
    const e3 = await createVia(s, { amount: "8", days: 1 });
    await call("evm_increaseTime", [2 * 86400]);
    await call("evm_mine");

    const late = await newPage({ ...phone, clockOffsetDays: 2 });
    await late.goto(e1.link);
    await late.waitForSelector("#claimAmount");
    check("expired link: badge says Expired", (await late.textContent(".badge")).includes("Expired"));
    check("expired link: explains it can still be claimed", (await late.textContent("main")).includes("passed its expiry date, but you can still claim it"));
    await late.screenshot({ path: `${SHOTS}/audit-expired-claim-390.png`, fullPage: true });
    await late.click('[data-mode="existing"]');
    await late.fill('input[name="recipient"]', third);
    await late.click("#claimBtn");
    await late.waitForSelector("#claimSuccess", { timeout: 30000 });
    check("expired link can still be claimed (contract allows late claims)", (await outcomeOf(e1.id))?.event === "LinkClaimed");
    await late.context().close();

    const sLater = await s.context().newPage();
    await sLater.clock.setFixedTime(Date.now() + 2 * 86400000);
    await sLater.goto(`${app}links`);
    const e2Row = sLater.locator("#myLinks .link-item", { hasText: "7.00 USDC" });
    await e2Row.locator('.badge:has-text("Expired")').waitFor({ timeout: 15000 });
    const senderBefore = await balance(sender);
    await e2Row.locator('button:has-text("Take back")').click();
    await sLater.click("#confirmReclaimBtn");
    await sLater.waitForSelector("#linksNotice.alert-success", { timeout: 30000 });
    const e2Out = await outcomeOf(e2.id);
    check("take back after expiry returns money to the sender", (await balance(sender)) - senderBefore > 6.99 && e2Out?.recipient.toLowerCase() === sender.toLowerCase());
    await sLater.close();

    // Recipient claims while the sender refunds from another browser.
    const rc = await newPage({ ...phone, clockOffsetDays: 2 });
    await rc.goto(e3.link);
    await rc.waitForSelector("#claimAmount");
    await rc.click('[data-mode="existing"]');
    await rc.fill('input[name="recipient"]', other);
    const sf = await newPage({ wallet: sender, clockOffsetDays: 2 });
    await sf.goto(`${app}links/${e3.id}`);
    await sf.waitForSelector("text=isn't saved in this browser");
    await sf.click('header button:has-text("Connect")');
    await connect(sf);
    await sf.waitForSelector("#refundBtn", { timeout: 15000 });
    await automine(false);
    await rc.click("#claimBtn");
    await rc.waitForSelector("text=Waiting for Hardhat to confirm", { timeout: 15000 });
    await sf.click("#refundBtn");
    await sf.click("#confirmRefundBtn");
    await sf.waitForSelector("#refund .alert", { timeout: 15000 });
    await call("evm_mine");
    await automine(true);
    await rc.waitForSelector("#claimSuccess, #claimError", { timeout: 30000 });
    await sf.waitForSelector("#detailsNotice.alert-success, #refund .alert-error", { timeout: 30000 });
    const claimWon = (await rc.$("#claimSuccess")) !== null;
    const refundWon = (await sf.$("#detailsNotice.alert-success")) !== null;
    const e3Out = await outcomeOf(e3.id);
    check("contention: exactly one of claim/refund reports success", claimWon !== refundWon, `claim=${claimWon} refund=${refundWon}`);
    check("contention: the loser shows an error, not success", claimWon ? (await sf.$("#refund .alert-error")) !== null : (await rc.$("#claimError")) !== null);
    check("contention: UI matches the contract's event", claimWon ? e3Out?.event === "LinkClaimed" : e3Out?.event === "LinkRefunded");
    await rc.context().close();
    await sf.context().close();

    // ------------------------------------------------------------------
    section("Mobile: create and share on a phone");
    const m = await newPage({ wallet: sender, ...phone, clipboard: true });
    await m.goto(`${app}send`);
    await m.click("#reviewBtn");
    await m.waitForSelector("text=Installed", { timeout: 15000 }).catch(() => {});
    await connect(m);
    await sendReady(m);
    await m.fill('input[name="amount"]', "1.5");
    await m.fill('textarea[name="note"]', "Sent from my phone 📱");
    await m.click("#reviewBtn");
    await m.waitForSelector("#review[open]");
    await m.waitForTimeout(300);
    const box = await m.locator("#review .dialog-panel").boundingBox();
    check("review dialog fits a 390px screen", box.x >= 0 && box.x + box.width <= 390);
    const btn = await m.locator("#confirmCreateBtn").boundingBox();
    check("primary buttons are touch-sized (≥ 44px)", btn.height >= 44);
    await m.screenshot({ path: `${SHOTS}/audit-review-390.png` });
    await m.click("#confirmCreateBtn");
    await m.waitForSelector("#createdBanner", { timeout: 30000 });
    const mobileLink = await m.inputValue("#linkOut");
    await m.click("#copyLinkBtn");
    check("copy works on mobile", (await m.evaluate(() => navigator.clipboard.readText())) === mobileLink);
    check("success view has no horizontal scroll on mobile", await noOverflow(m));
    await m.goto(`${app}links`);
    await m.waitForSelector("#myLinks .link-item");
    check("My links has no horizontal scroll on mobile", await noOverflow(m));
    await m.screenshot({ path: `${SHOTS}/audit-links-390.png`, fullPage: true });
    await m.context().close();
    await s.context().close();
  } catch (e) {
    check("unexpected error", false, e.message.split("\n")[0]);
    await call("evm_setAutomine", [true]).catch(() => {});
  } finally {
    check("no page or console errors", errors.length === 0, errors.slice(0, 3).join(" | "));
  }
  return h.finish("Audit");
};
