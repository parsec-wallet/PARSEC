# Verified Algorand assets

PARSEC calls an Algorand Standard Asset (ASA) **verified** only when its **id** is on PARSEC's
list — never because of its ticker or name. Anyone can mint an asset called "USDC"; the list is
what says which one is Circle's.

- **The list:** [`src/lib/algorand/asset-whitelist.json`](../src/lib/algorand/asset-whitelist.json)
  (22 mainnet assets and testnet USDC as of 2026-10-02).
- **Its snapshot:** [`asset-whitelist.snapshot.json`](../src/lib/algorand/asset-whitelist.snapshot.json)
  — what the indexer and Pera reported for each entry on the day it was checked.
- **The check:** `npm run asa:check` re-derives every entry live; `--write-snapshot` refreshes the
  snapshot, and only when every entry matches the chain.

## What an entry pins

| Field | Meaning |
|---|---|
| `assetId` | The asset. The only thing that makes an asset "this one". |
| `creator` | The account that created it — a copy under another creator is not this asset. |
| `unitName`, `name` | Exactly as on chain (`name` is never a display name). |
| `label` | How PARSEC shows it where the on-chain name is ambiguous, e.g. "USD Coin (Wormhole)". |
| `decimals` | As on chain. |
| `freeze`, `clawback` | Whether the issuer kept the right to freeze holdings or take tokens back. |
| `issuer`, `group` | Who issued it, and where the asset picker lists it. |
| `sources` | Where the entry was confirmed — the issuer's own page first. |

## How an asset gets on the list

1. Its id comes from the **issuer's own published list** (Circle publishes USDC's Algorand id) or
   from a **recognised verification registry**: Pera's tier must be `verified` or `trusted`.
2. Its fields are copied **from the indexer**, not typed: `npm run asa:check` fails on any difference
   in id, creator, unit, name, decimals or freeze/clawback rights, on a deleted asset, or on a Pera
   tier other than verified/trusted.
3. Receipt and derivative tokens of a protocol (Folks' `f…` tokens) are left out; assets whose issuer
   cannot be confirmed are left out — `1007352535`, a Pera-verified "USD Coin" with no issuer
   information, is not on the list.

## Assets that share a ticker

Several real assets are called USDC, WBTC or WETH: Circle's USDC and the Wormhole-bridged USDC;
Wormhole's WBTC/WETH and the Wormhole NTT versions created by Folks Finance. All are on the list,
told apart by **issuer** and **label**. A listed asset is never a lookalike of another listed one;
an **unlisted** asset that borrows a listed unit or name is called out as not the listed one.

## Keeping it current

Run `npm run asa:check` before every release. A mismatch means the chain disagrees with the list —
fix or remove the entry. Drift (a changed manager, reserve, URL or supply) is reported for review;
`--write-snapshot` records it once reviewed. The check needs the network, so CI holds the list to
its committed snapshot (`asset-whitelist.test.ts`) rather than calling the chain.

## Verified, lookalike or unverified

One function decides, everywhere: `classifyAsset` in
[`asset-classify.ts`](../src/lib/algorand/asset-classify.ts).

- **verified** — the id is on the list (and, when the creator is known, it matches).
- **lookalike** — not listed, but its unit or name reads the same as a listed asset's once
  `foldTicker` has folded case, look-alike letters (Cyrillic and Greek ones that render as Latin,
  fullwidth forms), invisible and combining characters, spacing and punctuation, and the stand-ins
  0→O, 1/I→l, 5/$→S. "UЅDС" with Cyrillic letters, "ＵＳＤＣ" and "U S D C" are all lookalikes of
  Circle's USDC.
- **unverified** — anything else.

A lookalike can never be verified: verification is by id, and folding only finds what an asset is
pretending to be. A property test disguises every listed asset 40 ways under other ids and requires
every disguise to come out a lookalike. A name that merely *contains* a ticker ("Folks USDC") is not
flagged — it would flag most of the ecosystem — and the confusables table covers the scripts used in
real impersonation, extended as new ones are found.

## Finding and adding an asset

- **The command palette (Ctrl/Cmd-K)** finds Algorand assets by name, ticker or id, in its own
  "Algorand assets" section: verified matches at once, then the indexer's, each badged
  verified / lookalike ("⚠ Not USDC") / unverified, with its ASA id and network. It searches
  Algorand only — an ASA id means nothing on other chains, and EVM chains are the RAGEbar's.
- Choosing a result opens **ADD ASSETS** on that asset. The card states the cost first (0.1 ALGO set
  aside, returned on removal; 0.001 ALGO fee); an unverified or lookalike asset, or one whose issuer
  can freeze or claw back, takes a second, explicit click; the opt-in is signed in the Keycore.
- An asset the account holds with a zero balance can be **removed** (opted out) the same way.
- **The dashboard** badges each held asset verified or lookalike, and shows a dollar value only for
  verified dollar stablecoins chosen by id — an asset that merely calls itself USDC shows none.

Live Pera lookups for unlisted results are not made: that would tell a third party which assets a
person looks at. The list records Pera's tier at each check instead.

## SPINTRADE

SPINTRADE names every asset by ticker **and** ASA id ("USDC (ASA 31566704)") in the pool list, the
"from" list, the quote and each leg of the route, with its status: native (ALGO), verified (by id,
with its issuer), unverified, or a lookalike ("⚠ not USDC"). Pools are ordered USDC, verified,
unverified, lookalikes. A swap into or out of an unverified or lookalike asset is blocked until the
person ticks a statement naming the asset and, for a lookalike, the asset it imitates. "Swap to
USDC" only ever means the listed USDC, by id. (`src/lib/dex/spintrade-assets.ts`)
