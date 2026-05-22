# Parsec Wallet — Documentation

Parsec is a sovereign, modular multi-chain wallet. This folder documents each
chain pack, each tool / extension, and the operational surface. It mirrors the
codebase: a chain or tool is a self-contained module, and each gets its own doc.

## Start here

- [TODO-INDEX.md](./TODO-INDEX.md) — task index + quick start
- [DEVELOPMENT_PLAN.md](./DEVELOPMENT_PLAN.md) — roadmap
- [../README.md](../README.md) — project overview, architecture, security model

## Chains

Each blockchain is a self-contained **chain pack** — see
**[chains/](./chains/README.md)** for the model and how to add one.

- [Algorand](./chains/algorand.md) — classic 25-word algosdk accounts (home chain)
- [Algorand HD / ARC-52](./chains/algorand-hd.md) — BIP32-Ed25519 hierarchical
- [Solana](./chains/solana.md) — SLIP-0010 ed25519, Phantom-compatible
- [Arweave](./chains/arweave.md) — deterministic RSA-4096 + permaweb stack
- [Bitcoin](./chains/bitcoin.md) — BIP-32/44, Rust-backed
- [Litecoin](./chains/litecoin.md) — BIP-32/44, Rust-backed
- [xchain](./chains/xchain.md) — EVM-controlled Algorand (no Algorand seed)
- [Key handling](./chains/key-handling.md) — cross-chain key-handling map

## Tools & extensions

- [SpinTrade](./spintrade.md) — DEX aggregator (Pact + Tinyman, on-chain)
- [x402](./x402-integration.md) — AgenticPlace micropayments + BANKON identity
- [NFDominter](./nfdominter.md) — `.algo` name minting (NFD)
- [BANKON Names](./bankon-names.md) — sovereign permaweb namespace
- [BANKON Marketspace](./marketspace.md) — secondary market for names
- [Named-NFT binding](./named-nft-binding.md) — bind ASAs to namespace names
- [aORC](./aorc.md) — Algorand Open Runtime Contracts (NFT minting)
- [pmVPN](./pmvpn.md) — wallet-authenticated SSH
- [Diagnostics](./diagnostics.md) — opt-in network/system monitor, no storage

## dApp integration

- [Parsec Connect](./parsec-connect.md) — wallet-side bridge architecture
- [Integration guide](./integration/README.md) — connect a dApp (`@txnlab/use-wallet`)

## Operations & reference

- [PRODUCTION_DEPLOY.md](./PRODUCTION_DEPLOY.md) — deployment checklist
- [PROOF.md](./PROOF.md) — Mausoleum encryption attestation
- [algorandtestnet.md](./algorandtestnet.md) — testnet endpoints
- [announcement.md](./announcement.md) — project introduction
- [snapshot-investigation.md](./snapshot-investigation.md) — ARIO migration snapshot
- [GITHUB_ACTIONS_TRIGGER_GUIDE.md](./GITHUB_ACTIONS_TRIGGER_GUIDE.md) — CI triggers

## Conventions

- A **chain pack** lives in `src/lib/<chain>/` and implements the `WalletModule`
  interface (`src/lib/pouch/`).
- The runtime **chain registry** is `src/lib/chains.ts` — CAIP-2 ids, explorer
  URLs, balance fetchers; read by the dashboard and the wallet switcher.
- **Dashboard tiles** self-register from `src/lib/dashboard/`.
- Adding a chain or tool means adding a module *and* a doc here — see
  [chains/README.md](./chains/README.md#adding-a-chain).
