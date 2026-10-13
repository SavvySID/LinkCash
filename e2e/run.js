// End-to-end browser tests for the LinkCash website against a local Hardhat chain.
//
//   npm run e2e
//
// Starts a Hardhat node, deploys the contract with a demo link, builds the
// site twice (with and without a contract address), serves both with
// `vite preview`, then drives them with Playwright using an installed
// Microsoft Edge or Chrome (E2E_BROWSER=msedge|chrome, default msedge on
// Windows and chrome elsewhere). Nothing touches a real network.
const { spawn, spawnSync, execSync } = require("child_process");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const WEB = path.join(ROOT, "web");
const RPC = "http://127.0.0.1:8545";
const PORTS = { app: 4173, empty: 4174 };
const children = [];

function start(cmd, cwd, env) {
  const child = spawn(cmd, { cwd, env: { ...process.env, ...env }, shell: true, stdio: ["ignore", "pipe", "pipe"] });
  children.push(child);
  return child;
}

function stopAll() {
  for (const c of children) {
    if (c.exitCode !== null) continue;
    // Synchronous, so the process tree is gone before this script exits.
    if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(c.pid), "/T", "/F"], { stdio: "ignore" });
    else c.kill("SIGTERM");
  }
}

async function waitFor(fn, label, ms = 60000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      if (await fn()) return;
    } catch {
      /* not ready yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

const rpcUp = async () => (await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' })).ok;
const httpUp = (url) => async () => (await fetch(url)).ok;

async function main() {
  if (await rpcUp().catch(() => false)) throw new Error(`Something is already listening on ${RPC}. Stop it and try again.`);

  console.log("• starting hardhat node");
  start("npx hardhat node --hostname 127.0.0.1 --port 8545", ROOT);
  await waitFor(rpcUp, "hardhat node");

  console.log("• deploying contract + demo link");
  const appUrl = `http://localhost:${PORTS.app}`;
  const demo = execSync("npx hardhat run scripts/local-demo.js --network localhost", { cwd: ROOT, env: { ...process.env, APP_URL: appUrl } }).toString();
  const contract = demo.match(/contract:\s+(0x[0-9a-fA-F]{40})/)[1];
  const demoClaimUrl = demo.match(/claim:\s+(\S+)/)[1];

  console.log("• building site (with contract, and without)");
  execSync("npx vite build --outDir dist-e2e --emptyOutDir --logLevel error", { cwd: WEB, stdio: "inherit", env: { ...process.env, VITE_CHAIN: "local", VITE_CONTRACT_ADDRESS: contract } });
  execSync("npx vite build --outDir dist-e2e-empty --emptyOutDir --logLevel error", { cwd: WEB, stdio: "inherit", env: { ...process.env, VITE_CHAIN: "local", VITE_CONTRACT_ADDRESS: "" } });

  console.log("• serving builds");
  start(`npx vite preview --outDir dist-e2e --port ${PORTS.app} --strictPort`, WEB);
  start(`npx vite preview --outDir dist-e2e-empty --port ${PORTS.empty} --strictPort`, WEB);
  await waitFor(httpUp(appUrl), "app preview");
  await waitFor(httpUp(`http://localhost:${PORTS.empty}`), "empty preview");

  // Each suite starts from the same chain snapshot, so state and time travel
  // in one suite can't leak into the next. `npm run e2e -- audit` runs one suite.
  const only = process.argv[2];
  // The security suite records audit findings as failing checks, so it only
  // runs when asked for: `npm run e2e -- security`.
  const suites = [
    ["site", "./app.test.js"],
    ["audit", "./audit.test.js"],
    ["security", "./security.test.js"],
  ].filter(([name]) => (only ? name === only : name !== "security"));
  const ctx = { app: `${appUrl}/`, emptyApp: `http://localhost:${PORTS.empty}/`, rpc: RPC, contract, demoClaimUrl, distDir: path.join(WEB, "dist-e2e") };
  const snapshot = await rpcCall("evm_snapshot");
  const totals = [];
  for (const [name, file] of suites) {
    console.log(`\n=== ${name} suite ===`);
    totals.push([name, await require(file).run(ctx)]);
    await rpcCall("evm_revert", [snapshot]);
    await rpcCall("evm_snapshot");
  }
  console.log("\n=== summary ===");
  for (const [name, t] of totals) console.log(`${name.padEnd(6)} ${t.total - t.failed}/${t.total} passed`);
  return totals.reduce((n, [, t]) => n + t.failed, 0);
}

async function rpcCall(method, params = []) {
  const res = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  return (await res.json()).result;
}

main()
  .then((failed) => {
    stopAll();
    process.exit(failed ? 1 : 0);
  })
  .catch((e) => {
    console.error(e);
    stopAll();
    process.exit(1);
  });
