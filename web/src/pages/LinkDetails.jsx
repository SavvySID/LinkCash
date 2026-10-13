import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { AddressLink, Alert, Amount, Badge, Button, ButtonLink, Details, Message, OPEN_STATES, PageHeader, Skeleton, TxLink, useFocusHeading } from "../components";
import { chain, CONTRACT_ADDRESS } from "../config";
import { NotConfigured } from "../layout";
import { ReclaimDialog, RefundDialog, ShareCard } from "../linkActions";
import { deriveState, errMsg, fetchOutcomes, findRecord, fmtDate, fmtDay, isLinkId, readLink, reconcileRecord, recordLink, recordNote, removeLink, upsertLink } from "../linkcash";
import { navigate, useLocation } from "../router";

/** /links/:id — one link's verified status and the actions its state allows. ?created=1 marks a just-created link. */
export function LinkDetailsPage({ id }) {
  return <div className="container container-mid page">{CONTRACT_ADDRESS ? <LinkDetails id={id} /> : <NotConfigured what="Link details" />}</div>;
}

function LinkDetails({ id }) {
  const { search } = useLocation();
  const justCreated = new URLSearchParams(search).has("created");
  const [data, setData] = useState({ kind: "loading" });
  const [version, setVersion] = useState(0);
  const [notice, setNotice] = useState(null);
  const [dialog, setDialog] = useState(null);
  const { address } = useAccount();
  const reload = () => setVersion((v) => v + 1);

  useEffect(() => {
    if (!isLinkId(id)) return setData({ kind: "invalid" });
    let live = true;
    (async () => {
      try {
        const link = await readLink(id);
        const record = await reconcileRecord(findRecord(id), link);
        if (!record && !link.exists) return live && setData({ kind: "missing" });
        let outcome = record?.outcome ?? null;
        if (link.settled && !outcome) {
          const outcomes = await fetchOutcomes([id], record?.block ? BigInt(record.block) : "earliest").catch(() => ({}));
          outcome = Object.entries(outcomes).find(([k]) => k.toLowerCase() === id.toLowerCase())?.[1] ?? null;
          if (outcome && record) upsertLink({ claimKey: record.claimKey, outcome });
        }
        const withOutcome = record ? { ...record, outcome } : { outcome };
        const state = await deriveState(withOutcome, link);
        if (live) setData({ kind: "ok", record, link, outcome, state });
      } catch (e) {
        if (live) setData({ kind: "error", message: errMsg(e) });
      }
    })();
    return () => {
      live = false;
    };
  }, [id, version]);

  if (data.kind === "loading") {
    return (
      <div className="panel" role="status">
        <span className="sr-only">Loading link…</span>
        <Skeleton width="30%" />
        <Skeleton width="50%" height={44} style={{ margin: "14px 0" }} />
        <Skeleton height={120} />
      </div>
    );
  }
  if (data.kind !== "ok") {
    const copy = {
      invalid: ["That isn't a valid link ID", "Link IDs start with 0x and are 42 characters long. Open a link from My links instead."],
      missing: ["We couldn't find this link", `There's no payment with this ID on ${chain.name}, and it wasn't created in this browser.`],
      error: ["Couldn't load this link", data.message],
    }[data.kind];
    return <Problem title={copy[0]} text={copy[1]} onRetry={data.kind === "error" ? reload : null} />;
  }

  const { record, link, outcome, state } = data;
  const note = record ? recordNote(record) : null;
  const open = OPEN_STATES.includes(state);
  // A conflicting on-chain link belongs to someone else: show only this browser's record.
  const onChain = link.exists && state !== "conflict";
  const isSender = address && onChain && address.toLowerCase() === link.sender.toLowerCase();
  // The "ready" banner is only for a link this browser just created.
  const success = justCreated && Boolean(record) && onChain && !link.settled;
  const amount = onChain ? link.amount : BigInt(record.amount);

  return (
    <>
      {success ? (
        <SuccessHeader amount={amount} />
      ) : (
        <DetailsHeader />
      )}

      <Alert alert={notice} id="detailsNotice" />

      <div className="details-grid">
        <section className="panel" aria-labelledby="summary-title">
          <div className="claim-head">
            <h2 id="summary-title">Payment</h2>
            <Badge state={state} />
          </div>
          {!success && <Amount value={amount} />}
          {note != null ? (
            <Message text={note} label="Your message" />
          ) : (
            <p className="hint">Messages travel inside the link, so this one is only visible with the full link.</p>
          )}
          <Details
            rows={[
              ["Status", <StatusText state={state} outcome={outcome} />],
              onChain && ["Sender", <AddressLink address={link.sender} />],
              record && ["Created", fmtDay(record.created)],
              [state === "expired" ? "Expired" : "Expires", fmtDate(onChain ? link.expiry : record.expiry)],
              record?.txHash && ["Created in", <TxLink hash={record.txHash}>Transaction</TxLink>],
              outcome?.hash && [state === "claimed" ? "Claimed in" : "Returned in", <TxLink hash={outcome.hash}>Transaction</TxLink>],
              ["Link ID", <span className="mono">{id}</span>],
            ]}
          />
        </section>

        <div className="details-side">
          {record && open && <ShareCard link={recordLink(record)} amount={amount} />}
          <Actions
            state={state}
            record={record}
            link={link}
            isSender={isSender}
            onReclaim={() => setDialog("reclaim")}
            onRefund={() => setDialog("refund")}
            onRemove={() => {
              removeLink(record.claimKey);
              navigate("/links");
            }}
          />
        </div>
      </div>

      <ReclaimDialog
        target={dialog === "reclaim" ? { record, link } : null}
        onClose={() => setDialog(null)}
        onDone={(hash, amt) => {
          setDialog(null);
          setNotice({ kind: "success", text: `${amt} USDC is back in the sending wallet.`, hash });
          reload();
        }}
      />
      {onChain && (
        <RefundDialog
          open={dialog === "refund"}
          claimKey={id}
          link={link}
          onClose={() => setDialog(null)}
          onDone={(hash) => {
            setDialog(null);
            setNotice({ kind: "success", text: "Refunded to the sending wallet.", hash });
            reload();
          }}
        />
      )}
    </>
  );
}

function SuccessHeader({ amount }) {
  const headingRef = useFocusHeading();
  return (
    <div className="page-header created-header" id="createdBanner">
      <p className="confirmed-line">
        <span className="live-dot" aria-hidden="true" />
        Confirmed on {chain.name}
      </p>
      <h1 tabIndex={-1} ref={headingRef}>
        Your payment link is ready
      </h1>
      <Amount value={amount} />
      <p className="lead">Share the link with the person you're paying. Anyone who opens it can claim the money.</p>
    </div>
  );
}

function DetailsHeader() {
  const headingRef = useFocusHeading();
  return <PageHeader title="Link details" back={{ to: "/links", label: "My links" }} headingRef={headingRef} />;
}

function StatusText({ state, outcome }) {
  const to = outcome?.to;
  const text = {
    waiting: "Waiting for the recipient to claim",
    expired: "Expired, still claimable until taken back",
    claimed: to ? `Claimed by ${to.slice(0, 6)}…${to.slice(-4)}` : "Claimed",
    reclaimed: "Taken back by the sender",
    refunded: "Refunded to the sender",
    completed: "Claimed or taken back",
    confirming: "Waiting for the creation transaction to confirm",
    failed: "Creation failed; no money was locked",
    notsent: "Never confirmed on Arc; no money was locked",
    conflict: "Not created: this link's key was already used on Arc, so no money was locked",
  }[state];
  return <span>{text}</span>;
}

function Actions({ state, record, link, isSender, onReclaim, onRefund, onRemove }) {
  const open = OPEN_STATES.includes(state);
  const expired = state === "expired";
  return (
    <section className="aside-block" aria-labelledby="actions-title">
      <h2 id="actions-title">Getting money back</h2>
      {open && record && (
        <>
          <p className="hint">
            Until it's claimed, you can take this money back at any time. It goes to the sending wallet, and the network fee comes out of
            the link's claim fee allowance.
          </p>
          <Button variant="secondary" block onClick={onReclaim} id="detailsReclaimBtn">
            Take money back
          </Button>
        </>
      )}
      {open && !record && expired && (
        <>
          <p className="hint">
            This link's key isn't saved in this browser, but it has expired, so the wallet that created it can refund it directly from
            the contract.
          </p>
          {isSender ? (
            <Button variant="secondary" block onClick={onRefund} id="refundBtn">
              Refund to my wallet
            </Button>
          ) : (
            <p className="hint">Connect the wallet that created this link to refund it.</p>
          )}
        </>
      )}
      {open && !record && !expired && (
        <p className="hint">
          This link's key isn't saved in this browser. After it expires on {fmtDate(link.expiry)}, the wallet that created it can refund it
          here.
        </p>
      )}
      {!open && ["claimed", "reclaimed", "refunded", "completed"].includes(state) && <p className="hint">This payment is settled, so there's nothing left to take back.</p>}
      {["failed", "notsent", "conflict"].includes(state) && (
        <>
          <p className="hint">
            No money is locked behind this link. You can remove it from your list.
            {state === "notsent" && " If your wallet still shows this payment as pending, wait: removing deletes the only copy of its key."}
          </p>
          <Button variant="ghost" block onClick={onRemove}>
            Remove from My links
          </Button>
        </>
      )}
      {state === "confirming" && (
        <p className="hint">
          Waiting for this payment to appear on {chain.name}. Don't create it again while it's confirming. If nothing arrives within a few
          minutes, it will show as Not sent.
        </p>
      )}
      <ButtonLink to="/links" variant="ghost" block>
        Back to My links
      </ButtonLink>
    </section>
  );
}

function Problem({ title, text, onRetry }) {
  const headingRef = useFocusHeading();
  return (
    <div className="panel problem">
      <h1 tabIndex={-1} ref={headingRef}>
        {title}
      </h1>
      <p className="hint">{text}</p>
      <div className="btn-row">
        {onRetry && (
          <Button variant="secondary" onClick={onRetry}>
            Try again
          </Button>
        )}
        <ButtonLink to="/links" variant="secondary">
          Go to My links
        </ButtonLink>
      </div>
    </div>
  );
}
