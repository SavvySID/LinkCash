import { connectorsForWallets } from "@rainbow-me/rainbowkit";
import {
  coinbaseWallet,
  injectedWallet,
  metaMaskWallet,
  rabbyWallet,
  rainbowWallet,
  trustWallet,
  walletConnectWallet,
} from "@rainbow-me/rainbowkit/wallets";
import { createConfig, createStorage, http } from "wagmi";
import { chain, WALLETCONNECT_PROJECT_ID } from "./config";

// The branded wallets below fall back to WalletConnect (QR / mobile), which
// needs a project ID. Without one, list only what's installed in the browser:
// each extension announces itself via EIP-6963 and shows up under
// "Installed", so one extension can't hijack the connection from another.
const hasWc = Boolean(WALLETCONNECT_PROJECT_ID);

const connectors = connectorsForWallets(
  [
    {
      groupName: hasWc ? "Popular" : "Other",
      wallets: hasWc
        ? [metaMaskWallet, rainbowWallet, trustWallet, coinbaseWallet, rabbyWallet, walletConnectWallet]
        : [injectedWallet],
    },
  ],
  { appName: "LinkCash", projectId: WALLETCONNECT_PROJECT_ID || "unset" },
);

// localStorage that never throws: when the browser blocks storage, wallet
// connection state lives in memory for this visit instead.
const memory = new Map();
const safeStorage = {
  getItem(key) {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return memory.get(key) ?? null;
    }
  },
  setItem(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      memory.set(key, value);
    }
  },
  removeItem(key) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      memory.delete(key);
    }
  },
};

export const wagmiConfig = createConfig({
  connectors,
  storage: createStorage({ storage: safeStorage }),
  chains: [chain],
  transports: { [chain.id]: http(chain.rpcUrls.default.http[0]) },
  multiInjectedProviderDiscovery: true,
});
