# Algorand — Parsec chain pack

> The primary chain. Classic 25-word algosdk accounts — generate/recover,
> fetch balance, send payments and assets.

## Overview

Algorand is Parsec's home chain. The classic module uses `algosdk` directly:
account generation, recovery, ALGO + ASA transfers, and NFT metadata
(ARC-3 / ARC-19 / ARC-69, ARC-26 URIs).

## Key derivation

- **Mnemonic:** 25-word **algosdk** mnemonic — *not* BIP-39. It encodes a
  single 32-byte Ed25519 secret key; there is no hierarchical derivation.
- **One mnemonic = one address.** For HD (24-word BIP-39, many addresses)
  see [algorand-hd](./algorand-hd.md).
- **CAIP-2:** `algorand:wGHE2Pwdvd7S12BL5FaOP20EGYesN73k` (mainnet).

## Address format

58-character base32 with a 4-byte checksum.

## Implemented

| Capability | Status |
|---|---|
| Create | ✅ `generateAccount()` |
| Import | ✅ 25-word mnemonic · base64 private key · watch-only address |
| Balance | ✅ `fetchAccountInfo()` — ALGO + ASAs |
| Send | ✅ ALGO payments, ASA transfers |
| Sign | ✅ via the vault bridge |
| Assets | ✅ ASA opt-in / opt-out, verified registry, NFT ARC-19/26 |

## Key files

`src/lib/algorand/` — `account.ts`, `transactions.ts`, `assets.ts`,
`client.ts` (Algod/Indexer), `validate.ts` (input classifier),
`nft-metadata.ts`, `nft-arc19.ts`, `arc26.ts`, `query-cache.ts`.

## Notes

The create flow (`views/create-wallet.ts`) and import flow
(`views/import-wallet.ts`) are Algorand-first. Network is switchable between
mainnet / testnet / betanet in Settings.
