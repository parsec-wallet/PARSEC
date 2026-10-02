# PARSEC Wallet — Documentation

PARSEC is a sovereign, modular multi-chain wallet. This folder documents each
chain pack, each tool / extension, and the operational surface. It mirrors the
codebase: a chain or tool is a self-contained module, and each gets its own doc.

## Start here

- [TODO-INDEX.md](./TODO-INDEX.md) — task index + quick start
- [DEVELOPMENT_PLAN.md](./DEVELOPMENT_PLAN.md) — roadmap
- [technical.md](./technical.md) — the Rust backend module by module (16 modules, 112 commands), and the optional infrastructure: what it does and what it needs to run
- [algorand-assets.md](./algorand-assets.md) — **opting in to assets**: why Algorand's opt-in stops spam tokens, the verified list and lookalike guard, and what x402 needs
- [bankon-vault.md](./bankon-vault.md) — **the vault, explained**: how keys are kept, profiles (several vaults on one device), a forgotten passphrase, the commands, and how code uses it
- [design/controls.md](./design/controls.md) — the interface's controls: in-house styles for Blueprint's class vocabulary, with Blueprint kept as the design reference
- [modules.md](./modules.md) — **the expansion contract**: one module registration adds a chain, a name registry or a dApp surface
- [cypherpunk4096.md](./cypherpunk4096.md) — the consortium standard PARSEC joins on completion, and an honest gap list against its five commitments
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

- [Verified assets](./verified-assets.md) — the ASA list: what "verified" means, how entries are checked against the chain
- [SpinTrade](./spintrade.md) — DEX aggregator (Pact + Tinyman, on-chain)
- [x402](./x402-integration.md) — HTTP 402 payments: the protocol, the Algorand and EVM rails, embedding the module in another wallet
- [x402 API](./x402-api.md) — every export, every error, troubleshooting
- [NFDminter](./nfdominter.md) — `.algo` name minting, subdomains & hierarchy (NFD)
- [BANKON Names](./bankon-names.md) — sovereign permaweb namespace
- [BANKON Marketspace](./marketspace.md) — secondary market for names
- [Named-NFT binding](./named-nft-binding.md) — bind ASAs to namespace names
- [aORC](./aorc.md) — Algorand Open Runtime Contracts (NFT minting)
- [pmVPN](./pmvpn.md) — wallet-authenticated SSH
- [Diagnostics](./diagnostics.md) — opt-in network/system monitor, no storage
- [Permaweb](./permaweb/README.md) — ar.io names, gateway operation, the ARIO bridge, and **in-wallet uploads to Arweave** (upload → verify → point a name)
- [Lightspeed](./lightspeed.md) — reactive chain reads over a chosen provider (light.js idea, zero deps); **the module template** with the choices / privilege ladder

## dApp integration

- [PARSEC Connect](./parsec-connect.md) — wallet-side bridge architecture
- [Integration guide](./integration/README.md) — connect a dApp (`@txnlab/use-wallet`)

## Operations & reference

- [PRODUCTION_DEPLOY.md](./PRODUCTION_DEPLOY.md) — deployment checklist
- [PROOF.md](./PROOF.md) — Mausoleum encryption attestation
- [algorandtestnet.md](./algorandtestnet.md) — testnet endpoints
- [announcement.md](./announcement.md) — project introduction
- [snapshot-investigation.md](./snapshot-investigation.md) — ARIO migration snapshot
- [GITHUB_ACTIONS_TRIGGER_GUIDE.md](./GITHUB_ACTIONS_TRIGGER_GUIDE.md) — CI triggers
- [arweave-ario-map.md](./arweave-ario-map.md) — **the complete Arweave / ar.io source map**:
  every file, both ar.io eras, the AO processes, the endpoints, what we import vs re-implemented.
  `npm run map:arweave` regenerates it and names anything unmapped
- [reference/permaweb/](./reference/permaweb/README.md) — the Arweave / ar.io source
  corpus the permaweb module is built on, plus dated snapshots of
  [docs.ar.io](./reference/permaweb/docs-ar-io/README.md) and
  [toon.ar.io](./reference/permaweb/toon-ar-io/README.md)

## Conventions

- A **chain pack** lives in `src/lib/<chain>/` and implements the `WalletModule`
  interface (`src/lib/pouch/`).
- The runtime **chain registry** is `src/lib/chains.ts` — CAIP-2 ids, explorer
  URLs, balance fetchers; read by the dashboard and the wallet switcher.
- **Dashboard tiles** self-register from `src/lib/dashboard/`.
- Adding a chain or tool means adding a module *and* a doc here — see
  [chains/README.md](./chains/README.md#adding-a-chain).
