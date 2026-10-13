// Chain reads, the claim flow and the sender's saved links, shared by every screen.
import {
  BaseError,
  ChainMismatchError,
  ContractFunctionRevertedError,
  HttpRequestError,
  TimeoutError,
  UserRejectedRequestError,
  createPublicClient,
  createWalletClient,
  encodeAbiParameters,
  formatEther,
  http,
  isAddress,
  keccak256,
  parseEther,
  zeroAddress,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { abi } from "./contract.json";
import { chain, CONTRACT_ADDRESS, GAS_ALLOWANCE } from "./config";

export { abi };
const transport = http(chain.rpcUrls.default.http[0]);
export const publicClient = createPublicClient({ chain, transport });

export const GAS_ALLOWANCE_WEI = parseEther(GAS_ALLOWANCE);
export const MESSAGE_MAX = 140;

// Bidirectional controls (LRM/RLM/ALM, embeddings, overrides, isolates) and
// invisible separators can make a message read differently from what it
// says. Zero-width joiners stay: emoji and several scripts need them.
const DECEPTIVE_CHARS = /[\u061C\u200B\u200E\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g;

/** A message as it should be shown: controls removed, at most MESSAGE_MAX characters. */
export function cleanMessage(text) {
  const chars = Array.from(String(text ?? "").replace(DECEPTIVE_CHARS, ""));
  return chars.length > MESSAGE_MAX ? `${chars.slice(0, MESSAGE_MAX - 1).join("")}…` : chars.join("");
}
const MIN_AMOUNT = parseEther("0.01");

// ---- formatting ----
export const fmt = (wei) =>
  Number(formatEther(wei)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 });
/** Rounded down to cents, for compact summaries (never overstates a balance). */
export const fmtCents = (wei) =>
  (Math.floor(Number(formatEther(wei)) * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const short = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;
export const txUrl = (h) => `${chain.blockExplorers.default.url}/tx/${h}`;
export const addressUrl = (a) => `${chain.blockExplorers.default.url}/address/${a}`;
export const fmtDate = (seconds) =>
  new Date(seconds * 1000).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
export const fmtDay = (ms) => new Date(ms).toLocaleDateString(undefined, { dateStyle: "medium" });
const sameAddress = (a, b) => Boolean(a && b) && a.toLowerCase() === b.toLowerCase();

/** Parse a USDC amount typed by the user: { value } or { error }. */
export function parseAmount(text) {
  const t = text.trim();
  if (!t) return { error: "Enter an amount." };
  if (t.startsWith("-")) return { error: "The amount can't be negative." };
  if (!/^\d*\.?\d*$/.test(t) || t === ".") return { error: "Enter a number, like 10 or 2.50." };
  if ((t.split(".")[1] || "").length > 6) return { error: "USDC supports up to 6 decimal places." };
  const value = parseEther(t);
  if (value === 0n) return { error: "Enter an amount greater than zero." };
  if (value < MIN_AMOUNT) return { error: "The minimum is 0.01 USDC." };
  return { value };
}

export function errMsg(e) {
  if (e instanceof UnresolvedCreateError) return e.message;
  if (e instanceof BaseError) {
    if (e.walk((x) => x instanceof UserRejectedRequestError)) return "You cancelled the request in your wallet. Nothing was sent.";
    const revert = e.walk((x) => x instanceof ContractFunctionRevertedError);
    const name = revert?.data?.errorName;
    if (name === "AlreadySettled") return "This payment has already been claimed or returned to the sender.";
    if (name === "LinkNotFound") return "This payment link doesn't exist.";
    if (name === "InvalidRecipient") return "That wallet address can't receive this payment.";
    if (name === "NotSender") return "Only the wallet that created this link can refund it.";
    if (name === "NotExpired") return "This link hasn't expired yet, so it can't be refunded from the contract.";
    if (name === "LinkExists") return LINK_EXISTS_MESSAGE;
    if (/insufficient funds/i.test(e.message)) return "Not enough USDC on Arc to cover this transaction and its network fee.";
    if (e.walk((x) => x instanceof ChainMismatchError) || e.name === "SwitchChainError")
      return `Your wallet is on a different network. Switch it to ${chain.name} and try again.`;
    if (e.walk((x) => x instanceof HttpRequestError || x instanceof TimeoutError))
      return `Can't reach the ${chain.name} network (${new URL(chain.rpcUrls.default.http[0]).host}). Check your connection. If you use Brave Shields or an ad blocker, allow that address on this site, then try again.`;
    return e.shortMessage;
  }
  return e?.message || String(e);
}

async function confirmed(hash) {
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`The transaction failed on ${chain.name}, so nothing moved. You can try again.`);
  return receipt;
}

// ---- contract reads ----
export async function readLink(claimKey) {
  const [sender, expiry, settled, amount] = await publicClient.readContract({
    address: CONTRACT_ADDRESS,
    abi,
    functionName: "links",
    args: [claimKey],
  });
  return { exists: sender !== zeroAddress, sender, expiry: Number(expiry), settled, amount };
}

// Arc's public RPC rejects log queries wider than 100,000 blocks (about 14 hours).
const LOG_WINDOW = 99_000n;

/**
 * How settled links ended, from LinkClaimed / LinkRefunded events.
 * Only the most recent LOG_WINDOW blocks can be searched; links settled
 * earlier simply aren't found and show as "completed".
 * Returns { [claimKey]: { type: "claimed" | "refunded", to, hash } }.
 */
export async function fetchOutcomes(claimKeys, fromBlock = "earliest") {
  const latest = await publicClient.getBlockNumber();
  const floor = latest > LOG_WINDOW ? latest - LOG_WINDOW : 0n;
  const from = fromBlock === "earliest" || fromBlock < floor ? floor : fromBlock;
  const query = (eventName) =>
    publicClient.getContractEvents({ address: CONTRACT_ADDRESS, abi, eventName, args: { claimKey: claimKeys }, fromBlock: from, toBlock: latest });
  const [claimed, refunded] = await Promise.all([query("LinkClaimed"), query("LinkRefunded")]);
  const out = {};
  for (const e of claimed) out[e.args.claimKey] = { type: "claimed", to: e.args.recipient, hash: e.transactionHash };
  for (const e of refunded) out[e.args.claimKey] = { type: "refunded", to: e.args.sender, hash: e.transactionHash };
  return out;
}

/** "claimed" | "reclaimed" | "refunded" | "completed" (settled, but the events couldn't be read). */
export function settledState(link, outcome) {
  if (!outcome) return "completed";
  if (outcome.type === "refunded") return "refunded";
  return sameAddress(outcome.to, link.sender) ? "reclaimed" : "claimed";
}

/** Can the link pay for its own claim from the allowance the sender forwarded? */
export async function claimFunding(claimKey) {
  const [balance, fees, gas] = await Promise.all([
    publicClient.getBalance({ address: claimKey }),
    publicClient.estimateFeesPerGas(),
    publicClient.estimateContractGas({ address: CONTRACT_ADDRESS, abi, functionName: "claim", args: [claimKey], account: claimKey }),
  ]);
  const maxCost = ((gas * 13n) / 10n) * fees.maxFeePerGas;
  // A relayed claim also verifies a signature, so allow extra headroom for the wallet's fee.
  return { selfFunded: balance >= maxCost, walletFee: (maxCost * 3n) / 2n };
}

/** Network fee estimate for create(), in wei. */
export async function estimateCreateFee({ account, value, days }) {
  const dummyKey = privateKeyToAccount(generatePrivateKey()).address;
  const expiry = BigInt(Math.floor(Date.now() / 1000) + days * 86400);
  const [gas, gasPrice] = await Promise.all([
    publicClient.estimateContractGas({
      address: CONTRACT_ADDRESS,
      abi,
      functionName: "create",
      args: [dummyKey, expiry, GAS_ALLOWANCE_WEI],
      value: value + GAS_ALLOWANCE_WEI,
      account,
    }),
    publicClient.getGasPrice(),
  ]);
  return gas * gasPrice;
}

// ---- claiming ----
/**
 * Move a link's funds to `recipient` and wait for confirmation.
 * Prefers the claim key paying its own gas from the allowance the sender
 * forwarded; if that isn't enough, signs a claim and hands it to `relay`
 * (the user's connected wallet) to submit via claimWithSig.
 * onStatus receives { step: "preparing" | "wallet" | "confirming", hash? }.
 */
export async function claimWithKey({ privateKey, recipient, relay, onStatus }) {
  const account = privateKeyToAccount(privateKey);
  onStatus?.({ step: "preparing" });

  const [balance, fees, gas] = await Promise.all([
    publicClient.getBalance({ address: account.address }),
    publicClient.estimateFeesPerGas(),
    publicClient.estimateContractGas({ address: CONTRACT_ADDRESS, abi, functionName: "claim", args: [recipient], account }),
  ]);
  const gasLimit = (gas * 13n) / 10n;

  let hash;
  if (balance >= gasLimit * fees.maxFeePerGas) {
    const keyClient = createWalletClient({ account, chain, transport });
    hash = await keyClient.writeContract({
      address: CONTRACT_ADDRESS,
      abi,
      functionName: "claim",
      args: [recipient],
      gas: gasLimit,
      maxFeePerGas: fees.maxFeePerGas,
      maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
    });
  } else {
    if (!relay) throw new Error("This link's fee allowance has run out. Connect a wallet with a little USDC on Arc to pay the network fee.");
    onStatus?.({ step: "wallet" });
    const inner = keccak256(
      encodeAbiParameters(
        [{ type: "uint256" }, { type: "address" }, { type: "address" }, { type: "address" }],
        [BigInt(chain.id), CONTRACT_ADDRESS, account.address, recipient],
      ),
    );
    const sig = await account.signMessage({ message: { raw: inner } });
    hash = await relay({ functionName: "claimWithSig", args: [account.address, recipient, sig] });
  }
  onStatus?.({ step: "confirming", hash });
  await confirmed(hash);
  return hash;
}

// ---- creating ----
// A link that isn't on-chain yet stays "Confirming" this long before it can be
// treated as never sent (Arc confirms in about a second, so this is generous).
export const PENDING_GRACE_MS = 10 * 60 * 1000;
const RECEIPT_TIMEOUT_MS = 180_000;
const LINK_EXISTS_MESSAGE =
  "This link's key was already used on Arc, so your payment wasn't created and nothing was locked. Create the link again: it will get a new key.";

/** True only for an explicit Reject in the wallet (EIP-1193 code 4001), which always happens before anything is broadcast. */
export function isUserRejection(e) {
  if (e instanceof BaseError && e.walk((x) => x instanceof UserRejectedRequestError)) return true;
  for (let x = e, depth = 0; x && depth < 10; x = x.cause, depth++) if (x.code === 4001) return true;
  return false;
}

/** The wallet may or may not have sent the payment. The link (and its key) is kept; My links resolves it from the chain. */
export class UnresolvedCreateError extends Error {
  constructor(claimKey, cause) {
    super(
      "We couldn't confirm whether your wallet sent this payment. The link is saved in My links, which checks Arc for it. Don't create it again until it shows Not sent, or you could pay twice.",
    );
    this.name = "UnresolvedCreateError";
    this.claimKey = claimKey;
    this.cause = cause;
  }
}

/** What the contract says about a link we tried to create: "created" (by this sender), "conflict" (someone else's), "missing" or "unknown". */
export async function resolveCreation(claimKey, sender) {
  try {
    const link = await readLink(claimKey);
    if (!link.exists) return "missing";
    return sameAddress(link.sender, sender) ? "created" : "conflict";
  } catch {
    return "unknown";
  }
}

/** The LinkCreated event for a link, if it's within the searchable window: { txHash, block } | null. */
export async function findCreation(claimKey) {
  try {
    const latest = await publicClient.getBlockNumber();
    const fromBlock = latest > LOG_WINDOW ? latest - LOG_WINDOW : 0n;
    const [event] = await publicClient.getContractEvents({ address: CONTRACT_ADDRESS, abi, eventName: "LinkCreated", args: { claimKey }, fromBlock, toBlock: latest });
    return event ? { txHash: event.transactionHash, block: event.blockNumber.toString() } : null;
  } catch {
    return null;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Polls the contract briefly; a just-broadcast create usually lands within a few seconds. */
async function settleCreation(claimKey, sender, tries = 4) {
  let outcome = "unknown";
  for (let i = 0; i < tries; i++) {
    outcome = await resolveCreation(claimKey, sender);
    if (outcome === "created" || outcome === "conflict") return outcome;
    if (i < tries - 1) await sleep(1500);
  }
  return outcome;
}

/**
 * Lock `value` behind a fresh claim key. The record (including the key) is
 * saved before the wallet prompt and is only deleted when the user rejects
 * the request in their wallet. Any other failure keeps it, because the wallet
 * may already have broadcast the transaction; the chain decides what happened.
 * onStatus receives { step: "wallet" | "confirming", hash? }.
 * Throws UnresolvedCreateError when the outcome can't be determined yet.
 */
export async function createLink({ write, sender, value, days, note, onStatus }) {
  const privateKey = generatePrivateKey();
  const claimKey = privateKeyToAccount(privateKey).address;
  const expiry = Math.floor(Date.now() / 1000) + days * 86400;
  const record = {
    claimKey,
    privateKey,
    link: buildLink(privateKey, note),
    amount: value.toString(),
    expiry,
    created: Date.now(),
    sender,
    note,
  };
  upsertLink(record);

  const created = async (txHash) => {
    const found = txHash ? null : await findCreation(claimKey);
    const patch = { claimKey, unresolved: false, ...(found || {}) };
    if (txHash) patch.txHash = txHash;
    upsertLink(patch);
    return { ...record, ...patch };
  };
  const conflict = () => {
    upsertLink({ claimKey, unresolved: false });
    throw new Error(LINK_EXISTS_MESSAGE);
  };

  onStatus?.({ step: "wallet" });
  let hash;
  try {
    hash = await write({ functionName: "create", args: [claimKey, BigInt(expiry), GAS_ALLOWANCE_WEI], value: value + GAS_ALLOWANCE_WEI });
  } catch (e) {
    if (isUserRejection(e)) {
      removeLink(claimKey);
      throw e;
    }
    // Disconnects, timeouts and RPC errors are ambiguous: keep the key and ask the chain.
    upsertLink({ claimKey, unresolved: true });
    const outcome = await settleCreation(claimKey, sender);
    if (outcome === "created") return created(null);
    if (outcome === "conflict") return conflict();
    throw new UnresolvedCreateError(claimKey, e);
  }
  upsertLink({ claimKey, txHash: hash });
  onStatus?.({ step: "confirming", hash });

  let replaced = null;
  let receipt;
  try {
    receipt = await publicClient.waitForTransactionReceipt({
      hash,
      timeout: RECEIPT_TIMEOUT_MS,
      onReplaced: (r) => {
        replaced = r;
        if (r.reason === "repriced") upsertLink({ claimKey, txHash: r.transaction.hash });
      },
    });
  } catch (e) {
    upsertLink({ claimKey, unresolved: true });
    const outcome = await settleCreation(claimKey, sender, 2);
    if (outcome === "created") return created(hash);
    if (outcome === "conflict") return conflict();
    throw new UnresolvedCreateError(claimKey, e);
  }

  const outcome = await settleCreation(claimKey, sender, 2);
  if (outcome === "created") {
    upsertLink({ claimKey, block: receipt.blockNumber.toString() });
    return created(replaced?.reason === "repriced" ? replaced.transaction.hash : hash);
  }
  if (outcome === "conflict") return conflict();
  if (replaced && replaced.reason !== "repriced") {
    throw new Error("Your wallet cancelled or replaced this transaction, so nothing was locked. You can create the link again.");
  }
  if (receipt.status !== "success") throw new Error(`The transaction failed on ${chain.name}, so nothing moved. You can try again.`);
  upsertLink({ claimKey, unresolved: true });
  throw new UnresolvedCreateError(claimKey, null);
}

/**
 * Claim links look like /claim/<claim key address>#k=<secret>&m=<message>.
 * The address is public (it's on-chain anyway); the secret and the message
 * live in the fragment, which browsers never send to a server.
 */
export function claimPath(privateKey, note) {
  const params = new URLSearchParams({ k: privateKey.slice(2) });
  if (note) params.set("m", note);
  return `/claim/${privateKeyToAccount(privateKey).address}#${params}`;
}
export function buildLink(privateKey, note) {
  return `${location.origin}${import.meta.env.BASE_URL.replace(/\/$/, "")}${claimPath(privateKey, note)}`;
}

/** Older links were /#k=…&m=…; map them onto the claim route, keeping the fragment as-is. */
export function legacyClaimPath(hash) {
  const hex = new URLSearchParams(hash.slice(1)).get("k") || "";
  const id = /^[0-9a-fA-F]{64}$/.test(hex) ? privateKeyToAccount(`0x${hex}`).address : "invalid";
  return `/claim/${id}${hash}`;
}

/** The message saved with a record (older records only kept it inside the link). */
export function recordNote(record) {
  if (typeof record.note === "string") return record.note;
  try {
    return new URLSearchParams(new URL(record.link).hash.slice(1)).get("m") || "";
  } catch {
    return "";
  }
}
/** A record's shareable link, always in the current format and origin. */
export const recordLink = (record) => buildLink(record.privateKey, recordNote(record));

/**
 * Live state of a link: waiting | expired | claimed | reclaimed | refunded |
 * completed | confirming | failed | notsent | conflict.
 * "conflict": the claim key is on-chain but belongs to another sender's link,
 * so this browser's create never happened. "notsent": nothing is on-chain and
 * no transaction can be found after PENDING_GRACE_MS (dropped, cancelled or
 * never broadcast); until then the link shows as confirming.
 */
export async function deriveState(record, link) {
  if (link.exists) {
    if (record?.sender && !sameAddress(link.sender, record.sender)) return "conflict";
    if (link.settled) return settledState(link, record?.outcome);
    return Date.now() / 1000 >= link.expiry ? "expired" : "waiting";
  }
  if (record?.txHash) {
    const receipt = await publicClient.getTransactionReceipt({ hash: record.txHash }).catch(() => null);
    if (receipt?.status === "reverted") return "failed";
    if (receipt) return "confirming";
    if (await publicClient.getTransaction({ hash: record.txHash }).catch(() => null)) return "confirming";
  }
  return Date.now() - (record?.created || 0) > PENDING_GRACE_MS ? "notsent" : "confirming";
}

/** Fills in the creation transaction for a link that turned out to exist after an unresolved create. */
export async function reconcileRecord(record, link) {
  if (!record || !link.exists || !sameAddress(link.sender, record.sender)) return record;
  if (!record.unresolved && record.txHash) return record;
  const found = record.txHash ? null : await findCreation(record.claimKey);
  const patch = { claimKey: record.claimKey, unresolved: false, ...(found || {}) };
  upsertLink(patch);
  return { ...record, ...patch };
}

export const isLinkId = (id) => isAddress(id || "");
export const findRecord = (id) => loadLinks().find((l) => l.claimKey.toLowerCase() === String(id).toLowerCase()) || null;

/** Sender refund after expiry, straight from the contract (no link key needed). */
export async function refundLink({ write, claimKey, onStatus }) {
  onStatus?.({ step: "wallet" });
  const hash = await write({ functionName: "refund", args: [claimKey] });
  onStatus?.({ step: "confirming", hash });
  await confirmed(hash);
  return hash;
}

// ---- links the sender created, kept in this browser only ----
const STORE_KEY = "linkcash:links";
export function loadLinks() {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY)) || [];
  } catch {
    return [];
  }
}
function saveLinks(links) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(links));
  } catch {
    /* storage unavailable */
  }
}
export function upsertLink(patch) {
  const links = loadLinks();
  const i = links.findIndex((l) => l.claimKey === patch.claimKey);
  if (i >= 0) links[i] = { ...links[i], ...patch };
  else links.unshift(patch);
  saveLinks(links);
}
export function removeLink(claimKey) {
  saveLinks(loadLinks().filter((l) => l.claimKey !== claimKey));
}
