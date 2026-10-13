import { useEffect, useId, useState } from "react";
import { AddressLink, ButtonLink, useFocusHeading } from "../components";
import { chain, CONTRACT_ADDRESS, GAS_ALLOWANCE } from "../config";
import {
  ArrowIcon,
  BlockIcon,
  BoltIcon,
  ChatIcon,
  ClockIcon,
  DocIcon,
  GlobeIcon,
  KeyIcon,
  LinkIcon,
  LockIcon,
  MailIcon,
  QrIcon,
  ReceiptIcon,
  SparkIcon,
  UndoIcon,
  WalletIcon,
} from "../icons";
import { addressUrl, fmt, GAS_ALLOWANCE_WEI, MESSAGE_MAX, parseAmount, publicClient } from "../linkcash";
import { Link, navigate } from "../router";

// Gas used by create() for this contract, measured on a local chain. Multiplied
// by the live gas price to estimate the sender's network fee before connecting.
const CREATE_GAS = 104_000n;
const EXAMPLE_AMOUNT = 25n * 10n ** 18n;

const HERO_POINTS = [
  { icon: LinkIcon, title: "No address needed.", text: "Send the link in any chat, email or text." },
  { icon: BoltIcon, title: "Claimed in seconds.", text: `${chain.name} confirms the payment the moment they claim.` },
  { icon: UndoIcon, title: "Yours until it's claimed.", text: "Take it back any time before they open it." },
];

const COMPARE = [
  { icon: WalletIcon, name: "Wallet transfer", ask: "You need their wallet address first", needs: "A wallet, set up" },
  { icon: LinkIcon, name: "LinkCash", ask: "You only need a way to message them", needs: "Nothing in advance", ours: true },
  { icon: DocIcon, name: "Exchange account", ask: "You need their exchange account details", needs: "A verified account" },
];

const STEPS = [
  {
    art: "amount",
    title: "Enter an amount in USDC",
    text: "Choose how much to send, how long the link stays open, and add a message if you like.",
  },
  {
    art: "share",
    title: "Share the link anywhere",
    text: "Paste it into any messaging app, email or SMS, or show them the QR code.",
  },
  {
    art: "claim",
    title: "They claim it",
    text: "They open the link and move the USDC into their wallet, or into a new one made on the spot.",
  },
];

const BENEFITS = [
  {
    icon: ChatIcon,
    title: "Nothing to ask for",
    text: "No bank details, no wallet address. If you can message someone, you can pay them.",
  },
  {
    icon: SparkIcon,
    title: "No wallet needed to receive",
    text: `They can make a wallet when they claim. The ${GAS_ALLOWANCE} USDC added to each link pays their network fee.`,
  },
  {
    icon: GlobeIcon,
    title: "Only USDC involved",
    text: `${chain.name} charges network fees in USDC too, so nobody has to buy a second token.`,
  },
  {
    icon: UndoIcon,
    title: "Yours until it's claimed",
    text: "Take it back from the device you made it on. After expiry, your wallet can refund it from the contract.",
  },
];

const WAYS = {
  receive: {
    tab: "Ways to receive",
    title: "Two ways to receive a link",
    lead: "The person you pay chooses where the money goes when they open the link. Either way, the claim fee allowance pays their network fee.",
    cards: [
      {
        icon: WalletIcon,
        title: "Into a wallet they have",
        text: `They paste the address of any wallet that works on ${chain.name}, such as MetaMask or Rainbow, and the USDC lands there.`,
      },
      {
        icon: KeyIcon,
        title: "Into a new wallet",
        text: "LinkCash makes a wallet right in their browser and shows a 12-word recovery phrase to save. They can import it into a wallet app later.",
      },
    ],
  },
  back: {
    tab: "Ways to get it back",
    title: "Two ways to get it back",
    lead: "Until someone claims a link, the money is still yours. Once a link has been claimed, the payment is final.",
    cards: [
      {
        icon: UndoIcon,
        title: "Take back",
        text: "Any time before it's claimed, from My links on the device you created the link on. The link's own fee allowance pays the network fee.",
      },
      {
        icon: ClockIcon,
        title: "Refund after expiry",
        text: "Once the link expires, the wallet that sent it can refund it straight from the contract, from any device.",
      },
    ],
  },
};

const FAQ = [
  {
    q: "Does the recipient need a crypto wallet?",
    a: (
      <>
        No. When they open the link, they can create a new wallet right in their browser, which gives them a 12-word recovery phrase to
        save. They can also paste the address of a wallet they already have. To spend the money later, they import the phrase into a
        wallet app such as MetaMask or Rainbow.
      </>
    ),
  },
  {
    q: "What happens when a link expires?",
    a: (
      <>
        Nothing moves automatically. An expired link keeps working for the recipient until the sender takes the money back. Expiry
        matters to the sender: after it, the contract also lets the sending wallet refund the link directly, even without the
        browser the link was created in.
      </>
    ),
  },
  {
    q: "Can I get unclaimed money back?",
    a: (
      <>
        Yes. Until someone claims it, use <strong>Take back</strong> in My links on the device where you created the link. That uses
        the link's own fee allowance, and whatever's left of the allowance isn't returned. After the link expires, the sending wallet
        can also call the contract's refund from the link's details page. Once a link has been claimed, the payment is final.
      </>
    ),
  },
  {
    q: "Which network and token does LinkCash use?",
    a: (
      <>
        USDC on {chain.name} (chain ID {chain.id}). On {chain.name}, USDC is also the token used for network fees, so you only need
        USDC.
      </>
    ),
  },
  {
    q: "What does it cost?",
    a: (
      <>
        Each link adds a {GAS_ALLOWANCE} USDC claim fee allowance, which pays the recipient's network fee. Creating the link costs a
        network fee paid by your wallet; the app shows a live estimate before you confirm, and your wallet shows the final amount.
        LinkCash itself charges nothing on top.
      </>
    ),
  },
  {
    q: "Is the message required? Who can read it?",
    a: (
      <>
        It's optional, up to {MESSAGE_MAX} characters. The message is stored inside the link itself, not on the blockchain and not on
        any server, so anyone who has the link can read it. It can't be changed after the link is created.
      </>
    ),
  },
  {
    q: "What do I need to keep safe?",
    a: (
      <>
        <strong>Senders:</strong> the link itself, because anyone with it can claim the money, and this browser's data, which holds
        the keys used by Take back. <strong>Recipients:</strong> the recovery phrase of a wallet created during claiming. LinkCash
        can't recover lost links or phrases.
      </>
    ),
  },
  {
    q: "Is LinkCash audited?",
    a: <>No. LinkCash is a proof of concept, and its contract hasn't been audited. Please use small amounts.</>,
  },
];

/** The latest block, polled every few seconds. null when the network can't be reached. */
function useLatestBlock() {
  const [block, setBlock] = useState(null);
  useEffect(() => {
    let live = true;
    const tick = () => {
      if (document.hidden) return;
      publicClient
        .getBlockNumber({ cacheTime: 0 })
        .then((n) => live && setBlock(n))
        .catch(() => live && setBlock(null));
    };
    tick();
    const id = setInterval(tick, 3000);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, []);
  return block;
}

/** The live gas price, read once. null until known or if the network can't be reached. */
function useGasPrice() {
  const [gasPrice, setGasPrice] = useState(null);
  useEffect(() => {
    publicClient
      .getGasPrice()
      .then(setGasPrice)
      .catch(() => setGasPrice(null));
  }, []);
  return gasPrice;
}

export function Landing() {
  const headingRef = useFocusHeading();
  const block = useLatestBlock();
  const gasPrice = useGasPrice();
  const createFee = gasPrice !== null ? CREATE_GAS * gasPrice : null;

  return (
    <>
      <section className="hero">
        <div className="container hero-grid">
          <div className="hero-copy">
            <ChainLine block={block} />
            <h1 tabIndex={-1} ref={headingRef}>
              Send dollars to anyone with a link
            </h1>
            <p className="hero-lead">
              Lock USDC on {chain.name} behind a private link and send it however you already talk to people.{" "}
              <span className="hero-lead-hl">They don't need a wallet address.</span>
            </p>
            <ul className="hero-points">
              {HERO_POINTS.map(({ icon: Icon, title, text }) => (
                <li key={title}>
                  <span className="icon-ring" aria-hidden="true">
                    <Icon size={18} />
                  </span>
                  <span>
                    <strong>{title}</strong> {text}
                  </span>
                </li>
              ))}
            </ul>
            <div className="hero-ctas">
              <ButtonLink to="/send" size="lg" id="heroCreate">
                Create a payment link
              </ButtonLink>
              <ButtonLink to="/#how-it-works" size="lg" variant="outline">
                How it works
              </ButtonLink>
            </div>
          </div>
          <HeroCalculator fee={createFee} />
        </div>
      </section>

      <section className="band band-mist compare-section" aria-labelledby="compare-title">
        <div className="container">
          <div className="band-head center">
            <h2 id="compare-title" className="display">
              Compare ways to send someone USDC
            </h2>
            <p className="band-lead">
              Most ways to send USDC need something from the person you're paying before any money can move. A payment link needs
              nothing until they open it.
            </p>
            <ButtonLink to="/send" size="lg">
              Send money now
            </ButtonLink>
          </div>
          <div className="compare-card">
            <div className="compare-top">
              <span>What you need first</span>
              <span>What they need</span>
            </div>
            <ul className="compare-list">
              {COMPARE.map(({ icon: Icon, name, ask, needs, ours }) => (
                <li key={name} className={ours ? "is-ours" : undefined}>
                  <span className="compare-mark" aria-hidden="true">
                    <Icon size={22} />
                  </span>
                  <span className="compare-name">
                    <strong>{name}</strong>
                    <span>{ask}</span>
                  </span>
                  <span className="compare-needs">{needs}</span>
                </li>
              ))}
            </ul>
            <p className="compare-foot">Compared by what each way needs before money can move.</p>
          </div>
          <ul className="trust-row">
            <li>
              <span className="icon-disc" aria-hidden="true">
                <DocIcon size={22} />
              </span>
              <p>
                The contract is public.{" "}
                {CONTRACT_ADDRESS ? (
                  <a href={addressUrl(CONTRACT_ADDRESS)} target="_blank" rel="noopener">
                    Read it on the {chain.name} explorer
                  </a>
                ) : (
                  <>Anyone can read it on the {chain.name} explorer.</>
                )}
              </p>
            </li>
            <li>
              <span className="icon-disc" aria-hidden="true">
                <GlobeIcon size={22} />
              </span>
              <p>Anyone with the link and a web browser can claim it, wherever they are.</p>
            </li>
            <li>
              <span className="icon-disc" aria-hidden="true">
                <LockIcon size={22} />
              </span>
              <p>
                The secret sits after the # sign, so <Link to="/#link-parts">it never reaches a server</Link>.
              </p>
            </li>
          </ul>
        </div>
      </section>

      <section id="how-it-works" className="band band-mist how-section" aria-labelledby="how-title">
        <div className="container">
          <h2 id="how-title" className="display center">
            How to send money with a link
          </h2>
          <ol className="steps-row">
            {STEPS.map((s) => (
              <li key={s.title}>
                <StepArt kind={s.art} />
                <h3>{s.title}</h3>
                <p>{s.text}</p>
              </li>
            ))}
          </ol>
          <div className="center">
            <ButtonLink to="/send" size="lg">
              Create a payment link
            </ButtonLink>
          </div>
        </div>
      </section>

      <section className="band" aria-labelledby="link-title">
        <div className="container">
          <div className="color-panel panel-butter link-panel" id="link-parts">
            <figure className="anatomy" aria-labelledby="anatomy-caption">
              <figcaption id="anatomy-caption" className="sr-only">
                An example payment link, broken into its four parts.
              </figcaption>
              <LinkAnatomy />
            </figure>
            <div className="color-panel-copy">
              <h2 id="link-title">
                One link.
                <br />
                One payment.
                <br />
                One secret.
              </h2>
              <p>
                The link is the payment. The part after the # unlocks the money, and browsers never send that part to a server, so only
                people holding the link can claim it.
              </p>
              <ButtonLink to="/#faq" variant="dark">
                Read common questions
              </ButtonLink>
            </div>
          </div>
        </div>
      </section>

      <section className="band" aria-labelledby="benefits-title">
        <div className="container">
          <div className="split">
            <div className="split-copy">
              <h2 id="benefits-title" className="title-xl">
                Your money stays yours until it's claimed
              </h2>
              <p>
                LinkCash is for paying someone who doesn't use crypto yet. The USDC waits in the contract on {chain.name}, not with us,
                and you can see every link's status in My links.
              </p>
              <ButtonLink to="/links" size="lg">
                See my links
              </ButtonLink>
            </div>
            <LinksPreview />
          </div>
          <dl className="why-list">
            {BENEFITS.map(({ icon: Icon, title, text }) => (
              <div key={title} className="why-item">
                <dt>
                  <span className="icon-disc" aria-hidden="true">
                    <Icon size={22} />
                  </span>
                  {title}
                </dt>
                <dd>{text}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <WaysSection />

      <section className="band band-mist cost-section" aria-labelledby="cost-title">
        <div className="container">
          <div className="band-head center">
            <h2 id="cost-title" className="display">
              What a payment link costs
            </h2>
            <p className="band-lead">
              LinkCash doesn't charge a fee. You pay a small allowance that covers the recipient's network fee, plus the network fee
              to create the link, both in USDC.
            </p>
          </div>
          <CostTable fee={createFee} />
        </div>
      </section>

      <section className="band" aria-labelledby="live-title">
        <div className="container">
          <div className="color-panel panel-sky live-panel">
            <span className="icon-disc icon-disc-light" aria-hidden="true">
              <BlockIcon size={22} />
            </span>
            <h2 id="live-title" className="display">
              Live on {chain.name}
              {block !== null && (
                <>
                  <br />
                  at block {Number(block).toLocaleString()}
                </>
              )}
            </h2>
            {CONTRACT_ADDRESS && (
              <a className="btn btn-dark btn-lg" href={addressUrl(CONTRACT_ADDRESS)} target="_blank" rel="noopener">
                View the contract on the explorer
              </a>
            )}
          </div>
        </div>
      </section>

      <section id="faq" className="band faq-section" aria-labelledby="faq-title">
        <div className="container">
          <h2 id="faq-title" className="display">
            Common questions
          </h2>
          <div className="faq">
            {FAQ.map((f) => (
              <details key={f.q}>
                <summary>
                  <span>{f.q}</span>
                  <span className="faq-plus" aria-hidden="true" />
                </summary>
                <div className="faq-a">{f.a}</div>
              </details>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}

/** Live chain data in place of a rating line: the latest block and the contract. */
function ChainLine({ block }) {
  if (block === null) return <p className="chain-line chain-line-empty" aria-hidden="true" />;
  return (
    <p className="chain-line" id="chainLine">
      <span className="live-dot" aria-hidden="true" />
      <span>
        Live on {chain.name}, block <span className="tnum">{Number(block).toLocaleString()}</span>
      </span>
      {CONTRACT_ADDRESS && (
        <span className="chain-line-contract">
          Contract <AddressLink address={CONTRACT_ADDRESS} />
        </span>
      )}
    </p>
  );
}

/** What you send, what they get and every fee, before connecting a wallet. */
function HeroCalculator({ fee }) {
  const [text, setText] = useState("");
  const inputId = useId();
  const parsed = parseAmount(text);
  const value = parsed.value ?? null;
  const fees = fee !== null ? GAS_ALLOWANCE_WEI + fee : null;
  const showError = Boolean(text) && Boolean(parsed.error);

  function start(e) {
    e.preventDefault();
    navigate(value !== null ? `/send?amount=${encodeURIComponent(text.trim())}` : "/send");
  }

  return (
    <form className="calc" id="heroCalc" onSubmit={start} aria-label="Work out a payment">
      <p className="calc-pill">
        <LockIcon size={16} />
        <span>Locked until they claim</span>
      </p>
      <div className="calc-field">
        <label className="calc-label" htmlFor={inputId}>
          You send exactly
        </label>
        <div className={`calc-amount${showError ? " is-invalid" : ""}`}>
          <span className="currency-pill">USDC</span>
          <input
            id={inputId}
            inputMode="decimal"
            autoComplete="off"
            placeholder="0.00"
            value={text}
            onChange={(e) => setText(e.target.value)}
            aria-invalid={showError}
            aria-describedby={showError ? `${inputId}-err` : undefined}
          />
        </div>
        {showError && (
          <p className="field-error" id={`${inputId}-err`}>
            {parsed.error}
          </p>
        )}
      </div>
      <div className="calc-field">
        <span className="calc-label" id={`${inputId}-out-label`}>
          They receive
        </span>
        <div className="calc-amount calc-amount-out">
          <span className="currency-pill">USDC</span>
          <output id="heroOut" className={value === null ? "is-empty" : undefined} aria-labelledby={`${inputId}-out-label`}>
            {value !== null ? fmt(value) : "0.00"}
          </output>
        </div>
      </div>
      <ul className="calc-facts">
        <li>
          <span className="icon-ring" aria-hidden="true">
            <ClockIcon size={20} />
          </span>
          <span className="fact">
            <span className="fact-label">Arrives</span>
            <strong>As soon as they open the link</strong>
          </span>
        </li>
        <li>
          <span className="icon-ring" aria-hidden="true">
            <ReceiptIcon size={20} />
          </span>
          <span className="fact">
            <span className="fact-label">Total fees</span>
            <strong>Paid by you, on top</strong>
            <span className="fact-sub">
              {GAS_ALLOWANCE} USDC claim allowance{fee !== null ? ` + ≈ ${fmt(fee)} USDC network fee` : " + network fee"}
            </span>
          </span>
          <span className="fact-value">{fees !== null ? `≈ ${fmt(fees)} USDC` : "Shown before you confirm"}</span>
        </li>
      </ul>
      <div className="calc-note">
        <span className="icon-disc icon-disc-sm" aria-hidden="true">
          <SparkIcon size={18} />
        </span>
        <div>
          <p className="calc-note-title">No wallet on their side? That's fine.</p>
          <p>They can make one in their browser when they open the link, and the claim allowance pays their network fee.</p>
        </div>
      </div>
      <button type="submit" className="btn btn-primary btn-block btn-lg">
        {value !== null ? `Create a ${fmt(value)} USDC link` : "Create a link"}
      </button>
    </form>
  );
}

/** Small product illustrations for the three steps. */
function StepArt({ kind }) {
  return (
    <div className="step-art" aria-hidden="true">
      {kind === "amount" && (
        <div className="art-amounts">
          <span className="art-pill art-figure">25.00</span>
          <span className="art-swap">
            <LinkIcon size={18} />
          </span>
          <span className="art-pill art-figure">25.00</span>
        </div>
      )}
      {kind === "share" && (
        <div className="art-chain">
          <span className="art-dot dot-sky">
            <ChatIcon size={22} />
          </span>
          <span className="art-dot dot-butter">
            <MailIcon size={22} />
          </span>
          <span className="art-dot dot-white">
            <QrIcon size={22} />
          </span>
        </div>
      )}
      {kind === "claim" && (
        <div className="art-chain">
          <span className="art-dot dot-sky">
            <ArrowIcon size={22} />
          </span>
          <span className="art-dot dot-butter">
            <WalletIcon size={22} />
          </span>
        </div>
      )}
    </div>
  );
}

/** A real link, split into its parts. The ID and secret shown are an example. */
function LinkAnatomy() {
  const host = typeof location !== "undefined" ? location.host : "linkcash.app";
  return (
    <dl className="anatomy-key">
      <div className="key-site">
        <dt>
          <span className="mono">{host}/claim/</span>
        </dt>
        <dd>
          <strong>The site.</strong> Where the link opens. The money lives on {chain.name}, not here.
        </dd>
      </div>
      <div className="key-id">
        <dt>
          <span className="mono">0x5A1f…c3E9</span>
        </dt>
        <dd>
          <strong>Link ID.</strong> The payment's public address, used to look up the amount and status.
        </dd>
      </div>
      <div className="key-secret">
        <dt>
          <span className="mono">#k=8f2d…a41c</span>
        </dt>
        <dd>
          <strong>Secret.</strong> Unlocks the money. Browsers never send what's after the # to a server.
        </dd>
      </div>
      <div className="key-msg">
        <dt>
          <span className="mono">&amp;m=Thanks!</span>
        </dt>
        <dd>
          <strong>Message.</strong> Optional, up to {MESSAGE_MAX} characters, stored only inside the link.
        </dd>
      </div>
    </dl>
  );
}

/** An illustration of the My links page, built from the same parts. The rows are an example. */
function LinksPreview() {
  const rows = [
    { amount: "25.00", note: "Rent split", state: "Waiting to be claimed", tone: "info", action: "Take back" },
    { amount: "10.00", note: "Thanks!", state: "Claimed", tone: "success" },
    { amount: "5.00", note: "Coffee", state: "Taken back", tone: "neutral" },
  ];
  return (
    <figure className="preview" aria-label="Example of the My links page">
      <div className="preview-card" aria-hidden="true">
        <p className="preview-title">My links</p>
        {rows.map((r) => (
          <div key={r.amount} className="preview-row">
            <span className="preview-amount">
              {r.amount} <small>USDC</small>
            </span>
            <span className="preview-note">{r.note}</span>
            <span className={`badge badge-${r.tone}`}>{r.state}</span>
            {r.action ? <span className="preview-action">{r.action}</span> : <span />}
          </div>
        ))}
      </div>
      <figcaption className="preview-caption">Example: every link and its live status, in one list.</figcaption>
    </figure>
  );
}

function WaysSection() {
  const [tab, setTab] = useState("receive");
  const ways = WAYS[tab];
  return (
    <section className="band band-mist ways-section" aria-labelledby="ways-title">
      <div className="container">
        <div className="pill-toggle" role="group" aria-label="Show">
          {Object.entries(WAYS).map(([key, w]) => (
            <button key={key} type="button" aria-pressed={tab === key} onClick={() => setTab(key)}>
              {w.tab}
            </button>
          ))}
        </div>
        <div className="band-head center">
          <h2 id="ways-title" className="display">
            {ways.title}
          </h2>
          <p className="band-lead">{ways.lead}</p>
        </div>
        <div className="ways-grid">
          {ways.cards.map(({ icon: Icon, title, text }) => (
            <article key={title} className="way-card">
              <span className="icon-disc" aria-hidden="true">
                <Icon size={22} />
              </span>
              <h3>{title}</h3>
              <p>{text}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function CostTable({ fee }) {
  const rows = [
    ["They receive", `${fmt(EXAMPLE_AMOUNT)} USDC`],
    ["Claim fee allowance", `${GAS_ALLOWANCE} USDC`],
    ["Network fee to create the link", fee !== null ? `≈ ${fmt(fee)} USDC` : "Shown before you confirm"],
    ["LinkCash fee", "None"],
  ];
  const total = fee !== null ? `≈ ${fmt(EXAMPLE_AMOUNT + GAS_ALLOWANCE_WEI + fee)} USDC` : `${fmt(EXAMPLE_AMOUNT + GAS_ALLOWANCE_WEI)} USDC + network fee`;
  return (
    <table className="cost-table">
      <caption className="sr-only">Cost of sending 25 USDC</caption>
      <thead>
        <tr>
          <th scope="col">Sending {fmt(EXAMPLE_AMOUNT)} USDC</th>
          <th scope="col">Cost</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([k, v]) => (
          <tr key={k}>
            <th scope="row">{k}</th>
            <td>{v}</td>
          </tr>
        ))}
        <tr className="cost-total">
          <th scope="row">You pay in total</th>
          <td>{total}</td>
        </tr>
      </tbody>
    </table>
  );
}
