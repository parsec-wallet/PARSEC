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

Next ([plan](TODO-INDEX.md)): lookalike detection that folds case, look-alike characters and spacing
(0.3.2); finding and adding assets from the ragebar (0.3.3); SPINTRADE using this list as its
authority (0.3.4).
