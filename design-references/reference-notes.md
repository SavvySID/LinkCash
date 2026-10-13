# LinkCash design references

Screenshots in this folder were captured from the live sites on 2026-10-13 for internal reference only. They are other companies' work: they're excluded from git. LinkCash doesn't use their logos, photos, illustrations or proprietary fonts.

## Current direction (2026-10-14): Wise page structure

The UI now follows the structure of Wise's money-transfer page (`wise-send-flow*.png`) section by section. The earlier plan below is kept for history.

| Wise section | LinkCash version |
|---|---|
| Dark hero: rating line, all-caps headline, feature bullets in circled icons, two pill buttons | Live block line, "Send dollars to anyone with a link", three points, Create / How it works |
| White calculator card: You send exactly, Recipient gets, Arrives, Total fees, discount box, wide Send button | Same card for USDC: what they receive, fees with the live gas price, a no-wallet note, Create a link |
| Compare providers: highlighted row in the accent colour | Compare ways to send USDC by what the recipient must have first |
| Trust row of three circled icons | Public contract, anyone can claim, secret never reaches a server |
| How to send money: three dark tiles with UI fragments | Amount, share, claim tiles |
| Colour panel, split section with app image, three benefits | Link-parts panel, My links preview, four benefits |
| Ways to send / receive toggle with two cards | Ways to receive / Ways to get it back |
| Cost table with dark header | What a 25 USDC link costs, live network fee |
| Big accent statement panel | Live on Arc at the current block, link to the contract |
| FAQ rows with circular plus buttons, grey footer | Same |

Dark mode (navbar switch, remembered per browser, follows the system setting until chosen): near-black navy page, the hero and step tiles stay brand blue, and the bright panels become deep tinted versions with their colour moved into the headline (yellow panel to dark amber with a yellow title, blue panel to deep blue with a sky title, the highlighted comparison row to a sky outline). QR codes keep a white tile so they still scan.

What stays LinkCash's own: the name and logo, navy and sky blue in place of Wise's forest and lime, Archivo (condensed, black weight) in place of the proprietary Wise Sans, Inter for text, and no photography or Wise artwork.

## What each reference teaches

### Stripe (`stripe-landing*.png`, `stripe-at-*.png`)
- **Live, real data as the first line.** Above the headline Stripe shows a small figure that genuinely updates ("Global GDP running on Stripe: 1.73…%"). It proves the product is real without a single marketing claim.
- **Headline as a paragraph.** The hero is a long, left-aligned statement at display size with a tight measure, not a slogan plus a subhead. Plenty of empty space to its right.
- **Product storytelling through real UI.** Feature sections show crisp, real-looking product screens (checkout, terminal, billing) instead of icons in cards.
- **Quiet chrome.** Hairline separators, a white page, one strong button colour.

### Wise (`wise-send-flow.png`, `wise-landing*.png`)
- **The money is the hero of the form.** "You send exactly" and "Recipient gets" each pair a small currency pill on the left with a very large, right-aligned amount.
- **The maths is spelled out.** Under the amounts sit plain rows: when it arrives, total fees, with values on the right. Nothing is hidden behind a tooltip.
- **One wide, unmistakable action** at the bottom of the form.
- Brand-specific traits we do *not* take: the condensed all-caps display face, the forest/lime palette, lifestyle photography.

### Mercury (`mercury-landing*.png`, `mercury-at-*.png`)
- **Desktop-first precision.** Dense but calm product screens: labels left, figures right, thin dividers, very few boxes.
- **Money typography.** Balances show cents smaller and raised (`$5,216,471¹⁸`), so the whole number reads first.
- **Statuses and lists as plain rows**, not badges stacked inside cards. Action chips (Send, Request, Transfer) sit in one row above the data.
- Traits we do not take: the dark theme, the photographic hero, the laptop mock-up.

### Plaid (`plaid-landing*.png`)
- Useful mainly as a counter-example for the hero (gradient + engraving is very brand-specific).
- What we keep: explaining financial plumbing with a diagram rather than adjectives.

## How the patterns map onto LinkCash

| Pattern | Reference | Where it goes in LinkCash |
|---|---|---|
| Live chain data above the headline | Stripe | Landing hero: the current Arc block number, read from the RPC every few seconds |
| Long left-aligned headline, empty space | Stripe | Landing hero |
| Send / receive amounts with big right-aligned figures and fee rows | Wise | Landing hero calculator; `/send` page; review dialog |
| One wide primary action | Wise | Send, claim, deploy |
| Cents set smaller and raised | Mercury | Every large amount (claim, details, success, review) via one `Amount` component |
| Labels left, values right, hairline rows | Mercury | Details lists, fee rows, deploy checklist |
| Summary figures in one strip, table below | Mercury | `/links` dashboard |
| Explain the plumbing with a diagram | Plaid | "How a payment link works": the link itself, typeset and annotated |

## Design plan

**Colour** (the brief asks for paper white, dark navy and a confident blue)
- Paper `#F9F9F7`: page background (neutral, not cream)
- Surface `#FFFFFF`: panels and inputs
- Ink `#13213C`: text
- Slate `#5B6475`: secondary text
- Rule `#E3E4E8`: hairlines and borders
- Blue `#2459E8`: actions, links, the private part of a link
- State colours, used only for status: green `#0E7A4A`, amber `#8A5A00`, red `#B42318`

**Type**
- Schibsted Grotesk for everything except code-like data. It's a news-house grotesk with editorial weight at display sizes and a sturdy, plain texture at UI sizes, and it isn't one of the defaults (Inter, Geist).
- IBM Plex Mono only for things that really are code: addresses, hashes, the link URL.
- Scale (px): 13 · 15 · 17 · 21 · 28 · 40 · 60. Headlines 600 weight with negative tracking; body 400 at 15–17px with a measure under 70 characters.
- Sentence case everywhere: no all-caps labels, no eyebrows above headings.

**Layout**
- Desktop-first, left-aligned, 1160px max width.
- App pages sit on a 12-column grid: form or table on the left (8 columns), context on the right (4 columns).
- One radius scale used by hierarchy: 6px for inputs and buttons, 10px for panels, full pills only for currency and status. Borders instead of shadows; shadows only on things that float (dialogs, menus).

```
Landing
┌───────────────────────────────────────────────────────────────┐
│ LinkCash   Home  How it works  Create link  My links  [wallet]│
├───────────────────────────────────────────────────────────────┤
│ ● Arc mainnet  Block 25,782,421                               │
│                                         ┌───────────────────┐ │
│ Send dollars to anyone                  │ You send   [USDC] │ │
│ with a link.                            │            0.00   │ │
│                                         │ They receive …    │ │
│ Paragraph, <60ch                        │ Claim fee  0.005  │ │
│ [Create a payment link] [How it works]  │ Network fee ≈ …   │ │
│                                         │ [Create this link]│ │
│                                         └───────────────────┘ │
├───────────────────────────────────────────────────────────────┤
│ How a payment link works                                      │
│ linkcash.app/claim/ 0x5A1f…c3E9  #k=8f2d…a41c  &m=Thanks      │
│ ───────────         ──────────   ────────────  ──────────     │
│ the site            link ID      secret        message        │
│                     (public)     (never sent)  (optional)     │
│ 1 Create   2 Share   3 Claim                                  │
├───────────────────────────────────────────────────────────────┤
│ Why a link?   │ ruled list                                    │
├───────────────────────────────────────────────────────────────┤
│ Common questions (accordion)                                  │
└───────────────────────────────────────────────────────────────┘

/send                                   /links
┌──────────────────────────┬─────────┐  ┌──────────────────────────────┐
│ You send [USDC]    25.00 │ Wallet  │  │ Waiting │ Claimed │ Back │ … │
│ They receive  25.00 USDC │ Network │  ├──────────────────────────────┤
│ Claim fee     0.005      │ Balance │  │ All Waiting Expired …  [⌕]   │
│ Network fee   ≈ 0.002    │         │  │ 25.00  ● Waiting  "Rent" …   │
│ Total         ≈ 25.007   │ Fees    │  │ 3.00   ● Taken back …        │
│ Expiry  Message  [Review]│ explained│ └──────────────────────────────┘
└──────────────────────────┴─────────┘
```

**Principles**
1. The amount and the link are the two things this product is about, so they get the typographic attention. Everything else stays quiet.
2. One bold element: the annotated link on the landing page. It's the product's actual mechanism, typeset large.
3. Real numbers only. Live block height, the real fee allowance, live gas price, the user's own links. No invented metrics, logos or testimonials.
4. Rows before boxes: a panel only where something is genuinely a unit (a form, a table, a receipt, a dialog).

## Review against generic defaults (what changed and why)

- *First draft:* the hero was a big headline with a "product preview" card of example amounts beside it. That's the stock SaaS hero. **Changed to** a working calculator using live data, so the panel beside the headline is a real tool rather than a picture of one.
- *First draft:* three feature previews in identical cards (the current site's showcase). **Removed.** It's the repeated-card pattern and showed placeholder data. The annotated link replaces it with something specific to LinkCash.
- *First draft:* a blue-to-violet glow behind the hero, Stripe-style. **Dropped:** a gradient wash adds nothing a user needs, and it's a known AI-generated tell.
- *First draft:* small uppercase labels ("HOW IT WORKS") above section titles. **Dropped.** The titles say the same thing.
- *First draft:* meta strings joined with "·" and links ending in "→". **Replaced** with separate labelled values and plain link text.
- *Kept on purpose:* numbered steps 1–3, because creating, sharing and claiming really is a sequence. And monospace, only where the content is literally code (addresses, the URL).
