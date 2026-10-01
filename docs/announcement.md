# PARSEC

The wallet layer.

---

You are standing in front of a wall of falling code. Green glyphs cascade through 3D space — their speed driven by the market itself. When things are calm, the rain drifts. When volatility spikes, the matrix accelerates. When the market bleeds, the code turns red. When it runs, it glows.

This is not a screensaver. This is the state of the world, rendered.

Move your hand. The matrix glitches — scan lines tear, characters shimmer between two states, chromatic aberration splits the light. The closer you get, the deeper the disturbance. The glitch is the interaction. The interaction is the entry.

Two pills appear.

---

## Blue Pill — Diagnostics

No keys. No signing. No risk.

The blue pill opens a read-only view into your holdings. Network activity streams in real time — every API call, every block round, every asset resolution. You see what the blockchain sees. Balances, assets, freeze status, pending rewards. The wall turns blue.

This is observation without authority. Portfolio intelligence without custody exposure. You can walk away from this screen and nothing changes. Nothing was unlocked. Nothing was signed. Nothing was exposed.

Safe to look. Safe to leave.

---

## Red Pill — Live Wallet

Your passphrase. Your keys. Your coins.

The red pill requires proof. You enter your passphrase — it is never stored, never remembered, never transmitted. The passphrase decrypts your keys from the local vault. A session begins. The wall turns red.

From this moment, you have sovereign access:

- **Send** — ALGO, USDC, any ASA. Transaction confirmation with fee display before signing.
- **Receive** — Public address, click to copy. Share it with everyone.
- **Swap** — SpinTrade queries all DEX sources, reads prices directly from the blockchain, shows you every quote ranked by output. You choose the path.
- **Add Asset** — Opt in to any Algorand Standard Asset. Verified registry. Freeze and clawback warnings before you commit.
- **Manage** — Multiple accounts, multiple chains, watch-only mode, network switching.

Lock the wallet. The session ends. Keys zeroed from memory. You return to the matrix.

---

## The Wallet IS the Login

Parsec does not use passwords, emails, or OAuth tokens. The wallet is the identity. A cryptographic signature proves you hold the keys. From that proof, every choice opens — DEX, send, receive, onramp, offramp.

No intermediary. No custodian. No permission layer.

If you hold the private key, you hold the asset.

---

## What Parsec Is

Parsec is a sovereign wallet layer for Algorand, with Bitcoin and multi-chain expansion on the roadmap.

**Built from:**
- Vanilla TypeScript — no React, no frameworks, no runtime dependencies beyond algosdk
- Blueprint.js CSS — styling only, no component library
- Rust backend via Tauri — bankon_vault encrypted key storage (Argon2id + AES-256-GCM)
- Tomb integration — Linux encrypted volumes with USB cold storage
- WebGL shader — procedural matrix rain, zero textures, zero external assets

**Security model:**
- Keys encrypted on your device with your passphrase
- Passphrase held in private memory only during session — never serialized, never in localStorage
- Mnemonics zeroed after signing (finally blocks)
- CSP hardened — no unsafe-inline, no unsafe-eval, whitelisted endpoints only
- Auto-lock on inactivity
- Session passphrase overwritten with zeros before null on lock

**Market expression:**
- Matrix speed driven by market volatility (SentSponce engine)
- Color driven by bull/bear sentiment — weighted by BTC/ETH market cap
- Crypto icon glyphs floating in the rain with live price tooltips
- Calibrated to real crypto daily swings: 1-2% is common, 10% is a working day, 25%+ is a storm

---

## Parsec Paper Export

Offline Bitcoin wallet generator. Forked from bitaddress.org, rebranded to Cypherpunk2048 standard.

Single self-contained HTML file. Zero remote dependencies. All wallet types: single, paper, bulk, brain, vanity, split, details.

**If you are smart, you generate your wallet while disconnected from the internet.**

Private key hidden until hover. QR blurred by default. Transfer to Parsec Pouch with one click — key zeroed from memory immediately after transfer. Public address click-to-copy with green highlight.

---

## Architecture

```
Matrix Gate (WebGL shader)
    │
    ├── Blue Pill → Diagnostics (read-only, network activity feed)
    │
    └── Red Pill → Passphrase → Session
            │
            ├── Dashboard (balance, assets, transactions)
            ├── Send (ALGO + any ASA, confirmation screen)
            ├── Swap (SpinTrade — all DEX sources, best price)
            ├── Receive (public address, click to copy)
            ├── Add Asset (verified registry, freeze warnings)
            ├── Docs (quickstart, FAQ, security, assets, about)
            └── Settings (network, accounts, lock, reset)

bankon_vault (Rust)
    ├── Argon2id + AES-256-GCM encrypted key files
    ├── Tomb integration (Linux LUKS volumes)
    └── USB cold storage (key file on removable media)

Wallet Pouch (multi-chain)
    ├── Algorand (live)
    ├── Bitcoin (Paper Export + future Core integration)
    ├── Ethereum (stub)
    ├── Solana (stub)
    ├── Litecoin (stub)
    └── Monero (stub)

SpinTrade DEX
    ├── tinyman-onchain (reads blockchain directly)
    ├── tinyman-api (reference, disabled by default)
    └── Future: Pact, Folks, cross-chain
```

---

## Cypherpunk2048 Standard

- The wallet is client side
- The holder generates offline
- The holder verifies independently
- The holder prints and exports directly
- The holder retains custody through key possession
- Parsec provides tooling, not custody
- No analytics, no telemetry, no beacons
- Unencrypted backup prevented in standard mode

---

## The Matrix

The wall is not decoration. The wall is the state.

When you approach the matrix, it responds. Glyphs shimmer between two states — the glitch is a tear in the surface, a moment where the code reveals itself. The glitch is the entry point. From the glitch, you choose your pill.

The matrix remembers nothing. There is no session on the wall. No cookie. No token. No trace. You can stand in front of it forever and it costs nothing. It leaks nothing. It stores nothing.

Walk away. The rain continues. The market moves. The glyphs fall.

Come back. The wall is the same wall. The pills are the same pills. The choice is the same choice.

Except the market moved. And the wall knows.

---

(c) 2026 BANKON. GPL-3.0-or-later (key generation, signing & privacy) · Apache-2.0 (the rest) · MIT (server side) — see [LICENSE](../LICENSE).

Contact: github@deltav.exchange

GitHub: [parsec-wallet](https://github.com/parsec-wallet)
