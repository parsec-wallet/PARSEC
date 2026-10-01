# SpinTrade — DEX Aggregator

SpinTrade is the integrated DEX aggregator in PARSEC Wallet. It queries multiple Algorand AMMs in parallel, finds the best price, and lets the participant choose their swap path.

## Architecture

```
Participant → SpinTrade Aggregator
                ├── Tinyman v2 (on-chain) ← primary, sovereign
                ├── Tinyman API           ← centralized, disabled by default
                └── Pact (on-chain)       ← second AMM source
```

All on-chain modules read data directly from Algod and Indexer. Zero third-party API dependencies. The aggregator deduplicates assets across sources and returns the best quote.

## DEX Modules

### Tinyman v2 (On-Chain)

- **Source:** `src/lib/dex/tinyman-onchain.ts`
- **Status:** Enabled (primary)
- **App IDs:** Mainnet `1002541853`, Testnet `148607000`
- **Data:** Pool discovery via Indexer transaction search, reserves from account state
- **Fee:** 0.3% per swap

The sovereign data source. Discovers pools by searching recent AMM transactions on the Tinyman application, then reads pool account balances to calculate reserves and prices. No API dependency — all data comes from the Algorand blockchain.

### Tinyman API

- **Source:** `src/lib/dex/tinyman-api.ts`
- **Status:** Disabled by default
- **Endpoint:** `mainnet.analytics.tinyman.org/api/v1`

Convenience module using Tinyman's centralized analytics API. Faster pool discovery but not sovereign — data comes from Tinyman's server. Cannot execute swaps (delegates to on-chain module). Enable in code if you want faster discovery alongside on-chain verification.

### Pact (On-Chain)

- **Source:** `src/lib/dex/pact.ts`
- **Status:** Enabled
- **App IDs:** Mainnet `1167966498`, Testnet `612838176`
- **Data:** Same on-chain pattern as Tinyman module
- **Fee:** 0.3% per swap

Second on-chain AMM source. Pact pools often have different liquidity distributions than Tinyman, so the aggregator may find better prices on Pact for certain pairs. Known pairs include ALGO, USDC, USDt, goBTC, and goETH.

## Multi-Hop Routing

When no direct pool exists between two ASAs, SpinTrade automatically routes through ALGO:

```
ASA_A → ALGO (hop 1) → ASA_B (hop 2)
```

- Both hops are fetched from all enabled DEX modules
- The aggregator compares direct vs multi-hop and returns whichever gives better output
- Compound fees: 0.6% for 2-hop (2x 0.3%)
- Compound slippage is calculated across both hops
- Cross-DEX routing: hop 1 via Pact, hop 2 via Tinyman (or vice versa)

## Slippage Tolerance

Preset options: 0.1%, 0.25%, 0.5% (default), 1%, 2%. Custom values up to 50%.

Slippage is applied as basis points (50 bps = 0.5%). The `minOutput` field in each quote ensures the swap reverts on-chain if the price moves beyond your tolerance.

## Swap History

All successful swaps are recorded to localStorage:

- **Storage key:** `parsec-swap-history`
- **Max records:** 100 (oldest trimmed automatically)
- **Fields:** input/output asset IDs, symbols, amounts, txId, DEX source, hop count, network, timestamp
- **Display:** Last 10 swaps shown at the bottom of the swap view

History is local-only. No data is transmitted. Clear history by removing `parsec-swap-history` from localStorage.

## Quote Display

Each quote card shows:

| Field | Description |
|-------|-------------|
| Route | Direct path or multi-hop route with intermediary |
| You Receive | Expected output amount |
| Rate | Exchange rate (1 input = X output) |
| Min Received | Guaranteed minimum after slippage |
| Impact | Price impact as percentage of pool reserves |
| Fee | DEX fee (0.3% direct, 0.6% multi-hop) |
| Slippage | Your selected tolerance |

## Pool Discovery

The swap view shows available output assets as pool cards with:

- Asset name and ID
- Current price ratio (from on-chain reserves)
- Pool liquidity (reserve amounts)

Pool data is fetched live from the blockchain when you select an input asset.

## Adding a New DEX Module

1. Create `src/lib/dex/your-dex.ts` implementing the `DexModule` interface
2. Implement `fetchPairsForAsset`, `getQuote`, and `executeSwap`
3. Register in `src/lib/dex/spintrade.ts` DEX_MODULES array
4. The aggregator handles deduplication, comparison, and multi-hop routing automatically

```typescript
export interface DexModule {
  id: string;
  name: string;
  enabled: boolean;
  fetchPairsForAsset(assetId: number, network: NetworkId): Promise<DexAsset[]>;
  getQuote(inputAssetId, outputAssetId, inputAmount, slippageBps, network): Promise<DexQuote | null>;
  executeSwap(mnemonic, inputAssetId, outputAssetId, inputAmount, minOutput, poolAddress, network): Promise<{ txId: string }>;
}
```

## Security

- Mnemonic is held only during swap execution, then zeroized
- Passphrase must be active (session not expired) to sign
- Watch-only accounts cannot swap
- All quotes show fees and impact before signing
- On-chain modules are the only sovereign data sources
