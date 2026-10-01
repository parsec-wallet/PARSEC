# Algorand assets in PARSEC: opting in, and why it stops spam

## Opting in, in one paragraph

On Algorand, an account cannot hold an asset (an ASA: USDC, an NFT, any token) until it has **opted
in** to that asset: a zero-amount transfer of the asset from the account to itself, signed by the
account's own key. Until then, any transfer of the asset to that account is **rejected by the
protocol**. Opting in sets aside **0.1 ALGO** of the account's minimum balance for as long as it holds
the asset (returned when you remove it) and costs the normal **0.001 ALGO** network fee.

## Why that prevents spam assets

On chains where anyone can send any token to any address, a wallet fills with things its owner never
asked for:

- **Spam and scam tokens** — "airdrops" named like a reward or a website, there to lure a click.
- **Lookalike tokens** — a token called USDC that is not USDC, sitting in the balance list looking
  legitimate.
- **Address poisoning** — tiny transfers from an address that resembles one you use, so the wrong
  address appears in your history and gets copied next time.

On Algorand none of these can land uninvited, because **an account receives an asset only if its
owner signed an opt-in for it**. Nobody else can sign that for you. The list of assets in your account
is therefore exactly the list you chose — there is no spam folder because there is no spam to file.

What opt-in does **not** do is stop you from opting in to the wrong asset yourself. Anyone can create
an asset with any name and ticker, including "USDC". That is the gap PARSEC closes next.

## How PARSEC helps you opt in to the right asset

**Search and the verified list** (`Add Assets`, and the same picker on the x402 desk):

- **Verified assets** are a short, curated list — USDC (Circle), USDt (Tether), EURS (STASIS), goBTC
  and goETH (Algomint), gALGO and FOLKS (Folks Finance), TINY (Tinyman), VEST (Vestige), GORA — each
  checked against the mainnet indexer: asset id, ticker, decimals, **creator address** and issuer
  controls (`src/lib/algorand/asset-whitelist.ts`). A search shows verified matches first, instantly.
- **Everything else is marked "Unverified — check the id".** The id is what identifies an asset; a
  name or ticker identifies nothing.
- **Lookalikes are flagged.** An asset that borrows a verified ticker or name under a different id is
  shown in red: *"Not the listed USDC: that is asset 31566704 by Circle."* A search for "USDC" on
  mainnet returns one real USDC and over a dozen imitations; PARSEC labels each.
- **Issuer controls are stated.** Some issuers keep the right to **freeze** your balance (regulated
  stablecoins such as USDC do) or to **claw back** tokens (USDt can). PARSEC shows both, and adding an
  unverified or controllable asset needs a second, deliberate click with the risk spelled out.

**Signing.** The opt-in transaction is signed by the **PARSEC Keycore** in Rust; no recovery phrase
enters the interface (`src/lib/algorand/opt-in.ts`).

## Opting in and x402

x402 payments on Algorand are made in **USDC (ASA 31566704)**, so both sides need the opt-in:

- **The payer** must hold USDC, which means having opted in to it. The x402 desk and the payment
  screen check this before anything is signed. If the opt-in is missing, the payment screen offers it
  as a one-click fix and then continues to the payment — no starting over.
- **The seller's receiving address (`payTo`)** must be opted in too, or the payment is rejected on
  chain. That is why a seller cannot accept USDC at an address that never opted in.

The payment itself is **fee-sponsored**: the facilitator pays its network fee. ALGO is needed only for
the account's minimum balance and the one-time opt-in. The **Ready for x402** checklist (after creating
a wallet, on the x402 desk and on the `.algo` review screen) walks through it: ALGO for the opt-in →
USDC added → a USDC balance.

## Where it lives

| What | Where |
|---|---|
| Add Assets screen (its own place) | Dashboard → **ADD ASSET**, or Wallet Pouch → Add Assets |
| The picker (search + verified list) | `src/lib/ui/asset-picker.ts` — also on the x402 desk |
| Verified list and lookalike check | `src/lib/algorand/asset-whitelist.ts` |
| Opt-in (Keycore-signed) | `src/lib/algorand/opt-in.ts` |
| x402 readiness | `src/lib/ui/x402-ready.ts` |
| Payment-screen fix-and-continue | `recheckPayment()` in `src/lib/x402/client.ts`, used by `views/x402-confirm.ts` |
