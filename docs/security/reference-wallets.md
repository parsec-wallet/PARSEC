# Reference wallets — how the others actually do it

Source-verified against pinned commits, not blog posts. Assembled while designing
`bankon-vault/2`, and kept because most of its decisions are reactions to
something specific below.

Pins: MetaMask `browser-passworder@9ce1edf`, `MetaMask/core@1103332`;
Bitcoin Core `ca7162c`; Pera `pera-web-wallet@ed6cd38` (read from
`reference/perawallet/`); BANKONBTCWaaS `b1ccee7`.

## Scorecard

| Property | MetaMask | Pera | Bitcoin Core | mindX (production sibling) | **PARSEC** |
|---|---|---|---|---|---|
| Passphrase KDF | PBKDF2-600k | scrypt N=16384, **global salt** | **iterated SHA-512, 8-byte salt** | PBKDF2-600k | **Argon2id 256 MiB/t=3/p=4** |
| Memory-hard | no | yes | **no** | **no** | **yes** |
| Cipher | AES-256-GCM | XSalsa20-Poly1305 | **AES-256-CBC, unauthenticated** | AES-256-GCM | **AES-256-GCM + extended AAD** |
| Per-entry keys | no | no | per-key IV only | yes | **yes** |
| KDF on the unlock path | yes | **no** | yes | yes | **yes** |
| Confirmation oracle | vault blob | **SHA-512 verifier** | none | `__check__` sentinel | **none** |
| Keys reachable from JS | **yes** | **yes** | no | n/a | **no** (see gap below) |
| Real zeroization | **no** | **no** | yes | **no** (Python cannot) | **yes** |
| Out of swap / core dumps | **no** | **no** | **yes** | **no** | **yes** |
| Auto-lock default | **off** | 5 min, mousemove only | no default timeout | yes | **on** |
| Unlock rate limiting | no | **no** | no | no | **yes** |
| Rotation cost | O(1) | O(1) | O(1) | **O(n)** | **O(1)** |
| Multiple custodians | no | no | no | one at a time | **yes** |
| Index encrypted | no | partial (hashed keys) | **no** | **no** | **yes** |
| Keys leave the device | no | **optional backend upload** | no | no | **never** |
| PQ-ready key container | **no** | **no** | **no** | **no** | **yes** |

## Pera Wallet

Read from the local checkout at `reference/perawallet/`. Keys live in IndexedDB
under `pera-wallet` → `accounts`, sealed with TweetNaCl `secretbox`
(XSalsa20-Poly1305) under a `scrypt-async` key.

| URL | What it is | Why it mattered here |
|---|---|---|
| [`naclUtils.ts`](https://github.com/perawallet/pera-web-wallet/blob/main/src/core/util/nacl/naclUtils.ts#L15-L98) | KDF and cipher; `PASSWORD_SALT` is a **hardcoded global constant** | One rainbow table covers every Pera user. PARSEC's per-vault random salt is the direct contrast — never regress it. |
| [`PasswordAccessPage.tsx`](https://github.com/perawallet/pera-web-wallet/blob/main/src/password/page/access/PasswordAccessPage.tsx#L191-L200) | Unlock compares an **unsalted single-round SHA-512** verifier from `localStorage` | The scrypt work factor is bypassed entirely: an offline attacker attacks SHA-512 at billions/sec instead of scrypt at ~10/sec. **This is why `bankon-vault/2` has no sentinel at all.** |
| [`DBManager.ts`](https://github.com/perawallet/pera-web-wallet/blob/main/src/core/util/storage/db/DBManager.ts#L240-L285) | Nested double encryption; IndexedDB primary keys are hashed | Worth stealing, and the precedent for PARSEC's opaque entry ids. |
| [`useTxnSigner.tsx`](https://github.com/perawallet/pera-web-wallet/blob/main/src/core/util/hook/useTxnSigner.tsx#L399-L418) | Decrypts the secret key per signature, leaves it to GC | No wipe idiom exists anywhere in the repo. |
| [`useCheckForInactivity.tsx`](https://github.com/perawallet/pera-web-wallet/blob/main/src/core/util/hook/useCheckForInactivity.tsx) | 5-minute auto-lock — **mousemove only** | Typing continuously for five minutes locks the wallet. PARSEC's timer watches keyboard, pointer and focus. |
| [`useLockApp.tsx`](https://github.com/perawallet/pera-web-wallet/blob/main/src/core/util/hook/useLockApp.tsx) | Cross-tab lock broadcast via the `storage` event | Genuinely good; the model for multi-window Tauri. |
| [`connect/Teller.ts`](https://github.com/perawallet/connect/blob/main/src/util/network/teller/Teller.ts#L32-L64) | postMessage bridge with **no origin check**, `targetOrigin` defaulting to `"*"` | Prompted the audit of `parsec_connect`, which does validate origins. |
| [`TransferMobileSelectAccounts.tsx`](https://github.com/perawallet/pera-web-wallet/blob/main/src/settings/transfer-mobile/page/select-accounts/TransferMobileSelectAccounts.tsx#L119-L155) | Raw private keys base64'd and **uploaded to Pera's backend**, E2E-encrypted | PARSEC's "keys never leave the device" is a real differentiator; state it against this. |

## MetaMask

The primitives are fine. Key *lifetime* is the problem.

| URL | What it is | Why it mattered here |
|---|---|---|
| [`browser-passworder/index.ts`](https://github.com/MetaMask/browser-passworder/blob/9ce1edf0e769afecc78f5198cb8d6b2f283a64d0/src/index.ts#L44-L56) | The whole vault crypto. PBKDF2-SHA-256, AES-256-GCM, 32-byte salt, 16-byte IV | The baseline PARSEC's Tier 1 already matches. |
| [`keyring-controller.ts:23`](https://github.com/MetaMask/core/blob/1103332b8aac9199d4662b571a621a2f667f7ca3/packages/wallet/src/initialization/instances/keyring-controller/keyring-controller.ts#L23) | `encryptorFactory(600_000)` | **The shipped iteration count is 600,000, not the library default of 900,000.** Do not quote 900k. |
| [`KeyringController.ts:2500-2545`](https://github.com/MetaMask/core/blob/1103332b8aac9199d4662b571a621a2f667f7ca3/packages/keyring-controller/src/KeyringController.ts#L2500-L2545) | Derives the key **extractable** and caches the exported JWK as a plaintext JS string for the whole session | Deliberately discards the non-extractable-`CryptoKey` protection WebCrypto offers. PARSEC's Tier 1 passes `false` and keeps it. |
| [`KeyringController.ts:1458-1472`](https://github.com/MetaMask/core/blob/1103332b8aac9199d4662b571a621a2f667f7ca3/packages/keyring-controller/src/KeyringController.ts#L1458-L1472) | `setLocked()` drops references | Lock is not a wipe. Nothing is zeroized anywhere in the path. |
| [`preferences.ts:13`](https://github.com/MetaMask/metamask-extension/blob/v13.46.0/shared/constants/preferences.ts#L13) | `DEFAULT_AUTO_LOCK_TIME_LIMIT = 0` | **Auto-lock is off by default.** PARSEC's defaults on. |
| [`hd-keyring.ts:112-128`](https://github.com/MetaMask/accounts/blob/main/packages/keyring-eth-hd/src/hd-keyring.ts#L112-L128) | `mnemonic`, `seed`, `root` as public class fields | The structural version of the gap PARSEC closes by keeping signing in Rust. |
| [hackerone.com/metamask](https://hackerone.com/metamask) | Bug bounty | Their only policy surface — the repo ships no `SECURITY.md`. |

Also worth knowing: `cacheEncryptionKey` was *removed* as an opt-in, making
in-memory key caching unconditional — a weakening, not a hardening.

## Bitcoin Core

World-class memory discipline; the weakest KDF of the four. Copy the former, not
the latter.

| URL | What it is | Why it mattered here |
|---|---|---|
| [`crypter.h`](https://github.com/bitcoin/bitcoin/blob/ca7162cde58e69214a3309c17fac6d666b5f055a/src/wallet/crypter.h) | `CMasterKey` — a passphrase-derived key wrapping a random master key | **The two-tier idea PARSEC's DEK layer generalises.** |
| [`crypter.cpp`](https://github.com/bitcoin/bitcoin/blob/ca7162cde58e69214a3309c17fac6d666b5f055a/src/wallet/crypter.cpp) | `BytesToKeySHA512AES` — iterated plain SHA-512, **8-byte salt**, not memory-hard; AES-256-CBC, unauthenticated | The KDF **not** to copy. |
| [`wallet.cpp:565-610`](https://github.com/bitcoin/bitcoin/blob/ca7162cde58e69214a3309c17fac6d666b5f055a/src/wallet/wallet.cpp#L565-L610) | `EncryptMasterKey` calibrates the round count to a 100 ms target and stores it per wallet | **Adopted.** It is why cost tracks hardware without a format migration. PARSEC targets 750 ms. |
| [`wallet.cpp:3389-3413`](https://github.com/bitcoin/bitcoin/blob/ca7162cde58e69214a3309c17fac6d666b5f055a/src/wallet/wallet.cpp#L3389-L3413) | `Lock()` calls `memory_cleanse` | Lock genuinely wipes — unlike MetaMask and Pera. |
| [`lockedpool.cpp:235-272`](https://github.com/bitcoin/bitcoin/blob/ca7162cde58e69214a3309c17fac6d666b5f055a/src/support/lockedpool.cpp#L235-L272) | `mlock` + `MADV_DONTDUMP`, `RLIMIT_MEMLOCK`-aware, soft-fail | **The model for `secure_mem.rs`.** |
| [`secure.h`](https://github.com/bitcoin/bitcoin/blob/ca7162cde58e69214a3309c17fac6d666b5f055a/src/support/allocators/secure.h) | `secure_allocator` wipes before free | The allocator pattern `SecretBytes` reproduces per-allocation. |
| [`managing-wallets.md`](https://github.com/bitcoin/bitcoin/blob/ca7162cde58e69214a3309c17fac6d666b5f055a/doc/managing-wallets.md#L28-L60) | Their own candid limitations — keyloggers, plaintext metadata, no recovery | The model for honest scope statements. PARSEC's `SECURITY.md` follows it. |
| [`SECURITY.md`](https://github.com/bitcoin/bitcoin/blob/ca7162cde58e69214a3309c17fac6d666b5f055a/SECURITY.md) · [advisories](https://bitcoincore.org/en/security-advisories/) | Four severity classes and disclosure timelines | Adopted, **except** their classification of local-access wallet bugs as Low. |

Also documented in their own source: the RPC passphrase is *not* `mlock`ed on the
way in. PARSEC wipes it on arrival rather than inheriting that.

## BANKONBTCWaaS

PARSEC's Bitcoin extension. Its server side is already correct and needs no
change: watch-only descriptors (`disable_private_keys=true`), unsigned PSBTs,
broadcast only, a public-metadata registry.

Two things to know:

- Its browser keygen (`keygen.mjs`, `offline-client.html`) puts the mnemonic in
  DOM `textContent`, prefills it into a `<textarea>`, copies it to the clipboard,
  ships no CSP, and zeroizes nothing. That is the exposure moving keygen into
  PARSEC closes. Licence is compatible — those files are GPL-3.0-or-later and
  keygen lands in PARSEC's GPL-3.0-or-later core (`chain_*`); keep it there.
- Its `rejectPrivate` middleware is a **substring match on JSON key names**. It is
  a guard rail, not a boundary; a client posting a seed under a differently-named
  field sails through. PARSEC must not rely on it.

Its vault's loopback signing oracle (`127.0.0.1:8099`, `/challenge` + `/sign`,
returning a signed PSBT only, with a client that *refuses any reply containing key
material*) is the pattern PARSEC's signing commands mirror.

## The audit gate

Several documents in this family defer to a "pending cypherpunk audit". As of the
last review that gate has **no date, no named auditor, and no scope document**, and
is self-referential to the same organisation's standard rather than a third party.
Treat it as an internal checkpoint. PARSEC has not been independently audited.
