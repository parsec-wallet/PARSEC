# Threat model

What PARSEC's vault defends against, what it does not, and why. Written to be
falsifiable: every claim maps to code and to a test.

> **Status of the shipping vault (2026-10-01).** PARSEC ships **`bankon-vault/1`**.
> The second-generation format, **`bankon-vault/2`** (wrapped key, per-entry keys,
> authenticated header and index), is specified in `bankon-vault-spec.md` and
> written, but **not yet compiled into the app**. Where a section below describes
> v2, it says so and states what v1 does today. An internal audit on 2026-10-01
> found that earlier versions of this document described v2 as if it were
> shipping; they did not. Remediation is in progress in three steps: hardening the
> shipping vault (done for the items marked *0.1.4*), moving every signature into
> the PARSEC Keycore, then shipping v2.

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

PARSEC runs in four configurations with genuinely different properties. The UI
must say which one is in force; a participant who thinks they are on Tier 3 when
they are on Tier 1 has been misled about their own risk.

| Tier | Where | At rest | Notes |
|---|---|---|---|
| **1** | Web build, deployed to Arweave | PBKDF2-SHA-256 600k + AES-256-GCM in `localStorage` | Weakest. Reachable by any script that achieves XSS. Uses a non-extractable `CryptoKey`, which MetaMask does not. |
| **2** | Tauri desktop (any OS) **and Android** | today `bankon-vault/1` (Argon2id at library defaults, AES-256-GCM); `bankon-vault/2` when it ships | The universal path. Pure Rust, cross-compiles to `aarch64-linux-android`. |
| **3a** | Tauri on desktop Linux | Tier 2 inside a Tomb/LUKS volume, key on removable media | Optional. Degrades to Tier 2 when Tomb is absent, never fails shut. |
| **3b** | Android | Tier 2 + platform Keystore/StrongBox as a second factor | Optional, not yet implemented. |

**Android is Tier 2, not Tier 3a.** Android runs a Linux kernel, but Tomb needs
`tomb`, `zsh`, `cryptsetup`, `gpg`, device-mapper and root — an app has none of
those. Making Tomb mandatory would *exclude* Android, not include it.

## Attackers

### A1 — Stolen disk or laptop, vault locked · **Defended by the passphrase; weaker today than designed**

The primary threat. The attacker has the vault file and unlimited offline time.

- **Today (v1):** Argon2id at the library defaults (m=19 MiB, t=2, p=1) with a
  per-vault salt; a small verification token lets a guess be tested with one
  derivation. A strong passphrase is the defence that matters.
- **v2 (not yet shipping):** Argon2id at m=256 MiB, t=3, p=4 (64 MiB, t=3, p=2 on
  phones), parameters inside the authenticated header with a floor, and no
  sentinel — a guess costs a full derivation and an AEAD unwrap.
- Android backup of app data is off (0.1.4), so the vault does not leave a phone
  through cloud backup or device transfer.
- *Residual:* a short passphrase still falls. The meter says so at the moment of
  choosing, and the generator offers an alternative.

### A2 — Another local process, vault unlocked · **Substantially reduced**

An unprivileged process running as the same user, reading swap, core files, or
`/proc`.

- The session key and every decrypted secret the Keycore uses live in `mlock`ed
  pages marked `MADV_DONTDUMP`, wiped with volatile writes on drop (`SecretBytes`;
  the session key since 0.1.4).
- The process disables core dumps (and on Linux sets `PR_SET_DUMPABLE=0`) at
  startup, before anything can hold key material (since 0.1.4).
- Secrets never render through `Debug`, a log, or an error message — the types
  carry redacting `Debug` implementations and a test asserts it.
- *Open:* the Tomb passphrase is still passed to `tomb` as `--tomb-pwd`, which
  exposes it in `/proc/<pid>/cmdline` to processes of the same user while the
  command runs. `tomb` has no non-interactive alternative; moving it is tracked.
- *Residual:* page locking is best-effort. `RLIMIT_MEMLOCK` is small by default
  and zero in some containers; like Bitcoin Core's `LockingFailed()`, we proceed
  with a warning rather than refusing to open the wallet. `is_locked()` reports
  the truth rather than assuming success.

### A3 — Write access to the vault directory · **Partially defended today; defended by v2**

An attacker who can modify files but does not know the passphrase.

- **v2 (not yet shipping):** every ciphertext authenticates `version ‖ vault_id ‖
  purpose`, and the account index is encrypted and authenticated, so entries cannot
  be swapped or relabelled and an address cannot be substituted.
- **Today (v1):** ciphertexts are authenticated but not bound to their address, and
  the account index is plaintext. The webview has no file access to the vault
  directory (denied in the capability scope since 0.1.4), and vault files are
  written atomically, owner-only (since 0.1.4).
- Initialisation over any existing vault artefact is refused (since 0.1.4), so a
  "fresh" vault cannot be forced over the participant's keys.

### A4 — Online guessing · **Reduced, honestly scoped**

Someone at the keyboard, or driving the IPC surface.

- Three free attempts, then a doubling backoff to a one-hour cap, persisted across
  restarts, applied to `vault_unlock`, `vault_destroy` and the Tomb unlock paths
  (since 0.1.4; `vault_v2_unlock` when v2 ships).
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

- **Every chain pack can sign in Rust** — Algorand, Solana, Arweave, Bitcoin,
  Litecoin and EVM: `*_sign_*` retrieves, uses and wipes the secret and returns a
  signature only, and checks the key belongs to the address (Algorand and Solana
  since 0.1.4, Arweave since 0.1.8; Solana raw keys since 0.1.8).
- **On the desktop, every participant signing path uses the Keycore** (0.1.5–0.1.8):
  ALGO/ASA sends and opt-outs, dApp approvals, .algo name transactions, x402 and AORC
  mints, Solana sends and @solana/kit writes, and every Arweave transaction, upload,
  DataItem and dApp signature. The browser build has no Keycore and still reads the
  key for the moment of signing.
- **No command returns a secret for signing** (0.1.9). `vault_retrieve_key` is gone;
  the one way a secret leaves the Keycore is `vault_export_secret`, which needs an
  unlocked vault, the passphrase again (attempt-limited) and the address typed as
  confirmation. On the desktop the passphrase is not kept in JavaScript after
  unlock — the store holds a non-secret session marker.
- **Every signer refuses the vault key-binding message** (`BANKON-VAULT-KEY-BINDING`,
  0.1.9), so no signing request can mint a v2 custodian signature.
- ***Open:* signing commands have no Rust-side approval step** bound to what is
  signed. Adding it completes 0.2.0.
- **Key generation moved for the participant-facing path.**
  `chain_algo_create_account` and `chain_ar_create_account` generate, store and
  drop the secret inside Rust, returning an address rather than a seed, and
  `create-wallet.ts` now creates the vault *before* any key exists. Showing a
  backup phrase is a separate, explicit act (at creation, then only through
  `vault_export_secret`) rather than a side effect of creation. A
  consequence worth having: a crash during backup no longer loses the key, because
  it was sealed before it was displayed.
- **Residual:** the admin ceremony in `src/views/admin-keygen.ts` still mints in
  the renderer with `algosdk`, because it chooses its passphrase after generating
  and so has no vault to write into. Marked in the source; inverting that flow is
  the remaining piece.
- **Residual:** the browser build has no Rust and keeps in-renderer keygen. That
  is Tier 1 and is labelled as such in the UI.
- `vault_export_secret` is the only export path (0.1.9); `vault_retrieve_key`,
  `chain_algo_reveal_mnemonic` and `chain_ar_export_jwk` were removed.
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

## Android (since 0.1.1)

A phone is Tier 2: the same `bankon-vault/2` in Rust, the same PARSEC Keycore. What
changes is the device around it, and each difference is answered or stated:

- **Loopback is shared** — every installed app can reach `127.0.0.1`, so the A5
  defence of `parsec_connect` (only this machine reaches the bridge) does not hold.
  **The bridge does not run on a phone**: the frontend never starts it and
  `connect_start` refuses on Android and iOS (0.1.2).
- **Screens are visible to the system** — the recent-apps preview, screenshots and
  screen recording. **`FLAG_SECURE`** keeps every PARSEC screen out of all three
  (0.1.1), so a recovery phrase on screen is not captured by them.
- **The clipboard is readable by other apps.** On a phone a key is copied rather than
  downloaded, and the screen says so: paste it into a password manager, then
  overwrite the clipboard (0.1.1).
- **Timers are held back in the background**, so the auto-lock is measured when the
  app returns to the foreground rather than trusted to a timer (0.1.1).
- **Keyboards rewrite text** (capitalising, autocorrecting, learning words). Phrase
  fields turn auto-capitalise, autocorrect and spellcheck off (0.1.1).
- **Desktop-only defences are absent.** Tomb/LUKS (Tier 3a) needs root and tools an app
  does not have; Mausoleum and pmVPN are not offered on a phone.
- **Signing** — release builds are signed with the PARSEC release key, kept outside the
  repository; the certificate sha256 is published with every release, and an update
  signed by anything else is not ours.
- *Open:* Tier 3b (Android Keystore / StrongBox as a second factor) is not implemented;
  a rooted or compromised phone is A6.

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
| `parsec_connect` unavailable on Android | dApps cannot reach a phone wallet over the bridge until it has an app-private channel |
| No independent audit | Every claim here rests on our own tests |
| Bitcoin path unaudited upstream | Gated to regtest; not for mainnet custody |
