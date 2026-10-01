# CLAUDE.md

Guidance for Claude Code when working in this repository.

> **This file replaced an unedited Tauri/React starter template.** If you are
> reading advice about React, `src/components/`, `React.memo`, or `npm run
> docker:*` anywhere else in this repo, it is stale. None of it applies.

## What this is

**PARSEC** — a sovereign multi-chain desktop wallet. Algorand-first, with
Solana, Arweave, EVM/Base, and Bitcoin packs. Tauri 2 shell, Rust backend for
signing and validation, **vanilla TypeScript frontend with no UI framework**.

Tagline: *Your keys. Your coins. No compromises.*
Repo: <https://github.com/parsec-wallet>
Licence: by component — **GPL-3.0-or-later** for client-facing encryption software: anything that
generates keys, derives them from a seed/mnemonic, holds key material, or signs (`bankon_vault`,
`chain_*`, pmVPN, plus the TypeScript key paths in `REUSE.toml`). **Apache-2.0** for the rest,
**MIT** for the server-side AO processes. No permissive alternative on the key tier — by design.
`REUSE.toml` is the per-path authority; check it before moving code between those areas.

**Destination:** on completion PARSEC joins the
**[cypherpunk4096 consortium](https://github.com/cypherpunk4096)**. Conformance
is binary — all five commitments or none. Two are not met today
(zero-dependencies; float arithmetic in the money path). Read
`docs/cypherpunk4096.md` before claiming conformance anywhere, and do not add a
runtime dependency or a float to a value path without knowing you are widening
a gap. Bitcoin is **standalone**: PARSEC is compatible with `BANKONBTCWaaS` (a sibling
repo in that org) but **must never require it** — it is an optional provider
behind a seam, and every surface it backs degrades to `unknown` when absent.
See `docs/integration/bankon-btc-waas.md`.

## Non-negotiables

These come from `../CLAUDE_HANDOFF.md` and `../parsec_claude_handoff/docs/`.
Do not relax them without an explicit instruction from the user.

1. **No React, Vue, Tailwind, component kits, wallet SDKs, or chart libraries.**
   The UI runtime is intentionally tiny. New UI is built from `src/lib/dom.ts`.
2. **Frontend may classify and suggest. Backend must verify and decide.**
   The input classifier only proposes candidates; Rust validators are the
   gatekeepers.
3. **Secrets never persist in frontend storage.** They live in private fields on
   the store and in the Rust-side vault. Never `localStorage`.
   **Signing** runs in Rust for every chain pack — `chain_algo`, `chain_sol`,
   `chain_ar`, `chain_btc`, `chain_ltc`, `chain_evm`; `*_sign_*` returns a
   signature, never a key. **Generation** runs in Rust on the participant-facing
   desktop path: `create-wallet.ts` creates the vault *first*, then mints the
   account into it, then reveals the phrase for backup. Two paths still generate
   in the renderer and say so in their source — the browser build (no Rust) and
   `views/admin-keygen.ts` (sets its passphrase after generating).
   One caveat remains, tracked in `docs/security/threat-model.md`: *"zeroed on
   lock"* is not achievable in JS — `store.ts` overwrites with `'\0'.repeat(...)`,
   which allocates a new string and leaves the original for the collector. Anything
   that must actually be wiped belongs in Rust `SecretBytes`.
   One deliberate exception: Arweave's legacy *mnemonic → RSA-4096* derivation
   stays in `src/lib/arweave/seed.ts`, because its determinism is a property of
   node-forge's prime search and reimplementing it would risk stranding existing
   accounts. See `src-tauri/src/chain_ar/mod.rs`.
4. **Algorand is first-class** and uses its own 25-word account mnemonic. Never
   collapse it into BIP-39-only assumptions.
5. **Chain-native formats are mandatory** — EVM `0x` + EIP-55; Algorand 58-char
   base32; Bitcoin Base58 and Bech32/Bech32m; Solana base58; Cosmos HRP-aware
   Bech32. Do not infer chain identity from a raw private key alone.
6. **The web build must stay Tauri-free.** All IPC goes through
   `src/lib/platform.ts`, which dynamically imports `@tauri-apps/api` only when
   `isTauri` is true. The same `dist/` is deployed to Arweave.
7. **CSP is hardened** — no `unsafe-inline`, no `unsafe-eval`.
8. **No telemetry, analytics, or beacons.**

## Commands

```bash
npm run dev            # Vite dev server → http://localhost:1420
npm run tauri:dev      # Tauri desktop app (dev)
npm run build          # tsc && vite build  → dist/
npm run tauri:build    # production desktop bundle
npm test               # vitest run  (~695 tests)
npm run test:watch
npm run lint:css       # stylelint src/**/*.scss --fix
npm run lint:css:ci    # CI-clean output
```

Permaweb deploy: `npm run deploy:permaweb` (binds ArNS `pythai`) or
`deploy:permaweb:txid` (no ArNS binding). Resolver SPA: `build:resolver` /
`deploy:resolver`. AO process spawns: `npm run spawn:bnr`, `npm run spawn:bmr`.

Always run `npx tsc --noEmit` and `npx vitest run` before declaring work done.

## Architecture

```
src/
├── main.ts             entry — registers views, mounts router, deferred IPC init
├── views/              71 view modules, each exporting a () => HTMLElement factory
├── lib/
│   ├── dom.ts          el() / input() / btn() / toast() — the whole "component kit"
│   ├── router.ts       Map<view, factory> + store subscription
│   ├── store.ts        singleton pub/sub state; secrets in private fields
│   ├── platform.ts     isTauri + dynamic invoke/listen shim
│   ├── keystore.ts     dual backend: bankon_vault (Tauri) | Web Crypto (browser)
│   ├── pouch/          THE WALLET POUCH — WalletModule interface + chain registry
│   ├── chains.ts       ChainDescriptor registry (display/UX layer)
│   ├── dashboard/      self-registering dashboard tiles
│   ├── namespaces/     NamespaceAdapter registry (ArNS / BANKON / Solana-ArNS)
│   └── algorand|solana|arweave|bitcoin|litecoin|xchain|dex|x402|permaweb|…
├── styles/             SCSS 7-1-ish; wallet/_views.scss is the app skin
└── types/wallet.ts     WalletState, WalletAccount, AppView
src-tauri/src/
├── lib.rs              16 modules, 112 commands in one generate_handler!
├── bankon_vault/       Argon2id + AES-256-GCM key storage; Tomb (LUKS) commands
├── chain_btc|chain_ltc|chain_evm/   derivation + signing
├── parsec_connect/     dApp WebSocket bridge (127.0.0.1:9876)
├── parsec_validate/    address validators — the gatekeepers
└── parsec_mesh|search|sandbox|throttle|pmvpn|network_monitor/
```

### The product's four tiers

`../PARSEC.png` is the canonical architecture, and the code mirrors it:

**Chain Modules** (`lib/pouch/` `WalletModule`) → **Wallet Pouch**
(`lib/pouch/` — the multi-chain collection) → **Vault Identity** (`bankon_vault`
+ `views/identity.ts`) → **AgenticPlace** (`views/agents.ts`, `lib/x402/`,
`parsec_connect`, Marketspace).

Navigation, dashboard grouping, and the Linkage Map view all follow these tiers.

### Frontend ↔ backend

Views never call `invoke` directly. Each Rust module gets one thin typed wrapper
in `src/lib/` (`vault.ts`, `connect.ts`, `validate.ts`, `tomb.ts`, …), and those
wrappers call `platform.ts`. Only ~20 files touch IPC.

### bankon_vault — a shared component

**Read `docs/security/vault-family.md` before touching this.** At least five
codebases carry the name, in three languages, with materially different
cryptography; PARSEC's is `bankon-vault/2` (Argon2id → wrapped DEK → per-entry
HKDF, scheme-tagged bytes, encrypted index). The format is specified in
`docs/security/bankon-vault-spec.md`, which is the contract, not the code.

`bankon_vault` is **one component across several projects**, not a PARSEC
internal. The same vault appears in BANKONBTCWaaS and elsewhere, and **PARSEC
offers it as a service**. Treat its interface as a contract other applications
depend on: additive changes, no silent breaks. Its public surface is 34 IPC commands:
the original 16 (9 v1 in `commands.rs` + 7 Tomb in `tomb_commands.rs`) plus 18
`bankon-vault/2` commands in `commands_v2.rs`, added without removing any.
**Build status:** the v2 half is in the tree but not yet compiled in — `bankon_vault/mod.rs`
does not declare `commands_v2`/`vault`/`format`/`overseer`/`throttle`, `lib.rs` does not
register the 18 commands, and `VaultSession` has no v2 state. `src/lib/vault.ts` gates its v2
wrappers on `VAULT_V2_IN_BUILD` (false): reads degrade to the v1 vault, writes refuse. Flip it
in the same change that wires the Rust side.

**Scope discipline:** in this repo, focus on PARSEC. Do not refactor for other
consumers, chase their integrations, or vendor their code here — note the
cross-project implication and keep the work in PARSEC's own tree.

### Registries (the modular-expansion seam)

Four registries, all "self-register, iterate, never branch on chain name":

| Registry | File | Purpose |
|---|---|---|
| `WalletModule` | `lib/pouch/chains.ts` | key material: create/import/derive/sign |
| `ChainDescriptor` | `lib/chains.ts` | display: label, CAIP-2, explorer, balance |
| `DashboardModule` | `lib/dashboard-modules.ts` | dashboard rows |
| `NamespaceAdapter` | `lib/namespaces/registry.ts` | name registries |

**Adding a chain or tool means adding a module *and* a doc** under `docs/`.

## Conventions

- Vanilla TS, strict mode, no `any`. Target es2022.
- Build UI with `el()` / `btn()` / `input()` from `lib/dom.ts`; they emit
  Blueprint's class vocabulary (`bp5-*`), styled in-house by
  `src/styles/components/_controls.scss`. Blueprint is **not installed**; it is
  the design reference only (`docs/design/controls.md`). Never add it back or
  import its React components.
- Views are `() => HTMLElement` factories, lazily loaded via `lazyView()` in
  `main.ts` unless they are on the first-paint path.
- Style in `src/styles/`; brand tokens are CSS custom properties (`--px-*`).
- Retrieve a mnemonic only for the moment of signing, and zero it in a `finally`.
- Prefer editing an existing view over adding a parallel one — there are already 68.

## Docs worth reading

- `docs/DEVELOPMENT_PLAN.md` — roadmap, phase ladder, design principles
- `docs/TODO-INDEX.md` — session log and pending operator setup
- `docs/chains/README.md` — how to add a chain pack
- `docs/parsec-connect.md`, `docs/spintrade.md`, `docs/x402-integration.md`
- `README.md` — feature list; `QUANTUM.md`, `PERA_DEPARTURE.md` — positioning
- `docs/performance.md` — first-paint budget and the chunking traps behind it;
  the view lifecycle (`lib/lifecycle.ts`) and the leaks it fixed. **Read before
  adding a static import to an eager view or a `window` listener to any view.**
- **`docs/security/`** — threat model, the `bankon-vault/2` spec, the vault-family
  map, memory-hygiene rules, and a source-verified comparison against MetaMask,
  Pera and Bitcoin Core. `SECURITY.md` at the root carries the disclosure process.
