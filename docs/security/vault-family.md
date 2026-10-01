# The bankon vault family — which is which

`CLAUDE.md` describes `bankon_vault` as *"one component across several projects"*.
That is the intent. It is not the current state, and assuming otherwise has
already cost time: at least **five** codebases carry the name, in three languages,
with materially different cryptography.

This document exists so nobody has to rediscover that.

## The implementations

| | Language | Passphrase KDF | Per-entry keys | AAD | Custody |
|---|---|---|---|---|---|
| **mindX `mindx_backend_service/bankon_vault/`** — canonical production | Python | PBKDF2-HMAC-SHA512, 600k | HKDF-SHA512 `bankon-entry:{id}:{context}` | entry id | machine key-file; human EIP-191 signature |
| **BANKONBTCWaaS `bankon-vault/`** v1.7.0 | Python | PBKDF2-HMAC-SHA512, 600k | two-stage HKDF-SHA512 | entry id | + Shamir GF(256), ML-KEM-768, policy engine |
| **DeltaVerse `participant_vault.py`** + `engine/bankon-vault.js` | Python + JS | **bare HKDF** ⚠ | HKDF `bankon-vault-entry:{id}` | entry id | participant wallet signature |
| **walletcreator `bankon_vault.py`** | Python | **bare HKDF** ⚠ | same | entry id | participant signature |
| **PARSEC `src-tauri/src/bankon_vault/`** | Rust | **Argon2id** | HKDF `bankon-entry:{oid}` | version ‖ vault ‖ entry ‖ scheme | passphrase, signature, key file |

Plus two things that are *not* vaults but share the name: a `bankon_vault.py`
adapter shim in `bankon-qt/adapters/`, and a vendored `bankon-vault-multichain`
(Solidity `VaultQuorum.sol` + Algorand + Python) under `dexy/vendor/`.

## Which is canonical for what

- **The crypto core:** mindX `vault.py` / `overseer.py`. BANKONBTCWaaS's
  `LINEAGE.md` names it as the source it reproduces.
- **The participant / signature-bound client path and the `bankon-vault/1`
  interop format:** DeltaVerse `participant_vault.py`, with a byte-compatible
  browser twin at `engine/bankon-vault.js`.
- **The richest custody set:** BANKONBTCWaaS — Shamir, ML-KEM-768, and a signing
  policy engine that PARSEC has no equivalent of.
- **The strongest at-rest protection:** PARSEC, and only on the passphrase axis.

## What actually interoperates

- The **signature / HKDF path** of `bankon-vault/1` is byte-compatible between the
  Python and JavaScript implementations.
- The **passphrase path is not.** `engine/bankon-vault.js` uses PBKDF2-**SHA-256**
  where the Python side uses SHA-512. Do not assume a passphrase-derived vault
  opens on both.
- **PARSEC's `bankon-vault/2` is a different format.** It shares the derivation
  shape and the per-entry HKDF idea, but adds a DEK layer, a scheme registry,
  extended associated data and an encrypted index. It reads `bankon-vault/1`
  through an explicit migration, not natively.

## Where PARSEC deliberately diverges

Recorded so a future harmonisation does not quietly undo them.

1. **Argon2id, not PBKDF2, and never bare HKDF for a passphrase.** The DeltaVerse
   and walletcreator vaults feed a human passphrase straight into HKDF, which
   performs no stretching at all. That is fine for a 65-byte signature and
   catastrophic for a human secret. PARSEC forces the passphrase through Argon2id
   at 256 MiB and reserves HKDF for high-entropy input.
2. **A wrapped DEK.** The siblings derive the master key from the credential, so
   rotation is O(n) in entries and only one credential can ever open a vault.
   PARSEC wraps a random DEK once per custodian: rotation is O(1) and several
   custodians coexist.
3. **No sentinel.** Production's `__check__` entry holds the fixed plaintext
   `bankon-vault-ok`, and PARSEC v1 held `bankon_vault_ok`. Both are free
   confirmation oracles for an offline attacker. In v2 the DEK unwrap is the check.
4. **An encrypted index.** The siblings leave entry ids and contexts in cleartext;
   the live mindX vault leaks its entire agent roster that way. In a wallet the
   index *is* the account list.
5. **Broader associated data.** The siblings bind the entry id. PARSEC binds
   version, vault identity, entry and scheme, so a ciphertext cannot move between
   vaults or have its declared scheme changed.
6. **Real zeroization.** Python cannot deliver it — `lock()` in production
   allocates a new zero-filled `bytes` object and rebinds the name, leaving the
   original for the collector, and the docstring claiming otherwise is not true.
   Rust can, and does.

## What PARSEC should still take from the siblings

Not yet implemented, and worth doing:

- **`ShamirOverseer`** (GF(256), K-of-N) and **`HybridPQCOverseer`** (ML-KEM-768)
  from BANKONBTCWaaS. Both drop straight into the `Overseer` trait.
- **The rotation ceremony** from mindX `vault.py` — exclusive lock, snapshot,
  pre-hash every plaintext, candidate file, scratch-decrypt-and-compare, dry-run
  by default, time-boxed commit marker, atomic replace, post-commit sanity check,
  append-only audit log. PARSEC's DEK layer makes most rotations O(1) rewraps, but
  the ceremony is still the right shape for the rare case that re-encrypts.
- **The signing policy engine** — fee and output caps, allow/denylists, cooldowns,
  N-of-M quorum.
- **`encrypt_folder` / `decrypt_folder`** from `CLIENT_VAULT_SPEC.md`.

## Cautions

- **`CLIENT_VAULT_SPEC.md` describes PARSEC.** It says the vault *"is created from
  parsec"* and that the Python modules are a reference implementation of what runs
  on the client. PARSEC's Rust vault is the intended production form of it.
- **A signature over `BANKON-VAULT-KEY-BINDING/v1` is a bearer credential.**
  Anyone who can persuade a participant to sign that exact string derives their
  vault key. It must never be reachable from a generic dApp signing path.
- **Signature custody needs a deterministic scheme.** Ed25519 and RFC-6979 ECDSA
  qualify; a wallet signing with a random `k` produces a different key every time
  and an unopenable vault.
- **Never harmonise PARSEC's passphrase KDF toward the siblings.** It is the one
  axis where PARSEC is ahead of all of them.
