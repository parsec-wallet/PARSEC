# x402 Integration — Parsec Wallet ↔ AgenticPlace

## Overview

The x402 module (`src/lib/x402/`) connects Parsec Wallet to the AgenticPlace ecosystem: 70,000+ AI agents, x402 micropayments, BANKON identity, BONA FIDE reputation, and SmartOracle pricing. Parsec becomes the sovereign wallet interface for the entire agent economy.

## Architecture

```
Parsec Wallet (Tauri Desktop)
├── src/lib/x402/             ← THIS MODULE
│   ├── types.ts              ERC-8004, identity, payment types
│   ├── constants.ts          BANKON ASA, ERC-8004 addresses, network IDs
│   ├── oracle.ts             PriceOracle (Vestige DEX, ALGO/USD)
│   ├── discount.ts           BANKON holder check (50% off x402 fees)
│   ├── bridge.ts             Vault-secured x402 signing bridge
│   ├── payment.ts            x402 payment flow (402 → pay → settle)
│   ├── agenticplace-client.ts HTTP client for pythai.net services
│   └── index.ts              Module barrel export
│
├── src/views/
│   ├── x402-confirm.ts       Payment approval dialog
│   ├── agents.ts             Agent discovery browser
│   └── identity.ts           BANKON + ERC-8004 identity view
│
└── src/lib/pouch/chains.ts   Chain adapters (Algorand wired, Ethereum enabled)
```

**Naming:** the same rail is the shortest path to paid BANKON name claims — an x402 settlement is
an Algorand tx id paying a quoted address, which is exactly the proof `BNR.Treasury.algorand`
wants. The one blocker is local: `X402PaymentResult.txId` is declared and never assigned. See
[TOON, x402 and the naming service](./integration/toon-naming-x402.md).

## Three Integration Tiers

### Tier 1 — Direct Import (No Network Required)

Pure TypeScript types and constants consumed directly in the Tauri WebView:

| File | What It Provides |
|------|-----------------|
| `types.ts` | `AgentRegistration`, `CommandChannel`, `FeedbackParams`, `BankonPaymentRequirement`, access tiers |
| `constants.ts` | BANKON ASA ID (203977300), ERC-8004 addresses (15+ chains), CAIP-2 network IDs, pythai.net URLs |

### Tier 2 — Vault-Secured Signing

Modules that perform cryptographic signing through Parsec's encrypted vault:

| File | What It Does |
|------|-------------|
| `bridge.ts` | `buildAlgorandX402Signer()` — retrieves mnemonic from vault ephemerally, builds x402 signer, discards key |
| `payment.ts` | `x402Fetch()` — wraps fetch to handle 402 responses, builds payment headers with vault-secured signer |

**Key security property**: Secrets pass through JavaScript only for a single signing operation, then are discarded. The vault (Rust AES-256-GCM) is the only persistent secret store.

### Tier 3 — HTTP to pythai.net

Server-side services called over HTTPS:

| File | Endpoints |
|------|----------|
| `agenticplace-client.ts` | Discovery API (agents), SmartOracle (prices), MindX (x402 paywalled), Facilitator (verify/settle), BANKON (identity) |

## Key Components

### PriceOracle (`oracle.ts`)

Algorand-native pricing via Vestige DEX API (free, no API key):

```typescript
import { PriceOracle } from './x402'

const oracle = new PriceOracle()
const algoUsd = await oracle.getAlgoUsd()       // $0.20
const microAlgo = await oracle.usdToMicroAlgo(1) // 5000000
const bankon = await oracle.getBankonPrice()      // { usd, algo, source }
const asaPrice = await oracle.getAssetPrice(203977300) // any ASA
```

Replaces the CoinGecko-only `prices.ts` with Algorand-native DEX data for ALGO and ASA pricing.

### BANKON Discount (`discount.ts`)

Checks if an Algorand address holds BANKON ASA (203977300) for 50% off x402 fees:

```typescript
import { checkBankonHolder, applyDiscount } from './x402'

const status = await checkBankonHolder(address) // { isHolder: true, balance: 500 }
const effectivePrice = applyDiscount(0.001, status.isHolder) // $0.0005
```

5-minute cache per address. BANKON supply: 10,000,000 (0 decimals, whole units).

### Vault-Secured x402 Bridge (`bridge.ts`)

The critical security seam between Parsec's Rust vault and x402 payment signing:

```typescript
import { buildAlgorandX402Signer } from './x402'

// 1. Retrieve mnemonic from vault (Rust AES-256-GCM → JS briefly)
// 2. Build algosdk signer (sk in closure)
// 3. Sign x402 payment transaction
// 4. Discard signer → sk eligible for GC

const signer = await buildAlgorandX402Signer(address, passphrase, 'testnet')
// signer.signTransaction(), signer.signTransactions(), signer.getAlgodClient()
```

Also provides:
- `signBytesWithVault()` — sign arbitrary bytes for identity challenges
- `sendPaymentWithVault()` — direct ALGO payment (non-x402)

### x402 Payment Flow (`payment.ts`)

Complete 402 → pay → settle flow:

```typescript
import { x402Fetch } from './x402'

const response = await x402Fetch(
  'https://mindx.pythai.net/weather',
  { method: 'GET' },
  payerAddress,
  passphrase,
  'testnet',
  async (pending) => {
    // UI shows: "$0.001 → 0.005 ALGO (50% BANKON discount)"
    // Returns true if user approves
    return confirm(`Pay ${pending.effectivePriceAlgo} ALGO?`)
  }
)
```

### AgenticPlace Client (`agenticplace-client.ts`)

HTTP client for all pythai.net services:

```typescript
import { AgenticPlaceClient } from './x402'

const client = new AgenticPlaceClient()

// Discovery: 70K+ agents across 15+ chains
const agents = await client.searchAgents('weather oracle', 20)
const count = await client.getAgentCount()

// Oracle: live ALGO/USD from SmartOracle
const price = await client.getAlgoUsd()
const tokens = await client.getTopTokens()

// MindX: x402 paywalled endpoints
const priceTable = await client.getPriceTable()

// Identity: BANKON IDNFT
const identity = await client.checkIdentity(address)
```

## Views

### x402 Confirm (`views/x402-confirm.ts`)

Payment approval dialog shown when an x402 paywall is hit:

- Endpoint and description
- Price in USD and ALGO
- BANKON holder discount badge (if applicable)
- Exchange rate display
- Pay & Continue / Decline buttons

### Agent Discovery (`views/agents.ts`)

Browse and search 70K+ agents from the AgenticPlace discovery API:

- Search by name/description
- Chain pill badges
- Agent cards with ID, owner, description
- Live agent count from API

### Identity (`views/identity.ts`)

BANKON + ERC-8004 identity management:

- Algorand address and BANKON holder status
- ERC-8004 IDNFT status across 15+ EVM chains
- Access tier display (Visitor → Imperator)
- BANKON token info (10M supply, ASA 203977300)
- Live BANKON price from Vestige DEX

## Pouch Integration

The x402 bridge is wired into Parsec's chain adapter system (`src/lib/pouch/chains.ts`):

### Algorand Module (Enhanced)
```typescript
// chains.ts line 41 — was: throw new Error('Sign via keystoreRetrieve + algosdk')
// Now: uses vault-secured bridge
async signMessage(walletId, message) {
  return signBytesWithVault(walletId, '', message)
}
```

### Ethereum Module (Enabled)
```typescript
// chains.ts line 67 — was: throw new Error('not implemented')
// Now: key generation + storage enabled (signing requires viem)
enabled: true,
async createWallet() { /* Web Crypto random key */ },
async importWallet(secret, 'private-key') { /* store in vault */ },
```

## Configuration

The module connects to pythai.net by default. Override URLs via `AgenticPlaceConfig`:

```typescript
const client = new AgenticPlaceClient({
  discoveryApi: 'https://agenticplace.pythai.net',
  mindx: 'https://mindx.pythai.net',
  facilitator: 'https://mindx.pythai.net:4022',
  bankon: 'https://bankon.pythai.net',
  timeout: 10000,
})
```

## Dependencies

The x402 module adds zero new npm dependencies. It uses:
- `algosdk` (already in parsec-wallet)
- `@tauri-apps/api` (already in parsec-wallet, for vault IPC)
- `fetch` (browser native)
- `crypto.subtle` (browser native, for Ethereum key gen)
