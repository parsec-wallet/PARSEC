# PERA_DEPARTURE — the canonical source PARSEC departs from, on Algorand

PARSEC builds each chain's compatibility by following the **canonical wallet's own code as the
reference example** — Pera → Algorand, Phantom → Solana, MetaMask → EVM. This file records the
Algorand leg: **which Pera Wallet source is held in the parsec-wallet org as the departure point,
under what license, and what PARSEC takes from it.**

## The forks (held in github.com/parsec-wallet)

| Fork | Upstream | What it is | Why it is the departure |
|---|---|---|---|
| [`parsec-wallet/pera-web-wallet`](https://github.com/parsec-wallet/pera-web-wallet) | `perawallet/pera-web-wallet` | Pera's web wallet application (TypeScript) | The closest cousin to PARSEC's own shape — browser wallet, account/seed handling, transaction signing in TS |
| [`parsec-wallet/pera-wallet`](https://github.com/parsec-wallet/pera-wallet) | `perawallet/pera-wallet` | The canonical Pera monorepo | The reference for account model, 25-word-seed handling, and the conventions the Algorand ecosystem treats as normative |
| [`parsec-wallet/connect`](https://github.com/parsec-wallet/connect) | `perawallet/connect` | `@perawallet/connect` JS SDK | The dApp-connection model — the wire PARSEC's per-connection-keypair design must remain compatible with |

Forks, not copies: GitHub lineage back to `perawallet/*` stays visible, which is part of the credit.

## License and attribution

<!-- REUSE-IgnoreStart -->All three upstreams are **Apache License 2.0, Copyright Pera Wallet, LDA** (GitHub's license detector<!-- REUSE-IgnoreEnd -->
shows "Other"/NOASSERTION because of the notice-file format; the LICENSE text in each repo is the
Apache-2.0 notice — verified 2026-08-20). Apache-2.0 permits derivative work with attribution and
license preservation. Any PARSEC module derived from these sources must:

1. keep the Apache-2.0 license and the **Pera Wallet, LDA** copyright notice on derived files;
2. state the derivation in the file header ("derived from perawallet/<repo> @ <commit>");
3. carry changes in a NOTICE entry rather than silently diverging.

## What PARSEC takes (and what it doesn't)

**Takes as reference:** the Algorand account model; 25-word mnemonic seed handling; transaction
building/signing conventions; the connect session model. PARSEC's existing `src/lib/algorand/` and
`src/lib/algorand-hd/` were already modeled on Pera's example; these forks pin the exact source that
modeling departs from.

**The forward reason these forks matter now — Algorand's post-quantum roadmap.** Per
[Algorand's PQ roadmap](https://algorand.co/blog/algorand-post-quantum-cryptography-roadmap)
(credit: **Algorand** — first post-quantum mainnet transaction, Falcon, 2025), **native Falcon-1024
accounts arrive Q3 2026**, derived from the **standard 25-word seed**, and **Pera Wallet is a named
supporting wallet**. When Pera lands Falcon-1024 derivation, these forks are where PARSEC reads that
implementation and inherits it — the same Pera-as-example path, now carrying the quantum leg of
PARSEC's Tier-Q target (see [QUANTUM.md](QUANTUM.md)).

**Does not take:** custody or telemetry decisions. PARSEC remains sovereign, client-side,
per-connection-keypair (CP2048-QR §3, carried into cypherpunk4096); keys live in the bankon_vault
keystore as `bytes` across architectures (ed25519 · secp256k1 · RSA-4096 · Falcon when it lands).

## Credits

- **Pera Wallet, LDA** — the canonical Algorand wallet whose open source (Apache-2.0) is the departure
  point for PARSEC's Algorand compatibility.
- **Algorand** — the substrate: the first post-quantum mainnet transaction (2025), the native
  Falcon-1024 account design and 25-word-seed derivation (Q3 2026), the cryptographic-agility
  framework, and State Proofs. PARSEC's quantum posture is grounded in, and dated against,
  [Algorand's post-quantum cryptography roadmap](https://algorand.co/blog/algorand-post-quantum-cryptography-roadmap).
