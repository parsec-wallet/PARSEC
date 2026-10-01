# Chains

Parsec is modular: each blockchain is a self-contained **chain pack** under
`src/lib/<chain>/` that implements the common `WalletModule` interface (see
`src/lib/pouch/`). One Parsec account is one human identity holding an address
on every chain it has been set up for.

## Chain packs

| Chain | Doc | Mnemonic | Derivation | Address |
|---|---|---|---|---|
| Algorand (classic) | [algorand.md](./algorand.md) | 25-word algosdk | none (one key) | base32, 58 |
| Algorand HD (ARC-52) | [algorand-hd.md](./algorand-hd.md) | 24-word BIP-39 | BIP32-Ed25519 | base32, 58 |
| Solana | [solana.md](./solana.md) | 24-word BIP-39 | SLIP-0010 ed25519, `m/44'/501'/0'/0'` | base58, 43–44 |
| Arweave | [arweave.md](./arweave.md) | 24-word BIP-39 | seeded RSA-4096 | base64url, 43 |
| Bitcoin | [bitcoin.md](./bitcoin.md) | 12/24-word BIP-39 | BIP-32/44, `m/44'/0'/…` | bech32 / P2SH / P2PKH |
| Litecoin | [litecoin.md](./litecoin.md) | 12/24-word BIP-39 | BIP-32/44, `m/44'/2'/…` | bech32 / P2SH / P2PKH |
| xchain (EVM→Algo) | [xchain.md](./xchain.md) | none | LogicSig from EVM address | base32, 58 |

See also [key-handling.md](./key-handling.md) for the cross-chain key-handling
map, and `src/lib/chains.ts` for the runtime registry (CAIP-2 ids, explorer
URLs, balance fetchers) that the dashboard and wallet switcher read.

## Adding a chain

1. Create `src/lib/<chain>/` implementing the `WalletModule` interface.
2. Add a `ChainDescriptor` to `src/lib/chains.ts` — label, CAIP-2 id,
   `addressType`, explorer URL, optional `balance` fetcher, `sendView`.
3. Register a dashboard tile under `src/lib/dashboard/` if it needs one.
4. Add a doc to this folder and link it from the table above.
