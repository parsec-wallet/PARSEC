# Parsec dApp integration

Parsec ships with a local WebSocket bridge (Parsec Connect) that speaks JSON-RPC 2.0. The easiest way to add Parsec to an existing dApp is to plug it into [`@txnlab/use-wallet`](https://github.com/TxnLab/use-wallet) as a `CustomProvider` — no new SDK to learn, no separate UI.

## Files

- `parsec-use-wallet-provider.ts` — copy this into your dApp. It implements the `CustomProvider` interface from `@txnlab/use-wallet` on top of the Parsec Connect WebSocket.

## Install

```bash
pnpm add @txnlab/use-wallet algosdk
```

## Register Parsec alongside your other wallets

```ts
import { WalletManager, WalletId, NetworkId } from '@txnlab/use-wallet'
import { parsecProvider } from './parsec-use-wallet-provider'

export const walletManager = new WalletManager({
  wallets: [
    WalletId.PERA,
    WalletId.DEFLY,
    {
      id: WalletId.CUSTOM,
      options: { provider: parsecProvider() },
      metadata: { name: 'Parsec', icon: '/icons/parsec.svg' },
    },
  ],
  defaultNetwork: NetworkId.MAINNET,
})
```

Your dApp then signs through use-wallet as usual (`useWallet`, `signTransactions`, `transactionSigner`) — Parsec just shows up in the wallet picker.

## How it works

1. Parsec Wallet exposes a WebSocket server at `ws://127.0.0.1:9876/parsec/v1/connect/ws` when the wallet is unlocked.
2. The provider speaks the two JSON-RPC methods the server implements:
   - `parsec_accounts` — returns the active address.
   - `parsec_signTransactions` — queues a sign request; the user sees a Parsec approval dialog and approves or rejects.
3. Rejected/timed-out requests surface as errors through use-wallet normally.

## Origins

Parsec Connect enforces an allowlist on `Origin` (default: `https://agenticplace.pythai.net`). Add your dApp's origin to Parsec's allowlist in settings before testing.

## Security notes

- Private keys never leave Parsec. The provider only ships base64-encoded transactions; Parsec signs inside its own Tauri/Rust process using the vault-unlocked mnemonic.
- Approval is per request: the user sees origin, transaction count, and any message you pass.
- Timeouts: Parsec itself times a sign request out after 120 s; the provider's socket timeout is set slightly above that.

- [toon-connector.md](./toon-connector.md) — review of the TOON Protocol ILP connector (paid reverse proxy) and the plan to expand it in-house as an AgenticPlace-tier payment rail. Primary source: <https://toon.ar.io/>, snapshotted in [`../reference/permaweb/toon-ar-io/`](../reference/permaweb/toon-ar-io/README.md). **Testnet only upstream; module ships disabled.**
- [toon-naming-x402.md](./toon-naming-x402.md) — **assessment**: how TOON and x402 meet the naming service. TOON pays for what a name points at, never for the name; x402 already fits the BANKON registry's `Payment-Method: algorand` and is blocked on one uncaptured tx id. ArNS stays ARIO-only.
- [bankon-btc-waas.md](./bankon-btc-waas.md) — **Bitcoin in Parsec**: standalone by default, with BANKON BTC WaaS as an **optional** provider for node truth and Bitcoin-Core diagnostics. Parsec signs every PSBT locally and never requires the WaaS. **Upstream pre-release.**
- [ario-deploy.md](./ario-deploy.md) — **publishing path**: `ario-deploy` (ArNS, Solana authority) vs `permaweb-deploy` (Permaweb Names, Arweave authority). The two have diverged into different name systems. Parsec is pinned on `permaweb-deploy@3.4.6`, two majors behind, with flags that no longer exist upstream.
