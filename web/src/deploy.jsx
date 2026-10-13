import { useConnectModal } from "@rainbow-me/rainbowkit";
import { useEffect, useState } from "react";
import { useAccount, useSwitchChain, useWalletClient } from "wagmi";
import { Alert, Button, PageHeader, WalletStatus } from "./components";
import { chain, CONTRACT_ADDRESS } from "./config";
import { bytecode } from "./contract.json";
import { Layout } from "./layout";
import { abi, addressUrl, errMsg, fmt, publicClient } from "./linkcash";
import { mount } from "./mount";
import { Providers } from "./providers";
import "./style.css";

function Deploy() {
  const { address, isConnected, chainId } = useAccount();
  const { openConnectModal } = useConnectModal();
  const { switchChainAsync } = useSwitchChain();
  const { data: walletClient } = useWalletClient({ chainId: chain.id });
  const [balance, setBalance] = useState(null);
  const [cost, setCost] = useState(null);
  const [status, setStatus] = useState(null);
  const [deployed, setDeployed] = useState(null);
  // The page must be able to read the chain itself, or it couldn't confirm the
  // deployment or record the address even though the wallet would send it.
  const [readError, setReadError] = useState(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!address) return;
    let live = true;
    setReadError(null);
    Promise.all([
      publicClient.getBalance({ address }),
      publicClient.estimateGas({ account: address, data: bytecode }),
      publicClient.getGasPrice(),
    ])
      .then(([bal, gas, price]) => {
        if (!live) return;
        setBalance(bal);
        setCost((gas * price * 12n) / 10n);
      })
      .catch((e) => live && setReadError(errMsg(e)));
    return () => {
      live = false;
    };
  }, [address, deployed, attempt]);

  async function deploy() {
    if (!isConnected) return openConnectModal?.();
    try {
      if (chainId !== chain.id) await switchChainAsync({ chainId: chain.id });
      setStatus({ busy: true, text: "Confirm the deployment in your wallet…" });
      const hash = await walletClient.deployContract({ abi, bytecode, chain });
      setStatus({ busy: true, text: "Deploying. Waiting for confirmation…", hash });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (!receipt.contractAddress || receipt.status !== "success") throw new Error("The deployment transaction failed.");
      setDeployed(receipt.contractAddress);
      setStatus(null);
    } catch (e) {
      setStatus({ kind: "error", text: errMsg(e) });
    }
  }

  const tooPoor = balance !== null && cost !== null && balance < cost;

  return (
    <Layout hideNotice>
      <div className="container container-narrow page">
        <PageHeader
          title="Deploy the contract"
          lead={`Operator tool. Deploys the LinkCash contract to ${chain.name} (chain ID ${chain.id}) from your wallet. ${chain.name} charges network fees in USDC, so the wallet needs a little USDC there.`}
        />
        <div className="panel">
          {CONTRACT_ADDRESS && !deployed && (
            <Alert alert={{ kind: "warn" }}>
              This site is already set up with the contract at <span className="mono">{CONTRACT_ADDRESS}</span>. Deploying again creates a
              separate contract.
            </Alert>
          )}
          {isConnected && <WalletStatus />}
          {address && balance !== null && cost !== null && (
            <p className="hint" id="balanceLine">
              Your USDC on {chain.name}: <strong className="tnum">{fmt(balance)}</strong>. Estimated deployment cost:{" "}
              <strong className="tnum">{fmt(cost)} USDC</strong>.
            </p>
          )}
          {tooPoor && (
            <Alert alert={{ kind: "warn" }}>
              Not enough USDC on {chain.name} to deploy. Bridge a few USDC to {chain.name} (chain ID {chain.id}) for this address first,
              then refresh this page.
            </Alert>
          )}

          {readError && (
            <Alert alert={{ kind: "error", text: readError }} id="readError">
              {" "}
              <button type="button" className="text-btn" onClick={() => setAttempt((a) => a + 1)}>
                Try again
              </button>
            </Alert>
          )}
          <Alert alert={status} />
          <Button
            block
            id="deployBtn"
            onClick={deploy}
            loading={Boolean(status?.busy)}
            disabled={(isConnected && (!walletClient || balance === null || cost === null)) || tooPoor || Boolean(deployed)}
          >
            {isConnected ? "Deploy" : "Connect wallet"}
          </Button>
          {deployed && (
            <Alert alert={{ kind: "success" }} id="deployed">
              Contract address: <span className="mono">{deployed}</span>
              <br />
              Set it as <code>CONTRACT_ADDRESS</code> in <code>src/config.js</code>, then rebuild.{" "}
              <a href={addressUrl(deployed)} target="_blank" rel="noopener">
                View on explorer
              </a>
            </Alert>
          )}
        </div>
      </div>
    </Layout>
  );
}

mount(
  <Providers>
    <Deploy />
  </Providers>,
);
