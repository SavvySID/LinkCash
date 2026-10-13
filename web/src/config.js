import { defineChain } from "viem";

const env = import.meta.env;

const arc = defineChain({
  id: 5042,
  name: "Arc",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.mainnet.arc.io"] } },
  blockExplorers: { default: { name: "Arc Explorer", url: "https://explorer.arc.io" } },
});

// Local hardhat node, for development and the e2e test (VITE_CHAIN=local).
const local = defineChain({
  id: 31337,
  name: "Hardhat",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: ["http://127.0.0.1:8545"] } },
  blockExplorers: { default: { name: "Local", url: "http://localhost" } },
});

export const chain = env.VITE_CHAIN === "local" ? local : arc;

// Set after deploying (see deploy.html). VITE_CONTRACT_ADDRESS overrides it;
// setting it to an empty string builds the site with no contract.
export const CONTRACT_ADDRESS = env.VITE_CONTRACT_ADDRESS ?? "0xa6c3a9ed94e5100279ae3070441ffe974da81567";

// Free project ID from https://cloud.reown.com - enables QR login for phone
// wallets. Browser extension wallets work without it.
export const WALLETCONNECT_PROJECT_ID = env.VITE_WALLETCONNECT_PROJECT_ID || "";

// USDC forwarded to each claim key so recipients with no balance can claim.
export const GAS_ALLOWANCE = "0.005";

// Public repository, linked from the footer once set.
export const REPO_URL = "https://github.com/SavvySID/LinkCash";
