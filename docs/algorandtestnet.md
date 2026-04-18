# Algorand Testnet Configuration — Parsec Wallet

## Node & Indexer Endpoints

| Service | URL |
|---------|-----|
| Algod | `https://testnet-api.algonode.cloud` |
| Indexer | `https://testnet-idx.algonode.cloud` |
| Provider | AlgoNode (free tier) |

## DEX App IDs

| DEX | App ID | Status |
|-----|--------|--------|
| Tinyman v2 (on-chain) | `148607000` | Enabled |
| Pact AMM | `612838176` | Enabled |
| Tinyman API (centralized) | — | Disabled by default |

## Testnet Assets

| Asset | ID | Decimals |
|-------|----|----------|
| USDC | `10458941` | 6 |

## DEX API Endpoints

| Service | URL |
|---------|-----|
| Tinyman Analytics (testnet) | `https://testnet.analytics.tinyman.org/api/v1` |
| Tinyman Analytics (mainnet) | `https://mainnet.analytics.tinyman.org/api/v1` |
| Vestige Price Oracle | `https://free-api.vestige.fi` |
| CoinGecko Market Data | `https://api.coingecko.com/api/v3/coins/markets` |

## Faucet

Get testnet ALGO: [https://bank.testnet.algorand.network/](https://bank.testnet.algorand.network/)

Displayed on the Dashboard when network is set to `testnet`.

## x402 Integration

| Setting | Value |
|---------|-------|
| CAIP-2 Network ID | `algorand:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI=` |
| Default Network | `testnet` |
| Identity Registry | `0x8004A818BFB912233c491871b3d84c89A494BD9e` |
| Reputation Registry | `0x8004B663056A597Dffe9eCcC1965A193B7388713` |

## AgenticPlace Service Endpoints

| Service | URL |
|---------|-----|
| Discovery API | `https://agenticplace.pythai.net` |
| MindX | `https://mindx.pythai.net` |
| Facilitator | `https://mindx.pythai.net:4022` |
| BANKON Identity | `https://bankon.pythai.net` |

## BANKON Token (Mainnet)

| Setting | Value |
|---------|-------|
| ASA ID | `203977300` |
| Supply | 10,000,000 (0 decimals) |
| Holder Discount | 50% on x402 fees |
| Cache TTL | 5 minutes |
| Nodely Indexer | `https://mainnet-idx.4160.nodely.dev` |

## Network Configuration

Supported networks: `mainnet`, `testnet`, `betanet`

Network switching is available in Settings with cache invalidation on change.

## CSP Whitelisted Testnet Domains

```
https://testnet-api.algonode.cloud
https://testnet-idx.algonode.cloud
https://mainnet.analytics.tinyman.org
https://api.coingecko.com
https://free-api.vestige.fi
```

## Source File Reference

| Component | File | Line(s) |
|-----------|------|---------|
| Algod/Indexer clients | `src/lib/algorand/client.ts` | 19-24 |
| Tinyman v2 on-chain | `src/lib/dex/tinyman-onchain.ts` | 13, 21 |
| Tinyman API | `src/lib/dex/tinyman-api.ts` | 9-12 |
| Pact AMM | `src/lib/dex/pact.ts` | 12, 20 |
| Asset definitions | `src/lib/algorand/assets.ts` | 26 |
| Faucet link | `src/views/dashboard.ts` | 92-97 |
| x402 constants | `src/lib/x402/constants.ts` | 9, 25-26, 30, 38-39, 50-53, 78-83 |
| x402 bridge | `src/lib/x402/bridge.ts` | 41, 129 |
| x402 payment | `src/lib/x402/payment.ts` | 100 |
| Network type | `src/types/wallet.ts` | 3 |
| Network switching | `src/views/settings.ts` | 12-18 |
| CSP policy | `src-tauri/tauri.conf.json` | 35-46 |
| Pricing | `src/lib/prices.ts` | 25 |
