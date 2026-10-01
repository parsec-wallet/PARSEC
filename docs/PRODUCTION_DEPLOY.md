# Production Deployment Checklist

## Running the UI locally

| Goal | Command | URL / artifact |
|---|---|---|
| Browser dev (fastest iteration) | `npm run dev` | http://localhost:1420 |
| Tauri desktop dev (full IPC) | `npm run tauri:dev` | native window |
| Production build (web) | `npm run build` | `dist/` |
| Production build (desktop) | `npm run tauri:build` | platform installer in `src-tauri/target/release/bundle/` |
| Publish to Arweave (arns://pythai) | `npm run deploy:permaweb` | requires `DEPLOY_KEY` env var |

First-run: `npm install` once. The wallet runs against testnet by default;
switch via Settings → Network. Hot-module reload covers everything in
`src/**`; touching `src-tauri/**` requires a `tauri:dev` restart.

---

End-to-end checklist for wiring PARSEC Wallet to production contracts.
Every contract id can be supplied through one of three layers — pick the
one that matches the operational context:

| Layer | When to use | How |
|---|---|---|
| **localStorage** | In-wallet spawn flow, per-device override | `setBnrProcessId(...)`, `setBmrProcessId(...)` via the admin UI |
| **Vite env var** | Production build deployed to many devices | Set in `.env.production`, baked into the bundle |
| **Source constant** | Long-term canonical value committed to the repo | Edit `src/lib/.../process-id.ts` and `src/lib/aorc/ids.ts` |

Priority resolves top→bottom: localStorage beats env beats source constant.

---

## Contracts inventory

| Contract | Type | Deploy script | Where the id lands |
|---|---|---|---|
| **BNR** — BANKON Names Registry | AO Lua process | `npm run spawn:bnr` | `src/lib/bankon-names/process-id.ts` |
| **BMR** — BANKON Marketspace Registry | AO Lua process | `npm run spawn:bmr` | `src/lib/marketplace/process-id.ts` |
| **aORC Minter** | Algorand smart contract | (external — algokit deploy) | `src/lib/aorc/ids.ts` `MAINNET_BAKED.minter` |
| **aORC Registry** | Algorand smart contract | (external — algokit deploy) | `src/lib/aorc/ids.ts` `MAINNET_BAKED.registry` |
| **aORC BonaFide** | Algorand smart contract | (external — algokit deploy) | `src/lib/aorc/ids.ts` `MAINNET_BAKED.bonaFide` |
| **aORC TypeMinter** | Algorand smart contract | (external — algokit deploy) | `src/lib/aorc/ids.ts` `MAINNET_BAKED.typeMinter` |

Testnet aORC ids are committed (Minter 757891101, Registry 757891112,
BonaFide 757895044, TypeMinter 757895349) and verified live on AlgoNode.

---

## Deploy order

BMR depends on BNR (it emits BNR Transfer messages on settle). Deploy in
this order:

1. **aORC stack** (mainnet) — external algokit deploy. Capture all four ids.
2. **BNR** — `DEPLOY_KEY=$(base64 -w0 maintainer-jwk.json) INITIAL_CONTROLLER=<arweave-addr> TREASURY_ARWEAVE=<arweave-addr> npm run spawn:bnr`
3. **BMR** — `DEPLOY_KEY=… INITIAL_CONTROLLER=… TREASURY=… BNR_PROCESS_ID=<from step 2> npm run spawn:bmr`
4. **Bake the ids** into `src/lib/aorc/ids.ts` and `process-id.ts` (the spawn
   scripts patch the AO ids surgically; aORC ids are edited by hand).
5. **Commit + tag** `v1.0.0-mainnet` so the binary can be reproduced.
6. **`npm run deploy:permaweb`** to publish the wallet at `arns://pythai`.

---

## Vite env file (`.env.production`)

```
VITE_BNR_PROCESS_ID=<43-char base64url>
VITE_BMR_PROCESS_ID=<43-char base64url>
VITE_AORC_MAINNET_MINTER=<uint64>
VITE_AORC_MAINNET_REGISTRY=<uint64>
VITE_AORC_MAINNET_BONAFIDE=<uint64>
VITE_AORC_MAINNET_TYPEMINTER=<uint64>
```

Build with `npm run build` — the constants are inlined at bundle time.
This is the cleanest production path: no source edits, env file lives in
the secrets vault, contract ids are reproducible from the env.

---

## Post-deploy verification

After spawning, send an `Info` message to each AO process and confirm the
response shape:

```bash
# BNR
ao.send(BNR_PROCESS_ID, { Action: 'Info' })
# expect: { name, version, recordCount, controllers, policy, treasury }

# BMR
ao.send(BMR_PROCESS_ID, { Action: 'Info' })
# expect: { name, version, listingCount, offerCount, controllers, treasury, policy }
```

In the wallet:
1. Open Settings → Network → switch to mainnet.
2. Dashboard renders the **Marketspace** tile with `intent=primary` (not warning).
3. `Dashboard → BANKON Names → name-hub` resolves a known reserved name.
4. `name-manage → Mint + bind an NFT` reaches `name-mint` and the aORC
   type-mint selector is enabled (not gated on `typeMinterAvailable`).
5. `Dashboard → AR.IO Names → ARIO → Solana` migrates without error.

---

## Rollback plan

- Per-device: clear localStorage keys `parsec:bnr-process-id`,
  `parsec:bmr-process-id`. Wallet falls back to the env/source layer.
- Build-wide: rebuild from the previous tag without the new `.env.production`.
- Contract-side: AO processes are append-only; rollback means publishing a
  new process and updating the id. Coordinate with the admin key holder.
