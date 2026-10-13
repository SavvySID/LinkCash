import { useId, useMemo, useState } from "react";
import { Alert, Amount, Badge, Button, ButtonLink, CopyButton, EmptyState, OPEN_STATES, PageHeader, Skeleton, TxLink, useFocusHeading } from "../components";
import { chain, CONTRACT_ADDRESS } from "../config";
import { NotConfigured } from "../layout";
import { ReclaimDialog } from "../linkActions";
import { cleanMessage, fmt, fmtDate, fmtDay, recordLink, recordNote, short } from "../linkcash";
import { Link, navigate } from "../router";
import { useMyLinks } from "../useMyLinks";

const FILTERS = [
  { key: "all", label: "All", match: () => true },
  { key: "open", label: "Waiting", match: (s) => s === "waiting" },
  { key: "expired", label: "Expired", match: (s) => s === "expired" },
  { key: "claimed", label: "Claimed", match: (s) => s === "claimed" },
  { key: "back", label: "Taken back", match: (s) => ["reclaimed", "refunded", "completed"].includes(s) },
  { key: "other", label: "Other", match: (s) => ["confirming", "failed", "notsent", "unknown"].includes(s) },
];

export function LinksPage() {
  const headingRef = useFocusHeading();
  return (
    <div className="container page">
      <PageHeader title="My links" lead={`Payment links created in this browser, with their live status on ${chain.name}.`} headingRef={headingRef}>
        {CONTRACT_ADDRESS && (
          <ButtonLink to="/send" id="newLinkBtn">
            Create payment link
          </ButtonLink>
        )}
      </PageHeader>
      {CONTRACT_ADDRESS ? <Dashboard /> : <NotConfigured what="Your links" />}
    </div>
  );
}

function Dashboard() {
  const links = useMyLinks();
  const { rows, loaded, error, refresh, remove } = links;
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [reclaiming, setReclaiming] = useState(null);
  const [notice, setNotice] = useState(null);
  const searchId = useId();

  const stats = useMemo(() => {
    const sum = (list) => list.reduce((a, r) => a + BigInt(r.record.amount), 0n);
    const open = rows.filter((r) => OPEN_STATES.includes(r.state));
    const claimed = rows.filter((r) => r.state === "claimed");
    const back = rows.filter((r) => ["reclaimed", "refunded"].includes(r.state));
    return { open, openSum: sum(open), claimed, claimedSum: sum(claimed), back, backSum: sum(back), expired: rows.filter((r) => r.state === "expired") };
  }, [rows]);

  const q = query.trim().toLowerCase();
  const visible = rows.filter((r) => {
    if (!FILTERS.find((f) => f.key === filter).match(r.state)) return false;
    if (!q) return true;
    return [fmt(BigInt(r.record.amount)), recordNote(r.record), r.record.claimKey].some((v) => v.toLowerCase().includes(q));
  });

  // Pasting a payment link or link ID jumps to its details, even if it wasn't created here.
  const pastedId = query.match(/0x[0-9a-fA-F]{40}/)?.[0];

  if (!rows.length && loaded) {
    return (
      <>
        <StorageNote />
        <div className="panel">
          <EmptyState title="No payment links yet" action={<ButtonLink to="/send">Create your first link</ButtonLink>}>
            Links you create in this browser appear here with their live status, so you can share them again or take back unclaimed
            money.
          </EmptyState>
        </div>
      </>
    );
  }

  return (
    <>
      <section className="stat-grid" aria-label="Summary">
        <Stat label="Waiting to be claimed" value={`${fmt(stats.openSum)} USDC`} sub={plural(stats.open.length, "link")} loading={!loaded} />
        <Stat label="Claimed" value={`${fmt(stats.claimedSum)} USDC`} sub={plural(stats.claimed.length, "link")} loading={!loaded} />
        <Stat label="Taken back or refunded" value={`${fmt(stats.backSum)} USDC`} sub={plural(stats.back.length, "link")} loading={!loaded} />
        <Stat label="Expired, not claimed" value={String(stats.expired.length)} sub={stats.expired.length ? "You can take these back" : "Nothing to do"} loading={!loaded} />
      </section>

      <Alert alert={notice} id="linksNotice" />
      {error && (
        <Alert alert={{ kind: "error", text: `Couldn't load the latest status from ${chain.name}. ${error}` }}>
          {" "}
          <button type="button" className="text-btn" onClick={refresh}>
            Try again
          </button>
        </Alert>
      )}

      <section className="panel table-panel" aria-labelledby="list-title">
        <div className="toolbar">
          <h2 id="list-title" className="sr-only">
            Payment links
          </h2>
          <div className="search">
            <label htmlFor={searchId} className="sr-only">
              Search links
            </label>
            <input
              id={searchId}
              type="search"
              placeholder="Search by amount, message or link ID"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="filter-chips" role="group" aria-label="Filter by status">
            {FILTERS.map((f) => (
              <button key={f.key} type="button" aria-pressed={filter === f.key} onClick={() => setFilter(f.key)}>
                {f.label}
              </button>
            ))}
          </div>
          <Button variant="ghost" size="sm" onClick={refresh}>
            Refresh
          </Button>
        </div>

        {pastedId && (
          <Alert alert={{ kind: "info" }}>
            Looking for a specific link?{" "}
            <Link to={`/links/${pastedId}`} className="text-link">
              Open details for {short(pastedId)}
            </Link>
          </Alert>
        )}

        {visible.length === 0 ? (
          <EmptyState title="No links match">Try a different search or status filter.</EmptyState>
        ) : (
          <div className="link-table" id="myLinks" role="list">
            <div className="link-table-head" aria-hidden="true">
              <span>Amount</span>
              <span>Status</span>
              <span>Message</span>
              <span>Created</span>
              <span>Expires</span>
              <span />
            </div>
            {visible.map((row) => (
              <LinkRow key={row.record.claimKey} row={row} onReclaim={() => setReclaiming(row)} onRemove={() => remove(row.record.claimKey)} />
            ))}
          </div>
        )}
      </section>

      <StorageNote />

      <ReclaimDialog
        target={reclaiming}
        onClose={() => setReclaiming(null)}
        onDone={(hash, amount) => {
          setReclaiming(null);
          setNotice({ kind: "success", text: `${amount} USDC is back in your wallet.`, hash });
          refresh();
        }}
      />
    </>
  );
}

function LinkRow({ row, onReclaim, onRemove }) {
  const { record, state } = row;
  const note = cleanMessage(recordNote(record));
  const open = OPEN_STATES.includes(state);
  const details = `/links/${record.claimKey}`;
  return (
    <div className="link-item" role="listitem" data-state={state}>
      <div className="li-amount">
        <Link to={details} className="li-amount-link">
          <Amount value={BigInt(record.amount)} as="span" size="sm" />
        </Link>
      </div>
      <div className="li-status">{state === "loading" ? <Skeleton width={120} height={22} /> : <Badge state={state} />}</div>
      <div className="li-note" title={note || undefined}>
        {note ? `“${note}”` : <span className="muted">No message</span>}
      </div>
      <div className="li-date">
        <span className="li-label">Created </span>
        {fmtDay(record.created)}
      </div>
      <div className="li-date">
        <span className="li-label">{state === "expired" ? "Expired " : "Expires "}</span>
        {fmtDate(record.expiry)}
      </div>
      <div className="li-actions">
        {open && <CopyButton text={recordLink(record)} label="Copy link" variant="secondary" size="sm" />}
        {open && (
          <Button variant="secondary" size="sm" onClick={onReclaim}>
            Take back
          </Button>
        )}
        {["failed", "notsent", "conflict"].includes(state) && (
          <Button variant="ghost" size="sm" onClick={onRemove}>
            Remove
          </Button>
        )}
        {record.txHash && <TxLink hash={record.txHash}>Explorer</TxLink>}
        <Button variant="ghost" size="sm" onClick={() => navigate(details)} aria-label={`Details for the ${fmt(BigInt(record.amount))} USDC link`}>
          Details
        </Button>
      </div>
    </div>
  );
}

function Stat({ label, value, sub, loading }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      {loading ? <Skeleton width="70%" height={24} style={{ margin: "4px 0" }} /> : <span className="stat-value">{value}</span>}
      <span className="stat-sub">{sub}</span>
    </div>
  );
}

function StorageNote() {
  return (
    <aside className="note storage-note" aria-labelledby="storage-title">
      <h2 id="storage-title">Where this list comes from</h2>
      <p className="hint">
        LinkCash has no server or account. This list, and the key each link needs for <strong>Take back</strong>, are saved only in this
        browser. Clearing site data or switching device removes them. The money stays safe: recipients can still claim with the link,
        and after expiry your wallet can refund a link from its details page using the link ID.
      </p>
    </aside>
  );
}

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
