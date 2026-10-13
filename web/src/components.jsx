// Shared UI building blocks used across every page.
import { useEffect, useRef, useState } from "react";
import { formatEther } from "viem";
import { useAccount, useBalance, useSwitchChain } from "wagmi";
import { chain } from "./config";
import { addressUrl, cleanMessage, errMsg, fmt, short, txUrl } from "./linkcash";
import { Link } from "./router";

const ExternalIcon = () => (
  <svg className="ext-icon" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
    <path d="M6 3h7v7M13 3 5.5 10.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export function TxLink({ hash, children = "View transaction" }) {
  return (
    <a href={txUrl(hash)} target="_blank" rel="noopener" className="tx-link">
      {children}
      <ExternalIcon />
      <span className="sr-only"> (opens the block explorer)</span>
    </a>
  );
}

export function AddressLink({ address }) {
  return (
    <a className="mono" href={addressUrl(address)} target="_blank" rel="noopener" title={address}>
      {short(address)}
      <span className="sr-only"> (opens the block explorer)</span>
    </a>
  );
}

/** alert: null | { kind: "info" | "success" | "warn" | "error", text, hash?, busy? } */
export function Alert({ alert, id, children }) {
  if (!alert && !children) return null;
  const kind = alert?.kind || "info";
  return (
    <div id={id} className={`alert alert-${kind}`} role={kind === "error" ? "alert" : "status"}>
      {alert?.busy && <Spinner />}
      <div>
        {alert?.text}
        {children}
        {alert?.hash && (
          <>
            {" "}
            <TxLink hash={alert.hash} />
          </>
        )}
      </div>
    </div>
  );
}

export const STATES = {
  loading: { label: "Checking", tone: "neutral" },
  waiting: { label: "Waiting to be claimed", tone: "info" },
  expired: { label: "Expired, not claimed", tone: "warn" },
  claimed: { label: "Claimed", tone: "success" },
  reclaimed: { label: "Taken back", tone: "neutral" },
  refunded: { label: "Refunded", tone: "neutral" },
  completed: { label: "Claimed or taken back", tone: "neutral" },
  confirming: { label: "Confirming", tone: "info" },
  failed: { label: "Failed", tone: "error" },
  notsent: { label: "Not sent", tone: "neutral" },
  conflict: { label: "Not sent", tone: "neutral" },
  unknown: { label: "Status unavailable", tone: "neutral" },
};
export const OPEN_STATES = ["waiting", "expired"];

export function Badge({ state, children }) {
  const s = STATES[state];
  return <span className={`badge badge-${s?.tone || "neutral"}`}>{children || s?.label || state}</span>;
}

export function Spinner() {
  return <span className="spinner" aria-hidden="true" />;
}

export function Button({ variant = "primary", size, block, loading, children, className = "", ...props }) {
  const cls = ["btn", `btn-${variant}`, size && `btn-${size}`, block && "btn-block", className].filter(Boolean).join(" ");
  return (
    <button type="button" className={cls} aria-busy={loading || undefined} {...props} disabled={props.disabled || loading}>
      {loading && <Spinner />}
      {children}
    </button>
  );
}

/** A router link styled as a button. */
export function ButtonLink({ to, variant = "primary", size, block, className = "", ...props }) {
  const cls = ["btn", `btn-${variant}`, size && `btn-${size}`, block && "btn-block", className].filter(Boolean).join(" ");
  return <Link to={to} className={cls} {...props} />;
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
}

export function CopyButton({ text, label = "Copy", copiedLabel = "Copied", ...props }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(t);
  }, [copied]);
  return (
    <Button
      {...props}
      onClick={async () => {
        await copyText(text);
        setCopied(true);
      }}
    >
      {copied ? copiedLabel : label}
      <span className="sr-only" aria-live="polite">
        {copied ? "Copied to clipboard" : ""}
      </span>
    </Button>
  );
}

/** Modal built on the native <dialog>, which handles focus trapping and Escape. */
export function Dialog({ open, onClose, title, dismissible = true, id, children }) {
  const ref = useRef(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      id={id}
      className="dialog"
      aria-labelledby={`${id}-title`}
      onCancel={(e) => {
        e.preventDefault();
        if (dismissible) onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current && dismissible) onClose();
      }}
    >
      <div className="dialog-panel">
        <div className="dialog-head">
          <h2 id={`${id}-title`}>{title}</h2>
          {dismissible && (
            <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
              <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                <path d="M3.5 3.5l9 9m0-9-9 9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </button>
          )}
        </div>
        {open && children}
      </div>
    </dialog>
  );
}

/** Label/value rows for summaries. rows: [label, value, hint?] (falsy rows are skipped). */
export function Details({ rows }) {
  return (
    <dl className="details">
      {rows.filter(Boolean).map(([k, v, hint]) => (
        <div key={k}>
          <dt>
            {k}
            {hint && <span className="dt-hint">{hint}</span>}
          </dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * The sender's message, shown only when the link actually has one. Messages
 * travel inside the link, so `unverified` adds a note that nobody checks them.
 */
export function Message({ text, label = "Message from the sender", id, unverified = false }) {
  const shown = cleanMessage(text);
  if (!shown) return null;
  return (
    <figure className="message" id={id}>
      <figcaption>{label}</figcaption>
      <blockquote className="message-text">{shown}</blockquote>
      {unverified && <p className="message-hint">Messages come with the link and aren't checked by LinkCash.</p>}
    </figure>
  );
}

const moneyFormat = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 });

/** Splits a wei amount into the whole part and the decimal part, using the reader's locale. */
export function moneyParts(wei) {
  let whole = "";
  let frac = "";
  for (const part of moneyFormat.formatToParts(Number(formatEther(wei)))) {
    if (part.type === "decimal" || part.type === "fraction") frac += part.value;
    else whole += part.value;
  }
  return { whole, frac };
}

/**
 * A large amount with the decimals set smaller and raised, so the whole
 * number reads first. The element with `id` contains exactly the formatted
 * amount (e.g. "25.00"), which tests and assistive tech read as one string.
 */
export function Amount({ value, id, as: Tag = "p", size = "lg" }) {
  const { whole, frac } = moneyParts(value);
  return (
    <Tag className={`amount amount-${size}`}>
      <span id={id} className="amount-figure">
        {whole}
        <span className="amount-frac">{frac}</span>
      </span>{" "}
      <span className="amount-unit">USDC</span>
    </Tag>
  );
}

const BackIcon = () => (
  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
    <path d="M10 3.5 5.5 8l4.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export function PageHeader({ title, lead, back, headingRef, children }) {
  return (
    <div className="page-header">
      {back && (
        <Link to={back.to} className="back-link">
          <BackIcon />
          {back.label}
        </Link>
      )}
      <div className="page-header-row">
        <div>
          <h1 tabIndex={-1} ref={headingRef}>
            {title}
          </h1>
          {lead && <p className="lead">{lead}</p>}
        </div>
        {children}
      </div>
    </div>
  );
}

export function EmptyState({ title, children, action }) {
  return (
    <div className="empty">
      <p className="empty-title">{title}</p>
      {children && <p className="hint">{children}</p>}
      {action}
    </div>
  );
}

export function Skeleton({ width = "100%", height = 14, style }) {
  return <div className="skeleton" style={{ width, height, ...style }} />;
}

/** Connected wallet, network and balance, with a one-click switch to Arc. */
export function WalletStatus() {
  const { address, chainId, isConnected } = useAccount();
  const { switchChain, isPending } = useSwitchChain();
  const balance = useBalance({ address, chainId: chain.id, query: { enabled: Boolean(address) } });
  if (!isConnected) return null;
  const onArc = chainId === chain.id;
  return (
    <div className="wallet-status" aria-label="Your wallet">
      <div>
        <span className="ws-label">Wallet</span>
        <AddressLink address={address} />
      </div>
      <div>
        <span className="ws-label">Network</span>
        <span className={onArc ? "ws-ok" : "ws-warn"}>
          <span className="dot" aria-hidden="true" />
          {onArc ? `${chain.name} (chain ${chain.id})` : "Different network"}
        </span>
      </div>
      <div>
        <span className="ws-label">Balance</span>
        <span className="tnum">{balance.isError ? "Unavailable" : balance.data ? `${fmt(balance.data.value)} USDC` : "Loading"}</span>
      </div>
      {!onArc && (
        <Alert alert={{ kind: "warn" }}>
          Your wallet is on another network. LinkCash only works on {chain.name}.{" "}
          <button type="button" className="text-btn" onClick={() => switchChain({ chainId: chain.id })} disabled={isPending}>
            Switch to {chain.name}
          </button>
        </Alert>
      )}
      {balance.isError && (
        <Alert alert={{ kind: "error", text: errMsg(balance.error) }}>
          {" "}
          <button type="button" className="text-btn" onClick={() => balance.refetch()}>
            Try again
          </button>
        </Alert>
      )}
    </div>
  );
}

/** Moves focus to a page's heading when it mounts, for keyboard and screen-reader users. */
export function useFocusHeading() {
  const ref = useRef(null);
  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
  }, []);
  return ref;
}
