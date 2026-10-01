# Bitcoin — PARSEC chain pack

> BIP-32/44 Bitcoin wallet. Thin TypeScript IPC wrapper over the Rust backend.

## Overview

The Bitcoin pack is a thin IPC wrapper over the Rust backend
(`src-tauri/src/chain_btc/`). No secret material crosses the boundary — only
addresses and metadata come back; the mnemonic stays encrypted in
`bankon_vault`.

## Key derivation

- **Mnemonic:** 12- or 24-word **BIP-39**.
- **Algorithm:** BIP-32 / BIP-44, path **`m/44'/0'/account'/0/index`**.
- Derivation, signing, and key handling all live in Rust.

## Address format

- **native-segwit** — bech32 (`bc1…`)
- **segwit-compat** — P2SH (`3…`)
- **legacy** — P2PKH (`1…`)

## Implemented

| Capability | Status |
|---|---|
| Create | ✅ `btcGenerateMnemonic()` |
| Import | ✅ `btcImportMnemonic()` |
| Derive | ✅ `btcDeriveAddress()` — single index, or vault-aware multi-index |
| Balance / Send | handled by the Rust chain pack; not yet surfaced as a dashboard wallet |

## Key files

`src/lib/bitcoin/account.ts` (IPC interface) · `src-tauri/src/chain_btc/` (Rust).

## Notes

The vault-aware API is preferred for real use — the mnemonic never leaves the
Rust vault. Desktop (Tauri) only: the IPC wrapper requires the Rust backend.
