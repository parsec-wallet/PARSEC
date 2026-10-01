# Threat model

What Parsec's vault defends against, what it does not, and why. Written to be
falsifiable: every claim maps to code and to a test.

## The design centre

**The passphrase is the only thing protecting a stolen machine.**

Everything else follows from that. It is why the Argon2id cost is 256 MiB rather
than the 19 MiB OWASP floor, why there is no verification sentinel to give an
offline attacker a cheap oracle, and why a weak passphrase is surfaced loudly
rather than silently accepted.

It is also why the length rule is advisory. The participant owns the vault; our
job is to make the consequence legible, not to refuse their choice. The meter
bands by length — ≤6 weak, 7–11 medium, ≥12 strong — and the generator offers a
12-character mixed-class passphrase for anyone who wants one.

## Tiers

Parsec runs in four configurations with genuinely different properties. The UI
must say which one is in force; a participant who thinks they are on Tier 3 when
they are on Tier 1 has been misled about their own risk.

| Tier | Where | At rest | Notes |
|---|---|---|---|
| **1** | Web build, deployed to Arweave | PBKDF2-SHA-256 600k + AES-256-GCM in `localStorage` | Weakest. Reachable by any script that achieves XSS. Uses a non-extractable `CryptoKey`, which MetaMask does not. |
| **2** | Tauri desktop (any OS) **and Android** | `bankon-vault/2` | The universal path. Pure Rust, cross-compiles to `aarch64-linux-android`. |
| **3a** | Tauri on desktop Linux | Tier 2 inside a Tomb/LUKS volume, key on removable media | Optional. Degrades to Tier 2 when Tomb is absent, never fails shut. |
| **3b** | Android | Tier 2 + platform Keystore/StrongBox as a second factor | Optional, not yet implemented. |

**Android is Tier 2, not Tier 3a.** Android runs a Linux kernel, but Tomb needs
`tomb`, `zsh`, `cryptsetup`, `gpg`, device-mapper and root — an app has none of
those. Making Tomb mandatory would *exclude* Android, not include it.

## Attackers

### A1 — Stolen disk or laptop, vault locked · **Defended**

The primary threat. The attacker has the vault file and unlimited offline time.

- Argon2id at m=256 MiB, t=3, p=4, per-vault salt. Parameters are inside the
  authenticated header, so an edited file asking for a cheaper derivation fails to
  open rather than being honoured, and a floor is enforced regardless.
- No sentinel, no verification token, no fixed known plaintext. The only way to
  test a guess is a full Argon2id derivation followed by an AEAD unwrap.
- *Residual:* a short passphrase still falls. The meter says so at the moment of
  choosing, and the generator offers an alternative.

### A2 — Another local process, vault unlocked · **Substantially reduced**

An unprivileged process running as the same user, reading swap, core files, or
`/proc`.

- The DEK and every decrypted secret live in `mlock`ed pages marked
  `MADV_DONTDUMP`, wiped with volatile writes on drop.
- The process disables core dumps and sets `PR_SET_DUMPABLE=0` at startup, before
  anything can hold key material.
- Secrets never render through `Debug`, a log, or an error message — the types
  carry redacting `Debug` implementations and a test asserts it.
- The Tomb passphrase is no longer passed as `--tomb-pwd`, which used to expose it
  in `/proc/<pid>/cmdline`.
- *Residual:* page locking is best-effort. `RLIMIT_MEMLOCK` is small by default
  and zero in some containers; like Bitcoin Core's `LockingFailed()`, we proceed
  with a warning rather than refusing to open the wallet. `is_locked()` reports
  the truth rather than assuming success.

### A3 — Write access to the vault directory · **Defended**

An attacker who can modify files but does not know the passphrase.

- Every ciphertext authenticates `version ‖ vault_id ‖ purpose`. Entries cannot be
  swapped between slots or vaults, relabelled, or have their declared scheme
  changed.
- The account index is encrypted and authenticated, so an address cannot be
  substituted to redirect a deposit.
- Initialisation over existing ciphertext is refused, so an attacker cannot force
  a "fresh" vault that orphans the participant's keys and hides the loss.

### A4 — Online guessing · **Reduced, honestly scoped**

Someone at the keyboard, or driving the IPC surface.

- Three free attempts, then a doubling backoff to a one-hour cap, persisted across
  restarts, applied to `vault_unlock`, `vault_v2_unlock` and `vault_destroy` so
  the older command surface cannot be used to dodge it.
- *This is a speed bump, not a boundary.* An attacker holding the file can copy it
  elsewhere and delete the counter. Against them the defence is Argon2id and the
  passphrase's own entropy. The counter is deliberately not tamper-proofed;
  pretending otherwise would be worse than saying what it does.

### A5 — Hostile dApp via `parsec_connect` · **Defended, with one standing rule**

- The bridge binds loopback only, validates origins (`is_loopback_origin_str`) and
  allowlists operations. Both are covered by tests.
- **Standing rule:** a signature over `BANKON-VAULT-KEY-BINDING/v1` is a bearer
  credential for the vault. It must never be offered to a dApp through any generic
  signing path. `vault_binding_message` exists so the UI can display exactly what
  is being signed, and is not reachable from the bridge.

### A6 — Malware running as you, vault unlocked · **NOT defended**

It can ask the running wallet to sign. The idle auto-lock reduces the window and
is on by default — MetaMask's is off by default, and Pera's watches only mouse
movement — but this is mitigation, not defence. Lock the vault when you step away.

### A7 — Keylogger capturing the passphrase · **NOT defended**

Bitcoin Core names the same limit in its own documentation. It is equally true here.

### A8 — Secrets reaching the JavaScript heap · **Partially defended**

Once a secret becomes a JavaScript string it is immutable and garbage-collected;
it cannot be wiped. `src/lib/store.ts` "zeroes" by `'\0'.repeat(...)`, which
allocates a *new* string and leaves the original for the collector.

- **Signing happens entirely in Rust for every chain pack** — Algorand, Solana,
  Arweave, Bitcoin, Litecoin and EVM. The secret is retrieved, used and wiped
  without crossing the boundary, and `*_sign_*` returns a signature only.
- **Key generation moved for the participant-facing path.**
  `chain_algo_create_account` and `chain_ar_create_account` generate, store and
  drop the secret inside Rust, returning an address rather than a seed, and
  `create-wallet.ts` now creates the vault *before* any key exists. Showing a
  backup phrase is a separate, explicit command
  (`chain_algo_reveal_mnemonic`) rather than a side effect of creation. A
  consequence worth having: a crash during backup no longer loses the key, because
  it was sealed before it was displayed.
- **Residual:** the admin ceremony in `src/views/admin-keygen.ts` still mints in
  the renderer with `algosdk`, because it chooses its passphrase after generating
  and so has no vault to write into. Marked in the source; inverting that flow is
  the remaining piece.
- **Residual:** the browser build has no Rust and keeps in-renderer keygen. That
  is Tier 1 and is labelled as such in the UI.
- `vault_retrieve_key`, `vault_retrieve_key_bytes`, `chain_algo_reveal_mnemonic`
  and `chain_ar_export_jwk` are export paths, not signing paths, and say so.
- **Residual:** an imported mnemonic still arrives as an IPC parameter — a
  participant typing one in has to send it somewhere. It is wiped on arrival, but
  it existed as a JavaScript string first, and that copy cannot be reclaimed.
- **Residual:** Arweave's legacy mnemonic→RSA recovery stays in TypeScript by
  design (see `chain_ar/mod.rs`). Import the resulting JWK and all subsequent
  signing is in Rust.

### A9 — Forgotten passphrase · **NOT recoverable, by design**

No recovery, no escrow, no hint. Bind a second custodian if that is unacceptable.
The DEK layer exists partly so that is possible: a passphrase *and* a wallet
signature *and* a key file can open the same vault.

### A10 — Supply chain · **Partially addressed**

- Hardening added no new Rust crates: HMAC-SHA-512 and HKDF are implemented in
  ~90 auditable lines over `sha2`, pinned by RFC 4231 vectors, rather than pulling
  `hmac`/`hkdf`. The volatile-wipe helper is shared rather than reimplemented per
  chain pack.
- *Open:* cp4096 commitment II is not met. The frontend still ships chain SDKs.
  See `docs/cypherpunk4096.md`.

## Explicitly out of scope

- Physical attacks: cold boot, DMA, hardware implants.
- A compromised operating system, firmware, or hypervisor.
- Coercion of the participant.
- Traffic analysis of network activity.

## Known gaps

| Gap | Consequence |
|---|---|
| An imported mnemonic arrives as an IPC parameter (A8) | That first JavaScript copy cannot be wiped |
| Arweave legacy mnemonic→RSA recovery remains in TS | Deterministic only under node-forge; moving it would strand accounts |
| No hardware / air-gapped signer | The highest-value keys must enter the vault at all |
| Tier 3b (Android Keystore) not implemented | Mobile has no second factor |
| No independent audit | Every claim here rests on our own tests |
| Bitcoin path unaudited upstream | Gated to regtest; not for mainnet custody |
