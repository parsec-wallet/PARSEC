# The road to PARSEC 1.0.0

What 1.0.0 means, and the releases that get there. Each release has **exit criteria** that can be
checked — a release ships when they hold, not on a date. The order follows risk: the keys first,
then the money paths, then everything else. Feature work in [`DEVELOPMENT_PLAN.md`](DEVELOPMENT_PLAN.md)
continues alongside, but no feature lands in a way that breaks a criterion already met.

## 1.0.0 means

1. **Keys never leave the PARSEC Keycore.** No command returns a secret to the web layer except an
   explicit, re-authenticated, user-confirmed export. Every signature is made in Rust after an
   approval the web layer cannot forge.
2. **The vault is `bankon-vault/2`**, as specified, with its audit findings closed, every v1 vault
   migrated, and its conformance suite running in CI.
3. **Every claim in `docs/security/` is true of the shipping build** and maps to code and a test.
4. **An independent security review** of the vault and the signing paths has been done and its
   findings resolved or published with their status.
5. **No floating point in any value path** (cypherpunk4096 commitment IV), checked by a test.
6. **Money paths proven on mainnet**: x402 payments (Algorand and Base), the .algo and ArNS name
   stores, Arweave uploads over x402 — each settled at least once end to end, with receipts.
7. **Desktop and Android builds are reproducible from the tag**, signed (Android release key;
   desktop code signing where the platform requires it), with published checksums.
8. **Stable interfaces**: the vault IPC surface, the x402 module API and the name-store API are
   versioned; breaking changes after 1.0.0 need a major version.
9. **PARSEC ships a verified asset whitelist from official sources**: every Algorand Standard
   Asset (ASA) on it pinned by id, creator, unit and decimals to what its issuer or a recognised
   verification registry publishes, with the source recorded; the ragebar finds any ASA by name,
   unit or id and marks it verified, unverified or a lookalike of a verified one before opt-in.

## The ladder

**Cadence:** every version is the previous one plus 0.0.1 — 0.1.5, 0.1.6 … 0.1.9, then 0.2.0.
Each increment is pushed once its tests pass; **installers and a published release are built only
at milestones** (0.2.0, 0.3.0 … 1.0.0). A milestone below lands on its x.y.0;
the 0.0.1 steps before it are its increments (for 0.2.0: the frontend signing paths moved onto the
Keycore one group per release, 0.1.5–0.1.9).

### 0.1.x — shipped
Android, phone layouts, the BANKONx402 fee on stores and uploads, exact costs, and (0.1.4) the
first vault hardening from the [2026-10-01 audit](security/vault-audit-2026-10-01.md).

### 0.2.0 — Keys stay in the Keycore *(audit P1)*
- Every frontend signing path moved onto `chain_*_sign*` (Algorand, ASA, dApp approvals, x402,
  NFD, algorand-hd, Solana, Arweave, the builder).
- `vault_retrieve_key` removed from the command surface; the session passphrase no longer held in
  JavaScript; phrase and key export become one re-authenticated, confirmed command.
- A Rust-side approval: a signing request carries a single-use nonce that only the approval view is
  given, bound to the digest of what is signed.
- Every signer refuses the vault key-binding message.
- **Exit:** a test fails if any registered command returns secret material outside export; the
  JavaScript bundle contains no `mnemonicToSecretKey` / raw-JWK signing on a participant path.

### 0.3.0 — `bankon-vault/2` ships *(audit P2)*
- v2 compiled in; the audit's v2 findings fixed (atomic migration, re-authenticated custodians,
  bound KDF parameters with ceilings, vault-bound key-binding message, rollback protection,
  profile support, unambiguous HKDF info).
- 256 MiB Argon2id on desktop, 64 MiB on phones; authenticated header; AAD on every ciphertext;
  encrypted index. v1 vaults migrate on next unlock, keeping the v1 files until v2 verifies from disk.
- **Exit:** `cargo test --lib bankon_vault` runs the full v2 suite (43 + the spec's missing cases)
  in CI; a migration test from a real v1 vault; the threat model's "today (v1)" notes removed.

### 0.4.0 — Money paths proven, and verified assets
- First mainnet settlements recorded: x402 on Algorand and Base, a .algo store purchase, an ArNS
  undername purchase, an Arweave upload over x402 — receipts linked in the docs.
- Name-store fulfilment (owner inbox, mint/transfer to the buyer) — the stores' phase 3.
- **Verified ASA whitelist, shipped with PARSEC.** Built from official sources — each issuer's own
  published asset id (Circle, Tether, wrapped-asset bridges, the Algorand ecosystem projects) and
  recognised verification registries — and pinned per entry: id, creator, unit, name, decimals,
  freeze/clawback rights, and the source and date it was checked. Grows from today's dozen to the
  full set of officially verified assets; refreshed and re-checked against the mainnet indexer every
  release; a lookalike (a listed unit or name under another id or creator) is always called out.
- **Find and add an ASA from the ragebar.** Search by name, unit or id across the verified list and
  the indexer; results show verified / unverified / lookalike; opt-in (and opt-out) from the result,
  signed by the PARSEC Keycore, with the minimum-balance cost shown first. Opting in is how the
  account keeps spam assets out, and the search makes that the easy path.
- **SPINTRADE uses the whitelist as its authority, never the symbol.** Anyone can mint an ASA
  named "USDC"; in every pair picker, quote, route and confirmation an asset is identified by id and
  marked **verified** only when its id and creator match the whitelist. Unverified assets are shown
  as such (their id and creator, not just a ticker), lookalikes are called out, and a swap into or
  out of an unverified asset needs an explicit confirmation. Routes through pools are labelled with
  each leg's verified status, and "swap to USDC" only ever means the whitelisted USDC.
- **Exit:** each money path has a mainnet receipt and an automated test against recorded responses;
  the shipped whitelist has a test that re-derives every entry against its source snapshot and fails
  on any mismatch; a lookalike can never be shown as verified — in the ragebar, the asset views or SPINTRADE.

### 0.5.0 — Phones, first-class
- Android Keystore / StrongBox as an optional second factor (threat model Tier 3b).
- The phone layouts audited view by view; the remaining desktop-only affordances replaced.
- An app-private channel for dApps on Android (the loopback bridge stays off on phones).

### 0.6.0 — cypherpunk4096 gaps
- No float in any value path, enforced by a test; runtime dependencies reduced and justified.

### 0.7.0 — BANKONx402 delivery
- Server custody as a server profile of `bankon-vault/2`, with its own threat model and a
  re-audit; client pays cost + markup over x402, BANKONx402 performs the purchase and delivers.

### 0.8.0 — Independent review
- An external security review of the vault, the Keycore signing paths and the x402 client; findings
  resolved or published.

### 0.9.0 — Release candidate
- Reproducible builds from the tag; desktop code signing; interface versions frozen; documentation
  complete. Only fixes after this point.

### 1.0.0
When every criterion above holds.
