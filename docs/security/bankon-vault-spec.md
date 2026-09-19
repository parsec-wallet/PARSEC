# `bankon-vault/2` — format specification

> Normative. This document, not the implementation, is the contract other
> projects in the family build against. Where they disagree, the implementation
> is wrong.
>
> Reference implementation: `src-tauri/src/bankon_vault/`.
> Conformance suite: `cargo test --lib bankon_vault`.

## Why a new format

`bankon-vault/1` had four defects that could not be fixed compatibly:

1. Secrets were typed `String` and passed through `String::from_utf8`. A
   Falcon-1024 private key is ~2,305 bytes of binary and cannot be stored at all,
   which blocked cp4096 commitment V on a type signature.
2. The AEAD carried no associated data, and the manifest was unauthenticated
   plaintext. Anyone able to write to the vault directory could swap two key files
   and have the wallet sign with the wrong key.
3. The file-encryption key was derived directly from the passphrase, so changing
   the passphrase meant re-encrypting every entry, and only one credential could
   ever open a vault.
4. A fixed known plaintext (`bankon_vault_ok`) was stored purely so a passphrase
   could be checked — a free confirmation oracle for an offline attacker.

## Key hierarchy

Three layers. Each has exactly one job.

```
custody credential
  passphrase        ──Argon2id(m,t,p from the wrap)──┐
  wallet signature  ─────────────────────────────────┼──HKDF-SHA512──▶ KEK
  key file          ─────────────────────────────────┘   (per-kind info)
                                                              │
                          DEK (32 random bytes) ◀──AES-256-GCM unwrap──┘
                                                              │
   entry key = HKDF-SHA512(salt, ikm=DEK, info="bankon-entry:{oid}")
   ciphertext = AES-256-GCM(nonce, secret, aad)
```

**A passphrase MUST pass through Argon2id before HKDF.** HKDF is extract-and-expand,
not a password hash; feeding a human secret straight into it provides no
stretching whatsoever. High-entropy credentials (a signature, a key file) go
straight to HKDF, where stretching would add nothing.

The DEK is random and independent of any credential. This is what makes
passphrase rotation a single 32-byte rewrap, and what allows several custodians
to open one vault.

## Parameters

| Item | Value |
|---|---|
| Password KDF | Argon2id, RFC 9106, version 0x13 |
| Desktop cost | m = 262144 KiB (256 MiB), t = 3, p = 4 |
| Mobile cost | m = 65536 KiB (64 MiB), t = 3, p = 2 |
| Cost floor | m = 65536 KiB, t = 2, p = 1 — parameters below this MUST be refused |
| Expansion KDF | HKDF-SHA-512 (RFC 5869) |
| AEAD | AES-256-GCM, 96-bit nonce, 128-bit tag |
| Salt | 32 bytes, per vault; each wrap additionally carries its own 32-byte salt |
| DEK | 32 bytes |
| Vault id | 16 bytes |
| Opaque entry id | 16 bytes, hex-encoded |

Cost parameters are recorded per wrap and **authenticated as associated data**, so
an edited header asking for a cheaper derivation fails to open rather than being
honoured. Implementations SHOULD calibrate `t_cost` to a wall-clock target at
creation time (the reference targets 750 ms) and MUST clamp the result to the floor.

## Document

One JSON document, `vault2.json`, written atomically. The previous generation is
retained as `vault2.json.bak`.

```json
{
  "format": "bankon-vault/2",
  "vault_id": "<32 hex chars>",
  "salt": "<base64, 32 bytes>",
  "wraps": [
    {
      "kind": "passphrase" | "wallet-signature" | "key-file",
      "label": "primary",
      "kdf": { "m_cost": 262144, "t_cost": 3, "p_cost": 4 },
      "salt": "<base64, 32 bytes>",
      "sealed": { "nonce": "<base64, 12>", "ct": "<base64>" },
      "created_at": 1756500000
    }
  ],
  "index": { "nonce": "<base64, 12>", "ct": "<base64>" },
  "entries": [
    {
      "oid": "<32 hex chars>",
      "scheme": "falcon1024",
      "sealed": { "nonce": "<base64, 12>", "ct": "<base64>" },
      "updated_at": 1756500000
    }
  ]
}
```

`kdf` is present only on wraps whose kind requires stretching.

### What is NOT in the document

- No sentinel, no verification token, no known plaintext. Unwrapping the DEK *is*
  the credential check: AEAD authentication fails on a wrong credential.
- No account address, chain, or label. Those live inside `index`, encrypted. A
  locked vault discloses neither which accounts it holds nor how many — only the
  entry count, which is structural.

## Associated data

Every AEAD operation binds:

```
AAD = 0x02 || 0x00 || vault_id || 0x00 || purpose
```

`0x02` is the format version. `purpose` is:

| Operation | `purpose` |
|---|---|
| DEK wrap | `wrap:{kind}:{label}` |
| Entry | `entry:{oid}:{scheme}` |
| Account index | `index` |

Consequences, each covered by a test: a ciphertext cannot be moved to another
entry, to another vault, relabelled, reinterpreted as another custody kind, or
have its declared scheme changed.

## Derivations

```
KEK(passphrase)  = HKDF(salt=wrap.salt, ikm=Argon2id(passphrase, wrap.salt, wrap.kdf),
                        info="bankon-overseer-passphrase-v1", len=32)
KEK(signature)   = HKDF(salt=wrap.salt, ikm=signature,
                        info="bankon-overseer-wallet-v1:" || address, len=32)
KEK(key file)    = HKDF(salt=wrap.salt, ikm=file_bytes,
                        info="bankon-overseer-keyfile-v1", len=32)

oid              = hex(HKDF(salt=vault.salt, ikm=DEK,
                            info="bankon-oid:{chain}:{address}", len=16))
entry_key        = HKDF(salt=vault.salt, ikm=DEK,
                        info="bankon-entry:{oid}", len=32)
index_key        = HKDF(salt=vault.salt, ikm=DEK, info="bankon-index:v2", len=32)
```

Per-kind `info` prefixes mean a credential accepted for one custody kind can never
be replayed as another. The address inside the signature prefix means a signature
bound to one account cannot open a vault bound to a different one.

## Scheme registry

Secrets are **bytes**. `scheme` says what they are; no code path may assume a
length or a text encoding.

| Tag | Material |
|---|---|
| `mnemonic-bip39` | BIP-39 mnemonic, UTF-8 |
| `mnemonic-algo25` | Algorand 25-word mnemonic, UTF-8 |
| `ed25519` | 32- or 64-byte seed / expanded key |
| `secp256k1` | 32-byte scalar |
| `rsa4096` | private key, DER or JWK |
| `falcon512`, `falcon1024` | Falcon private key (~1,281 / ~2,305 bytes) |
| `ml-dsa-44`, `ml-dsa-65`, `ml-dsa-87` | ML-DSA (FIPS 204) private key |
| `opaque` | caller-defined bytes |

Unknown tags MUST be rejected, not coerced to `opaque`: a caller naming a scheme
this build does not know is a version mismatch, and silently downgrading loses the
type information the registry exists to carry. The reserved range means a new
scheme never requires a format bump.

## Required behaviours

An implementation MUST:

1. **Reject an unknown `format`** as a hard error. It MUST NOT treat an unreadable
   or corrupt document as an empty vault — that presents a total-loss event to the
   participant as a fresh wallet.
2. **Distinguish "not found" from "authentication failed."** Conflating them makes
   corruption indistinguishable from absence.
3. **Refuse to initialise over existing ciphertext.** If entries are present but
   the metadata is missing, fail loudly and name the files to restore.
4. **Refuse to remove the last custodian.**
5. **Enforce the cost floor** on parameters read from the file.
6. **Write atomically** — temp file, `fsync`, `rename`, `fsync` parent — with mode
   0600 set at creation rather than by a later `chmod`.
7. **Wipe key material** on release, with writes the compiler cannot elide, and
   never render a secret through `Debug`, a log, or an error message.

## Migration from `bankon-vault/1`

Non-destructive and verified before it is declared successful:

1. Verify the v1 passphrase.
2. Decrypt every entry with the v1 session key.
3. Classify each secret into a scheme (25 words on Algorand → `mnemonic-algo25`;
   12/15/18/21/24 words → `mnemonic-bip39`; otherwise `opaque`).
4. Create a v2 vault with one custodian and re-seal every secret.
5. **Read every secret back through the new format and compare.** Any mismatch
   aborts with v1 untouched.
6. Leave the v1 files in place. Removing them is the participant's decision, after
   they have confirmed access.

## Test vectors

cp4096 commitment III requires that a stranger be able to re-run every claim.
`cargo test --lib bankon_vault` covers, at minimum:

- HMAC-SHA-512 against RFC 4231 cases 1, 2, 3 and 6.
- HKDF determinism, domain separation, and output length across block boundaries.
- Round-trip of a 2,305-byte non-UTF-8 secret tagged `falcon1024`.
- Rejection of a ciphertext presented in another slot, another vault, or with a
  different scheme.
- Passphrase rotation leaving every entry ciphertext byte-identical.
- Refusal of parameters below the floor, including the old `Argon2::default()`.
- A locked vault's document containing no address, chain, or label.
