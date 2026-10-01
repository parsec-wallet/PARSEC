# xchain — EVM-controlled Algorand

> An Algorand account controlled by an EVM wallet (MetaMask / Rabby) via a
> LogicSig — no Algorand seed.

## Overview

`xchain` is an Algorand account whose **signing authority is an EVM wallet**.
There is no Algorand seed material: the account is a LogicSig template derived
deterministically from an EVM address, and MetaMask / Rabby / etc. remains the
sole custodian. The vault stores only the EVM-address mapping.

## Key derivation

- **No mnemonic.** The Algorand address is a deterministic LogicSig template
  derived from the controlling **EVM address** (network-independent).
- Control is delegated to the injected EVM provider; PARSEC generates no keys.

## Address format

Standard Algorand — 58-character base32.

## Implemented

| Capability | Status |
|---|---|
| Create | ✅ detect injected EVM provider → request accounts → derive LogicSig address |
| Import | ✅ watch-only, via EVM address |
| Sign | ✅ routed through the EVM provider (MetaMask) |

## Key files

`src/lib/xchain/` — `module.ts`, `account.ts`, `sdk.ts`, `sign.ts`.

## Notes

`signingAuthority` is `metamask`. Wired into the x402 signer bridge. Useful for
EVM-native users who want an Algorand presence without a second seed phrase.
