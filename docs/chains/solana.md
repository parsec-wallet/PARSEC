# Solana — PARSEC chain pack

> BIP-39 → SLIP-0010 ed25519 wallet. Phantom / Solflare-compatible derivation.

## Overview

The Solana pack creates and operates a Solana wallet inside a PARSEC account.
Derivation is byte-compatible with Phantom and Solflare, so a PARSEC Solana
recovery phrase restores in those wallets and vice versa.

## Key derivation

- **Mnemonic:** 24-word **BIP-39**.
- **Algorithm:** BIP-39 seed → **SLIP-0010 ed25519**, path
  **`m/44'/501'/0'/0'`** (every segment hardened — SLIP-0010 ed25519 permits
  hardened derivation only).
- **CAIP-2:** `solana:101` (mainnet). Solana has no testnet tie to Algorand's
  network setting — PARSEC treats Solana as always-mainnet.
- A known-answer test (`src/lib/solana/__tests__/seed.test.ts`) pins the
  derivation against an independently-derived reference address.

## Address format

32-byte ed25519 public key, base58-encoded — 43–44 characters.

## Implemented

| Capability | Status |
|---|---|
| Create | ✅ `views/solana-create.ts` |
| Import | ✅ mnemonic · watch-only |
| Balance | ✅ `getBalance` via public RPC |
| Send | ✅ `views/solana-send.ts` — hand-built System Program transfer with a `simulateTransaction` preflight |
| Sign | ✅ ed25519 |

## RPC

`https://solana-rpc.publicnode.com` — a keyless, CORS-enabled public node.
`api.mainnet-beta.solana.com` is **not** used: it returns HTTP 403 for any
request carrying a browser `Origin` header.

## Key files

`src/lib/solana/` — `module.ts`, `seed.ts`, `address.ts` (base58),
`balance.ts` (JSON-RPC client), `transfer.ts` (sign + submit).

## Notes

PARSEC carries no `@solana/web3.js` dependency — the SOL transfer is assembled
by hand (shortvec encoding, System Program transfer) from the base58 +
`@noble/curves` primitives already in the bundle. The transfer serializer has
a unit test (`__tests__/transfer.test.ts`).
