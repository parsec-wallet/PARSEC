# PARSEC — technical overview

How the desktop app is put together: the Rust backend, what each module does, and the optional
infrastructure modules — stated as what the code does today and what each needs to run.
Counts were measured from `src-tauri/src/lib.rs` on 2026-09-30.

## Shape

```
Tauri 2 shell
├── Rust (src-tauri/src)     signs, validates, stores keys, runs the optional infrastructure
│     16 modules · 9 managed states · 112 commands in generate_handler!
└── TypeScript (src)         the interface: classifies and suggests, never decides
      71 views · lib/ wrappers — one per Rust module — all IPC through lib/platform.ts
```

The rule that governs the split: **the frontend may classify and suggest; the backend verifies and
decides.** A signing command returns a signature, never a key. Views never call `invoke`; each Rust
module has one thin typed wrapper in `src/lib/`, and every call passes `lib/platform.ts`, which also
enforces viewing mode (`lib/mode.ts`): with the Blue Pill only read-only, setup and teardown
commands may run.

## Rust modules

| Module | Commands | What it does |
|---|---|---|
| `bankon_vault` | 41 | The vault and the Keycore's guard. **`bankon-vault/2`** since 0.2.7 (Argon2id 256 MiB desktop / 64 MiB phone → wrapped DEK → per-entry HKDF + AES-256-GCM, encrypted index, document MAC and rollback check; [vault spec](security/bankon-vault-spec.md)); a v1 vault migrates on unlock. 11 vault commands (incl. `vault_export_secret`, the only export, and `vault_reveal_new`), 17 `bankon-vault/2` commands (custodians, passphrase change, auto-lock, migration), 2 profile commands, 4 Keycore approval commands (`approval.rs`: the native dialog every signature passes, batch tokens, the x402 allowance), and the Tomb — LUKS cold volumes with USB key separation, 7 commands (still v1 inside). |
| `chain_algo` | 6 | Algorand: 25-word mnemonic accounts generated in Rust, transaction and message signing (decoded for the approval dialog, `txn.rs`). |
| `chain_sol` | 4 | Solana: SLIP-0010 ed25519 (m/44'/501'/0'/0'), create in Rust, import (phrase or raw key), signing. |
| `chain_ar` | 4 | Arweave: RSA-4096 accounts, signing (backup goes through `vault_export_secret`). |
| `chain_evm` | 4 | EVM: secp256k1 keys created in Rust, EIP-55 addresses, signing, the EIP-712 digest for x402's EIP-3009 rail. |
| `chain_btc` | 6 | Bitcoin: BIP-44/49/84 derivation, native SegWit addresses, PSBT signing (`sign.rs`; refuses to return a partially signed PSBT). Not yet exercised end to end on regtest ([TODO index](TODO-INDEX.md)). |
| `chain_ltc` | 5 | Litecoin pack. |
| `parsec_validate` | 6 | Address validators — the gatekeepers for every chain-native format. |
| `parsec_connect` | 7 | PARSEC Connect, the dApp bridge on `ws://127.0.0.1:9876`; each request is approved on screen ([parsec-connect.md](parsec-connect.md)). |
| `pmvpn` | 5 | Wallet-authenticated SSH terminal ([pmvpn.md](pmvpn.md)). |
| `network_monitor` | 3 | Opt-in local network and system snapshot. |
| `app_shell` | 8 | The desktop shell: custom title bar controls, tray (Show / Lock wallet / Quit), close-to-tray, start at login (XDG autostart, LaunchAgent, Run key — no added dependency). |
| `parsec_search` | 8 | Optional infrastructure — see below. |
| `parsec_mesh` | 10 | Optional infrastructure — see below. |
| `parsec_throttle` | 6 | Optional infrastructure — see below. |
| `parsec_sandbox` | 11 | Optional infrastructure — see below. |

## Optional infrastructure

Four modules are compiled in and registered, each with a frontend wrapper (`src/lib/mesh.ts`,
`search.ts`, `throttle.ts`, `sandbox.ts`). They are **capabilities you switch on**, not things PARSEC
does by default. Precisely:

**Peer server (`parsec_mesh/server.rs`).** An embedded HTTP server (axum, token-bucket rate-limited)
that lets a PARSEC install serve content to other peers. It is **opt-in**: it starts when
`mesh_start_server` is called, not at launch. A normal launch serves nothing.

**IPFS content handoffs (`parsec_mesh/ipfs.rs`).** Add, get, pin, unpin and repository status go
through a **separately installed IPFS daemon** (Kubo's `/api/v0` HTTP API); PARSEC does not embed
IPFS. Peers are found through a **PostgreSQL peer registry** (`parsec_mesh/peer.rs`), not libp2p or
a DHT — a mesh coordinated through a database.

**Search (`parsec_search`).** PostgreSQL with pgvectorscale (DiskANN indexes) when the extension is
present, falling back to pgvector HNSW; hybrid text and vector queries, auto-migrating schema
(`sqlx`). There is no Elasticsearch anywhere. It needs **a PostgreSQL server you provide**, connected
with `search_connect` and a connection string; none ships with the app.

**Rate limiting (`parsec_throttle`).** Per-source token buckets for requests and bytes, with stats
and live reconfiguration. Separately, **resource pricing** (`parsec_mesh/resource.rs`) values what a
peer contributes as watts × hours × electricity price (default $0.12/kWh, user-configurable),
reduced to a **US-dollar** figure. It does not convert to a crypto exchange rate.

**dApp sandbox (`parsec_sandbox`).** File-system access for dApps on a ten-level scale the
participant chooses, from 1 (no file access; contract calls only) to 10 (full sandboxed access, peer
relay and search index), with grant, revoke and update commands and an audit log. The levels are
defined in `parsec_sandbox/mod.rs`.

## Frontend

- Vanilla TypeScript, strict; the whole component kit is `src/lib/dom.ts`. Its controls use
  Blueprint's class names, styled in-house ([design/controls.md](design/controls.md)); Blueprint
  itself is not a dependency. No UI framework, no wallet-connection SDKs, no chart libraries.
- Four registries, "self-register, iterate, never branch on chain name": `WalletModule`
  (`lib/pouch/chains.ts`), `ChainDescriptor` (`lib/chains.ts`), `DashboardModule`, `NamespaceAdapter`
  (`lib/namespaces/registry.ts`). `lib/modules.ts` collapses the four into one `registerModule`
  ([modules.md](modules.md)).
- Navigation is an accordion of six sections — Chain Modules, Wallet Pouch, Vault Identity,
  AgenticPlace, .algo, Permaweb — from `GROUP_ORDER` in `lib/nav.ts`, at three disclosure levels
  (simple, more, pro).
- Screen size: `lib/viewport.ts` sets `<html data-viewport="compact|regular|wide">` and
  `--px-app-h`; layouts respond to both.
- The same `dist/` is the desktop app's frontend and a permaweb site; the web build has no Tauri
  import (all IPC through `lib/platform.ts`).

## Further reading

[security/threat-model.md](security/threat-model.md) · [x402-integration.md](x402-integration.md) ·
[performance.md](performance.md) · [cypherpunk4096.md](cypherpunk4096.md) · [README.md](README.md) (index)
