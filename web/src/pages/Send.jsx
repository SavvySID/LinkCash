import { useConnectModal } from "@rainbow-me/rainbowkit";
import { useEffect, useId, useState } from "react";
import { useAccount, useBalance } from "wagmi";
import { Alert, Amount, Button, ButtonLink, Details, Dialog, Message, PageHeader, useFocusHeading, WalletStatus } from "../components";
import { chain, CONTRACT_ADDRESS, GAS_ALLOWANCE } from "../config";
import { NotConfigured } from "../layout";
import { createLink, errMsg, estimateCreateFee, fmt, fmtDate, GAS_ALLOWANCE_WEI, loadLinks, MESSAGE_MAX, parseAmount, UnresolvedCreateError } from "../linkcash";
import { useLinkCashWrite } from "../providers";
import { Link, navigate } from "../router";

const EXPIRY_OPTIONS = [1, 7, 30, 90];
const dayLabel = (d) => (d === 1 ? "1 day" : `${d} days`);
const expiryFrom = (days) => Math.floor(Date.now() / 1000) + days * 86400;

export function SendPage() {
  const headingRef = useFocusHeading();
  return (
    <div className="container container-mid page">
      <PageHeader
        title="Create a payment link"
        lead="Lock USDC behind a private link. Whoever opens it can claim the money, even without a crypto wallet."
        headingRef={headingRef}
      />
      {CONTRACT_ADDRESS && <UnresolvedNotice />}
      {CONTRACT_ADDRESS ? <SendForm /> : <NotConfigured what="Payment links" />}
    </div>
  );
}

/** A link whose creation couldn't be confirmed must be checked before paying again. */
function UnresolvedNotice() {
  const [pending] = useState(() => loadLinks().filter((r) => r.unresolved));
  if (!pending.length) return null;
  return (
    <Alert alert={{ kind: "warn" }} id="unresolvedNotice">
      {pending.length === 1 ? "A payment link you started earlier hasn't been confirmed yet." : `${pending.length} payment links you started earlier haven't been confirmed yet.`}{" "}
      Check My links before creating another, so you don't pay twice.{" "}
      <Link to="/links">Check My links</Link>
    </Alert>
  );
}

function SendForm() {
  const { address, isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();
  const write = useLinkCashWrite();
  const { data: balanceData, refetch: refetchBalance } = useBalance({ address, chainId: chain.id, query: { enabled: Boolean(address) } });
  const balance = balanceData?.value;

  // An amount carried over from the landing-page calculator (/send?amount=…), if it's valid.
  const [amountText, setAmountText] = useState(() => {
    const carried = new URLSearchParams(location.search).get("amount") || "";
    return parseAmount(carried).value != null ? carried : "";
  });
  const [showErrors, setShowErrors] = useState(false);
  const [days, setDays] = useState(7);
  const [note, setNote] = useState("");
  // null (no estimate yet) | "pending" | "unavailable" | bigint wei
  const [fee, setFee] = useState(null);
  const [reviewing, setReviewing] = useState(false);
  const [progress, setProgress] = useState(null);
  const [txError, setTxError] = useState(null);
  const [unresolved, setUnresolved] = useState(null);
  const ids = { amount: useId(), amountHint: useId(), note: useId(), noteHint: useId(), expiryHint: useId() };

  const parsed = parseAmount(amountText);
  const total = parsed.value != null ? parsed.value + GAS_ALLOWANCE_WEI : null;
  const feeWei = typeof fee === "bigint" ? fee : 0n;
  const shortfall = balance != null && total != null && balance < total + feeWei;
  const amountError =
    parsed.error ?? (shortfall ? `Not enough USDC. This wallet has ${fmt(balance)} USDC on ${chain.name}, including what's needed for fees.` : null);
  const message = note.trim() ? note : "";

  // Live network-fee estimate for the create transaction.
  useEffect(() => {
    if (!address || parsed.value == null || (balance != null && balance < total)) return setFee(null);
    setFee("pending");
    let live = true;
    const t = setTimeout(() => {
      estimateCreateFee({ account: address, value: parsed.value, days })
        .then((f) => live && setFee(f))
        .catch(() => live && setFee("unavailable"));
    }, 350);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [address, amountText, days, balance]); // eslint-disable-line react-hooks/exhaustive-deps

  function review(e) {
    e.preventDefault();
    setShowErrors(true);
    if (amountError) return document.getElementById(ids.amount)?.focus();
    setTxError(null);
    setReviewing(true);
  }

  async function confirm() {
    setTxError(null);
    try {
      const record = await createLink({ write, sender: address, value: parsed.value, days, note: message, onStatus: setProgress });
      refetchBalance();
      // Only reached once the transaction is confirmed on-chain.
      navigate(`/links/${record.claimKey}?created=1`);
    } catch (e) {
      // If the wallet may have sent it, never offer a blind retry: send the user to the saved link instead.
      if (e instanceof UnresolvedCreateError) setUnresolved({ claimKey: e.claimKey, text: e.message });
      else setTxError(errMsg(e));
      setProgress(null);
    }
  }

  const busy = Boolean(progress);
  const invalid = showErrors && Boolean(amountError);

  return (
    <div className="send-grid">
      <form className="panel sheet" onSubmit={review} noValidate aria-label="Payment details">
        <div className="field">
          <label className="calc-label" htmlFor={ids.amount}>
            You send
          </label>
          <div className={`calc-amount${invalid ? " is-invalid" : ""}`}>
            <span className="currency-pill">USDC</span>
            <input
              id={ids.amount}
              name="amount"
              inputMode="decimal"
              autoComplete="off"
              placeholder="0.00"
              value={amountText}
              onChange={(e) => setAmountText(e.target.value)}
              aria-invalid={invalid}
              aria-describedby={ids.amountHint}
            />
          </div>
          <p id={ids.amountHint} className={invalid ? "field-error" : "hint"}>
            {invalid ? amountError : balance != null ? `Available: ${fmt(balance)} USDC on ${chain.name}` : "Minimum 0.01 USDC, up to 6 decimal places."}
          </p>
        </div>

        <FeeSummary value={parsed.value} fee={fee} connected={isConnected} />

        <fieldset className="field">
          <legend>Link expires after</legend>
          <div className="chips" role="radiogroup" aria-describedby={ids.expiryHint}>
            {EXPIRY_OPTIONS.map((d) => (
              <label key={d} className="chip">
                <input type="radio" name="expiry" value={d} checked={days === d} onChange={() => setDays(d)} />
                <span>{dayLabel(d)}</span>
              </label>
            ))}
          </div>
          <p id={ids.expiryHint} className="hint">
            Expires {fmtDate(expiryFrom(days))}. You can take unclaimed money back at any time from My links on this device. After
            expiry, the link keeps working until you do, and your wallet can also refund it from the contract.
          </p>
        </fieldset>

        <div className="field">
          <label htmlFor={ids.note}>
            Message <span className="optional">(optional)</span>
          </label>
          <textarea
            id={ids.note}
            name="note"
            rows={3}
            maxLength={MESSAGE_MAX}
            placeholder="Add a note for the recipient"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            aria-describedby={ids.noteHint}
          />
          <p id={ids.noteHint} className="hint hint-split">
            <span>Saved inside the link itself, not on the blockchain. Anyone with the link can read it.</span>
            <span aria-hidden="true">
              {note.length}/{MESSAGE_MAX}
            </span>
          </p>
        </div>

        {isConnected ? (
          <Button type="submit" block id="reviewBtn">
            Review payment
          </Button>
        ) : (
          <Button block id="reviewBtn" onClick={openConnectModal}>
            Connect wallet to continue
          </Button>
        )}
      </form>

      <aside className="send-aside">
        <section className="aside-block" aria-labelledby="wallet-title">
          <h2 id="wallet-title">Paying from</h2>
          {isConnected ? (
            <WalletStatus />
          ) : (
            <>
              <p className="hint">Connect the wallet you want to pay from. It needs USDC on {chain.name}.</p>
              <Button variant="secondary" block onClick={openConnectModal}>
                Connect wallet
              </Button>
            </>
          )}
        </section>
        <section className="aside-block" aria-labelledby="fees-title">
          <h2 id="fees-title">What you pay</h2>
          <ul className="plain-list">
            <li>
              <strong>{GAS_ALLOWANCE} USDC claim fee allowance</strong> goes with the link and pays the recipient's network fee, so they
              don't need any USDC to claim. Any part of it that isn't used isn't returned.
            </li>
            <li>
              <strong>Network fee</strong> for creating the link is paid by your wallet in USDC. We show a live estimate; your wallet
              shows the final amount.
            </li>
            <li>LinkCash doesn't add any other fee.</li>
          </ul>
        </section>
      </aside>

      <Dialog id="review" open={reviewing} onClose={() => setReviewing(false)} dismissible={!busy && !unresolved} title="Review your payment link">
        <Amount value={parsed.value ?? 0n} size="md" />
        <Details
          rows={[
            ["They receive", `${fmt(parsed.value ?? 0n)} USDC`],
            ["Claim fee allowance", `${GAS_ALLOWANCE} USDC`, "Pays the recipient's network fee so they can claim for free"],
            ["Network fee", feeLabel(fee, true)],
            ["Expires", fmtDate(expiryFrom(days))],
          ]}
        />
        <Message text={message} label="Your message" />
        {progress?.step === "wallet" && <Alert alert={{ busy: true, text: "Confirm the transaction in your wallet…" }} />}
        {progress?.step === "confirming" && (
          <Alert alert={{ busy: true, text: `Locking your USDC on ${chain.name}. Waiting for confirmation…`, hash: progress.hash }} />
        )}
        <Alert alert={txError && { kind: "error", text: txError }} id="createError" />
        <Alert alert={unresolved && { kind: "warn", text: unresolved.text }} id="createUnresolved" />
        <div className="dialog-actions">
          {unresolved ? (
            <ButtonLink to={`/links/${unresolved.claimKey}`} id="checkStatusBtn">
              Check its status
            </ButtonLink>
          ) : (
            <>
              <Button variant="secondary" onClick={() => setReviewing(false)} disabled={busy}>
                Edit
              </Button>
              <Button id="confirmCreateBtn" onClick={confirm} loading={busy}>
                {busy ? "Creating…" : txError ? "Try again" : "Create link"}
              </Button>
            </>
          )}
        </div>
      </Dialog>
    </div>
  );
}

function feeLabel(fee, connected) {
  if (typeof fee === "bigint") return `≈ ${fmt(fee)} USDC`;
  if (fee === "pending") return "Estimating…";
  return connected ? "Shown in your wallet" : "Connect a wallet to estimate";
}

function FeeSummary({ value, fee, connected }) {
  if (value == null) return null;
  const known = typeof fee === "bigint";
  const total = value + GAS_ALLOWANCE_WEI + (known ? fee : 0n);
  return (
    <div className="summary" aria-live="polite">
      <Details
        rows={[
          ["They receive", `${fmt(value)} USDC`],
          ["Claim fee allowance", `${GAS_ALLOWANCE} USDC`],
          ["Network fee", feeLabel(fee, connected)],
          [
            "Total from your wallet",
            <strong>
              {known ? "≈ " : ""}
              {fmt(total)} USDC{known ? "" : " + network fee"}
            </strong>,
          ],
        ]}
      />
    </div>
  );
}
