# Parsec Wallet — TODO Index

> **Quick start:** `npm install && npm run dev` → open http://localhost:1420
> For Tauri desktop: `npm run tauri:dev`. Full options in [Production Deploy](./PRODUCTION_DEPLOY.md#running-the-ui-locally).
>
> **Related:**
> - [Development Plan](./DEVELOPMENT_PLAN.md) — architecture, roadmap, completed work
> - [Production Deploy](./PRODUCTION_DEPLOY.md) — running locally + contract deployment checklist
> - [x402 Integration](./x402-integration.md) — AgenticPlace payment + identity layer
> - [Snapshot Investigation](./snapshot-investigation.md) — ARIO Solana migration risk report (2026-05-16)

## Session: 2026-09-07 — Lightspeed + module choices

**Focus**: first module registered through the manifest, and the template for the next one. Doc: [lightspeed.md](./lightspeed.md).

- [x] `src/lib/module-choices.ts` — `ParsecModule.choices`: privilege ladder `observe < sign < vault < system`, reach, persistence, provider; `assertPrivilege` / `PrivilegeError`; cautious defaults.
- [x] `src/lib/lightspeed/` — light.js reimplemented in-house, zero deps: `poll()` observable (refcounted, replay, emit-on-change), provider seam with a local default and a JSON-RPC provider, `blockNumber$ chainId$ balanceOf$ syncStatus$`, `makeContract` read half, `post$` as the privilege boundary.
- [x] `src/views/lightspeed.ts` + dashboard tile; first `registerModule()` caller, imported from `main.ts`.
- [x] `parsec-wallet/lightspeed` repo: pure-Node `lightspeed.mjs` prototype of the same contract, `SKILL.md` (all eight light.js pages distilled), `lightspeed.md`.
- [ ] Open the `AppView` union so a module's route ids need no edit in `src/types/wallet.ts` (the one remaining manual step in the recipe).

## Session: 2026-08-30 (Phase R)

**Focus**: UI and workflow — tiered navigation shell, module manifest, PARSEC brand, wallet entry, matrix/diagnostics. Full contract in [modules.md](./modules.md); narrative in [Development Plan → Phase R](./DEVELOPMENT_PLAN.md).

### Completed — Navigation & shell

- [x] `src/lib/nav.ts` — route registry grouped into the four architecture tiers (Modules → Pouch → Identity → AgenticPlace), with per-route disclosure level, rail flag and `modal` flag.
- [x] `src/views/shell.ts` — persistent shell; router renders into its content host, removing the full-page `innerHTML` wipe.
- [x] Back stack + route params in `src/lib/store.ts`; `replace()` for redirects; `lock()` clears history then replaces.
- [x] Approval surfaces (`confirm-send`, `connect-approve`, `connect-name-approve`, `x402-confirm`, `arweave-approve`) kept off the stack and out of the palette.
- [x] Command palette (Ctrl/Cmd-K), zero deps, names the matched keyword.
- [x] Progressive disclosure Simple / More / Professional, persisted per device.

### Completed — Module contract

- [x] `src/lib/modules.ts` — `registerModule()` does router + nav + dashboard in one call; `aliases` retire the 11 forwarder views.
- [x] `src/views/linkage.ts` — Linkage Map: `PARSEC.png` live, tri-state nodes, connectors lit from real state.
- [x] `docs/modules.md` — the expansion contract and the add-a-chain recipe.

### Completed — Brand

- [x] `src/styles/abstracts/_brand.scss` + `src/styles/base/_brand-tokens.scss` — palette sampled from `PARSEC2.png` (emblem) and `PARSEC.png` (interface); semantic tokens repointed so ~129 call sites inherited it. `#0084ff` gone from the build.
- [x] `src/assets/brand/parsec-mark.svg` (hand-authored flat mark) + emblem rasters at 512/256.
- [x] All 14 `src-tauri/icons/*` regenerated from the badge crop; mobile icon sets dropped (no mobile target).
- [x] Favicon fixed — pointed at a non-existent `/vite.svg`, 404ing in the app window and the permaweb deploy.
- [x] Removed 548 lines of dead chat-app CSS (`_buttons.scss` 438 → 71 lines) and the empty React scaffolding.

### Completed — Wallet entry

- [x] `src/views/create-select.ts` — "Choose your chains": Algorand required (quantum rationale from `QUANTUM.md`), Bitcoin / Solana / Arweave / EVM as utility. Row state derived from held addresses.
- [x] `src/lib/recovery.ts` — rebuild accounts from the keystore (vault or browser blob), with shape-based chain inference; 11 tests.
- [x] `src/lib/nfd/login.ts` — `.algo` identity login. Name selects, passphrase authenticates; 11 tests.
- [x] Red pill states its situation: *Open Wallet* when a keystore exists; *Restore Existing Wallet* first when none does.

### Completed — Matrix & diagnostics

- [x] Landing remains the matrix screen. Pyramid on/off toggle, persisted; visibility class-driven and re-asserted after every rebuild.
- [x] Pyramid now shows inside the blue pill; diagnostics panel becomes a left column.
- [x] Diagnostics rows carry tri-state tone (dot + colour); every tab states provenance.
- [x] `src/lib/prices.ts` reports `FeedStatus` instead of swallowing errors; `sessionStorage` cache stops reloads re-hammering CoinGecko.
- [x] Favourites strip: GLMR → **STX (Stacks)**, CoinGecko id `blockstack`.

### Verification

- [x] `npx tsc --noEmit` clean.
- [x] `npx vitest run` **232/232** (+43: nav/fuzzy 21, recovery 11, `.algo` login 11).
- [x] `npm run build` succeeds; web bundle stays Tauri-free.
- [x] `npx stylelint "src/styles/**/*.scss"` — zero errors.
- [x] Confirmed running under `npm run tauri:dev`.

### Pending — next round

- [ ] Migrate the remaining dashboard modules onto `registerModule()` (start: Bitcoin, then Solana — see [modules.md](./modules.md)). **Permaweb done 2026-09-10** (`src/lib/permaweb/module.ts`).
- [x] ~~In-wallet upload to Arweave.~~ **Done 2026-09-10** — `permaweb-upload`: Turbo (free ≤ 107,520 B/item), path manifests for sites, Rust-signed on desktop, gateway digest verification, hand-off to the name controller. See [permaweb/README.md](./permaweb/README.md).
- [ ] Paid uploads: buy / check Turbo credits in-wallet (today an over-limit item without credits stops at HTTP 402).
- [ ] Upload hand-off for **undernames** (root target only today); Wayfinder-style gateway ranking for verification.
- [ ] Enable `bitcoinModule` in `src/lib/pouch/chains.ts` once BANKON BTC WaaS is wired through; it is `enabled: false` and the chain picker reports it honestly until then.
- [ ] `ethereumModule.signMessage` throws and the descriptor has no `sendView` — the Base panel's Send stays disabled.
- [ ] Derived stepper + next-action card (`src/lib/ui/`) applied to onboarding and send.
- [ ] QR rendering for receive (ARC-26 URI already built, no encoder yet).
- [ ] In-app modals to replace native `confirm()` / `prompt()` in dashboard logout, asset opt-out, settings rename/reset.
- [ ] Adopt `matrix-fx/` in `src/views/matrix.ts` (2,206 lines duplicated; module never imported).
- [x] ~~**Capture the x402 settlement tx id.**~~ **Done 2026-09-18.** `protocol.ts` reads `PAYMENT-RESPONSE` (and the v1 `X-PAYMENT-RESPONSE`); `receipts.ts` writes a receipt the moment one is decoded, delivered or not. `latestReceiptTo(payTo, network)` is the lookup a `Payment-Proof` makes. Part of the spec rewrite — see [x402-integration.md](./x402-integration.md).
- [x] ~~**Paid BANKON name claim.**~~ **Done 2026-09-18.** `src/lib/bankon-names/pay.ts` — `quoteNameClaim()` reads the treasury and cost live and reports any settlement already on file that covers it; `proveNameClaimPayment()` reuses that receipt or pays the treasury Rust-signed via `sendAlgoPayment()`, never twice. A receipt is refused if it underpaid, was another asset, paid someone else, or settled on another network. No registry change needed.
- [ ] **Wire the name desk UI to `pay.ts`** — the module and its tests are in place; no view calls `quoteNameClaim()` yet, so a paid claim is still API-only.
- [x] ~~**x402 multi-chain signer selection.**~~ **Done 2026-09-18.** Replaced by the rail registry (`src/lib/x402/rails.ts`): one rail per CAIP-2 namespace, `selectRequirement()` asks the registry which offers are payable and `unpayableNetworks()` names the rest. Adding a chain is one `registerRail()` call. The EVM, Solana and Arweave slots are registrable and still empty — see [integration/toon-connector.md](./integration/toon-connector.md).
- [x] ~~**An EVM rail for x402.**~~ **Done 2026-09-18.** `src/lib/x402/rails/evm.ts` — EIP-3009 `transferWithAuthorization`, with the EIP-712 digest built and signed in Rust (`src-tauri/src/chain_evm/eip712.rs`, pinned against an `eth_account` vector). No generic `sign_hash` door: the digest is built from named fields of one struct. Per-rail payer resolution (`payersFromAccount()` / `resolvePayer()`) so an EVM offer is paid from the EVM address.
- [ ] **A Solana rail for x402** — the last empty slot with a real payee behind it. One `registerRail({ family: 'svm' })`.
- [ ] TOON connector module (`tier: 'agenticplace'`, `enabled: false`) — **blocked on upstream leaving testnet**; production is "a named, empty tier" (ADR 0056) with no mainnet contracts, still true on <https://toon.ar.io/> as of 2026-09-02. Snapshot + re-check: [reference/permaweb/toon-ar-io/](./reference/permaweb/toon-ar-io/README.md).
- [x] ~~**cp4096 commitment IV — kill float money** in the x402 path.~~ **Done 2026-08-30.** New `src/lib/money.ts` (exact `bigint` fixed-point, zero deps); `payment.ts` / `oracle.ts` / `discount.ts` converted; `PendingX402Payment` carries exact amounts with display strings beside them; `usdToAlgo` → `usdToAlgoForDisplay`. 28 new tests.
- [ ] **Audit the remaining value paths** for float arithmetic the same way: SpinTrade quoting/slippage, ASA amount handling, NFD/ArNS pricing, marketplace listing amounts.
- [x] ~~Pin `permaweb-deploy` exactly.~~ **Done** — `3.4.6`, was `^3.4.0`.
- [ ] **Wire `chain_algo`, `chain_evm`, `chain_ar`, `chain_sol` into `src-tauri/src/lib.rs`** — all four exist as source and none is declared or in `generate_handler!`, so every `chain_*` IPC call fails with an unknown command. Blocks the whole x402 signing path (both rails), not just x402. Wiring them does not compile: they are written against `bankon_vault::secure_mem` (on disk, undeclared in `bankon_vault/mod.rs`) and `VaultSession::{store_by_address, retrieve_by_address}` (absent; the committed session has `store_secret`/`retrieve_secret`). **The real task is landing the `bankon-vault/2` session seam** — read `docs/security/vault-family.md` first; the IPC surface is a public contract.
- [ ] **Implement `chain_btc_sign_psbt` for real** — `chain_btc/mod.rs:11` is still a derivation scaffold. Blocks the whole Bitcoin path.
- [ ] **Bitcoin provider seam** (`src/lib/bitcoin/providers/`) with a `local` implementation — Bitcoin must work in Parsec **alone**. Follows the `namespaces/registry.ts` and `marketplace/providers/` pattern.
- [ ] `bitcoin` module (tier `modules`) on the `local` provider, exercised on **regtest**: descriptor → receive → PSBT → sign → broadcast.
- [ ] `bankon-waas` **optional** provider + `btc-node` diagnostics module (tier `identity`), registering only when reachable. Parsec is compatible with BANKONBTCWaaS but **must never require it**; absent = `unknown`, never `deficient`.
- [ ] Add the WaaS origins (`127.0.0.1:8088`, `:8090`) to the CSP `connect-src` allowlist in `src-tauri/tauri.conf.json` when wiring the above.
- [x] ~~Ask whether WaaS `bankon-vault` and Parsec's `bankon_vault` are the same component.~~ **Answered: one shared component.** It is finding its way into several applications and **Parsec offers it as a service** — treat its 16 IPC commands as a public contract, additive changes only.
- [ ] **Confirm the naming network** for `pythai`, `bankon`, `deltaverse`, `spintrade` — ArNS (Solana authority) or Permaweb Names (Arweave authority)? The two tools have diverged; publishing with the wrong one updates nothing. Fact-finding, blocks the rest.
- [ ] If ArNS-on-Solana: adopt `ario-deploy` (devDependency only — `@ar.io/sdk` and `@solana/kit` are already present) and port `deploy:permaweb` / `deploy:resolver`, keeping the old scripts until one deploy is verified end to end.
- [ ] Move publishing to the `ario-deploy` **GitHub Action** with a controller key, owner cold — matching `spintrade/deploy.yml` and `deltaverse/deploy.yml`.
- [ ] Update `docs/PRODUCTION_DEPLOY.md` once the deploy path changes.

---

## Session: 2026-05-16 (Phase Q)

**Focus**: BNR spawn UI, AR.IO module parity (mirror of BANKON), named-NFT bindings (aORC stack), BANKON Marketspace (order book + auctions).

### Completed — BNR spawn UI (Phase A)

- [x] Build-time Lua bundle (`src/lib/bankon-names/lua-source.ts`) — concatenates the `bankon-names-process/` source via Vite `?raw` imports.
- [x] Runtime BNR process-id override (`src/lib/bankon-names/process-id.ts`) — localStorage-backed `getBnrProcessId` / `setBnrProcessId` so the in-wallet spawn can publish without rewriting source.
- [x] `bankon-admin` view (`src/views/bankon-admin.ts`) — two-mode (spawn / governance) plus a Marketspace tab that spawns the BMR through the same flow.
- [x] Inline "Spawn registry" CTA on `bankon-hub` when unconfigured.
- [x] Dashboard yellow callout on the BANKON row when setup is needed.
- [x] Governance message builders in `src/lib/bankon-names/client.ts`: `getBnrInfo`, `buildSetPolicyInput`, `buildSetTreasuryInput`, `buildAddControllerInput`, `buildRemoveControllerInput`, `buildSetReservedInput`, `buildClearReservedInput`.
- [x] CLI `scripts/spawn-bnr.mjs` kept as the maintainer fallback.

### Completed — AR.IO parity (Phase B)

- [x] AR.IO Registry helpers (`src/lib/arweave/ario.ts`): `getOwnedArnsRecords`, `getArnsName`, `getPrimaryArnsName`, `buildExtendArnsLeaseInput`, `buildPrimaryArnsRequestInput`, `buildIncreaseUndernameLimitInput`.
- [x] ANT helpers (`src/lib/arweave/ant.ts`): `getAntInfo`, `getAntRecords`, `setAntUndername`, `removeAntRecord`, `transferAntOwnership`, `setAntController`, `primaryNameAcknowledge`.
- [x] View `src/views/ario-hub.ts` — landing for AR.IO actions (balance + owned names + CTAs).
- [x] Generalized `src/views/ario-claim.ts` (with `ario-claim-pythai` as a thin forwarder for the previous-round dashboard CTA).
- [x] View `src/views/ario-name.ts` — full ArNS lifecycle: root @, undernames, extend, primary, transfer, controllers.
- [x] View `src/views/ario-transfer.ts` — ARIO token send.
- [x] View `src/views/ario-resolve.ts` — in-wallet ArNS resolver.
- [x] Dashboard wiring — AR.IO Names + Transfer ARIO buttons alongside the migration CTA.

### Completed — Named-NFT bindings (Phase C)

- [x] aORC TypeScript clients in `src/lib/aorc/`: `ids.ts` (testnet/mainnet IDs), `types.ts`, `minter.ts` (generic ARC-3/19/69), `type-minter.ts` (aNFT/dNFT/iNFT/THOT + CID uniqueness check), `index.ts`.
- [x] View `src/views/name-mint.ts` — unified mint flow for BANKON and ArNS names; uploads a binding proof to Arweave and writes a Set-Record on the name's owning process.
- [x] Spec doc `docs/named-nft-binding.md`.
- [x] Bind-an-NFT section added to both `bankon-name.ts` and `ario-name.ts`.

### Completed — Marketspace (Phase D)

- [x] BMR Lua contract `marketplace-process/` — state.lua + handlers/{governance,list,cancel,offer,auction,escrow,fees,settle}.lua + main.lua.
- [x] Token-agnostic settle.lua with v1 signed Payment-Proof attestation (mirror of BNR's claim model).
- [x] Spawn script `scripts/spawn-bmr.mjs` (CLI) + in-wallet spawn flow via `bankon-admin` Marketspace tab.
- [x] BMR TS client (`src/lib/marketplace/`): `process-id.ts`, `lua-source.ts`, `client.ts` (read+write helpers), `escrow.ts` (composite name→BMR transfer), `index.ts`.
- [x] Views `src/views/market-{hub,listing,create,auction}.ts` — full marketspace surface (fixed-price + auctions + escrow).
- [x] Per-name "List for sale" section + Marketspace dashboard button.
- [x] Branded **Marketspace** (per user direction); web mirror linked from the hub: `agenticplace.pythai.net/marketspace`.

### Verification

- [x] `npx tsc --noEmit` clean.
- [x] `npx vitest run` 101/101 pass.
- [x] `npm run build` succeeds; new chunks: `bankon-admin` (86.4 kB; bundles both BNR + BMR Lua sources), `name-mint` (12.5 kB), 4× market views, 5× ario views (`ario-hub`, `ario-claim`, `ario-name`, `ario-transfer`, `ario-resolve`).

### Pending — operator setup

- [ ] Spawn the BNR (from inside the wallet: Dashboard → BANKON Names → "Spawn registry").
- [ ] Spawn the BMR (from inside the wallet: bankon-admin → Marketspace tab → "Spawn BMR").
- [ ] Verify a name claim → bind manifest tx-id → list for sale → match a test buy → confirm Settle-Trade.
- [ ] Publish the public Marketspace web mirror at `agenticplace.pythai.net/marketspace` (server side; out of scope here).

---

## Session: 2026-05-15 / 2026-05-16

**Focus**: Arweave/AO foundation, permaweb deploy infra, ARIO Solana migration handler, pythai ArNS claim, sovereign **BANKON Names** namespace.

### Completed — Arweave/AO foundation

- [x] ANS-104 DataItem signing (`src/lib/arweave/ans104.ts`): encode/decode + sign/verify, Avro tag encoding, deep-hash sig data, vault-bridged `signDataItemFromVault`
- [x] AO transport (`src/lib/arweave/ao.ts`): `aoMessage` / `aoResult` / `aoDryRun` / `aoSpawn` + standard tag scaffolds; CU = `cu.ardrive.io`
- [x] Vault-bridged Arweave signer (`src/lib/arweave/signer.ts`): JWK held in a closure per session, RSA-PSS sign / verify / dispatch, dispose on disconnect
- [x] `window.arweaveWallet` injected API (`src/lib/arweave/inject.ts`): ArConnect/Wander parity (connect, sign, signDataItem, dispatch, signMessage, encrypt-decrypt stubs); per-origin permission persistence
- [x] dApp approval flow: new view `views/arweave-approve.ts` mirrors the connect-approve pattern
- [x] WalletAccount multi-chain map: `chains: Record<ChainId, string>` on every account; helpers `getAccountAddress` / `setAccountAddress` in `lib/store.ts`
- [x] 101/101 vitest pass after foundation; web build excludes static Tauri imports

### Completed — Permaweb deploy

- [x] Platform shim (`src/lib/platform.ts`): `isTauri` constant + dynamic `invoke` / `listen`. Migrated 13 callers (vault.ts, connect.ts, mesh.ts, validate.ts, throttle.ts, search.ts, sandbox.ts, tomb.ts, pmvpn/auth.ts, pmvpn/connector.ts, bitcoin/account.ts, litecoin/account.ts, views/mausoleum.ts)
- [x] `permaweb-deploy@^3.4.0` devDep + scripts: `deploy:permaweb` (binds to `pythai`), `deploy:permaweb:txid` (initial deploy without ArNS binding)
- [x] `npm run build` produces a Tauri-free web bundle; only runtime-guarded dynamic loads of `@tauri-apps/api`

### Completed — Solana migration handler

- [x] Solana chain module (`src/lib/solana/`): SLIP-0010 ed25519 derivation (path `m/44'/501'/0'/0'`), base58 address, ed25519 sign via `@noble/curves`
- [x] Registered in `lib/pouch/chains.ts`
- [x] View `views/solana-create.ts`: 24-word create flow, stores to vault, updates `account.chains.solana`
- [x] View `views/ario-migrate-solana.ts`: reads BASE ARIO balance via MetaMask `eth_call balanceOf` on `0x138746adfa52909e5920def027f5a8dc1c7effb6`, surfaces Solana destination, hands off to `sol.ar.io`. Snapshot countdown to **June 1, 2026**.

### Completed — pythai ArNS claim

- [x] AR.IO Registry client (`src/lib/arweave/ario.ts`): `getArioBalance`, `getArnsRecord`, `getReservedName`, `getTokenCost`, `buildBuyNameInput`, `buildTransferArioInput`, `formatArio` / `parseArio`. Mainnet process = `qNvAoz0Tg...`.
- [x] ANT helpers (`src/lib/arweave/ant.ts`): `getLatestAntModuleId`, `spawnAnt` (with confirmation polling), `setAntRootRecord`
- [x] View `views/arweave-create.ts`: RSA-4096 in background, stores JWK in vault, 24-word cold backup
- [x] View `views/ario-claim-pythai.ts`: preflight → confirm → spawn ANT → Buy-Name → bind manifest tx-id. Live cost preview (1-yr lease = 8,242.02 ARIO verified 2026-05-15)

### Completed — BANKON Names (sovereign namespace)

- [x] BNR Lua contract source (`bankon-names-process/`): state schema + 7 handler modules
  - `claim.lua`: Buy-Name with token-agnostic `Payment-Method` + `Payment-Proof` tag pair (free / algorand / arweave-stake / bankon)
  - `transfer.lua`: owner-only Transfer
  - `records.lua`: Set-Record / Get-Record / Record / Resolve / Paginated-Records / Get-Owned-Records / Reserved-Name
  - `lease.lua`: Extend-Lease (permabuy preserved)
  - `primary.lua`: two-step Primary-Name-Request + Acknowledge + Get-Primary-Name
  - `cost.lua`: Token-Cost / Cost-Details, configurable cost table per (intent, method, purchase-type)
  - `governance.lua`: Set-Policy / Set-Treasury / Add-Controller / Remove-Controller (controller-only)
  - `admin.lua`: bootstrap reserved names (bankon, parsec, pythai, cypherpunk, ar, ao, …), Set-Reserved / Clear-Reserved
  - `Info` diagnostic handler in `main.lua` for client sanity-checks
- [x] One-time spawn script `scripts/spawn-bnr.mjs`: bundles Lua, signs Spawn DataItem from `DEPLOY_KEY`, polls confirmation, writes `BNR_PROCESS_ID` to `src/lib/bankon-names/process-id.ts`. Idempotent with `--force` override.
- [x] Parsec client (`src/lib/bankon-names/`): `process-id.ts` + `isBnrConfigured()` guard, `payment.ts` (discriminated-union PaymentProof + tag mapping), `client.ts` (read+write helpers mirroring `ario.ts`)
- [x] Views: `bankon-hub.ts` (identity + owned-names + actions), `bankon-claim.ts` (search → configure → execute, single signed DataItem), `bankon-name.ts` (root @ + undernames + extend + primary + transfer), `bankon-resolve.ts` (in-wallet resolver)
- [x] Public permaweb resolver SPA (`apps/bankon-resolver/`): standalone Vite project, 3.70 kB JS, reads name from `?name=` / `#hash` / pathname, dry-runs `Resolve` on the BNR via `cu.ardrive.io`, redirects to `https://<txid>.arweave.net`
- [x] Build/deploy scripts: `build:resolver`, `deploy:resolver`
- [x] Dashboard wiring: `BANKON Names` + `Resolve` row alongside the AR.IO row, conditional on having an Arweave address

### Completed — Snapshot investigation

- [x] `docs/snapshot-investigation.md`: June 1 date confirmed firm; Solana mint authority + reclaim-window length **not publicly disclosed** (flagged as medium risk); BASE bridge `0x138746...effb6` + relayer EOA `0x79B5B6F47F865194EAa02756883a003f06F7Ba6c` documented; risk table + pre-snapshot user action sequence captured

### Verification

- [x] `tsc --noEmit` clean across all rounds
- [x] `vitest run` 101/101 pass (added `ans104.test.ts` roundtrip in round 1)
- [x] `npm run build` succeeds; web bundle drops all static Tauri imports; new lazy chunks: `bankon-hub` `bankon-claim` `bankon-name` `bankon-resolve` `ario-claim-pythai` `ario-migrate-solana` `solana-create` `arweave-create` `arweave-approve` `arweave-ario-migrate`
- [x] `npm run build:resolver` produces a dependency-free 3.70 kB SPA at `apps/bankon-resolver/dist/`

### Pending — pre-June 1 user action

- [ ] Run `scripts/spawn-bnr.mjs` once (mainnet) to instantiate the BNR; record the process id
- [ ] Bridge a small test amount (e.g. 100 ARIO) BASE → AO to validate the relayer responds; then bridge ~10k for the pythai claim if proceeding via AO route
- [ ] Claim `pythai` via `views/ario-claim-pythai.ts`; bind to deployment manifest tx-id
- [ ] Deploy Parsec to Arweave via `npm run deploy:permaweb:txid` first, then re-deploy via `npm run deploy:permaweb` once pythai's ANT is owned
- [ ] Complete sol.ar.io registration for the 99,600 ARIO BASE holding (deadline: June 1, 2026)
- [ ] Deploy the BANKON Names resolver SPA via `npm run deploy:resolver`

---

## Session: 2026-03-28 / 2026-03-29

**Focus**: Multi-chain builder, Mausoleum vault manager, contract deployment pipeline, BONA FIDE

### Completed

- [x] Multi-chain transaction builder: 8 chain families (Algorand, EVM, UTXO, CryptoNote, Zilliqa, Cardano, Arweave)
- [x] Chain registry: 2500+ EVM chain discovery from allchain API + chainid.network CDN
- [x] Isolation layer: cryptographic boundary enforcement per chain family
- [x] MetaMask/WalletConnect external signer sandboxing (EIP-1193)
- [x] Vault signing: @noble/curves (EVM secp256k1), WebCrypto (Arweave RSA-4096)
- [x] Pouch chain modules: Zilliqa (Schnorr), Cardano (Ed25519-BIP32), Arweave (RSA-PSS), Litecoin, Monero added
- [x] Admin key ceremony: 6-phase airgapped generation with 5-probe network isolation
- [x] Mausoleum: Tomb vault manager + cipher threshold dashboard + WebGL 3D crypto horizon
- [x] PROOF.md: formal attestation (5 theorems, 10 cipher proofs, Landauer/Bremermann limits, quantum agnostic position)
- [x] aORC contracts compiled (puya-ts 1.1.0): Minter (563 TEAL), Registry (1331), BONA FIDE (1008), TypeMinter (1613)
- [x] Testnet deployment verified: Minter 757891101, Registry 757891112, BONA FIDE 757895044, TypeMinter 757895349
- [x] deployer.html: tabbed deployment center (contracts, ASA creator, ABI explorer, settings)
- [x] deployer.php: ARC-56 ABI server, deployment records, ASA presets
- [x] deploy.html: TEAL embedded + algod.compile() step + 7-step flow with BONA FIDE
- [x] agents.html: fixed localStorage key mismatch (aORC_appId → aORC_registryAppId)
- [x] BONA FIDE controller: clawback-controlled reputation token (issue/revoke/batch)
- [x] TypeMinter: type-aware minting (aNFT/dNFT/iNFT/THOT) with per-type on-chain logic + THOT CID uniqueness
- [x] register.html + minter.html: BONA FIDE awareness wired
- [x] testnet-skills.md: reusable skills doc for faucet, compile, deploy, verify patterns

---

## Session: 2026-03-25

**Focus**: Matrix overhaul, x402 integration, tabbed diagnostics, algodeployer tokenomics

### Completed

- [x] Matrix rain: Shadertoy glyph atlas textures (256x256 POT, katakana)
- [x] Glitch spin: 360 rotation + chromatic aberration + scanline tear (intro + transitions)
- [x] Pyramid: brick steps, apex = #1 gainer, gainers right, losers left, icons
- [x] Top 10 column: left side, icons, abbreviated mcap ($1.34T, $460.2B)
- [x] Featured assets: VITE_JUST_BECAUSE env var (POL,ALGO,ETH,BEAM,ZIL), right side zigzag
- [x] Drag-and-drop: brand, pills, ship, top 10, fleet
- [x] PARSEC click: full-screen pill choice over pure rain
- [x] Blue pill: 6 tabbed diagnostics (Global, Gas, Chains, Network, DeFi, Portfolio)
- [x] Blue pill: auto-refresh 20s, Tab key cycles, two-column grid, compact layout
- [x] Blue pill: slow rain, red glyphs, hides market overlays
- [x] Red pill: login + create + import, natural market glyph colors
- [x] x402 module: types, constants, oracle, discount, bridge, payment, client (8 files)
- [x] New views: x402-confirm, agents, identity
- [x] Pouch: Algorand signing wired, Ethereum enabled
- [x] docs.html: 37 docs with hash routing
- [x] algodeployer: ShambaLuv LUV9, BONA FIDE, fee redemption, liquidity locker, fee controller, aLUV, bridge
- [x] algodeployer/interchain: PhiFeeCalculator, GasStation, InterchainWeaver, InterchainRegistry, InterchainDeployer + tests
- [x] algodeployer docs: EXPLANATION, USAGE, BONAFIDE, SHAMBALUV, LIQUIDITY-LOCKER, FEE-CONTROLLER, BRIDGE
- [x] interchain docs: INTERCHAIN, EXPLANATION, TECHNICAL, USAGE, DEPLOYMENT

---

## Active Tasks

### Matrix / Frontend

| Priority | Task | Status |
|----------|------|--------|
| Next | Multi-hop swap routing (ASA-ALGO-ASA) | Planned |
| Next | Swap history tracking | Planned |
| Next | Custom slippage setting | Planned |
| Next | Frontend permission slider UI for parsec_sandbox | Planned |
| Next | dApp connection interface (WalletConnect v2) | Complete (builder/walletconnect.ts) |
| Future | Rekeying support | Planned |
| Future | Multisig account creation | Planned |
| Future | ARC-19/ARC-3 NFT display | Planned |
| Future | Transaction history export (CSV) | Planned |
| Future | QR code receive (algorand:// URI) | Planned |

### x402 / AgenticPlace

| Priority | Task | Status |
|----------|------|--------|
| Next | Wire viem for Ethereum signing in pouch | Planned |
| Next | End-to-end x402 payment test (Parsec -> MindX -> Facilitator) | Planned |
| Next | BANKON holder discount live verification | Planned |
| Future | Reputation feedback after x402 payments (ReputationRegistryClient) | Planned |
| Future | Venalicarii/Mercatores marketplace in wallet | Planned |

### AlgoDeployer

| Priority | Task | Status |
|----------|------|--------|
| Next | Foundry tests: `forge test` on interchain contracts | Planned |
| Next | Deploy to Anvil local chain | Planned |
| Next | Deploy to Base Sepolia (first livenet) | Planned |
| Next | BONA FIDE ASA creation on Algorand testnet | Complete (testnet App 757895044) |
| Future | PuyaTs contract compilation via Puya compiler | Complete (puya-ts 1.1.0, 4 contracts) |
| Future | aLUV ARC-200 deployment on Algorand localnet | Planned |
| Future | SHAMBA LUV redeployment on Polygon (LUV9 with name fix) | Planned |

### Infrastructure

| Priority | Task | Status |
|----------|------|--------|
| Next | parsec_search: embedding generation pipeline | Planned |
| Next | parsec_mesh: IPFS DHT peer discovery | Planned |
| Next | parsec_throttle: persistent metrics to PostgreSQL | Planned |
| Next | parsec_sandbox: persist permissions to PostgreSQL | Planned |
| Future | Sovereign sync (Earthstar offline-first) | Planned |
| Future | Hypercore append-only log for wallet journaling | Planned |
| Future | Tomb FIDO2 passkey support | Planned |
| Future | Hardware wallet integration (Ledger, Trezor) | Planned |

### Multi-Chain (Phase H)

| Priority | Task | Status |
|----------|------|--------|
| Next | Bitcoin chain pack (UTXO, Bech32) | Planned |
| Next | Ethereum chain pack (viem signing) | In Progress |
| Next | Litecoin, Monero chain packs (signing stubs, builder paths) | Complete (types + stubs) |
| Next | Zilliqa, Cardano, Arweave chain packs | Complete (types + stubs, Arweave vault signing live) |
| Future | Solana chain pack | Planned |
| Future | Atomic-style key pair display | Planned |
| Future | USB cold storage for multi-chain keys | Planned |

---

## Progress

| Phase | Status | Completion |
|-------|--------|------------|
| A: Core wallet | Complete | 100% |
| B: Matrix + DEX | Complete | 100% |
| B2: Matrix overhaul | Complete | 100% |
| B3: x402 integration | Complete | 100% |
| B4: Documentation | Complete | 100% |
| C: Input validation | Complete | 95% (Rust validator pending) |
| D: SpinTrade DEX | Functional | 80% (multi-hop, history pending) |
| E: Wallet interop | WalletConnect + ParsecConnect | 60% |
| F: Advanced Algorand | Not started | 0% |
| G: Extensions | Not started | 0% |
| H: Multi-chain | Builder + 8 families | 65% (builder, registry, isolation, 7 chain modules) |
| I: Infrastructure | Modules built | 70% (persistence pending) |

---

## Accomplishments

### Matrix Entry Gate
- WebGL shader rain with market-driven speed/color/sentiment
- Katakana glyph atlas from Shadertoy textures
- Glitch spin with chromatic aberration on transitions
- Brick pyramid with daily gainers/losers
- 6-tab diagnostics (Tank view): live gas, TVL, blocks, sentiment
- All UI elements draggable

### x402 / AgenticPlace
- 8-file x402 module: vault-secured signing, payment flow, oracle, discount
- 3 new views: payment confirm, agent discovery (70K+), BANKON identity
- Zero new npm dependencies (algosdk + native APIs only)

### Multi-Chain Builder + Isolation
- 8 chain families: Algorand, EVM, UTXO, CryptoNote, Zilliqa, Cardano, Arweave
- 2500+ EVM chain discovery (allchain API + chainid.network CDN)
- Cryptographic isolation: keys never cross family boundaries
- External signer sandboxing: MetaMask (EIP-1193), WalletConnect (multi-chain)
- Arweave vault signing live via WebCrypto RSA-PSS (zero deps)

### Mausoleum (bankon-vault visual manager)
- Tomb lifecycle: create/open/close/slam, USB key detection
- Cipher threshold dashboard: 10 ciphers, classical + quantum + collision ratings
- WebGL 3D crypto horizon: security surface over time × compute × probability
- Admin key ceremony: 6-phase airgapped generation, 5-probe network isolation

### aORC Contract Suite (agenticplace.pythai.net)
- 4 contracts compiled (puya-ts 1.1.0), all testnet-verified:
  - AgenticMinter (563 TEAL) — generic NFT minting
  - AgenticRegistry (1331 TEAL) — blockchain verification registry with box storage
  - BonaFideController (1008 TEAL) — clawback-controlled reputation token
  - TypeMinter (1613 TEAL) — type-aware minting (aNFT/dNFT/iNFT/THOT) with CID uniqueness
- deployer.html: tabbed deployment center with ABI explorer
- deployer.php: ARC-56 API, deployment records, ASA presets
- PROOF.md: formal encryption attestation (5 theorems, Bremermann limit, quantum agnostic)

### AlgoDeployer Tokenomics
- ShambaLuv LUV9: 100Q supply, 5% reflection, all 5 bugs fixed
- BONA FIDE: 1T ASA, binary reputation, penalty doubling, ghost vote
- Interchain Weave Protocol: golden ratio fee (phi), 14+ chain deployment
- 14 docs across algodeployer + interchain
