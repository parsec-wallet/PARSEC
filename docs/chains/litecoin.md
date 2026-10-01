# Litecoin — PARSEC chain pack

> BIP-32/44 Litecoin wallet. Mirrors the Bitcoin pack; LTC specifics live in Rust.

## Overview

The Litecoin pack is a thin IPC wrapper over the Rust backend
(`src-tauri/src/chain_ltc/`), the same shape as [Bitcoin](./bitcoin.md).
Litecoin's differences — coin type `2'`, the `ltc` bech32 HRP, base58 prefixes
`L` / `M` — are all handled in Rust.

## Key derivation

- **Mnemonic:** 12- or 24-word **BIP-39**.
- **Algorithm:** BIP-32 / BIP-44, path **`m/44'/2'/account'/0/index`**.

## Address format

- **native-segwit** — bech32 (`ltc1…`)
- **segwit-compat** — P2SH (`M…`)
- **legacy** — P2PKH (`L…`)

## Implemented

| Capability | Status |
|---|---|
| Create | ✅ |
| Import | ✅ |
| Derive | ✅ vault-aware and direct |
| Sign | ✅ PSBT signing (Rust) |
| Balance / Send | handled by the Rust chain pack; not yet surfaced as a dashboard wallet |

## Key files

`src/lib/litecoin/account.ts` (IPC interface) · `src-tauri/src/chain_ltc/` (Rust).

## Notes

Desktop (Tauri) only.
