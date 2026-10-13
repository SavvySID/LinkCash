// Share card and the two ways a sender gets unclaimed money back.
import qrcode from "qrcode-generator";
import { useMemo, useState } from "react";
import { useAccount } from "wagmi";
import { Alert, Button, CopyButton, Details, Dialog } from "./components";
import { chain } from "./config";
import { claimWithKey, errMsg, fmt, fmtDate, refundLink, short, upsertLink } from "./linkcash";
import { useLinkCashWrite } from "./providers";

const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

export function ShareCard({ link, amount, idPrefix = "" }) {
  const qr = useMemo(() => {
    const q = qrcode(0, "M");
    q.addData(link);
    q.make();
    return q.createDataURL(6, 12);
  }, [link]);

  function share() {
    navigator.share({ title: "You've been sent money", text: `You've been sent ${fmt(amount)} USDC. Claim it here:`, url: link }).catch(() => {});
  }

  return (
    <section className="panel share-panel" aria-labelledby={`${idPrefix}share-title`}>
      <h2 id={`${idPrefix}share-title`}>Share the link</h2>
      <p className="hint">Anyone who opens this link can claim the money, so send it only to the person you're paying.</p>
      <label className="sr-only" htmlFor="linkOut">
        Payment link
      </label>
      <input id="linkOut" className="link-field" readOnly value={link} onFocus={(e) => e.target.select()} />
      <div className="btn-row">
        <CopyButton text={link} label="Copy link" id="copyLinkBtn" />
        {canShare && (
          <Button variant="secondary" onClick={share}>
            Share…
          </Button>
        )}
      </div>
      <figure className="qr" id="qrOut">
        <img src={qr} alt="QR code of the payment link" width="220" height="220" />
        <figcaption>Scan to open the payment link</figcaption>
      </figure>
      <div className="btn-row center">
        <a className="btn btn-ghost btn-sm" href={qr} download="linkcash-payment-qr.gif">
          Download QR code
        </a>
      </div>
    </section>
  );
}

/** Take money back with the link key saved in this browser (works any time before it's claimed). */
export function ReclaimDialog({ target, onClose, onDone }) {
  const { isConnected } = useAccount();
  const write = useLinkCashWrite();
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState(null);
  const busy = Boolean(progress);
  const sender = target?.link?.sender;

  function close() {
    setError(null);
    onClose();
  }

  async function confirm() {
    setError(null);
    try {
      const hash = await claimWithKey({ privateKey: target.record.privateKey, recipient: sender, relay: isConnected ? write : null, onStatus: setProgress });
      upsertLink({ claimKey: target.record.claimKey, outcome: { type: "claimed", to: sender, hash } });
      setProgress(null);
      onDone(hash, fmt(target.link.amount));
    } catch (e) {
      setProgress(null);
      setError(errMsg(e));
    }
  }

  return (
    <Dialog id="reclaim" open={Boolean(target)} onClose={close} dismissible={!busy} title="Take this money back?">
      {target && (
        <>
          <p>
            <strong>{fmt(target.link.amount)} USDC</strong> goes back to the wallet that sent it, and the link stops working for the
            recipient.
          </p>
          <Details
            rows={[
              ["Returns to", <span className="mono">{short(sender)}</span>],
              ["Network fee", "Paid from the link's claim fee allowance"],
            ]}
          />
          {progress?.step === "preparing" && <Alert alert={{ busy: true, text: "Preparing…" }} />}
          {progress?.step === "wallet" && (
            <Alert alert={{ busy: true, text: "The link's fee allowance has run out, so your wallet will pay the network fee. Confirm it in your wallet…" }} />
          )}
          {progress?.step === "confirming" && <Alert alert={{ busy: true, text: "Waiting for confirmation…", hash: progress.hash }} />}
          <Alert alert={error && { kind: "error", text: error }} />
          <div className="dialog-actions">
            <Button variant="secondary" onClick={close} disabled={busy}>
              Cancel
            </Button>
            <Button id="confirmReclaimBtn" onClick={confirm} loading={busy}>
              {busy ? "Taking back…" : "Take money back"}
            </Button>
          </div>
        </>
      )}
    </Dialog>
  );
}

/** After expiry the contract's refund() lets the sender's wallet recover funds without the link key. */
export function RefundDialog({ open, claimKey, link, onClose, onDone }) {
  const write = useLinkCashWrite();
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState(null);
  const busy = Boolean(progress);

  async function confirm() {
    setError(null);
    try {
      const hash = await refundLink({ write, claimKey, onStatus: setProgress });
      setProgress(null);
      onDone(hash);
    } catch (e) {
      setProgress(null);
      setError(errMsg(e));
    }
  }

  return (
    <Dialog id="refund" open={open} onClose={onClose} dismissible={!busy} title="Refund this link?">
      <p>
        The link expired on {fmtDate(link.expiry)}, so the contract lets the sending wallet refund it. <strong>{fmt(link.amount)} USDC</strong>{" "}
        goes back to <span className="mono">{short(link.sender)}</span>.
      </p>
      <Details rows={[["Network fee", `Paid by your wallet in USDC on ${chain.name}`]]} />
      {progress?.step === "wallet" && <Alert alert={{ busy: true, text: "Confirm the refund in your wallet…" }} />}
      {progress?.step === "confirming" && <Alert alert={{ busy: true, text: "Waiting for confirmation…", hash: progress.hash }} />}
      <Alert alert={error && { kind: "error", text: error }} />
      <div className="dialog-actions">
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button id="confirmRefundBtn" onClick={confirm} loading={busy}>
          {busy ? "Refunding…" : "Refund"}
        </Button>
      </div>
    </Dialog>
  );
}
