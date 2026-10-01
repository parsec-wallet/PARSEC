# Algorand HD (ARC-52) — PARSEC chain pack

> BIP32-Ed25519 hierarchical Algorand wallet, parallel to the classic 25-word module.

## Overview

`algorand-hd` derives many Algorand addresses from one 24-word BIP-39 seed,
following **ARC-52** (BIP32-Ed25519). It runs alongside the classic
[algorand](./algorand.md) module without conflict — the 24-word seed is stored
in `bankon_vault` tagged `algorand-hd` so it is never confused with the
25-word algosdk path.

## Key derivation

- **Mnemonic:** 24-word **BIP-39**.
- **Algorithm:** BIP-39 → PBKDF2 seed → BIP32-Ed25519
  (`@algorandfoundation/xhd-wallet-api`).
- **Hierarchical:** one seed derives multiple addresses (`listDerivedAddresses`).
- **Vault tag:** `algorand-hd`.

## Address format

Standard Algorand — 58-character base32.

## Implemented

| Capability | Status |
|---|---|
| Create | ✅ |
| Import | ✅ mnemonic · watch-only |
| Derive | ✅ multi-address (`listDerivedAddresses`) |
| Sign | ✅ `signBytesWithVault` |

## Key files

`src/lib/algorand-hd/` — `module.ts`, `seed.ts`, `derive.ts`, `sign.ts`,
`crypto-shim.ts`.

## Notes

Wired into the x402 signer bridge. Because both Algorand modules share the same
58-char address format, an account can hold a classic *and* an HD Algorand
address; the vault chain tag keeps the two seeds distinct.
