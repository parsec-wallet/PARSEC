# PARSEC Wallet

Sovereign multi-chain wallet — Algorand, Solana, Arweave. Your keys. Your coins. No compromises.

(c) 2026 BANKON. GPL-3.0-only (encryption & privacy core) · Apache-2.0 (the rest) · MIT (server side) — see [LICENSE](LICENSE).

## What Is Parsec

Parsec is a sovereign universal wallet built on cypherpunk2048 principles. No React, no frameworks — a lean dependency set (algosdk, @noble curves, arweave). Vanilla TypeScript frontend with Blueprint.js CSS. Rust backend via Tauri with bankon_vault encrypted key storage.

Every Parsec node is both client and server. P2P mesh with IPFS content handoffs. PostgreSQL + pgvectorscale for search (no Elasticsearch). Resource-aware throttling maps CPU, bandwidth, and electricity to crypto exchange value. dApp filesystem access controlled by participant choice on a 1-10 scale.

Parsec never holds your private key or mnemonic. Keys are encrypted on your device with your passphrase. bankon_vault is recommended but optional — the web version works standalone. All security is open source.

## Features

- **Create or import** Algorand wallets (25-word mnemonic, base64 private key, or watch-only address)
- **Send & receive** ALGO and any Algorand Standard Asset (ASA)
- **Multi-chain** — one account holds addresses on Algorand, Solana, and Arweave; each chain created or imported from its own recovery phrase
- **Wallet switcher** — Phantom-style header picker: switch account or chain in one click, copy any chain address, per-account emoji avatars
- **Solana** — create or import a Solana wallet (SLIP-0010 ed25519, Phantom-compatible derivation), view SOL balance, send SOL
- **Arweave** — create an RSA-4096 Arweave wallet (deterministic keygen runs in a background Web Worker), view AR balance, send AR
- **NFDominter** — mint and manage `.algo` names via NFD contracts
- **SpinTrade swap** — in-wallet DEX via Tinyman v2 pools
- **ASA management** — opt-in, opt-out, verified registry (USDC, USDt)
- **Transaction confirmation** — review recipient, amount, fee, and network before signing
- **Freeze/clawback warnings** — flagged before opt-in and on dashboard
- **bankon_vault** — Rust-side Argon2id + AES-256-GCM encrypted key storage
- **Tomb cold storage** — Linux LUKS encrypted volumes with USB key separation
- **Auto-lock** — enforced in Rust, on by default (5 min), configurable; the DEK is dropped even if the UI is wedged or compromised
- **Multi-account** — create, import, switch between accounts
- **Watch-only mode** — view balances without signing keys
- **In-wallet docs** — quickstart, FAQ, security model, asset guide
- **Network switching** — mainnet, testnet, betanet
- **Input classifier** — live detection and validation of pasted secrets
- **pmVPN** — wallet-authenticated SSH terminal for remote machine access
- **parsec_search** — sovereign search via PostgreSQL + pgvectorscale (no Elasticsearch)
- **parsec_mesh** — every client is a server; IPFS content-addressed handoffs
- **parsec_throttle** — resource-aware rate limiting (CPU, bandwidth, electricity mapping)
- **parsec_sandbox** — dApp filesystem permissions on 1-10 participant choice scale

## Quick Start

### Prerequisites

- **Node.js** 20+ and npm
- **Rust** (latest stable) — for desktop builds only
- **Platform-specific dependencies (Linux):** `webkit2gtk-4.1`, `libappindicator3-dev`, `librsvg2-dev`

### Install & Run (Web)

```bash
npm install
npm run dev
```

Open `http://localhost:1420` in your browser. The web version is fully functional — create wallets, send/receive, swap, manage assets.

### Run Desktop App (Tauri)

```bash
npm run tauri:dev
```

Requires Rust toolchain. Desktop version uses bankon_vault (Rust-side encryption) for stronger key protection.

### Build for Production

```bash
# Frontend only
npm run build

# Desktop app (current platform)
npm run tauri:build
```

## Architecture

```
src/                          # Frontend — vanilla TypeScript
├── main.ts                   # Entry point, view registration, auto-lock
├── lib/
│   ├── store.ts              # State management (sensitive data in private fields)
│   ├── router.ts             # View router (re-renders only on view change)
│   ├── dom.ts                # DOM helpers (el, btn, input, toast)
│   ├── keystore.ts           # Unified keystore (auto-selects vault or web crypto)
│   ├── crypto.ts             # Web Crypto fallback (PBKDF2 + AES-256-GCM)
│   ├── vault.ts              # Tauri vault IPC client
│   ├── tomb.ts               # Tomb IPC client (Linux cold storage)
│   ├── algorand/
│   │   ├── account.ts        # Account create, import, validate
│   │   ├── client.ts         # Algod/Indexer client config (AlgoNode)
│   │   ├── transactions.ts   # Send ALGO, send ASA, fetch history
│   │   ├── assets.ts         # ASA opt-in/out, lookup, enrichment, registry
│   │   ├── swap.ts           # SpinTrade engine (Tinyman v2 quotes + execution)
│   │   └── validate.ts       # Input classifier (mnemonic, key, address)
│   ├── solana/               # Solana — SLIP-0010 ed25519 derivation, balance, transfer
│   ├── arweave/              # Arweave — RSA-4096 keygen (Web Worker), tx, AO, ANS-104
│   ├── dashboard/            # Dashboard module registry + wallet switcher
│   ├── chains.ts             # Chain registry — CAIP-2 ids, per-chain metadata
│   └── avatars.ts            # Deterministic per-account emoji avatars
├── views/                    # UI views (vanilla DOM)
│   ├── onboarding.ts         # Welcome screen
│   ├── create-wallet.ts      # Generate mnemonic
│   ├── verify-mnemonic.ts    # Verify + set passphrase
│   ├── import-wallet.ts      # Import (mnemonic/key/address)
│   ├── unlock.ts             # Session unlock
│   ├── dashboard.ts          # Balance, assets, transactions
│   ├── send.ts               # Send with asset selector
│   ├── confirm-send.ts       # Transaction review
│   ├── receive.ts            # Public address display
│   ├── add-asset.ts          # ASA opt-in
│   ├── swap.ts               # SpinTrade DEX
│   ├── docs.ts               # In-wallet documentation
│   ├── settings.ts           # Network, accounts, avatars, lock, reset
│   ├── solana-create.ts      # Create a Solana wallet
│   ├── solana-send.ts        # Send SOL
│   ├── arweave-create.ts     # Create an Arweave (RSA-4096) wallet
│   ├── arweave-send.ts       # Send AR
│   └── nfdominter.ts         # Mint / manage .algo names (NFD)
├── types/wallet.ts           # TypeScript types
└── styles/                   # SCSS design system + Blueprint CSS

src-tauri/                    # Backend — Rust
├── src/
│   ├── lib.rs                # Tauri app (6 states, 66 IPC commands)
│   ├── main.rs               # Entry point
│   ├── bankon_vault/         # Encrypted vault (16 commands)
│   │   ├── crypto.rs         # Argon2id + AES-256-GCM
│   │   ├── store.rs          # File-based vault storage
│   │   ├── tomb.rs           # Tomb CLI wrapper (Linux cold storage)
│   │   └── commands.rs + tomb_commands.rs
│   ├── pmvpn/                # Wallet-authenticated SSH (5 commands)
│   ├── parsec_search/        # PostgreSQL + pgvectorscale (8 commands)
│   │   ├── pool.rs           # Connection pool + extension detection
│   │   ├── schema.rs         # Auto-migrating tables
│   │   └── search.rs         # Hybrid text + vector search
│   ├── parsec_mesh/          # P2P mesh + IPFS handoffs (10 commands)
│   │   ├── ipfs.rs           # Kubo HTTP API integration
│   │   ├── peer.rs           # Discovery + reputation
│   │   ├── resource.rs       # CPU/bandwidth/electricity mapping
│   │   └── server.rs         # Embedded axum server
│   ├── parsec_throttle/      # Rate limiting + energy cost (6 commands)
│   └── parsec_sandbox/       # dApp filesystem 1-10 scale (11 commands)
├── Cargo.toml
└── tauri.conf.json
```

## Security Model

- **Key sovereignty** — Parsec never stores raw keys. Encrypted with your passphrase on your device.
- **Desktop encryption** — Argon2id key derivation + AES-256-GCM (bankon_vault, Rust)
- **Web encryption** — PBKDF2 600K iterations + AES-256-GCM (Web Crypto API)
- **Session isolation** — passphrase held in private class fields, never serialized to localStorage
- **Mnemonic zeroing** — secrets overwritten after signing, cleared in finally blocks
- **Auto-lock** — Rust-enforced idle timer, on by default, drops the vault key independently of the frontend
- **CSP hardened** — no unsafe-inline, no unsafe-eval, whitelisted endpoints only
- **Cold storage** — optional Tomb encrypted volumes with USB key separation (Linux)
- **Watch-only** — explicit flag, signing blocked at view level
- **Sovereign search** — PostgreSQL + pgvectorscale hybrid search (replaces Elasticsearch)
- **P2P mesh** — every client is a server; content handoffs via IPFS CIDs
- **Resource throttling** — CPU/bandwidth/electricity mapped to real cost; token bucket rate limiting
- **dApp sandbox** — filesystem access on 1-10 participant choice scale, full audit log

## Development

```bash
npm run dev              # Vite dev server (web only)
npm run build            # TypeScript + Vite production build
npm run tauri:dev        # Full Tauri desktop dev mode
npm run tauri:build      # Production desktop build
npm run lint:css         # SCSS lint
```

## License

(c) 2026 BANKON. Tri-licensed: **GPL-3.0-only** for the encryption and privacy core (`bankon_vault`,
the `chain_*` signing packs, pmVPN), **Apache-2.0** for the rest of the wallet, **MIT** for the
server-side AO processes. Per-path mapping in [REUSE.toml](REUSE.toml); full texts in
[LICENSES/](LICENSES/). See [LICENSE](LICENSE).

Contact: github@deltav.exchange
