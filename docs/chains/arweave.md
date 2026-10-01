# Arweave — Parsec chain pack

> Deterministic RSA-4096 Arweave wallet + the permaweb stack (AO, ANS-104, ArNS).

## Overview

The Arweave pack derives a deterministic RSA-4096 key from a BIP-39 mnemonic
and is the signer for permanent storage, AO process messages, ANS-104
DataItems, and ArNS / BANKON name actions.

## Key derivation

- **Mnemonic:** 24-word **BIP-39**.
- **Algorithm:** BIP-39 seed → seeded PRNG → **deterministic RSA-4096** keygen
  (`node-forge`). The keygen is slow and CPU-heavy, so it runs **synchronously
  inside a Web Worker** (`derive-worker.ts`) to keep the UI responsive.
- **Determinism:** the same 24 words always produce the same JWK — the words
  are the only backup. *Not* byte-compatible with Wander's human-crypto-keys;
  import a Wander key via JWK instead of mnemonic.
- **Vault tag:** `arweave-hd` (the full JWK is stored; the 24 words are cold backup).
- **CAIP-2:** `arweave:mainnet` (ad-hoc — Arweave has no registered namespace).

## Address format

43-character base64url — `SHA-256(public modulus)`.

## Implemented

| Capability | Status |
|---|---|
| Create | ✅ `views/arweave-create.ts` — worker keygen, ~10–60 s |
| Import | ✅ mnemonic · JWK (private-key) · watch-only |
| Balance | ✅ via the gateway client |
| Send | ✅ `views/arweave-send.ts` — AR transfer |
| Sign | ✅ RSA-PSS via WebCrypto |
| Permaweb | ✅ AO messages/spawn, ANS-104 DataItems, ArNS, ANT, gateway upload |

## Key files

`src/lib/arweave/` — `module.ts`, `seed.ts`, `derive-worker.ts`, `jwk.ts`,
`client.ts` (gateway), `tx.ts` (build/sign/upload), `ans104.ts`, `ao.ts`,
`ario.ts`, `ant.ts`, `signer.ts`, `inject.ts` (`window.arweaveWallet`).

The full inventory — every Arweave, ar.io, AO and naming file in the repo, both registry eras,
the runtime endpoints and the upstream dependency split — is
[`../arweave-ario-map.md`](../arweave-ario-map.md).

## Notes

ArNS is one of two namespaces behind the unified name hub — see
[BANKON Names](../bankon-names.md). The RSA keygen previously hung in the
browser via node-forge's async scheduler; it now runs synchronously in a
worker, which is reliable in every environment.
