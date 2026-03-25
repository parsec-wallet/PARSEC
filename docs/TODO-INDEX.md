# Parsec Wallet — TODO Index

> **Related:**
> - [Development Plan](./DEVELOPMENT_PLAN.md) — architecture, roadmap, completed work
> - [x402 Integration](./x402-integration.md) — AgenticPlace payment + identity layer

## Session: 2026-03-25

**Focus**: Matrix overhaul, x402 integration, tabbed diagnostics, algodeployer tokenomics

### Completed

- [x] Matrix rain: Shadertoy glyph atlas textures (256x256 POT, katakana)
- [x] Glitch spin: 360 rotation + chromatic aberration + scanline tear (intro + transitions)
- [x] Pyramid: brick steps, apex = #1 gainer, gainers right, losers left, icons
- [x] Top 10 column: left side, icons, abbreviated mcap ($1.34T, $460.2B)
- [x] Featured assets: VITE_JUST_BECAUSE env var (POL,ALGO,ETH,BEAM,ZIL), right side zigzag
- [x] Drag-and-drop: brand, pills, ship, top 10, fleet
- [x] PARSEC click: full-screen pill choice over pure rain
- [x] Blue pill: 6 tabbed diagnostics (Global, Gas, Chains, Network, DeFi, Portfolio)
- [x] Blue pill: auto-refresh 20s, Tab key cycles, two-column grid, compact layout
- [x] Blue pill: slow rain, red glyphs, hides market overlays
- [x] Red pill: login + create + import, natural market glyph colors
- [x] x402 module: types, constants, oracle, discount, bridge, payment, client (8 files)
- [x] New views: x402-confirm, agents, identity
- [x] Pouch: Algorand signing wired, Ethereum enabled
- [x] docs.html: 37 docs with hash routing
- [x] algodeployer: ShambaLuv LUV9, BONA FIDE, fee redemption, liquidity locker, fee controller, aLUV, bridge
- [x] algodeployer/interchain: PhiFeeCalculator, GasStation, InterchainWeaver, InterchainRegistry, InterchainDeployer + tests
- [x] algodeployer docs: EXPLANATION, USAGE, BONAFIDE, SHAMBALUV, LIQUIDITY-LOCKER, FEE-CONTROLLER, BRIDGE
- [x] interchain docs: INTERCHAIN, EXPLANATION, TECHNICAL, USAGE, DEPLOYMENT

---

## Active Tasks

### Matrix / Frontend

| Priority | Task | Status |
|----------|------|--------|
| Next | Multi-hop swap routing (ASA-ALGO-ASA) | Planned |
| Next | Swap history tracking | Planned |
| Next | Custom slippage setting | Planned |
| Next | Frontend permission slider UI for parsec_sandbox | Planned |
| Next | dApp connection interface (WalletConnect v2) | Planned |
| Future | Rekeying support | Planned |
| Future | Multisig account creation | Planned |
| Future | ARC-19/ARC-3 NFT display | Planned |
| Future | Transaction history export (CSV) | Planned |
| Future | QR code receive (algorand:// URI) | Planned |

### x402 / AgenticPlace

| Priority | Task | Status |
|----------|------|--------|
| Next | Wire viem for Ethereum signing in pouch | Planned |
| Next | End-to-end x402 payment test (Parsec -> MindX -> Facilitator) | Planned |
| Next | BANKON holder discount live verification | Planned |
| Future | Reputation feedback after x402 payments (ReputationRegistryClient) | Planned |
| Future | Venalicarii/Mercatores marketplace in wallet | Planned |

### AlgoDeployer

| Priority | Task | Status |
|----------|------|--------|
| Next | Foundry tests: `forge test` on interchain contracts | Planned |
| Next | Deploy to Anvil local chain | Planned |
| Next | Deploy to Base Sepolia (first livenet) | Planned |
| Next | BONA FIDE ASA creation on Algorand testnet | Planned |
| Future | PuyaTs contract compilation via Puya compiler | Planned |
| Future | aLUV ARC-200 deployment on Algorand localnet | Planned |
| Future | SHAMBA LUV redeployment on Polygon (LUV9 with name fix) | Planned |

### Infrastructure

| Priority | Task | Status |
|----------|------|--------|
| Next | parsec_search: embedding generation pipeline | Planned |
| Next | parsec_mesh: IPFS DHT peer discovery | Planned |
| Next | parsec_throttle: persistent metrics to PostgreSQL | Planned |
| Next | parsec_sandbox: persist permissions to PostgreSQL | Planned |
| Future | Sovereign sync (Earthstar offline-first) | Planned |
| Future | Hypercore append-only log for wallet journaling | Planned |
| Future | Tomb FIDO2 passkey support | Planned |
| Future | Hardware wallet integration (Ledger, Trezor) | Planned |

### Multi-Chain (Phase H)

| Priority | Task | Status |
|----------|------|--------|
| Next | Bitcoin chain pack (UTXO, Bech32) | Planned |
| Next | Ethereum chain pack (viem signing) | In Progress |
| Future | Litecoin, Monero, Solana chain packs | Planned |
| Future | Atomic-style key pair display | Planned |
| Future | USB cold storage for multi-chain keys | Planned |

---

## Progress

| Phase | Status | Completion |
|-------|--------|------------|
| A: Core wallet | Complete | 100% |
| B: Matrix + DEX | Complete | 100% |
| B2: Matrix overhaul | Complete | 100% |
| B3: x402 integration | Complete | 100% |
| B4: Documentation | Complete | 100% |
| C: Input validation | Complete | 95% (Rust validator pending) |
| D: SpinTrade DEX | Functional | 80% (multi-hop, history pending) |
| E: Wallet interop | Not started | 0% |
| F: Advanced Algorand | Not started | 0% |
| G: Extensions | Not started | 0% |
| H: Multi-chain | In progress | 15% (Ethereum key gen done) |
| I: Infrastructure | Modules built | 70% (persistence pending) |

---

## Accomplishments

### Matrix Entry Gate
- WebGL shader rain with market-driven speed/color/sentiment
- Katakana glyph atlas from Shadertoy textures
- Glitch spin with chromatic aberration on transitions
- Brick pyramid with daily gainers/losers
- 6-tab diagnostics (Tank view): live gas, TVL, blocks, sentiment
- All UI elements draggable

### x402 / AgenticPlace
- 8-file x402 module: vault-secured signing, payment flow, oracle, discount
- 3 new views: payment confirm, agent discovery (70K+), BANKON identity
- Zero new npm dependencies (algosdk + native APIs only)

### AlgoDeployer Tokenomics
- ShambaLuv LUV9: 100Q supply, 5% reflection, all 5 bugs fixed
- BONA FIDE: 1T ASA, binary reputation, penalty doubling, ghost vote
- Interchain Weave Protocol: golden ratio fee (phi), 14+ chain deployment
- 14 docs across algodeployer + interchain
