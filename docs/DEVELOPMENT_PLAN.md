# Parsec Wallet — Development Plan

> **Updated:** 2026-03-22
> **Status:** Alpha — Algorand core functional, sovereign infrastructure modules landed
> **Vision:** The evolution of the cryptocurrency wallet. Sovereign, modular, Algorand-first. Every client is a server.

## Mission

Build Parsec as a sovereign universal wallet: Tauri desktop shell, zero-dependency vanilla TypeScript frontend, Rust backend, bankon_vault encrypted storage with optional Tomb cold storage, extensible chain packs. Algorand native first-class support, SpinTrade DEX inside the wallet. Every Parsec node is both client and server — P2P mesh with IPFS content handoffs, resource-aware throttling, and participant-controlled dApp sandboxing.

**Policy:** Parsec never holds the user's private key or mnemonic. bankon_vault is recommended but optional. User controls their keys. All security is open source per cypherpunk2048 standard.

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
├── pmvpn/              # Wallet-authenticated SSH (5 commands)
├── parsec_search/      # PostgreSQL + pgvectorscale search engine (8 commands)
│   ├── pool.rs         # Connection pool + extension detection
│   ├── schema.rs       # Auto-migrating schema (documents, chains, peers, metrics)
│   ├── search.rs       # Hybrid full-text + vector similarity search
│   └── commands.rs     # Tauri IPC
├── parsec_mesh/        # P2P mesh — every client is a server (10 commands)
│   ├── ipfs.rs         # IPFS content-addressed handoffs (Kubo HTTP API)
│   ├── peer.rs         # Peer discovery + reputation
│   ├── resource.rs     # CPU/bandwidth/electricity mapping + throttle computation
│   ├── server.rs       # Embedded axum HTTP server
│   └── commands.rs     # Tauri IPC
├── parsec_throttle/    # Resource-aware API rate limiting (6 commands)
│   └── commands.rs     # Token bucket + energy cost tracking
├── parsec_sandbox/     # dApp filesystem access control 1-10 scale (11 commands)
│   └── commands.rs     # Participant-choice permissions + audit log
└── lib.rs              # Tauri app entry (6 managed states, 66 IPC commands)
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
- [x] Matrix entry gate — WebGL shader rain, red/blue pill, market-driven
- [x] Matrix shader: 3D depth perspective, anti-aliased glyphs, CRT effects
- [x] Matrix speed driven by market volatility (CoinGecko free tier)
- [x] Matrix color driven by bull/bear sentiment (weighted 24h change)
- [x] Crypto icon glyphs floating in matrix with live price tooltips on hover
- [x] PARSEC brand hover → Create New Wallet shortcut
- [x] Red pill: unlock existing + add new wallet (chain selector)
- [x] Blue pill: on-chain diagnostics from public key holdings
- [x] Chain registry: ALGO active, BTC/LTC/XMR/ETH/SOL ready to plug in
- [x] Import option in chain selector (private key or mnemonic)
- [x] Modular DEX architecture: on-chain reads + API as separate modules
- [x] SpinTrade aggregator: queries all DEX modules, returns best price first
- [x] Swap "To" field populated from live on-chain pool data
- [x] Security audit: 5 critical fixes (mnemonic zeroing, CSP, session isolation)
- [x] BANKON license applied, README rewritten

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

### Phase H — Multi-Chain Sovereign Holdings
Informed by: parsec-wallet org, Atomic Wallet key pair model, MetaMask/Phantom patterns

Parsec absorbs from existing wallets — participant has complete handling of
public/private key pairs across all chains. True sovereign holding.

- [ ] Chain-pack adapter architecture (per parsec-wallet/xchainjs-lib-1 patterns)
- [ ] Bitcoin (BTC) — UTXO model, Bech32, full private key control
- [ ] Litecoin (LTC) — Scrypt PoW, Bech32
- [ ] Monero (XMR) — privacy-first, view keys + spend keys
- [ ] Ethereum (ETH) — EVM, BIP-39, 0x checksum, ERC-20
- [ ] Solana (SOL) — ed25519, SPL tokens
- [ ] Each chain: create, import, send, receive, private key export
- [ ] Atomic-style key pair display (participant sees all their keys)
- [ ] bankon_vault holds all chain keys in one encrypted Tomb volume
- [ ] USB cold storage for multi-chain key files
- [ ] Network registry (per parsec-wallet/chainlist)
- [ ] Hardware wallet integration (Ledger, Trezor)

### Phase I — Sovereign Infrastructure
Informed by: parsec-wallet/hypercore, parsec-wallet/earthstar, parsec-wallet/agregore-browser

**Module: parsec_search** — PostgreSQL + pgvectorscale (replaces Elasticsearch)
- [x] Connection pool with auto-detection of pgvector/pgvectorscale extensions
- [x] Auto-migrating schema (parsec_documents, parsec_chains, parsec_peers, parsec_dapp_permissions, parsec_throttle_metrics)
- [x] Hybrid search: full-text (tsvector/tsquery GIN) + vector similarity (DiskANN or HNSW fallback)
- [x] Document CRUD with upsert, batch indexing, filtered delete
- [x] Chain registry table (allchainz: RPC URLs, explorer URLs, address format, native asset)
- [x] 8 Tauri IPC commands: search_connect, search_disconnect, search_health, search_index, search_index_batch, search_query, search_delete, search_delete_filter
- [ ] Embedding generation pipeline (local model or delegated)
- [ ] TimescaleDB hypertable for metrics (auto-enabled if available)

**Module: parsec_mesh** — Client = Server + IPFS Handoffs
- [x] Embedded axum HTTP server (every Parsec node serves /parsec/v1/* endpoints)
- [x] IPFS integration via local Kubo HTTP API (add, get, pin, unpin, list, repo stats)
- [x] Content-addressed handoffs with CID + origin signature
- [x] Peer discovery via PostgreSQL registry
- [x] Resource mapping: CPU cores, RAM, disk, bandwidth up/down, power draw (watts), electricity cost/kWh
- [x] Electricity-to-crypto exchange formula: resource_value = power_draw × hours × cost_kwh / 1000
- [x] Resource budget (configurable max bandwidth, CPU, storage, power share)
- [x] Peer reputation tracking (0.0–1.0)
- [x] 10 Tauri IPC commands
- [ ] IPFS DHT peer discovery (supplement PostgreSQL registry)
- [ ] Hypercore append-only log for wallet event journaling
- [ ] Earthstar-style private, offline-first sync

**Module: parsec_throttle** — Resource-Aware API Rate Limiting
- [x] Token bucket rate limiter with dynamic refill rates
- [x] Per-source and global rate limiting
- [x] Energy cost tracking per request (milliwatt-hours)
- [x] Bandwidth-proportional token consumption
- [x] Dynamic adjustment based on resource snapshot (CPU, bandwidth, power)
- [x] 6 Tauri IPC commands
- [ ] Persistent metrics to PostgreSQL (parsec_throttle_metrics table)
- [ ] Rate limit headers on mesh server responses

**Module: parsec_sandbox** — dApp Filesystem Access (1-10 Participant Choice)
- [x] 10-level permission scale:
  - Level 1: Contract calls only — zero filesystem
  - Level 2: Read own sandbox
  - Level 3: Read/write sandbox (10MB)
  - Level 4: Read/write sandbox (100MB)
  - Level 5: + shared read-only directory
  - Level 6: + IPFS get
  - Level 7: + IPFS pin
  - Level 8: + read user-selected files (dialog)
  - Level 9: + write user-selected files (dialog)
  - Level 10: Full — peer relay + search index
- [x] Path traversal prevention, storage quotas, expiry timestamps
- [x] Full audit log of every access check
- [x] No silent escalation — participant always chooses
- [x] 11 Tauri IPC commands
- [ ] Persist permissions to PostgreSQL (parsec_dapp_permissions table)
- [ ] Frontend permission slider UI
- [ ] Permission request dialog (dApp → user prompt)

**Still planned:**
- [ ] Sovereign sync (offline-first wallet state via Earthstar)
- [ ] Distributed backup (Hypercore-style append-only log)
- [ ] Tomb FIDO2 passkey support
- [ ] QR-based peer exchange

## Design Principles

1. **Minimal code, maximum impact** — no unnecessary abstractions
2. **Security first** — keys never leave device, Rust for signing, frontend for display
3. **No external runtime dependencies** — vanilla TS, Blueprint CSS only
4. **Chain-pack architecture** — each chain is a modular adapter
5. **User sovereignty** — Parsec never holds keys, bankon_vault recommended not required
6. **Extract ideas, not code** — learn from parsec-wallet org + ailgo repos, reimplement clean
7. **Client is server** — every node serves the mesh; no centralized infrastructure
8. **Resource honesty** — CPU, bandwidth, storage, electricity mapped to real cost; throttled accordingly
9. **Participant choice** — dApp permissions on a 1-10 scale, no silent escalation
10. **PostgreSQL over Elasticsearch** — web2 PostgreSQL is abundant, has good bandwidth; pgvectorscale gives us vector search without a separate search cluster
11. **Open source security** — all security-critical code is open, per cypherpunk2048 standard

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
