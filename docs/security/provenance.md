# Provenance — what PARSEC's security code was built from

Every external source that shaped the vault and the chain packs, what was taken
from it, and where that lands in this tree.

Written for three reasons. **Licence compliance:**
`docs/integration/bankon-btc-waas.md` requires provenance be recorded per file
when code is lifted rather than called. **Auditability:** cp4096 commitment III
requires every claim resolve to something a stranger can re-run, and "we modelled
this on X" is a claim. **Honesty:** several of these designs are reactions to a
specific mistake in a specific other wallet, and that is worth saying out loud
rather than presenting as originality.

## How to read the "taken" column

- **Idea** — a design decision was informed by reading it. No code copied.
- **Contract** — an interface, wire format, or parameter set was matched so the
  two implementations interoperate.
- **Vectors** — its output is used as ground truth in our tests.
- **Code** — source was actually copied or transliterated. *(Nothing in this table
  is currently marked Code.)*

---

## 1. Wallets studied

| Source | Licence | Taken | Lands in |
|---|---|---|---|
| [Bitcoin Core `lockedpool.cpp`](https://github.com/bitcoin/bitcoin/blob/ca7162cde58e69214a3309c17fac6d666b5f055a/src/support/lockedpool.cpp#L235-L272) | MIT | **Idea** — `mlock` + `MADV_DONTDUMP`, wipe before release, honest soft-fail when `RLIMIT_MEMLOCK` forbids pinning. The arena allocator was deliberately *not* taken; we lock a handful of small keys, so per-allocation `mlock` is simpler. | `bankon_vault/secure_mem.rs` |
| [Bitcoin Core `crypter.h`](https://github.com/bitcoin/bitcoin/blob/ca7162cde58e69214a3309c17fac6d666b5f055a/src/wallet/crypter.h) | MIT | **Idea** — `CMasterKey`: a credential-derived key wrapping a random master key, so rotation is O(1). Generalised here into a DEK with one wrap per custodian. | `bankon_vault/format.rs`, `vault.rs` |
| [Bitcoin Core `EncryptMasterKey`](https://github.com/bitcoin/bitcoin/blob/ca7162cde58e69214a3309c17fac6d666b5f055a/src/wallet/wallet.cpp#L565-L610) | MIT | **Idea** — calibrate KDF cost to a wall-clock target at creation and store it per vault. Their target is 100 ms; ours is 750 ms. | `bankon_vault/kdf.rs::calibrate` |
| [Bitcoin Core `managing-wallets.md`](https://github.com/bitcoin/bitcoin/blob/ca7162cde58e69214a3309c17fac6d666b5f055a/doc/managing-wallets.md#L28-L60) · [advisories](https://bitcoincore.org/en/security-advisories/) | MIT | **Idea** — candid limitation statements, and the four severity classes. We deliberately depart on one point: they rate local-access wallet bugs Low, we rate them High or Critical. | `SECURITY.md`, `threat-model.md` |
| [Pera `DBManager.ts`](https://github.com/perawallet/pera-web-wallet/blob/main/src/core/util/storage/db/DBManager.ts#L240-L285) | Apache-2.0 | **Idea** — hashing storage keys so the store's key space discloses nothing. Became DEK-derived opaque entry ids. | `bankon_vault/format.rs::entry_oid` |
| [Pera `useLockApp.tsx`](https://github.com/perawallet/pera-web-wallet/blob/main/src/core/util/hook/useLockApp.tsx) | Apache-2.0 | **Idea** — cross-context lock broadcast, lock on unload. | idle auto-lock, `bankon_vault/mod.rs` |
| [Pera `naclUtils.ts`](https://github.com/perawallet/pera-web-wallet/blob/main/src/core/util/nacl/naclUtils.ts#L15-L98) · [`PasswordAccessPage.tsx`](https://github.com/perawallet/pera-web-wallet/blob/main/src/password/page/access/PasswordAccessPage.tsx#L191-L200) | Apache-2.0 | **Cautionary.** A hardcoded global scrypt salt, and an unsalted SHA-512 verifier that bypasses the KDF entirely at unlock. **This is why `bankon-vault/2` has no sentinel and no verification token.** | `bankon_vault/format.rs` (absence of) |
| [MetaMask `browser-passworder`](https://github.com/MetaMask/browser-passworder/blob/9ce1edf0e769afecc78f5198cb8d6b2f283a64d0/src/index.ts#L44-L56) | ISC | **Idea / benchmark** — PBKDF2-600k + AES-256-GCM is the bar PARSEC's web tier matches and the desktop tier exceeds. | `src/lib/crypto.ts` (pre-existing) |
| [MetaMask `KeyringController`](https://github.com/MetaMask/core/blob/1103332b8aac9199d4662b571a621a2f667f7ca3/packages/keyring-controller/src/KeyringController.ts#L2500-L2545) | ISC | **Cautionary.** Derives the key *extractable* and caches the exported JWK as a plaintext JS string; auto-lock defaults off. PARSEC keeps the non-extractable key and defaults auto-lock on. | `secure_mem.rs`, auto-lock defaults |

## 2. The bankon vault family

Same organisation. Full map in [`vault-family.md`](vault-family.md).

| Source | Licence | Taken | Lands in |
|---|---|---|---|
| mindX `mindx_backend_service/bankon_vault/vault.py` | GPL-3.0 | **Idea** — per-entry HKDF domain separation (`bankon-entry:{id}:{context}`); the anti-orphan guard that refuses to regenerate a master key over existing ciphertext; `_secure_write` (mode at creation, not a later `chmod`); the verify-then-swap rotation ceremony. | `format.rs::entry_key`, `store.rs` C7 guard, `store.rs::write_atomic` |
| mindX `bankon_vault/overseer.py` | GPL-3.0 | **Idea** — the `VaultOverseer` protocol: every custody mode reduces to "produce 64 bytes", then one shared HKDF. Per-kind info prefixes so a credential cannot be replayed across kinds. Modelled as a Rust trait. | `bankon_vault/overseer.rs` |
| DeltaVerse `participant_vault.py` + `engine/bankon-vault.js` | GPL-3.0 | **Contract** — `BINDING_MESSAGE = "BANKON-VAULT-KEY-BINDING/v1"`, signature-bound custody, the airgap advisory, and the `bankon-vault/1` document shape that `/2` extends. | `overseer.rs::SignatureOverseer` |
| walletcreator `bankon_vault.py` + `CLIENT_VAULT_SPEC.md` | GPL-3.0 | **Idea** — the client-side, participant-key-bound, non-custodial model. That spec explicitly describes PARSEC; this Rust vault is its intended production form. | vault design overall |
| [BANKONBTCWaaS `bankon-vault`](https://github.com/cypherpunk4096/BANKONBTCWaaS) | GPL-3.0-or-later | **Idea** — the loopback signing-oracle contract (hand it a payload, get a signature, never a key) and its client-side assertion refusing any reply containing key material. `ShamirOverseer` and `HybridPQCOverseer` (ML-KEM-768) are noted as future custody modes, not yet implemented. | `chain_*/commands.rs` signing shape |
| BANKONBTCWaaS `keygen.mjs` | GPL-3.0-or-later | **Cautionary.** Mnemonic in DOM `textContent`, prefilled into a `<textarea>`, copied to clipboard, no CSP, no zeroization. The exposure this work closes. | `chain_algo/commands.rs` (create returns no secret) |

**Licence note:** everything this section takes lands in PARSEC's **GPL-3.0-or-later**
core (`bankon_vault`, `chain_*` — see `REUSE.toml`), so the GPL-3.0 and
GPL-3.0-or-later sources above stay compatible. The rest of PARSEC is Apache-2.0:
GPL-sourced material must not move outside the core. No code from them has been
copied into this tree; if any is later transliterated, mark it **Code** here and add
an SPDX header to the file.

## 3. Chain implementations

| Source | Licence | Taken | Lands in |
|---|---|---|---|
| [`algosdk`](https://github.com/algorand/js-algorand-sdk) | MIT | **Contract + Vectors.** The 25-word mnemonic algorithm (LSB-first 11-bit packing, SHA-512/256 checksum word), the base32 address with a 4-byte checksum, and the `MX` prefix `signBytes` applies. Mnemonics, addresses and signatures in our tests are ground truth generated by running algosdk. | `chain_algo/{mnemonic,keys,sign}.rs` |
| [SLIP-0010](https://github.com/satoshilabs/slips/blob/master/slip-0010.md) | Public spec | **Contract + Vectors** — ed25519 hardened-only derivation, `"ed25519 seed"` master key. Its official test vector 1 is asserted directly. | `chain_sol/seed.rs` |
| Phantom / Solflare convention | — | **Contract** — the `m/44'/501'/0'/0'` account path, so an address PARSEC shows is what an external sender's wallet derives. | `chain_sol/seed.rs::SOLANA_PATH` |
| `src/lib/solana/__tests__/seed.test.ts` | Apache-2.0 (this repo) | **Vectors** — its independently-derived address (Node crypto + tweetnacl + @solana/web3.js) is asserted by the Rust tests, so the two implementations are provably in step. | `chain_sol/keys.rs` |
| [arweave-js](https://github.com/ArweaveTeam/arweave-js) / [ANS-104](https://github.com/ArweaveTeam/arweave-standards/blob/master/ans/ANS-104.md) | MIT / spec | **Contract** — RSA-PSS over SHA-256 with a 32-byte salt, signature type 1; the JWK field set and base64url-unpadded encoding; address = base64url(SHA-256(modulus)). | `chain_ar/{jwk,keys,sign}.rs` |
| [node-forge](https://github.com/digitalbazaar/forge) | BSD-3-Clause / GPL-2.0 | **Not taken, deliberately.** Its seeded RSA generator makes `src/lib/arweave/seed.ts` mnemonic→key mapping deterministic, but determinism is a property of *its* prime search. Reimplementing that in Rust would pin PARSEC to another library's internals where a mistake silently loses funds, so the legacy derivation stays in TypeScript and Rust generates new keys from the OS CSPRNG. | see `chain_ar/mod.rs` |
| `reference/atomicwallet/bitgo-utxo-lib` | MIT | **Idea** — read while writing the Bitcoin pack; the runtime uses the `bitcoin` crate. Pre-existing, recorded in `chain_btc/mod.rs`. | `chain_btc/` |

## 4. Standards implemented directly

| Spec | Used for | Verified by |
|---|---|---|
| [RFC 2104](https://www.rfc-editor.org/rfc/rfc2104) | HMAC-SHA-512 | [RFC 4231](https://www.rfc-editor.org/rfc/rfc4231) cases 1, 2, 3, 6 |
| [RFC 5869](https://www.rfc-editor.org/rfc/rfc5869) | HKDF extract/expand | determinism, domain separation, length across block boundaries |
| [RFC 9106](https://www.rfc-editor.org/rfc/rfc9106) | Argon2id | floor enforcement, salt and passphrase dependence |
| [RFC 4648](https://www.rfc-editor.org/rfc/rfc4648) | base32 (Algorand), base64url (Arweave) | §10 test vectors |
| [SP 800-38D](https://csrc.nist.gov/pubs/sp/800/38/d/final) | AES-256-GCM | round-trip, tamper rejection, AAD binding |
| [BIP-39](https://github.com/bitcoin/bips/blob/master/bip-0039.mediawiki) | Wordlist (Algorand borrows it); seeds for Solana | via the `bip39` crate |

HMAC and HKDF are implemented in this tree rather than pulled from the `hmac` and
`hkdf` crates — both are present transitively but neither is a direct dependency,
and cp4096 commitment II says not to widen the surface. ~90 lines, one screen,
pinned by RFC vectors.

## 5. Rust crates

| Crate | Why | Commitment II |
|---|---|---|
| `argon2`, `aes-gcm`, `rand`, `sha2`, `hex`, `base64`, `serde`, `libc` | vault primitives | pre-existing direct dependencies |
| `bip39`, `bitcoin`, `k256`, `sha3` | BIP-39 wordlist and seeds; Bitcoin/Litecoin; secp256k1; keccak | pre-existing |
| **`ed25519-dalek` 2.2** | Algorand and Solana accounts and signatures | **added.** See below. |
| **`rsa` 0.9** | Arweave RSA-4096 and RSA-PSS | **added.** Was already transitive; now direct. |

**On adding two crates.** `CLAUDE.md` lists dependency growth as a
non-negotiable, and these were added on explicit operator instruction. The
argument for them is that they *narrow* the gap `docs/cypherpunk4096.md` actually
describes, which is about the **frontend** SDK surface: with Algorand, Solana and
Arweave key handling in Rust, `algosdk`, `@solana/kit` and `node-forge` no longer
need to be in the renderer's trusted path. Two audited Rust crates in place of
three large JavaScript SDKs is a net reduction in trusted code — and it moves key
material out of a heap where it cannot be wiped.

## 6. Tooling

| Source | Licence | Use |
|---|---|---|
| [TxnLab/seedguard](https://github.com/TxnLab/seedguard) | MIT | CI scanner blocking committed 25-word mnemonics. Vendored at `reference/txnlab/seedguard`. |
| `cargo-audit`, `cargo-deny` | — | dependency advisories and licence policy |

## Maintaining this file

Add a row whenever an external design informs a decision, not only when code is
copied. If code is ever transliterated, mark it **Code**, add an SPDX header to
the file, and check licence compatibility first — GPL-3.0-or-later if it lands in the core,
Apache-2.0 anywhere else (`REUSE.toml`).
