import "@rainbow-me/rainbowkit/styles.css";
import { darkTheme, lightTheme, RainbowKitProvider } from "@rainbow-me/rainbowkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAccount, useSwitchChain, useWriteContract } from "wagmi";
import { WagmiProvider } from "wagmi";
import { chain, CONTRACT_ADDRESS } from "./config";
import { abi } from "./linkcash";
import { useTheme } from "./theme";
import { wagmiConfig } from "./wagmi";

const queryClient = new QueryClient();
const fonts = { body: "'Inter Variable', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" };
const walletThemes = {
  light: { ...lightTheme({ accentColor: "#0B1E46", accentColorForeground: "#FFFFFF", borderRadius: "large" }), fonts },
  dark: { ...darkTheme({ accentColor: "#8ECBFF", accentColorForeground: "#0B1E46", borderRadius: "large" }), fonts },
};

export function Providers({ children }) {
  const theme = useTheme();
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider
          initialChain={chain}
          modalSize="compact"
          theme={walletThemes[theme]}
        >
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}

/** Write to LinkCash from the connected wallet, switching to Arc first if needed. */
export function useLinkCashWrite() {
  const { chainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  return async ({ functionName, args, value }) => {
    if (chainId !== chain.id) await switchChainAsync({ chainId: chain.id });
    return writeContractAsync({ address: CONTRACT_ADDRESS, abi, functionName, args, value, chainId: chain.id });
  };
}
