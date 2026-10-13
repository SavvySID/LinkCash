import { useCallback, useEffect, useState } from "react";
import { deriveState, errMsg, fetchOutcomes, loadLinks, readLink, reconcileRecord, removeLink, upsertLink } from "./linkcash";

/**
 * Links created in this browser, joined with their live on-chain state.
 * Each row: { record, link?, state } where state is one of
 * loading | waiting | expired | claimed | reclaimed | refunded | completed |
 * confirming | failed | notsent | unknown.
 */
export function useMyLinks() {
  const [rows, setRows] = useState(() => loadLinks().map((record) => ({ record, state: "loading" })));
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(null);
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    let live = true;
    (async () => {
      const records = loadLinks();
      if (!records.length) {
        setRows([]);
        setError(null);
        setLoaded(true);
        return;
      }
      try {
        const links = await Promise.all(records.map((r) => readLink(r.claimKey)));
        // Creates that couldn't be confirmed at the time: fill in what the chain now shows.
        for (let i = 0; i < records.length; i++) records[i] = await reconcileRecord(records[i], links[i]);
        await attachOutcomes(records, links);
        const next = await Promise.all(records.map(async (record, i) => ({ record, link: links[i], state: await deriveState(record, links[i]) })));
        if (!live) return;
        setRows(next);
        setError(null);
      } catch (e) {
        if (!live) return;
        setRows(records.map((record) => ({ record, state: "unknown" })));
        setError(errMsg(e));
      }
      if (live) setLoaded(true);
    })();
    return () => {
      live = false;
    };
  }, [version]);

  // Keep open links fresh so a claim shows up without a manual refresh.
  const hasOpen = rows.some((r) => ["waiting", "expired", "confirming"].includes(r.state));
  useEffect(() => {
    if (!hasOpen) return;
    const id = setInterval(refresh, 20000);
    return () => clearInterval(id);
  }, [hasOpen, refresh]);

  const remove = useCallback(
    (claimKey) => {
      removeLink(claimKey);
      refresh();
    },
    [refresh],
  );

  return { rows, loaded, error, refresh, remove };
}

/** Settled outcomes are final, so they're cached on the stored record. */
export async function attachOutcomes(records, links) {
  const need = records.filter((r, i) => links[i].settled && !r.outcome);
  if (!need.length) return;
  const blocks = need.map((r) => (r.block ? BigInt(r.block) : null));
  const fromBlock = blocks.includes(null) ? "earliest" : blocks.reduce((a, b) => (a < b ? a : b));
  try {
    const outcomes = await fetchOutcomes(
      need.map((r) => r.claimKey),
      fromBlock,
    );
    for (const r of need) {
      if (!outcomes[r.claimKey]) continue;
      r.outcome = outcomes[r.claimKey];
      upsertLink({ claimKey: r.claimKey, outcome: r.outcome });
    }
  } catch {
    // Some RPCs limit log queries; those links show as "completed".
  }
}
