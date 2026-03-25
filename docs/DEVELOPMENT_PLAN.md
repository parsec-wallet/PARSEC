# Parsec Wallet — Development Plan

> **Updated:** 2026-03-25
> **Status:** Alpha — Matrix entry gate, x402 payments, AgenticPlace integration, tabbed diagnostics
> **Vision:** The evolution of the cryptocurrency wallet. Sovereign, modular, Algorand-first. Every client is a server.

## Mission

Build Parsec as a sovereign universal wallet: Tauri desktop shell, zero-dependency vanilla TypeScript frontend, Rust backend, bankon_vault encrypted storage with optional Tomb cold storage, extensible chain packs. Algorand native first-class support, SpinTrade DEX inside the wallet. Every Parsec node is both client and server — P2P mesh with IPFS content handoffs, resource-aware throttling, and participant-controlled dApp sandboxing.

**Policy:** Parsec never holds the user's private key or mnemonic. bankon_vault is recommended but optional. User controls their keys. All security is open source per cypherpunk2048 standard.

## Architecture

```
Frontend (vanilla TypeScript + Blueprint CSS)
├── src/views/          # View modules (matrix, dashboard, send, receive, agents, identity, x402-confirm, etc.)
├── src/lib/            # Core modules (store, router, dom, keystore, vault, tomb, prices)
├── src/lib/algorand/   # Chain pack: account, transactions, assets, client
├── src/lib/x402/       # AgenticPlace integration: types, oracle, bridge, payment, discount, client
├── src/lib/pouch/      # Chain adapter system: algorand (live), ethereum (live), bitcoin (stub)
├── src/lib/dex/        # SpinTrade DEX aggregator: tinyman-onchain, tinyman-api
├── src/lib/pmvpn/      # Private Mesh VPN: auth, connector, store, terminal
├── src/assets/matrix/  # WebGL textures: glyphs.png (16x16 katakana atlas), noise.png
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

### Phase B2 — Matrix Overhaul (2026-03-25)

- [x] Matrix rain: Shadertoy-faithful glyph rendering (iChannel0/iChannel1 textures, 256x256 POT)
- [x] Glitch spin intro: 360° rotation + chromatic aberration + scanline tear on load (1.5s) and pill transitions (0.8s)
- [x] Pyramid: brick steps from single apex (#1 daily gainer) to wide base, gainers right, losers left
- [x] Top 10 by market cap: vertical column on left side with icons + abbreviated mcap ($1.34T, $460.2B, $91M)
- [x] Stablecoin basket: ship on bottom-left, draggable
- [x] Featured "just because" assets: configurable via VITE_JUST_BECAUSE env var (default: POL,ALGO,ETH,BEAM,ZIL)
- [x] All floating glyphs constrained to right side (65-97%), left side reserved for top 10 + ship
- [x] Featured zigzag layout: 73%/88% x-position, 11% vertical spacing between each
- [x] Drag-and-drop: PARSEC brand, pills, ship, top 10 column, fleet — all draggable via makeDraggable()
- [x] PARSEC click → full-screen pill choice (blue/red, nothing else, return to landing)
- [x] Blue pill: slow calm rain (0.04 + 6% market activity), full sentiment color preserved
- [x] Blue pill: hides all market overlays (pyramid, top 10, ship, glyphs) — pure rain + diagnostics
- [x] Blue pill: 6 tabbed diagnostics (Global, Gas & Fees, Chain Health, Network, DeFi TVL, Portfolio)
- [x] Blue pill: Tab key cycles tabs, auto-refresh every 20s
- [x] Blue pill: Global tab = Tank view (market cap, BTC/ETH/ALGO, TVL trends, gas, blocks, F&G, top chains)
- [x] Blue pill: Gas tab = live gas from 6 EVM chains + Algorand + ETH cost estimates (transfer/swap/mint)
- [x] Blue pill: Chain Health = top 15 chains by TVL + Algorand protocol breakdown
- [x] Blue pill: Network = Algorand round/block/consensus + ETH block + Fear & Greed
- [x] Blue pill: DeFi TVL = global + Algorand TVL with 24h/7d/30d trends + stablecoin supply
- [x] Blue pill: compact two-column CSS grid layout (0.65em rows, 96vw width)
- [x] Blue pill: glyphs turn red (selling/diagnostics context)
- [x] Red pill: wallet login + Create New Wallet + Import Wallet + back to landing
- [x] Red pill: glyphs show natural market colors (green if up, red if down)
- [x] Glyph colors re-render on pill transitions
- [x] CoinGecko image field added to CoinPrice (coin icons in pyramid cards + fleet)
- [x] Pyramid cards: icon + symbol + price + change, hover scale 1.3x + border glow, touch support

### Phase B3 — x402 / AgenticPlace Integration (2026-03-25)

- [x] x402 types module: ERC-8004, identity, payment types (no viem dependency)
- [x] x402 constants: BANKON ASA 203977300, ERC-8004 addresses (17+ chains), CAIP-2 networks
- [x] PriceOracle: Algorand DEX pricing via Vestige API (replaces CoinGecko-only for ALGO/ASA)
- [x] BANKON holder discount: checkBankonHolder() — 50% off x402 fees, 5-min cache
- [x] Vault-secured x402 bridge: buildAlgorandX402Signer() — ephemeral key retrieval, sign, discard
- [x] x402 payment flow: x402Fetch() — handles 402 responses, discount, sign, retry
- [x] AgenticPlace HTTP client: discovery (70K+ agents), oracle, facilitator, BANKON identity
- [x] x402-confirm view: payment approval dialog with ALGO conversion + discount badge
- [x] Agents view: search/browse agents from AgenticPlace discovery API
- [x] Identity view: BANKON holder status, ERC-8004 IDNFT, access tiers, token info
- [x] Dashboard: Identity + Agents buttons added
- [x] Pouch chains.ts: Algorand signMessage() wired via vault bridge
- [x] Pouch chains.ts: Ethereum module enabled (key gen/import, signing deferred to viem)

### Phase B4 — Documentation (2026-03-25)

- [x] docs.html: 37 docs served via marked.js (architecture, x402, Blueprint.js, Tauri plugins)
- [x] x402-integration.md: complete integration guide (types, oracle, bridge, payment, views)
- [x] Hash routing: docs.html#dev-plan, docs.html#x402-integration, etc.

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

### Phase J — x402 Payments & Agent Economy
Informed by: x402-demo/modules/bankon-payments, x402-demo/erc8004, x402-demo/facilitator

Parsec is the wallet interface for the AgenticPlace agent economy.

- [x] x402 types: ERC-8004 agent identity, payment requirements, access tiers (no viem dep)
- [x] x402 constants: BANKON ASA 203977300 (10M supply), ERC-8004 on 17+ chains, CAIP-2 networks
- [x] PriceOracle: Vestige DEX API for ALGO/USD + any ASA price (replaces CoinGecko-only)
- [x] BANKON holder discount: 50% off x402 fees, cached 5 min per address
- [x] Vault-secured x402 bridge: ephemeral key from Rust vault → algosdk signer → sign → discard
- [x] x402 payment flow: 402 response → parse requirement → check discount → sign → retry
- [x] AgenticPlace HTTP client: discovery (70K+ agents), oracle, facilitator, BANKON identity
- [x] x402-confirm view: payment approval with ALGO conversion + BANKON discount badge
- [x] Agents view: search/browse 70K+ agents from AgenticPlace discovery API
- [x] Identity view: BANKON status, ERC-8004 IDNFT, access tiers (Visitor→Imperator)
- [ ] End-to-end x402 test: Parsec → MindX paywall → Facilitator settlement
- [ ] Reputation feedback after payment (ReputationRegistryClient → ERC-8004)
- [ ] Venalicarii/Mercatores marketplace integration
- [ ] SPINTRADE DEX pair browser in wallet

### Phase K — AlgoDeployer Tokenomics
Location: x402-demo/algodeployer/

Modular smart contracts for the AgenticPlace token economy. All Algorand contracts in PuyaTs.

**SHAMBA LUV (LUV9) — EVM Reflection Token**
- [x] ShambaLuv.sol: 100Q supply, 5% buy/sell (3% reflection, 1% liquidity, 1% team)
- [x] All 5 LUV8 bugs fixed (name, router approval, slippage, threshold logic, proxy bypass)
- [x] 0% wallet-to-wallet (EOA code.length check), fees only lower, admin hierarchy
- [ ] Foundry tests: `forge build && forge test`
- [ ] Deploy LUV9 on Polygon (replace LUV8 at 0x1035760d...)
- [ ] Multi-chain deployment via CREATE2

**BONA FIDE — Binary Reputation (Algorand)**
- [x] bonafide.algo.ts: 1T ASA, clawback, binary (hold 1 or 0), penalty doubling ($1→$2→$4...)
- [x] Ghost vote: consensus = permanently dead, can never re-apply
- [x] Fee allocation: applicant chooses wallets + splits, or redemption escrow
- [x] fee_redemption.algo.ts: tiered redemption (10%@90d, 25%@180d, 50%@365d, 100%@730d)
- [ ] Create BONA FIDE ASA on Algorand testnet
- [ ] Deploy BonafideController via AlgoKit
- [ ] Wire to SmartOracle for USD→ALGO fee conversion

**Liquidity Locker + Fee Controller**
- [x] liquidity_locker.algo.ts: LP lock, 90-day minimum for BONA FIDE, auto-extend toggle
- [x] fee_controller.algo.ts: SPINTRADE 3/1/1 split, lock team wallet (irreversible), fees only down
- [ ] Deploy on Algorand localnet
- [ ] Wire locker → BONA FIDE controller (issue on lock, clawback on day 89)

**aLUV — Algorand Reflection Token (ARC-200)**
- [x] aluv_token.algo.ts: ARC-200 with reflection engine (Algorand ASAs can't do reflection)
- [x] reflection_engine.algo.ts: shared index math (O(1) per claim, no holder iteration)
- [x] aluv_bridge.algo.ts: lock-and-mint bridge (EVM→Algorand), replay prevention, rate limiting
- [ ] Compile via Puya compiler
- [ ] Deploy on Algorand localnet
- [ ] Wire bridge relayer via SmartOracle command channel

**Documentation**
- [x] EXPLANATION.md: why Algorand can't do reflection, ARC-200 solution, BONA FIDE model
- [x] USAGE.md: code examples for every contract method
- [x] BONAFIDE.md: penalty escalation, ghost, fee allocation, liquidity lock lifecycle
- [x] SHAMBALUV.md: LUV9 spec, fee structure, wallet-to-wallet, cross-chain
- [x] LIQUIDITY-LOCKER.md: 90-day BONA FIDE lifecycle, auto-extend, keeper bot
- [x] FEE-CONTROLLER.md: 3/1/1 split, lock team wallet, lock liquidity to locker
- [x] BRIDGE.md: EVM↔Algorand lock-and-mint, relayer, rate limiting

### Phase L — Interchain Weave Protocol
Location: x402-demo/algodeployer/interchain/

Neither sidechain nor crosschain. Interchain weaves — direct value transfer with golden ratio fee.

**Core Contracts (Solidity, Foundry)**
- [x] PhiFeeCalculator.sol: phi (1.618...) fee math, 61.8/38.2 revenue split
- [x] GasStation.sol: multi-chain gas oracle, staleness checks, batch updates
- [x] InterchainWeaver.sol: weave router (value + phi_fee), relayer receive, revenue split
- [x] InterchainRegistry.sol: chain config, route discovery, 14+ chains expandable to 2510+
- [x] InterchainDeployer.sol: multi-chain deploy, cost estimation, CREATE2 prediction
- [x] PhiFeeCalculator.t.sol: 13 tests + fuzz (phi precision, scaling, overflow, split)
- [x] GasStation.t.sol: 9 tests (update, batch, auth, staleness, quote, realistic Polygon)
- [ ] `forge test` — all tests pass on Anvil
- [ ] Fork test against Polygon mainnet
- [ ] Deploy to Base Sepolia (first livenet)
- [ ] Deploy to Polygon mainnet

**Algorand Settlement**
- [x] interchain_settler.algo.ts: settlement finality (3.3s, no forks), phi fee in ALGO
- [x] interchain_oracle.algo.ts: gas prices for all chains via SmartOracle
- [ ] Deploy on Algorand testnet
- [ ] Wire relayer (SmartOracle command channel)

**Deployment Orchestration (TypeScript)**
- [x] types.ts: phi constants, 14 known chains, xERC20/ERC-8004 addresses
- [x] cost-calculator.ts: phi-based multi-chain cost estimation + formatted display
- [x] gas-estimator.ts: multi-chain gas fetcher, 60s cache
- [x] chain-registry.ts: AllChainz integration (2510+ chains)
- [x] deploy-orchestrator.ts: Anvil test → estimate → confirm → deploy → verify

**Documentation**
- [x] INTERCHAIN.md: weave protocol spec, chain registry, settlement layer
- [x] EXPLANATION.md: why phi, how weaving works, vs bridges, self-balancing liquidity
- [x] TECHNICAL.md: every constant, struct, function, gas cost, overflow analysis, security
- [x] USAGE.md: code examples for every contract + deployer + Algorand settler
- [x] DEPLOYMENT.md: Anvil → fork test → estimate → deploy (cheapest first)

### Phase M — DAIO Governance Integration
Informed by: x402-demo/DAIO/contracts/, x402-demo/modules/daio/

Future: credential-gated proposals, staked proposals, cross-proposal credit.

- [ ] AI seat in Development, Marketing, Community groups
- [ ] Proposal requires holding funds/assets to complete (credential from holding)
- [ ] Passed proposals receive payment (incentivized goals)
- [ ] Credit token issuance from collection of proposals
- [ ] Wire DAIO governance into Parsec (proposal submission from wallet)
- [ ] Constitutional tithe (15%) enforcement
- [ ] 2/3 consensus within groups, 2/3 of groups overall

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

### AgenticPlace / x402-demo
- **discovery-api**: 70K+ agents across 15+ EVM chains, PostgreSQL + pgvector
- **server-hono (MindX)**: x402-paywalled API (weather, oracle, mint)
- **facilitator**: x402 payment verification + settlement
- **erc8004**: ERC-8004 IdentityRegistry + ReputationRegistry SDK (17+ chains)
- **modules/bankon-payments**: PriceOracle, FeeSchedule, PaymentManager, Venalicarii
- **modules/smarttime**: SmartTime + SmartOracle (Algorand blocktime + DEX prices)
- **modules/algorand**: AlgorandAgentWallet (algosdk v3)
- **modules/bonafide**: BONAFIDE reputation bridge (tabularium, fides, sponsio)
- **modules/daio**: DAIO governance (controller, access, comitia, boardroom)
- **DAIO/contracts**: 90+ Solidity contracts (governance, identity, THOT, bonding, bridge)
- **algodeployer**: ShambaLuv LUV9, BONA FIDE, aLUV, interchain weave protocol

### Key External References
- [Algorand Developer Docs](https://developer.algorand.org)
- [ARC Standards](https://arc.algorand.foundation)
- [Tomb Encrypted Volumes](https://dyne.org/docs/tomb/)
- [Tauri 2.0](https://v2.tauri.app)
- [Tinyman Protocol](https://docs.tinyman.org)
- [DeFi Llama API](https://defillama.com/docs/api)
- [CoinGecko Markets API](https://www.coingecko.com/en/api/documentation)
- [Vestige DEX API](https://free-api.vestige.fi)
- [ERC-8004 Standard](https://eips.ethereum.org/EIPS/eip-8004)
- [x402 Protocol](https://x402.org)
- [xERC20 Standard](https://www.xerc20.com)
- [Foundry Book](https://book.getfoundry.sh)
- [PuyaTs (Algorand TypeScript)](https://github.com/algorandfoundation/puya-ts)

## Phase Summary

| Phase | Name | Status | Files |
|-------|------|--------|-------|
| A | Core Wallet | Complete | 20+ views, vault, keystore |
| B | Matrix + DEX | Complete | matrix.ts, swap.ts, prices.ts |
| B2 | Matrix Overhaul | Complete | matrix.ts (1800+ lines), _views.scss |
| B3 | x402 Integration | Complete | 8 files in src/lib/x402/ + 3 views |
| B4 | Documentation | Complete | docs.html + 37 docs |
| C | Input Validation | 95% | import-wallet.ts, validate.ts |
| D | SpinTrade DEX | 80% | swap.ts, dex/ (multi-hop pending) |
| E | Wallet Interop | Planned | WalletConnect, ARC-1, ARC-25 |
| F | Advanced Algorand | Planned | Rekeying, multisig, ARC-19 |
| G | Extensions | Planned | ASA minter, NFT minter, plugins |
| H | Multi-Chain | 15% | Ethereum key gen done, signing pending |
| I | Infrastructure | 70% | 4 Rust modules built, persistence pending |
| J | x402 Payments | 85% | Module complete, e2e test pending |
| K | AlgoDeployer | 70% | Contracts written, deployment pending |
| L | Interchain | 60% | Contracts + tests written, Anvil pending |
| M | DAIO Governance | Planned | Credential-gated proposals, AI seats |

---

*Parsec is the evolution of the cryptocurrency wallet. Extract ideas and architecture, not accidental complexity. The right outcome is a cleaner, safer, more sovereign Parsec.*
