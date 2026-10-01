# PARSEC Wallet — Development Plan

> **Updated:** 2026-05-16 (Phase Q)
> **Status:** Alpha — Matrix entry gate, x402 payments, multi-chain builder (8 families + Solana), Mausoleum vault, aORC contracts (testnet-verified + TS clients in `src/lib/aorc/`), PROOF.md attestation, deployer pipeline, **Arweave/AO foundation**, **permaweb deploy infra**, **ARIO Solana migration handler**, **BANKON Names** sovereign namespace (in-wallet spawn UI), **AR.IO module parity** (hub / name / transfer / resolve / claim), **named-NFT bindings** (ARC-3/19/69 + aORC TypeMinter), **BANKON Marketspace** (order book + auctions; web mirror at agenticplace.pythai.net/marketspace)
> **Vision:** The evolution of the cryptocurrency wallet. Sovereign, modular, Algorand-first. Every client is a server. Every namespace is forkable. Every name is for sale.

## Mission

Build PARSEC as a sovereign universal wallet: Tauri desktop shell, zero-dependency vanilla TypeScript frontend, Rust backend, bankon_vault encrypted storage with optional Tomb cold storage, extensible chain packs. Algorand native first-class support, SpinTrade DEX inside the wallet. Every PARSEC node is both client and server — P2P mesh with IPFS content handoffs, resource-aware throttling, and participant-controlled dApp sandboxing.

**Policy:** PARSEC never holds the user's private key or mnemonic. bankon_vault is recommended but optional. User controls their keys. All security is open source per cypherpunk2048 standard.

## Architecture

```
Frontend (vanilla TypeScript + Blueprint CSS)
├── src/views/          # View modules (matrix, dashboard, send, receive, agents, identity, x402-confirm, admin-keygen, mausoleum, arweave-*, solana-create, ario-*, bankon-*)
├── src/lib/            # Core modules (store, router, dom, keystore, vault, tomb, prices, platform)
├── src/lib/algorand/   # Chain pack: account, transactions, assets, client
├── src/lib/algorand-hd/# ARC-52 HD derivation (24-word BIP-39 → algorand sub-accounts)
├── src/lib/arweave/    # ans104, ao, ario, ant, signer, inject (window.arweaveWallet), tx, jwk, seed, client
├── src/lib/aorc/       # aORC TS clients: ids, minter (ARC-3/19/69), type-minter (aNFT/dNFT/iNFT/THOT)
├── src/lib/bankon-names/ # Sovereign BANKON namespace client: process-id, payment, client, lua-source
├── src/lib/marketplace/ # BANKON Marketspace client: process-id, client, escrow, lua-source
├── src/lib/solana/     # ed25519 chain module: seed (SLIP-0010), address (base58), module
├── src/lib/x402/       # AgenticPlace integration: types, oracle, bridge, payment, discount, client
├── src/lib/pouch/      # Chain adapter system: algorand, algorand-hd, ethereum, bitcoin, litecoin, monero, zilliqa, cardano, arweave, arweave-hd, solana
├── src/lib/builder/    # Multi-chain tx builder: types, multichain, walletconnect, registry, isolation
├── src/lib/dex/        # SpinTrade DEX aggregator: tinyman-onchain, tinyman-api
├── src/lib/pmvpn/      # Private Mesh VPN: auth, connector, store, terminal
├── src/lib/platform.ts # Tauri-vs-web shim: isTauri + dynamic invoke/listen
├── src/lib/xchain/     # EVM-controlled Algorand LogicSig (MetaMask custody, x402 path)
├── src/assets/matrix/  # WebGL textures: glyphs.png (16x16 katakana atlas), noise.png
└── src/types/          # TypeScript types

BANKON Names Registry contract
└── bankon-names-process/  # Lua AO process source (sovereign PARSEC namespace)
    ├── state.lua           # Records, Reserved, Policy, Treasury, Controllers, PrimaryNames
    ├── main.lua            # Boot-tag wiring, handler manifest, Info diagnostic
    └── handlers/
        ├── claim.lua       # Buy-Name (token-agnostic via Payment-Method + Payment-Proof)
        ├── transfer.lua    # Transfer (owner-only)
        ├── records.lua     # Set/Get/Record/Resolve, Paginated-Records, Get-Owned-Records
        ├── lease.lua       # Extend-Lease
        ├── primary.lua     # Primary-Name-Request + Acknowledge + Get-Primary-Name
        ├── cost.lua        # Token-Cost + Cost-Details
        ├── governance.lua  # Set-Policy / Set-Treasury / Add-Controller / Remove-Controller
        └── admin.lua       # Reserved-name seeding + Set-Reserved / Clear-Reserved

BANKON Marketspace Registry contract
└── marketplace-process/  # Lua AO process source (order book + auctions for names)
    ├── state.lua           # Listings, Offers, Bids, Trades, Treasury, Policy, FeesAccrued
    ├── main.lua            # Handler manifest, Info + read handlers
    └── handlers/
        ├── list.lua        # Create-Listing (fixed-price + auction)
        ├── cancel.lua      # Cancel-Listing
        ├── offer.lua       # Make-Offer / Cancel-Offer / Accept-Offer / Reject-Offer
        ├── auction.lua     # Bid / Settle-Auction
        ├── escrow.lua      # Receive-Asset (BNR Transfer-Notice) + Reconcile-Escrow
        ├── settle.lua      # Settle-Trade (verifies Payment-Proof, emits BNR/ANT Transfer)
        ├── fees.lua        # Record-Fee + Fees-Info + Withdraw-Fees
        └── governance.lua  # Set-Policy / Set-Treasury / Add/Remove-Controller / pause

Standalone apps
└── apps/bankon-resolver/    # 3.70 kB SPA — public permaweb resolver for BANKON names
    ├── index.html
    ├── main.ts              # Reads ?name=, dry-runs Resolve, redirects to <txid>.arweave.net
    └── vite.config.ts       # Permaweb-deployable bundle

Scripts
├── scripts/spawn-bnr.mjs    # One-time BNR spawn (maintainer fallback)
└── scripts/spawn-bmr.mjs    # One-time BMR spawn (Marketspace; maintainer fallback)
   (preferred: in-wallet spawn via Dashboard → BANKON Names → admin)

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

## Permaweb & Sovereign Naming (Phase P / 2026-05)

A three-track expansion landed in May 2026 that puts PARSEC on the permaweb itself, handles the ARIO Solana migration, and ships a sovereign alternative to AR.IO's ArNS.

### Arweave / AO foundation

- [x] ANS-104 DataItem encoding + sign + verify (`src/lib/arweave/ans104.ts`)
- [x] AO MU/CU/SU transport (`src/lib/arweave/ao.ts`) — message / result / dry-run / spawn
- [x] Vault-bridged Arweave signer with `dispose()` (`src/lib/arweave/signer.ts`)
- [x] `window.arweaveWallet` injected API — ArConnect/Wander parity (`src/lib/arweave/inject.ts`)
- [x] dApp approval view (`src/views/arweave-approve.ts`)
- [x] Per-account multi-chain address map: `WalletAccount.chains: Record<ChainId, string>`
- [x] Arweave HD account creation view (`src/views/arweave-create.ts`)

### Permaweb deploy

- [x] Platform shim (`src/lib/platform.ts`): `isTauri` + dynamic `invoke`/`listen`; 13 callers migrated
- [x] `permaweb-deploy@^3.4.0` devDep + scripts `deploy:permaweb` (binds to `pythai`), `deploy:permaweb:txid` (initial deploy without ArNS), `build:resolver`, `deploy:resolver`
- [x] Production web build excludes static `@tauri-apps/api` imports — PARSEC runs in any browser as a permaweb SPA

### ARIO Solana migration handler

- [x] Solana chain module (`src/lib/solana/`): BIP-39 → SLIP-0010 ed25519 (`m/44'/501'/0'/0'`) → base58
- [x] Solana account view (`src/views/solana-create.ts`)
- [x] Migration view (`src/views/ario-migrate-solana.ts`): reads BASE ARIO balance via MetaMask `eth_call balanceOf`, surfaces Solana destination, hands off to `sol.ar.io`. Countdown to **June 1, 2026** snapshot.

### pythai ArNS claim path

- [x] AR.IO Registry client (`src/lib/arweave/ario.ts`): `getArioBalance`, `getArnsRecord`, `getReservedName`, `getTokenCost`, `buildBuyNameInput`, `buildTransferArioInput`, `formatArio`/`parseArio`. Mainnet process = `qNvAoz0Tg...`.
- [x] ANT helpers (`src/lib/arweave/ant.ts`): `getLatestAntModuleId`, `spawnAnt` (with confirmation polling), `setAntRootRecord`
- [x] Claim view (`src/views/ario-claim-pythai.ts`): preflight → confirm → spawn ANT → Buy-Name → bind manifest tx-id. Live cost preview (1-yr lease = 8,242.02 ARIO verified 2026-05-15).

### BANKON Names — sovereign permaweb namespace

The PARSEC-controlled alternative to ArNS. Single AO process, token-agnostic claims, no AR.IO dependency.

- [x] BNR Lua contract (`bankon-names-process/`): state schema + 7 handler modules (claim / transfer / records / lease / primary / cost / governance / admin)
- [x] Token-agnostic payment: `Payment-Method` + `Payment-Proof` tags (`free` / `algorand` / `arweave-stake` / `bankon`)
- [x] One-time spawn script (`scripts/spawn-bnr.mjs`): bundles Lua, signs Spawn DataItem from `DEPLOY_KEY`, polls confirmation, writes `BNR_PROCESS_ID` to `src/lib/bankon-names/process-id.ts`
- [x] PARSEC client (`src/lib/bankon-names/`): `process-id.ts` guard, `payment.ts` discriminated union, `client.ts` (read+write helpers mirroring `ario.ts`)
- [x] UI: `bankon-hub`, `bankon-claim`, `bankon-name` (root @ + undernames + extend + primary + transfer), `bankon-resolve`
- [x] Public permaweb resolver SPA (`apps/bankon-resolver/`): 3.70 kB, dependency-free, redirects to `<txid>.arweave.net`
- [x] Dashboard wiring: `BANKON Names` + `Resolve` row conditional on an Arweave address

### Snapshot investigation

- [x] `docs/snapshot-investigation.md`: snapshot date confirmed firm; Solana mint authority + reclaim-window length **not publicly disclosed** (flagged as medium risk); BASE bridge contract `0x138746...effb6` + relayer EOA `0x79B5B6F47F865194EAa02756883a003f06F7Ba6c` documented; risk table + pre-snapshot action sequence

### Verification (full Phase P)

- [x] `npx tsc --noEmit` clean across all three rounds
- [x] `npx vitest run` 101/101 pass (incl. new `ans104.test.ts` roundtrip)
- [x] `npm run build` succeeds; web bundle has zero static Tauri imports
- [x] `npm run build:resolver` produces a 3.70 kB Vite SPA

### Pending pre-June 1 user actions

- [ ] One-time `node scripts/spawn-bnr.mjs` to instantiate the BNR
- [ ] Bridge a small test amount BASE → AO (relayer sanity check) before bulk
- [ ] Deploy PARSEC to a tx-id, then later to `pythai.arweave.net`
- [ ] Complete sol.ar.io registration for the 99,600 ARIO BASE holding (deadline: **June 1, 2026**)
- [ ] Deploy `apps/bankon-resolver/` via `npm run deploy:resolver`

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
- [x] Multi-hop routing (ASA→ALGO→ASA) — fetchBestQuote() checks direct + multi-hop in parallel
- [x] Multi-hop execution — executeMultiHopSwap() handles 1-hop and 2-hop paths
- [x] Swap view: route display (direct vs 2-hop), compound fee (0.6% for 2-hop), hop breakdown
- [ ] Swap history tracking
- [ ] Custom slippage setting

### Phase E — Wallet Interop & Standards
Informed by: ailgo/use-wallet, ailgo/peraconnect, ARC-1, ARC-25

- [x] WalletConnect v2 module (src/lib/builder/walletconnect.ts) — multi-family, Algorand + EVM
- [x] ParsecConnect browser SDK (modules/parsec-connect.js) — Pera-compatible signTransaction
- [x] parsec_connect Rust WebSocket server (localhost:9876) — JSON-RPC 2.0
- [ ] ARC-1 transaction signing API compliance
- [ ] dApp connection interface (QR code + deep link)

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
Informed by: parsec-wallet/parsec-pod, ailgo/mint-arc19, ailgo/ExtendableDAO, AlgoNode/algostack

- [ ] ASA minter extension
- [ ] NFT minter extension (ARC-19)
- [x] **NFT metadata normalization (ARC-3 / ARC-19 / ARC-69)** — `src/lib/algorand/nft-metadata.ts` + `nft-arc19.ts`. Single normalized shape regardless of source ARC; pattern adapted from algostack's Medias module. Wired into `enrichAssets` and dashboard.
- [x] **Query cache + dedup + rate-limit** — `src/lib/algorand/query-cache.ts`. Per-endpoint p-ratelimit, in-flight Promise dedup, TTL cache. Foundation for everything that touches indexer/algod. Pattern adapted from algostack's Query module.
- [x] **IPFS gateway abstraction** — `src/lib/algorand/ipfs-gateway.ts`. Multi-gateway sequential fallback (algonode.xyz → ipfs.io → cf-ipfs → pinata). Future participant-controlled override via `parsec_mesh` Kubo (Phase I).
- [x] **ARC-26 transaction-request URIs** — `src/lib/algorand/arc26.ts`. `algorand://...` encode/parse; receive view shows shareable URI; input classifier recognizes pasted URIs. Pattern adapted from `AlgoNode/algourl` (Go, public domain → TS reimpl).
- [ ] Plugin/extension system architecture
- [ ] DAO interaction module
- [ ] Staking/governance participation

### Phase H — Multi-Chain Sovereign Holdings
Informed by: parsec-wallet org, Atomic Wallet key pair model, MetaMask/Phantom patterns

PARSEC absorbs from existing wallets — participant has complete handling of
public/private key pairs across all chains. True sovereign holding.

- [x] Chain-pack adapter architecture — 8 chain families with isolation layer
- [x] Multi-chain builder: ParsecTxBuilder → chain router → family builder → isolation check
- [x] Chain registry: 2500+ EVM chains from allchain API + chainid.network CDN + static fallback
- [x] Isolation layer: cryptographic boundaries per family, vault signing, external signer sandboxing
- [x] Ethereum (ETH) — key gen live, vault signing via @noble/curves secp256k1 (no ethers dep)
- [x] Bitcoin (BTC) — UTXO model, builder path, signing stub (needs bitcoinjs-lib)
- [x] Litecoin (LTC) — UTXO family, builder path, signing stub
- [x] Monero (XMR) — CryptoNote family, ring signature model, signing stub (needs monero WASM)
- [x] Zilliqa (ZIL) — Schnorr/secp256k1 family, signing stub (needs @zilliqa-js/crypto)
- [x] Cardano (ADA) — Ed25519-BIP32 family, eUTXO model, signing stub (needs cardano-serialization-lib)
- [x] Arweave (AR) — RSA-4096 family, vault signing LIVE via WebCrypto RSA-PSS (zero deps)
- [x] EVM L2/L3/sidechains — Polygon, Arbitrum, Optimism, Base, zkSync, etc. via EVM family
- [x] MetaMask injection sandboxing (EIP-1193 passthrough, PARSEC never touches key)
- [x] **xchain (EVM-controls-Algorand)** — `algo-x-evm-sdk`; MetaMask signs EIP-712, on-chain LogicSig verifies via `ecdsa_pk_recover`. Each EVM address maps to one Algorand LogicSig address. `chainId='algorand-xchain'`, `signingAuthority='metamask'`. Module: `src/lib/xchain/`, view: `src/views/xchain-connect.ts`.
- [x] **algorand-hd (ARC-52 / BIP32-Ed25519)** — `@algorandfoundation/xhd-wallet-api`; 24-word BIP-39 seed → many sub-accounts (path `m/44'/283'/account'/0/index`) plus Identity-context keys (`m/44'/0'/...`) for DID/W3C-VC. Parallel to the canonical 25-word algosdk path — never disturbs the default. Module: `src/lib/algorand-hd/`, view: `src/views/arc52-create.ts`. Rust port (`chain_algo_hd`) deferred — vitest suite pinned against the lib's behavior makes the future port byte-exact.
- [ ] Solana (SOL) — ed25519, SPL tokens
- [ ] Each chain: send, receive, private key export
- [ ] Atomic-style key pair display (participant sees all their keys)
- [x] bankon_vault holds all chain keys in one encrypted Tomb volume
- [x] Mausoleum: visual vault manager + cipher threshold dashboard + WebGL 3D crypto horizon
- [x] Admin key ceremony: 6-phase airgapped generation with network isolation probes
- [x] PROOF.md: formal encryption attestation (5 theorems, 10 cipher proofs, Bremermann limit)

### Phase H2 — aORC Contract Suite (agenticplace.pythai.net)

- [x] AgenticMinter — generic NFT minting (563 TEAL, testnet App 757891101)
- [x] AgenticRegistry — blockchain verification registry with box storage (1331 TEAL, testnet App 757891112)
- [x] BonaFideController — clawback-controlled reputation token issuance/revocation (1008 TEAL, testnet App 757895044)
- [x] TypeMinter — type-aware minting: aNFT/dNFT/iNFT/THOT with per-type on-chain logic (1613 TEAL, testnet App 757895349)
  - aNFT: immutable agent identity, box-registered
  - dNFT: dynamic, metadata update log tracked, owner-only
  - iNFT: intelligent, directive address + autonomy + intelligence level stored on-chain
  - THOT: knowledge tensor, CID uniqueness enforced (one THOT per SHA-256(CID))
- [x] deployer.html — tabbed deployment center: contracts, ASA creator, ABI explorer, settings, access tiers
- [x] deployer.php — ARC-56 ABI server, deployment records, ASA presets, history
- [x] deploy.html — TEAL embedded + algod.compile() + 7-step flow (Minter + Registry + BONA FIDE)
- [x] deploy.ts — CLI deployment: all contracts + BONA FIDE ASA creation + verify
- [x] testnet-skills.md — reusable deployment skills (faucet, compile, deploy, verify)
- [ ] Mainnet deployment (blocked: deployer needs 12+ ALGO funded)
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
- [x] Embedded axum HTTP server (every PARSEC node serves /parsec/v1/* endpoints)
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

PARSEC is the wallet interface for the AgenticPlace agent economy.

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
- [ ] End-to-end x402 test: PARSEC → MindX paywall → Facilitator settlement
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
- [x] Foundry tests: 30/30 pass on Anvil (metadata, fees, exemptions, reflection, router, fuzz)
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
- [x] InterchainWeaver.sol: proof-gated escrow (NOT bridge), ECDSA settlement verification, reclaim timeout, delivery confirmation, multi-signer threshold
- [x] InterchainRegistry.sol: chain config, route discovery, 14+ chains expandable to 2510+
- [x] InterchainDeployer.sol: multi-chain deploy, cost estimation, CREATE2 prediction
- [x] PhiFeeCalculator.t.sol: 15 tests + fuzz (phi precision, scaling, overflow, split)
- [x] GasStation.t.sol: 11 tests (update, batch, auth, staleness, quote, realistic Polygon)
- [x] InterchainWeaver.t.sol: 19 tests (escrow, proof verification, reclaim, delivery, signer mgmt)
- [x] `forge test` — 45/45 pass on Anvil
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
- [x] EXPLANATION.md: 5-phase weave flow, escrow vs pool vs vault, proof gate, limitations, path to decentralization
- [x] TECHNICAL.md: 7 contracts specified verbosely, 45 tests documented, security model, trust assumptions
- [x] USAGE.md: code examples for every operation including proof generation, reclaim, delivery confirmation
- [x] DEPLOYMENT.md: Anvil → fork test → estimate → deploy (cheapest first)

### Phase M — DAIO Governance Integration
Informed by: x402-demo/DAIO/contracts/, x402-demo/modules/daio/

Future: credential-gated proposals, staked proposals, cross-proposal credit.

- [ ] AI seat in Development, Marketing, Community groups
- [ ] Proposal requires holding funds/assets to complete (credential from holding)
- [ ] Passed proposals receive payment (incentivized goals)
- [ ] Credit token issuance from collection of proposals
- [ ] Wire DAIO governance into PARSEC (proposal submission from wallet)
- [ ] Constitutional tithe (15%) enforcement
- [ ] 2/3 consensus within groups, 2/3 of groups overall

## Design Principles

1. **Minimal code, maximum impact** — no unnecessary abstractions
2. **Security first** — keys never leave device, Rust for signing, frontend for display
3. **No external runtime dependencies** — vanilla TS, Blueprint CSS only
4. **Chain-pack architecture** — each chain is a modular adapter
5. **User sovereignty** — PARSEC never holds keys, bankon_vault recommended not required
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

| Phase | Name | Status | Tests | Key Deliverable |
|-------|------|--------|-------|-----------------|
| A | Core Wallet | Complete | — | 20+ views, vault, keystore |
| B | Matrix + DEX | Complete | — | WebGL rain, pyramid, pills |
| B2 | Matrix Overhaul | Complete | — | Glitch spin, tabbed diagnostics, drag-and-drop, glyph atlas |
| B3 | x402 Integration | Complete | — | 8 files in src/lib/x402/ + 3 views |
| B4 | Documentation | Complete | — | docs.html (37 docs), dev plan (477 lines) |
| C | Input Validation | 95% | — | Classifier, live feedback, watch-only |
| D | SpinTrade DEX | 95% | — | Multi-hop ASA→ALGO→ASA, quote aggregator |
| E | Wallet Interop | Planned | — | WalletConnect, ARC-1, ARC-25 |
| F | Advanced Algorand | Planned | — | Rekeying, multisig, ARC-19, history export |
| G | Extensions | Planned | — | ASA minter, NFT minter, plugins |
| H | Multi-Chain | 15% | — | Ethereum key gen done, viem signing pending |
| I | Infrastructure | 70% | — | 4 Rust modules (66 IPC commands), persistence pending |
| J | x402 Payments | 85% | — | Module complete, e2e test pending |
| K | AlgoDeployer | 80% | 30/30 | LUV9 tested, BONA FIDE written, Puya pending |
| L | Interchain | 85% | 45/45 | True interchain (proof-gated escrow), docs rewritten |
| M | DAIO Governance | Planned | — | Credential-gated proposals, AI seats |

---

*PARSEC is the evolution of the cryptocurrency wallet. Extract ideas and architecture, not accidental complexity. The right outcome is a cleaner, safer, more sovereign PARSEC.*
