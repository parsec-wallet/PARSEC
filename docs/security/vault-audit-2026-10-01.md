# BANKON vault audit — 2026-10-01

**Public edition.** An internal review of PARSEC's key vault (`src-tauri/src/bankon_vault/`), its
command surface, the chain packs that use it, the Android build, and the security documents that
describe it. Audited at commit `a3f54cc` (PARSEC 0.1.3 + the BANKONx402 rename). Fixes ship in
**PARSEC 0.1.4**.

Findings that are fixed are described in full. Findings that are still open are named with their
severity and the plan, at the level of `threat-model.md`; their detail is withheld until they are
fixed, per [`SECURITY.md`](../../SECURITY.md).

**Not an independent audit.** It was performed by the PARSEC team with automated assistance; every
finding was traced to the code. An independent audit remains a stated gap
([`threat-model.md`](threat-model.md#known-gaps)).

## Summary

PARSEC ships **`bankon-vault/1`**. The hardened second generation, **`bankon-vault/2`** (wrapped key,
per-entry keys, authenticated header and index, 256 MiB Argon2id), is specified and written but was
**not compiled into the app** — and earlier versions of the security documents described it as if
it were shipping. Several protections they described (attempt limiting, core-dump disabling) were
written but never called.

0.1.4 fixes the parts of that gap that change no stored data, and the documents now describe what
ships. The remaining work — moving every signature into the PARSEC Keycore, then shipping v2 —
follows in later releases.

**Your vault does not need to be re-created.** Nothing in 0.1.4 changes how keys are stored or
encrypted. Update to 0.1.4; choose a strong passphrase (the shipping key derivation is weaker than
the design — see *Open*).

## Fixed in 0.1.4

| # | Severity | Finding | Fix |
|---|---|---|---|
| 1 | High | No limit on unlock attempts | 3 free attempts, then a doubling wait to 1 h, persisted, on unlock, vault destruction and the Tomb unlock paths (`throttle.rs`, now compiled) |
| 2 | High | Process hardening never ran; session key in ordinary memory | `harden_process()` first in `run()` (no core dumps; on Linux no same-user ptrace/dump); session key held in `SecretBytes` (mlocked, excluded from dumps, volatile-wiped) |
| 3 | High | The app's web layer had file access to the vault directory (desktop `filesystem.json`, and Android `mobile.json` added in 0.1.1) | vault, profile and Tomb paths denied in both capability scopes |
| 4 | High | Android backup enabled by default | `allowBackup="false"`, `fullBackupContent="false"`, `dataExtractionRules` excluding all app data from cloud backup and device transfer |
| 5 | High | Tomb unlock did not verify the passphrase and could fall back to the raw passphrase as the key (new secrets then unrecoverable) | verified, attempt-limited unlock on both Tomb paths; fallback removed; a damaged vault inside the tomb is left untouched |
| 6 | Medium | Removing an account worked while locked (the session kept the vault path) | lock clears the path; removal requires an unlocked vault |
| 7 | Medium | A vault missing one file could be re-created over its keys | creation refused over any vault artefact |
| 8 | Medium | Non-atomic writes with default permissions | every vault file written via temp file (0600) → fsync → rename → directory fsync |
| 9 | Medium | The Arweave export returned any stored secret | returns only a parsed Arweave JWK whose address matches |
| 10 | Medium | Algorand and Solana signers did not check the stored key matches the address | derived address compared before signing |
| 11 | Low | Plain (compiler-removable) wipes in the Bitcoin and Litecoin packs | volatile wipe everywhere |
| 12 | — | Documents described v2 as shipping | `threat-model.md`, `memory-hygiene.md` corrected; a false code comment about the key-binding message corrected |

Tests: 101 Rust library tests pass, including 4 new vault tests and the attempt limiter's 7 (now
compiled for the first time).

## Open

| Severity | Area | Plan |
|---|---|---|
| ~~Critical~~ Fixed in 0.2.0 | Some frontend paths still retrieve a secret and sign in JavaScript, through a retrieve command that returns plaintext; signing commands have no Rust-side approval step | Every desktop signature goes through the PARSEC Keycore (0.1.5–0.1.8); the plaintext retrieve is removed for one re-authenticated export, and every signer refuses the key-binding message (0.1.9); every signature needs the Keycore's native approval (0.2.0). Exit tests: `surface_tests.rs`, `keycore-js-surface.test.ts`. Not part of this finding but found while closing it: key *generation* is still in the renderer — roadmap 0.2.x |
| High | v1 key derivation is Argon2id at library defaults (19 MiB), with a verification token; ciphertexts are not bound to their address; the account index is plaintext | **Ship `bankon-vault/2`** (256 MiB desktop / 64 MiB phone, authenticated header, wrapped key, AAD, encrypted index), migrating v1 vaults on next unlock |
| High | The Tomb passphrase reaches `tomb` as a command-line argument; the Tomb key path is not confined | Desktop-Linux only and optional. `tomb` has no non-interactive alternative; tracked |
| High/Medium | `bankon-vault/2` itself needs fixes before it ships: atomic migration, re-authentication for custodian changes, bound KDF parameters with ceilings, a vault-bound key-binding message refused by every signer, rollback protection, profile support | Part of shipping v2 |
| Low | Key-file name collisions; unscoped `shell:allow-execute`; the web build's keystore not labelled as the weaker tier | Scheduled with v2 |

## What this means for BANKONx402

BANKONx402 delivery (the client pays cost + markup over x402; BANKONx402 performs the purchase and
delivers) needs server-side custody. That custody will be a server profile of `bankon-vault/2`, with
its own threat model, only after the open items above are closed and the vault is re-audited.
