# PARSEC Wallet

Sovereign Algorand wallet. Your keys. Your coins. No compromises.

(c) BANKON. All rights reserved.

## What Is Parsec

Parsec is a desktop and web wallet for Algorand built on cypherpunk principles. No React, no frameworks, no runtime dependencies beyond algosdk. Vanilla TypeScript frontend with Blueprint.js CSS. Rust backend via Tauri with bankon_vault encrypted key storage.

Parsec never holds your private key or mnemonic. Keys are encrypted on your device with your passphrase. bankon_vault is recommended but optional — the web version works standalone.

## Features

- **Create or import** Algorand wallets (25-word mnemonic, base64 private key, or watch-only address)
- **Send & receive** ALGO and any Algorand Standard Asset (ASA)
- **SpinTrade swap** — in-wallet DEX via Tinyman v2 pools
- **ASA management** — opt-in, opt-out, verified registry (USDC, USDt)
- **Transaction confirmation** — review recipient, amount, fee, and network before signing
- **Freeze/clawback warnings** — flagged before opt-in and on dashboard
- **bankon_vault** — Rust-side Argon2id + AES-256-GCM encrypted key storage
- **Tomb cold storage** — Linux LUKS encrypted volumes with USB key separation
- **Auto-lock** — session clears after inactivity (configurable)
- **Multi-account** — create, import, switch between accounts
- **Watch-only mode** — view balances without signing keys
- **In-wallet docs** — quickstart, FAQ, security model, asset guide
- **Network switching** — mainnet, testnet, betanet
- **Input classifier** — live detection and validation of pasted secrets

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
│   └── algorand/
│       ├── account.ts        # Account create, import, validate
│       ├── client.ts         # Algod/Indexer client config (AlgoNode)
│       ├── transactions.ts   # Send ALGO, send ASA, fetch history
│       ├── assets.ts         # ASA opt-in/out, lookup, enrichment, registry
│       ├── swap.ts           # SpinTrade engine (Tinyman v2 quotes + execution)
│       └── validate.ts       # Input classifier (mnemonic, key, address)
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
│   └── settings.ts           # Network, accounts, lock, reset
├── types/wallet.ts           # TypeScript types
└── styles/                   # SCSS design system + Blueprint CSS

src-tauri/                    # Backend — Rust
├── src/
│   ├── lib.rs                # Tauri app + command registration
│   ├── main.rs               # Entry point
│   └── bankon_vault/         # Modular encrypted vault
│       ├── mod.rs            # Session state (zeroize on drop)
│       ├── crypto.rs         # Argon2id + AES-256-GCM
│       ├── store.rs          # File-based vault storage
│       ├── commands.rs       # 9 Tauri IPC commands
│       ├── tomb.rs           # Tomb CLI wrapper
│       └── tomb_commands.rs  # 7 Tomb IPC commands
├── Cargo.toml
└── tauri.conf.json
```

## Security Model

- **Key sovereignty** — Parsec never stores raw keys. Encrypted with your passphrase on your device.
- **Desktop encryption** — Argon2id key derivation + AES-256-GCM (bankon_vault, Rust)
- **Web encryption** — PBKDF2 600K iterations + AES-256-GCM (Web Crypto API)
- **Session isolation** — passphrase held in private class fields, never serialized to localStorage
- **Mnemonic zeroing** — secrets overwritten after signing, cleared in finally blocks
- **Auto-lock** — configurable timer, clears session on inactivity
- **CSP hardened** — no unsafe-inline, no unsafe-eval, whitelisted endpoints only
- **Cold storage** — optional Tomb encrypted volumes with USB key separation (Linux)
- **Watch-only** — explicit flag, signing blocked at view level

## Development

```bash
npm run dev              # Vite dev server (web only)
npm run build            # TypeScript + Vite production build
npm run tauri:dev        # Full Tauri desktop dev mode
npm run tauri:build      # Production desktop build
npm run lint:css         # SCSS lint
```

## License

BANKON License. (c) 2026 BANKON. All rights reserved. See [LICENSE](LICENSE).

Contact: github@deltav.exchange
