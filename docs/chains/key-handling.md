# Per-chain key handling map

Parsec follows a **chain-pack** architecture: one adapter per chain, each responsible for key generation, derivation, signing, and address formatting. Secrets never leave Rust memory or the encrypted `bankon_vault` volume. The frontend only receives public addresses and derived data.

This doc maps each chain on Parsec's roadmap to a recommended library + derivation approach. Atomic Wallet's open-source org is cited where it vetted a particular upstream lib; most of those repos live at `reference/atomicwallet/` as read-only references.

> Atomic Wallet itself is closed-source — the org only publishes forks of upstream chain libraries. What we get from it is *vetting* (which libs a production multi-chain wallet chose), not integrated code we can lift.

## Matrix

| Chain | Seed | Curve | Derivation | Recommended lib (JS) | Atomic uses | Parsec status |
|---|---|---|---|---|---|---|
| Algorand | 25-word native | Ed25519 | Single account, BIP32-Ed25519 optional | `algosdk` | *not in org* | **implemented** (`src/lib/algorand/`, Rust sign) |
| Bitcoin | BIP-39 | secp256k1 | BIP-32 / BIP-44 / BIP-84 | `bitgo-utxo-lib` | ✓ `bitgo-utxo-lib` | planned |
| Litecoin | BIP-39 | secp256k1 | BIP-44 (coin type 2) | `bitgo-utxo-lib` (LTC network) | ✓ same | planned |
| Ethereum / EVM | BIP-39 | secp256k1 | BIP-44 m/44'/60'/0'/0/n | `ethers` (Rust: `alloy`) | *not in org* | planned |
| BSC | BIP-39 | secp256k1 | EVM chain 56 | same as Ethereum | *legacy BEP-2 `javascript-sdk`* | planned (EVM variant) |
| Solana | BIP-39 or raw | Ed25519 | BIP-44 m/44'/501'/0'/0' | `@solana/web3.js` | *not in org* | planned |
| Monero | 25-word native | Ed25519 (twisted) | private spend/view keypair | `mymonero-core-js` | ✓ fork | planned (licence review needed) |
| Cosmos family | BIP-39 | secp256k1 | BIP-44 (coin types per zone) | `@cosmjs/crypto`, `@cosmjs/amino` | *not in org* | planned |

## Key-handling principles

- **Secrets in Rust only.** Key material is derived, used, and zeroed in Rust. The JS side sees only addresses, public keys, and derived identifiers. `bankon_vault` (Argon2id + AES-256-GCM, with optional Tomb LUKS volume on Linux) is the only at-rest store.
- **Derivation in Rust.** We prefer Rust crates for the actual derivation (`bitcoin`, `secp256k1`, `ed25519-dalek`, `k256`, `curve25519-dalek`) rather than JS. The `reference/atomicwallet/` JS libs are kept for protocol/format study, not for runtime.
- **No BIP-39 for Algorand.** Algorand uses a 25-word native mnemonic mapped directly to a 32-byte seed — never force BIP-39 across it.
- **Per-chain coin type.** BIP-44 coin types (SLIP-0044) are the source of truth. Parsec stores `derivationPath` per account so imports from other wallets stay reproducible.
- **Per-account isolation.** Each chain account is a separate `.enc` file in the vault. Losing one never exposes another.

## Reference forks (at `reference/atomicwallet/`)

- `bitgo-utxo-lib` (MIT) — Bitcoin-family UTXO primitives (BTC, LTC, BCH, ZEC, DASH). Network params + pubkey hash handling are the parts worth reading.
- `coinselect` (MIT) — UTXO selection algorithms. Pairs with bitgo-utxo-lib for change/fee calc.
- `bip38` (MIT) — BIP-38 encrypted-key spec. We don't use BIP-38 as primary storage (`bankon_vault` is our format), but useful for *importing* paper wallets.
- `hdkey-secp256r1` (MIT) — Ontology's fork of hdkey for secp256r1. Reference only; Parsec targets secp256k1 for EVM and ed25519 elsewhere.
- `curve25519-js` (MIT) — axlsign — curve math reference. We use `curve25519-dalek` on Rust side.
- `mymonero-core-js` (custom licence — **read before adapting**) — Monero private spend/view key handling, subaddress derivation. Large repo (12 MB); skim rather than lift.

## Implementation order

1. **Bitcoin** — root reference chain per the architecture doc. Pure Rust (`bitcoin` + `bip39` + `bip32` crates). Reference `bitgo-utxo-lib` for script/network params.
2. **Ethereum + BSC** (EVM shared code path) — Rust (`alloy` or `ethers-rs`). One adapter, chain-id switch.
3. **Litecoin** — reuse Bitcoin adapter with LTC network params.
4. **Solana** — Rust `solana-sdk` (needs careful dependency review — solana-sdk is large and may not fit Parsec's minimal-deps posture).
5. **Cosmos** — Rust `cosmrs`.
6. **Monero** — last. Ring signatures and stealth addresses are not trivial; licence review on `mymonero-core-js` first.

## What Atomic Wallet's library choices tell us

The org confirms a few pragmatic choices a production multi-chain wallet makes:

- UTXO chains all share one forked `bitgo-utxo-lib` rather than per-chain libs. Good signal: one adapter, many networks.
- Cardano needs its own native toolkit (`cardano-serialization-lib-asmjs` and friends). We don't target Cardano near-term.
- They carry chain-specific forks (NEM, Waves, Lisk, Hedera, Kin, Tron, TON) precisely because each of those chains has its own key/signing model. Parsec only adopts these if a chain lands on the roadmap.
- They avoid a generic "multi-chain key manager" library. There isn't one that's both open and complete. Parsec builds its own via the chain-pack pattern.
