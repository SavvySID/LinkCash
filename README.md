# LinkCash

**Send USDC to anyone with a link. They don't need a wallet, a bank account, or gas.**

LinkCash runs on [Arc](https://arc.io) mainnet. A sender locks USDC behind a one-time link and shares it any way they like: WhatsApp, SMS, email or a printed QR code. Whoever opens the link can claim the money in under a minute, even if they've never used crypto. If the link is never claimed, the sender gets the money back.

## The problem

- About **1.4 billion adults** don't have a bank account.
- Sending money across borders costs **over 6%** on average, and it often takes days.
- Crypto could help, but it adds new hurdles. To receive a token, the recipient first needs a wallet. To move it, they need a *second* token to pay gas. Most people give up at this point.

## Why Arc

Arc uses **USDC as its native gas token**, so the only asset involved is a dollar stablecoin. LinkCash builds on that:

- The sender attaches a tiny gas allowance (0.005 USDC) to each link. The link pays for its own claim transaction, so **the recipient never needs any funds to receive money**.
- Arc's **deterministic, sub-second finality** means a claim is final the moment it lands. That makes a link feel like handing someone cash.
- Value is held in dollars from start to finish. There's no volatile gas token and no swap step.

## How it works

```
Sender                         LinkCash contract                  Recipient
  │  create(claimKey, expiry)      │                                  │
  │  + amount + gas allowance ───► │  locks amount                    │
  │                                │  forwards gas ─► claimKey        │
  │  shares /claim/<id>#k=<key> ──────────────────────────────────────► │
  │                                │ ◄── claim(recipient) signed &    │
  │                                │     paid for by claimKey         │
  │                                │  sends USDC ───────────────────► │
  │  refund() after expiry ──────► │  (only if never claimed)         │
```

1. The browser creates a fresh **claim key** (a keypair) for each link.
2. `create()` locks the USDC under the claim key's address. It also forwards a small gas allowance to that address.
3. The link is `/claim/<id>#k=<secret>&m=<message>`. The `id` is the claim key's public address (it's on-chain anyway). The private key and the message go in the **URL fragment** (after `#`). Browsers never send the fragment to a server, so it is never sent to or stored on any server. Older `/#k=…` links still work: they redirect to `/claim/<id>`.
4. The recipient opens the link. They choose an existing address, or the page creates a new wallet in their browser and gives them a recovery phrase to back up.
5. The claim key sends `claim(recipient)` and pays the gas itself. If the gas allowance runs out, the claim key signs a message instead, and any wallet can submit it with `claimWithSig()`. The signature binds the recipient, so a relayer can't redirect the money.
6. A sender can take an unclaimed link back at any time from **My links**, using the copy of the key saved in their browser. After expiry, the sending wallet can also call `refund()` from the link's details page (`/links/<id>`), which works even on another device.

## Where the data lives

| Data | Stored | Notes |
|---|---|---|
| Amount, sender, expiry, claimed/refunded | On-chain, in the `LinkCash` contract | Every screen reads these from Arc. |
| Who claimed it, and how it ended | On-chain, in `LinkClaimed` / `LinkRefunded` events | Used to show Claimed, Taken back or Refunded. If the RPC can't return the logs, the app shows "Claimed or taken back". |
| Message | In the link itself (`#…&m=…`), plus the sender's browser storage | Not on-chain and not on any server. Only people who have the link can read it, and each link carries its own message. It can't be edited after the link is created. |
| Link key and "My links" list | The sender's browser (`localStorage`) | There's no server or account. Clearing site data removes the list. Money is never lost: the recipient can still claim, and after expiry the sender's wallet can call `refund()` from `/links/<id>`. |

## Security notes

- Each link can be settled once: either claimed or refunded.
- Claims stay valid after expiry until the sender actually refunds, so a late recipient can still get paid.
- `claimWithSig` uses EIP-191 signatures that commit to the chain ID, the contract address, the claim key and the recipient. Malleable high-s signatures are rejected.
- The gas allowance is capped at 0.1 USDC per link.
- Anyone who has the link can claim the money, just like cash in an envelope. Share it only with the intended recipient.
- The contract hasn't had an independent audit. It's a proof of concept, so use small amounts.
- The site has no inline scripts and ships a strict Content Security Policy (scripts only from the site itself; network access only to the Arc RPC). Fonts are bundled, so pages make no third-party requests.
- Link keys a sender creates stay in that browser's storage until the link is claimed or taken back. If the wallet errors after sending, the key is kept and the link's status is resolved from the chain instead of being thrown away.

## Deployment

| | |
|---|---|
| Network | Arc mainnet (chain ID 5042) |
| Contract | [`0xa6c3A9ED94E5100279AE3070441fFE974da81567`](https://explorer.arc.io/address/0xa6c3A9ED94E5100279AE3070441fFE974da81567) |
| App | `TBD` |

## Run it yourself

```bash
npm install --legacy-peer-deps
npm install --prefix web
npm test           # contract tests, including the security suite
npm run build      # compile + export ABI/bytecode to web/src/contract.json
npm run dev        # run the app at http://localhost:5173
npm run build:web  # static build in web/dist (host anywhere, e.g. GitHub Pages)
npm run e2e        # browser tests against a local chain (needs Edge or Chrome)
npm run e2e -- security   # browser security checks
```

To deploy the contract, open `/deploy.html` with a wallet that holds some USDC on Arc, then set `CONTRACT_ADDRESS` in `web/src/config.js` and rebuild. (The deployed address above is already set.)

### Verify the contract source on the explorer

The source is not yet verified on the Arc explorer. To verify it:

1. `npx hardhat compile && node scripts/verify-input.js` writes `artifacts/verify/LinkCash.standard-input.json`. Compiled with solc 0.8.28, this input reproduces the deployed runtime bytecode exactly.
2. Open the contract on [explorer.arc.io](https://explorer.arc.io/address/0xa6c3A9ED94E5100279AE3070441fFE974da81567), choose **Contract → Verify & publish**, and pick **Solidity (Standard JSON input)**.
3. Compiler `v0.8.28+commit.7893614a`, contract name `LinkCash`, no constructor arguments, license MIT. Upload the JSON file and submit.
4. Check that the explorer shows the contract as verified before saying it is.

Wallets connect through [RainbowKit](https://rainbowkit.com). Browser extensions (MetaMask, Rabby, Trust, Coinbase…) are detected automatically. To also enable QR login for mobile wallets, put a free [Reown](https://cloud.reown.com) project ID in `web/.env.local`:

```
VITE_WALLETCONNECT_PROJECT_ID=your_project_id
```

## Website routes

| Route | Page |
|---|---|
| `/` | Landing page: hero, how it works, benefits, product previews, FAQ |
| `/send` | Create a payment link (amount, expiry, message, fees, review) |
| `/links` | My links: summary, search, status filters, take back |
| `/links/:id` | One link's details and actions; `?created=1` is the success view after creating |
| `/claim/:id#k=…&m=…` | Recipient claim page |
| `/deploy.html` | Operator tool for deploying the contract (linked from the footer) |
| anything else | Not-found page |

Routing uses the browser History API (no extra dependency). For hosting:

- **Any static host at the domain root:** `npm run build:web` and upload `web/dist`.
- **GitHub Pages project site:** build with `VITE_BASE=/<repo>/`. The build also writes `404.html`, a copy of `index.html`, so opening or refreshing `/claim/…` or `/links/…` works.
- **Netlify / Vercel:** add a rewrite from `/*` to `/index.html` (real files such as `deploy.html` are still served directly).

### Security headers

Every build puts a Content Security Policy `<meta>` tag in `index.html` and `deploy.html`, and writes `web/dist/_headers` with the full set of response headers. A `<meta>` CSP can't do everything a header can: browsers ignore `frame-ancestors` in a meta tag, so only response headers stop other sites from framing the app (clickjacking).

- **Netlify and Cloudflare Pages** read `_headers` automatically: CSP with `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Permissions-Policy` and HSTS.
- **Vercel:** copy the same headers into `vercel.json` (`headers`).
- **GitHub Pages can't send response headers.** The meta CSP and `no-referrer` still apply, and as a fallback the app refuses to render when another site frames it, but prefer a host that supports headers.
- `vite preview` serves the same headers, so the browser tests run under the production policy. The dev server (`npm run dev`) has no CSP, because Vite's hot reload needs inline scripts.
- If you add a WalletConnect project ID, the build adds Reown's hosts to the policy. That path isn't covered by the tests, so check the browser console for CSP errors after enabling it.

## Tests

- `npm test` runs the Hardhat contract tests.
- `npm run e2e` starts a local Hardhat chain, deploys the contract, builds the site with and without a contract address, and drives both in a headless browser. It covers navigation, back/forward, deep links and refresh, the 404 page, create, share, claiming with a new or existing wallet, take back, refund after expiry, relayed claims, invalid links, the deploy page, and four screen widths. Screenshots go to `e2e/screenshots/`.

## Project layout

```
contracts/LinkCash.sol   escrow contract
test/                    Hardhat tests
web/                     React + Vite frontend (no backend)
  src/main.jsx           routes
  src/router.jsx         small History API router (Link, navigate, params)
  src/layout.jsx         navbar, mobile menu, footer, setup notice
  src/pages/             Landing, Send, Links, LinkDetails, Claim, NotFound
  src/linkActions.jsx    share card (copy/share/QR), take-back and refund dialogs
  src/useMyLinks.js      saved links joined with live on-chain status
  src/linkcash.js        chain reads, create/claim/refund logic, link storage (viem)
  src/components.jsx     shared UI: buttons, alerts, badges, dialog, wallet status
  src/wagmi.js           RainbowKit / wagmi wallet setup
  src/config.js          network, contract address, gas allowance
  src/deploy.jsx         deploy page
  src/mount.jsx          shared entry point (fonts, framing fallback)
  public/theme-init.js   applies the light/dark theme before first paint
  vite.config.js         build, Content Security Policy and _headers
scripts/
  export-abi.js          copy ABI/bytecode into web/src/contract.json
  verify-input.js        standard-JSON input for explorer source verification
  local-demo.js          deploy + create a link on a local hardhat node
e2e/                     browser tests (npm run e2e)
```

## Roadmap

- A gasless relayer, so even claims whose gas allowance has run out need nothing from the recipient
- Cash-out guides for each country, through local exchanges and Circle partners
- Batch links, for payroll, aid distribution and giveaways
- Support for EURC and other Arc stablecoins

## License

MIT
