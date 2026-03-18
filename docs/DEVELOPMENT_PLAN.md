# Parsec Wallet — Development Plan

> **Updated:** 2026-03-17
> **Status:** Alpha — Algorand core functional, security hardened
> **Vision:** The evolution of the cryptocurrency wallet. Sovereign, modular, Algorand-first.

## Mission

Build Parsec as a sovereign universal wallet: Tauri desktop shell, zero-dependency vanilla TypeScript frontend, Rust backend, bankon_vault encrypted storage with optional Tomb cold storage, extensible chain packs. Algorand native first-class support, SpinTrade DEX inside the wallet.

**Policy:** Parsec never holds the user's private key or mnemonic. bankon_vault is recommended but optional. User controls their keys.

## Architecture

```
Frontend (vanilla TypeScript + Blueprint CSS)
├── src/views/          # View modules (onboarding, dashboard, send, receive, etc.)
├── src/lib/            # Core modules (store, router, dom, keystore, vault, tomb)
├── src/lib/algorand/   # Chain pack: account, transactions, assets, client
└── src/types/          # TypeScript types

Backend (Rust via Tauri IPC)
├── bankon_vault/       # Modular encrypted vault (portable across wallets)
│   ├── crypto.rs       # Argon2id + AES-256-GCM
│   ├── store.rs        # File-based vault storage
│   ├── commands.rs     # 9 Tauri IPC commands
│   ├── tomb.rs         # Tomb CLI wrapper (Linux cold storage)
│   └── tomb_commands.rs # 7 Tomb Tauri IPC commands
└── lib.rs              # Tauri app entry
```

## What's Built (Phase A+B complete)

- [x] Vanilla TypeScript frontend — no React, no frameworks
- [x] Blueprint.js CSS for styling (CSS only, no React components)
- [x] State management with private sensitive fields (never in localStorage)
- [x] Auto-lock timer (configurable, default 5 min)
- [x] Algorand account create (25-word mnemonic)
- [x] Algorand account import (mnemonic + base64 private key)
- [x] MetaMask-style unlock view (passphrase → session)
- [x] bankon_vault Rust module (Argon2id + AES-256-GCM, file-based)
- [x] Tomb integration (Linux encrypted volumes, USB cold storage)
- [x] Keystore unified interface (auto-selects Tauri vault or Web Crypto fallback)
- [x] Send ALGO + any ASA (asset selector dropdown)
- [x] Transaction confirmation screen (review before signing)
- [x] Receive view with full address display
- [x] ASA opt-in with verified asset registry (USDC, USDt — official contracts only)
- [x] ASA opt-out (recover 0.1 ALGO min balance)
- [x] Freeze/clawback warnings on assets
- [x] Minimum balance display
- [x] Pending rewards display
- [x] Note field with byte count validation (1000 byte limit)
- [x] Fee pre-display on confirmation screen
- [x] Testnet faucet link
- [x] Network switching (mainnet/testnet/betanet) with cache invalidation
- [x] Multi-account support (create, import, switch)
- [x] 6 decimal precision default for all assets
- [x] Public receive key display (truncated, expand on hover, click to copy)
- [x] In-wallet documentation (Quick Start, FAQ, Security, Assets, About)
- [x] ALGO shown as native asset in verified list
- [x] Balance validation before ASA opt-in (0.101 ALGO required)
- [x] Router fix — only re-renders on view change, not every state update

## Roadmap

### Phase C — Input Recognition & Validation
Informed by: parsec-wallet/metamask-extension (vault patterns), ailgo/js-algorand-sdk

- [x] Input classifier (detect: mnemonic, private key, address, unknown)
- [x] Live validation feedback with confidence scoring
- [x] Address preview on valid input
- [x] Multi-format import: mnemonic, private key, watch-only address
- [x] Watch-only mode (view balance, cannot sign)
- [ ] Rust-side address validators (Algorand base32 checksum) — future hardening

### Phase D — SpinTrade DEX Foundation
Informed by: ailgo/tinyman-amm-contracts-v2, Tinyman JS SDK docs

- [x] Swap engine (src/lib/algorand/swap.ts) — Tinyman v2 pool query + constant product quote
- [x] Swap view with asset selectors, amount input, quote preview
- [x] Quote display: rate, price impact, min received, slippage, pool fee
- [x] Confirm-and-sign flow for swaps
- [x] Atomic group transaction execution (input transfer + app call)
- [x] 0.5% default slippage with min output calculation
- [x] Swap button on dashboard
- [ ] Multi-hop routing (ASA→ALGO→ASA) for better rates
- [ ] Swap history tracking
- [ ] Custom slippage setting

### Phase E — Wallet Interop & Standards
Informed by: ailgo/use-wallet, ailgo/peraconnect, ARC-1, ARC-25

- [ ] WalletConnect v1/v2 support (ARC-25)
- [ ] ARC-1 transaction signing API compliance
- [ ] dApp connection interface (QR code + deep link)
- [ ] Watch-only mode (view balance without signing keys)

### Phase F — Advanced Algorand Features
Informed by: ailgo/pera-wallet, developer.algorand.org

- [ ] Rekeying support
- [ ] Multisig account creation and signing
- [ ] Group transaction builder
- [ ] Application call support (smart contract interaction)
- [ ] ARC-19/ARC-3 NFT metadata display
- [ ] Transaction history export (CSV)
- [ ] Address book / contacts
- [ ] QR code generation for receive (algorand:// URI)

### Phase G — Modular Extensions
Informed by: parsec-wallet/parsec-pod, ailgo/mint-arc19, ailgo/ExtendableDAO

- [ ] ASA minter extension
- [ ] NFT minter extension (ARC-19)
- [ ] Plugin/extension system architecture
- [ ] DAO interaction module
- [ ] Staking/governance participation

### Phase H — Multi-Chain Expansion (Future)
Informed by: parsec-wallet org (50 repos spanning BTC, EVM, Cosmos, Solana, Arweave)

- [ ] Chain-pack adapter architecture (per parsec-wallet/xchainjs-lib-1 patterns)
- [ ] EVM/BSC chain pack (BIP-39 import, 0x checksum, balance, transfer)
- [ ] Bitcoin read-only support (UTXO model, Bech32)
- [ ] Solana read-only support
- [ ] Cosmos-family (Bech32 HRP-aware)
- [ ] Hardware wallet integration (Ledger via parsec-wallet/eth-dcent-keyring patterns)
- [ ] Network registry (per parsec-wallet/chainlist)

### Phase I — Sovereign Infrastructure (Strategic)
Informed by: parsec-wallet/hypercore, parsec-wallet/earthstar, parsec-wallet/agregore-browser

- [ ] Sovereign sync (offline-first wallet state)
- [ ] Distributed backup (Hypercore-style append-only log)
- [ ] P2P wallet discovery
- [ ] Tomb FIDO2 passkey support

## Design Principles

1. **Minimal code, maximum impact** — no unnecessary abstractions
2. **Security first** — keys never leave device, Rust for signing, frontend for display
3. **No external runtime dependencies** — vanilla TS, Blueprint CSS only
4. **Chain-pack architecture** — each chain is a modular adapter
5. **User sovereignty** — Parsec never holds keys, bankon_vault recommended not required
6. **Extract ideas, not code** — learn from parsec-wallet org + ailgo repos, reimplement clean

## Reference Corpus

### parsec-wallet org (https://github.com/parsec-wallet) — 50 repos
Wallet R&D corpus: BitPay/Copay, Safe multisig, MetaMask, Keplr, xchainjs, Hypercore/Earthstar, EIPs

### ailgo org (https://github.com/ailgo) — 101+ repos
Algorand reference library: js-algorand-sdk, AlgoKit, Pera, use-wallet, vibekit, Tinyman, Tauri

### Key External References
- [Algorand Developer Docs](https://developer.algorand.org)
- [ARC Standards](https://arc.algorand.foundation)
- [Tomb Encrypted Volumes](https://dyne.org/docs/tomb/)
- [Tauri 2.0](https://v2.tauri.app)
- [Tinyman Protocol](https://docs.tinyman.org)

---

*Parsec is the evolution of the cryptocurrency wallet. Extract ideas and architecture, not accidental complexity. The right outcome is a cleaner, safer, more sovereign Parsec.*
