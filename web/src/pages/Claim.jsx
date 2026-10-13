import { useConnectModal } from "@rainbow-me/rainbowkit";
import { useEffect, useId, useState } from "react";
import { isAddress, zeroAddress } from "viem";
import { english, generateMnemonic, mnemonicToAccount, privateKeyToAccount } from "viem/accounts";
import { useAccount } from "wagmi";
import { AddressLink, Alert, Amount, Badge, Button, CopyButton, Details, Message, Skeleton, TxLink, useFocusHeading } from "../components";
import { chain, CONTRACT_ADDRESS } from "../config";
import { NotConfigured } from "../layout";
import { claimFunding, claimWithKey, errMsg, fetchOutcomes, fmt, fmtDate, isLinkId, publicClient, readLink, settledState, short } from "../linkcash";
import { useLinkCashWrite } from "../providers";
import { Link } from "../router";

/**
 * /claim/:id#k=<secret>&m=<message>
 * The id (claim key address) says which payment this is; the secret in the
 * fragment is what allows claiming. The message comes only from this URL.
 */
export function ClaimPage({ id, hash }) {
  return (
    <div className="container container-narrow page">
      {CONTRACT_ADDRESS ? <Claim id={id} hash={hash} /> : <NotConfigured what="Claims" />}
      <p className="center-note">
        <Link to="/">What is LinkCash?</Link>
        <Link to="/send">Send money with your own link</Link>
      </p>
    </div>
  );
}

/** Why an address can't receive this payment, or null. */
function recipientProblem(address, linkId) {
  const a = address.toLowerCase();
  if (a === zeroAddress) return "That's the zero address, which can't receive money. Enter your own wallet's address.";
  if (a === linkId.toLowerCase())
    return "That's this payment link's own address. Money sent there could still be taken by anyone with the link. Enter your own wallet's address.";
  if (CONTRACT_ADDRESS && a === CONTRACT_ADDRESS.toLowerCase()) return "That's the LinkCash contract, which can't receive payments. Enter your own wallet's address.";
  return null;
}

function parseClaimUrl(id, hash) {
  const params = new URLSearchParams(hash.slice(1));
  const hex = params.get("k");
  const note = params.get("m") || "";
  if (!isLinkId(id)) return { kind: "invalid" };
  if (hex == null) return { kind: "nosecret", id, note };
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) return { kind: "invalid" };
  const privateKey = `0x${hex}`;
  // The secret must belong to this payment; otherwise the link was altered or mixed up.
  if (privateKeyToAccount(privateKey).address.toLowerCase() !== id.toLowerCase()) return { kind: "invalid" };
  return { kind: "ok", id, privateKey, note };
}

function Claim({ id, hash }) {
  const [view, setView] = useState({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const url = parseClaimUrl(id, hash);
  const note = url.note || "";

  useEffect(() => {
    if (url.kind === "invalid") return setView({ kind: "invalid" });
    let live = true;
    setView({ kind: "loading" });
    (async () => {
      try {
        const link = await readLink(url.id);
        if (!live) return;
        if (!link.exists) return setView({ kind: "missing" });
        if (link.settled) {
          const outcome = await fetchOutcomes([url.id]).then(
            (o) => o[Object.keys(o).find((k) => k.toLowerCase() === url.id.toLowerCase())] ?? null,
            () => null,
          );
          return live && setView({ kind: "settled", link, outcome });
        }
        if (url.kind === "nosecret") return setView({ kind: "nosecret", link });
        const funding = await claimFunding(url.id).catch(() => null);
        if (live) setView({ kind: "open", link, funding });
      } catch (e) {
        if (live) setView({ kind: "error", message: errMsg(e) });
      }
    })();
    return () => {
      live = false;
    };
  }, [id, hash, attempt]); // eslint-disable-line react-hooks/exhaustive-deps

  const retry = () => setAttempt((a) => a + 1);

  return (
    <section aria-labelledby="claim-title" aria-busy={view.kind === "loading"}>
      {view.kind === "loading" && <LoadingCard />}
      {view.kind === "invalid" && (
        <Problem title="This link isn't valid">
          The link is incomplete or has been changed. Ask the sender to send it again, and make sure you open the whole link, including
          everything after the # sign.
        </Problem>
      )}
      {view.kind === "missing" && (
        <Problem title="We couldn't find this payment" onRetry={retry}>
          There's no payment for this link on {chain.name}. If the sender only just created it, wait a few seconds and try again.
        </Problem>
      )}
      {view.kind === "error" && (
        <Problem title="Couldn't load this payment" onRetry={retry}>
          We couldn't reach {chain.name} to check this link. {view.message}
        </Problem>
      )}
      {view.kind === "settled" && <Settled link={view.link} outcome={view.outcome} note={note} />}
      {view.kind === "nosecret" && (
        <div className="panel receipt">
          <PaymentHeader link={view.link} note={note} state={Date.now() / 1000 >= view.link.expiry ? "expired" : "waiting"} />
          <Alert alert={{ kind: "warn" }} id="claimStatus">
            This link is missing its secret part (everything after the # sign), so it can't be used to claim. Ask the sender for the
            complete link.
          </Alert>
        </div>
      )}
      {view.kind === "open" && <OpenClaim link={view.link} privateKey={url.privateKey} funding={view.funding} note={note} />}
    </section>
  );
}

function LoadingCard() {
  return (
    <div className="panel receipt" role="status">
      <span className="sr-only">Loading payment…</span>
      <Skeleton width="40%" />
      <Skeleton width="60%" height={44} style={{ margin: "14px 0" }} />
      <Skeleton width="80%" />
      <Skeleton height={48} style={{ marginTop: 24 }} />
    </div>
  );
}

function Problem({ title, children, onRetry }) {
  const headingRef = useFocusHeading();
  return (
    <div className="panel receipt problem" id="claimStatus">
      <h1 id="claim-title" tabIndex={-1} ref={headingRef}>
        {title}
      </h1>
      <p className="hint">{children}</p>
      {onRetry && (
        <Button variant="secondary" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

function PaymentHeader({ link, note, state }) {
  const headingRef = useFocusHeading();
  return (
    <>
      <div className="claim-head">
        <p className="from-line" id="claimFrom">
          From <AddressLink address={link.sender} />
        </p>
        <Badge state={state} />
      </div>
      <h1 id="claim-title" tabIndex={-1} ref={headingRef} className="claim-title">
        <span className="claim-kicker">You've been sent </span>
        <Amount value={link.amount} id="claimAmount" as="span" />
      </h1>
      <Message text={note} id="claimNote" unverified />
    </>
  );
}

function Settled({ link, outcome, note }) {
  const state = settledState(link, outcome);
  const text = {
    claimed: "This payment has already been claimed.",
    reclaimed: "The sender took this payment back, so it can't be claimed anymore.",
    refunded: "This payment was refunded to the sender, so it can't be claimed anymore.",
    completed: "This payment has already been claimed or returned to the sender.",
  }[state];
  return (
    <div className="panel receipt">
      <PaymentHeader link={link} note={note} state={state} />
      <Alert alert={{ kind: "warn", text, hash: outcome?.hash }} id="claimStatus" />
    </div>
  );
}

function OpenClaim({ link, privateKey, funding, note }) {
  const { address, isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();
  const write = useLinkCashWrite();
  const [mode, setMode] = useState("new");
  const [wallet, setWallet] = useState(null);
  const [saved, setSaved] = useState(false);
  const [input, setInput] = useState("");
  const [touched, setTouched] = useState(false);
  const [wantConnected, setWantConnected] = useState(false);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);
  const ids = { recipient: useId(), recipientHint: useId() };

  const expired = Date.now() / 1000 >= link.expiry;
  const needsWallet = funding && !funding.selfFunded;

  // "Use my connected wallet" fills the address once the wallet modal connects.
  useEffect(() => {
    if (wantConnected && address) {
      setInput(address);
      setWantConnected(false);
    }
  }, [wantConnected, address]);

  const recipient = mode === "new" ? wallet?.address : input.trim();
  const inputIsAddress = isAddress(input.trim());
  const problem = inputIsAddress ? recipientProblem(input.trim(), privateKeyToAccount(privateKey).address) : null;
  const inputValid = inputIsAddress && !problem;
  const ready = mode === "new" ? Boolean(wallet && saved) : inputValid;
  const isContract = useHasCode(mode === "existing" && inputValid ? input.trim() : null);

  function createWallet() {
    const phrase = generateMnemonic(english);
    setWallet({ phrase, address: mnemonicToAccount(phrase).address });
  }

  function fillConnected() {
    if (address) setInput(address);
    else {
      setWantConnected(true);
      openConnectModal?.();
    }
  }

  async function claim() {
    setError(null);
    if (needsWallet && !isConnected) return openConnectModal?.();
    try {
      const hash = await claimWithKey({ privateKey, recipient, relay: isConnected ? write : null, onStatus: setProgress });
      setDone({ hash, recipient, wallet: mode === "new" ? wallet : null });
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setProgress(null);
    }
  }

  if (done) return <Claimed link={link} note={note} done={done} />;

  const busy = Boolean(progress);
  const showInputError = mode === "existing" && ((touched && !inputValid) || Boolean(problem));

  return (
    <div className="panel receipt">
      <PaymentHeader link={link} note={note} state={expired ? "expired" : "waiting"} />
      <Details
        rows={[
          [expired ? "Expired" : "Expires", fmtDate(link.expiry)],
          ["Your network fee", needsWallet ? `Paid by your wallet (under ${fmt(funding.walletFee)} USDC)` : "None, the sender covered it"],
        ]}
      />
      <p className="hint spaced">
        {expired
          ? "This link has passed its expiry date, but you can still claim it until the sender takes the money back."
          : "The sender can take this money back until it's claimed, so it's best to claim it soon."}
      </p>
      {needsWallet && (
        <Alert alert={{ kind: "warn" }}>
          This link's fee allowance has run out. To claim, connect a wallet that has a little USDC on {chain.name}; it will pay a small
          network fee.
        </Alert>
      )}

      <fieldset className="field" disabled={busy}>
        <legend>Where should the money go?</legend>
        <div className="segmented">
          <button type="button" data-mode="new" aria-pressed={mode === "new"} onClick={() => setMode("new")}>
            New wallet
          </button>
          <button type="button" data-mode="existing" aria-pressed={mode === "existing"} onClick={() => setMode("existing")}>
            I have a wallet
          </button>
        </div>

        {mode === "new" ? (
          <div className="choice-panel">
            {!wallet ? (
              <>
                <p className="hint">
                  We'll create a wallet right here in your browser. You'll get a 12-word recovery phrase. It's the only way to access
                  the money, and it never leaves this page.
                </p>
                <Button variant="secondary" block id="genBtn" onClick={createWallet}>
                  Create my wallet
                </Button>
              </>
            ) : (
              <NewWallet wallet={wallet} saved={saved} setSaved={setSaved} />
            )}
          </div>
        ) : (
          <div className="choice-panel">
            <div className="field">
              <label htmlFor={ids.recipient}>Your wallet address on {chain.name}</label>
              <input
                id={ids.recipient}
                name="recipient"
                className={showInputError ? "is-invalid" : ""}
                placeholder="0x…"
                autoComplete="off"
                spellCheck={false}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onBlur={() => setTouched(true)}
                aria-invalid={showInputError}
                aria-describedby={ids.recipientHint}
              />
              <p id={ids.recipientHint} className={showInputError ? "field-error" : "hint"}>
                {problem ||
                  (showInputError
                    ? "That doesn't look like a wallet address. It starts with 0x and is 42 characters long."
                    : "Any Ethereum-style address works, for example from MetaMask or Rainbow.")}
              </p>
              {isContract && (
                <Alert alert={{ kind: "warn" }} id="contractWarning">
                  This address is a smart contract. Only continue if it can receive USDC on {chain.name}; if it can't, the claim fails and
                  you can try another address.
                </Alert>
              )}
            </div>
            <Button variant="secondary" block onClick={fillConnected}>
              {address ? `Use connected wallet (${short(address)})` : "Connect a wallet"}
            </Button>
          </div>
        )}
      </fieldset>

      {progress?.step === "preparing" && <Alert alert={{ busy: true, text: "Preparing your claim…" }} />}
      {progress?.step === "wallet" && <Alert alert={{ busy: true, text: "Confirm the network fee in your wallet…" }} />}
      {progress?.step === "confirming" && <Alert alert={{ busy: true, text: `Claiming. Waiting for ${chain.name} to confirm…`, hash: progress.hash }} />}
      <Alert alert={error && { kind: "error", text: error }} id="claimError" />

      <Button size="lg" block id="claimBtn" disabled={!ready} loading={busy} onClick={claim}>
        {busy ? "Claiming…" : needsWallet && !isConnected ? "Connect wallet to pay fee" : `Claim ${fmt(link.amount)} USDC`}
      </Button>
      {!ready && !busy && (
        <p className="hint center">
          {mode === "new"
            ? wallet
              ? "Confirm you've saved your recovery phrase to continue."
              : "Create a wallet or enter yours to continue."
            : "Enter a valid wallet address to continue."}
        </p>
      )}
    </div>
  );
}

/** Whether an address has contract code (EIP-7702 delegated accounts count as wallets). null while unknown. */
function useHasCode(address) {
  const [hasCode, setHasCode] = useState(null);
  useEffect(() => {
    setHasCode(null);
    if (!address) return;
    let live = true;
    publicClient
      .getCode({ address })
      .then((code) => live && setHasCode(Boolean(code && code !== "0x" && !code.startsWith("0xef0100"))))
      .catch(() => live && setHasCode(null));
    return () => {
      live = false;
    };
  }, [address]);
  return hasCode;
}

function NewWallet({ wallet, saved, setSaved }) {
  function download() {
    const text = `LinkCash wallet backup

Address: ${wallet.address}
Recovery phrase: ${wallet.phrase}

Keep this secret. Anyone with the phrase controls the money.
To use it, import the phrase into a wallet app (for example MetaMask or Rainbow) and add the ${chain.name} network:
  Chain ID: ${chain.id}
  RPC URL: ${chain.rpcUrls.default.http[0]}
  Currency: USDC
`;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    a.download = `linkcash-wallet-${wallet.address.slice(2, 8)}.txt`;
    a.click();
  }
  return (
    <div>
      <p className="label">Your new wallet address</p>
      <p className="mono address-box" id="newAddr">
        {wallet.address}
      </p>
      <p className="label">Recovery phrase</p>
      <ol className="phrase" aria-label="Recovery phrase, 12 words">
        {wallet.phrase.split(" ").map((w, i) => (
          <li key={i}>{w}</li>
        ))}
      </ol>
      <p className="hint">Write these words down or download the backup. Never share them: anyone with them can take the money.</p>
      <div className="btn-row">
        <Button variant="secondary" size="sm" onClick={download}>
          Download backup
        </Button>
        <CopyButton text={wallet.phrase} label="Copy phrase" variant="secondary" size="sm" />
      </div>
      <label className="check">
        <input type="checkbox" id="savedChk" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
        <span>I've saved my recovery phrase somewhere safe</span>
      </label>
    </div>
  );
}

function Claimed({ link, note, done }) {
  const headingRef = useFocusHeading();
  return (
    <div className="panel receipt" id="claimSuccess">
      <p className="confirmed-line">
        <span className="live-dot" aria-hidden="true" />
        Confirmed on {chain.name}
      </p>
      <h1 id="claim-title" tabIndex={-1} ref={headingRef} className="received-title">
        You received <Amount value={link.amount} as="span" />
      </h1>
      <Message text={note} />
      <Details
        rows={[
          ["Sent to", <span className="mono">{short(done.recipient)}</span>],
          ["Transaction", <TxLink hash={done.hash}>View on explorer</TxLink>],
        ]}
      />
      <Alert alert={{ kind: "success", text: `Confirmed on ${chain.name}. The money is in the wallet above.` }} id="claimStatus" />
      {done.wallet && (
        <div className="note">
          <h2>Using your new wallet</h2>
          <ol className="plain-list numbered">
            <li>Keep your recovery phrase safe. It's the only way to reach this money.</li>
            <li>Import the phrase into a wallet app, such as MetaMask or Rainbow.</li>
            <li>
              Add the {chain.name} network: chain ID <strong>{chain.id}</strong>, RPC URL{" "}
              <span className="mono">{chain.rpcUrls.default.http[0]}</span>, currency USDC.
            </li>
          </ol>
        </div>
      )}
    </div>
  );
}
