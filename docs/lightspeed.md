# Lightspeed — reactive chain reads, and the module template

> **What it is.** A stream of chain readings over a provider the participant
> chooses, with zero dependencies. **What it is for.** Two things: watching an
> EVM head block, sync state and balances live inside PARSEC, and being the
> file set you copy when you add a module — because it exercises every seam
> in [`modules.md`](./modules.md) and declares its *choices* honestly.

Source: `src/lib/lightspeed/`, view `src/views/lightspeed.ts`.
Prototype and skill: <https://github.com/parsec-wallet/lightspeed> (pure Node `.mjs`).

## Lineage

`parsec-wallet/lightspeed` began as a note: *"lightspeed using light.js —
DeltaVerse at the speed of light"*, pointing at `@parity/light.js`, Parity's
reactive library for light clients. That library is unmaintained and needs
rxjs. Per the ingestion guide, the good idea was reimplemented, not imported.

The idea, from the eight light.js pages, and what PARSEC did with each:

| light.js | What it taught | Lightspeed |
|---|---|---|
| Installation | `light.setProvider(p)` before anything else; Ws / injected / INFURA providers | `setProviderChoice()`; local default or a JSON-RPC URL the participant names |
| Full node? | Light client and remote full node share one API; only where the answer comes from differs | `LightspeedProvider` seam; every reading states its origin and reach |
| T1 set up a light client | `parity --light --ws-origins all` | No Parity. The local provider works with nothing and says `unknown` |
| T2 first RpcObservable | `blockNumber$().subscribe(...)` fires on every new block; `balanceOf$` returns BigNumber | `blockNumber$`, `chainId$`, `balanceOf$` (bigint), `syncStatus$` — `poll()` while subscribed |
| T3 manipulating | rxjs `map` / `filter` / `switchMap` over streams | `mapReading()`; no rxjs, subscribe/unsubscribe only |
| T4 send a transaction | `post$` emits `estimating → estimated → signed → sent → confirmed / failed` | **Not implemented.** `post$()` throws a `PrivilegeError`: the module declared `observe` |
| T5 contracts | `makeContract(address, abi)` → `method$()` reads and `post$` writes | `makeContract(address, { name: { encode, decode } })` → `name$()` reads; `erc20()` example |
| T6 React HOC | `light({ prop: obs })(Component)` subscribes for you | The view subscribes and `onCleanup()`s; the dashboard tile does the same |

## Choices — what a module elects

`ParsecModule.choices` (`src/lib/module-choices.ts`) makes a module state, once
and up front, the most it will ever ask of the wallet. Views print the four
lines in place. A module that reaches past its declaration throws a
`PrivilegeError` naming the module, what it declared and what it tried.

| Choice | Values | Lightspeed |
|---|---|---|
| `privilege` | `observe` < `sign` < `vault` < `system` | `observe` |
| `reach` | `internal` · `external` (from `ui/provenance.ts`) | `external` — may leave the device when a JSON-RPC node is chosen |
| `persistence` | `none` · `device` · `vault` | `device` — the provider preference, never a secret |
| `provider` | `none` · `local` · `optional-external` | `optional-external` — local default, unknown when absent |

The ladder:

- **observe** — reads public state. Never sees a key, never asks for a signature.
- **sign** — may request a signature from the PARSEC Keycore over the active account. Still never sees a key.
- **vault** — may create or import entries through `bankon_vault`.
- **system** — may call OS-privileged commands. Diagnostics' MAC spoof is the precedent.

Defaults when a module declares nothing are the cautious side: `observe`, and
`external` reach, for the same reason `provenanceLine()` assumes external —
believing a reading stayed local when it did not is the mistake that costs.

**This is an honesty contract, not a security boundary.** The frontend
classifies and suggests; `src-tauri/src/parsec_validate/` and the PARSEC Keycore's signers
decide. A module lying about its choices gains nothing from Rust.

## Files

```
src/lib/module-choices.ts         the four choices, the ladder, assertPrivilege — no imports beyond a type
src/lib/modules.ts                ParsecModule.choices, choicesOf(), assertModulePrivilege()
src/lib/lightspeed/
├── observable.ts                 poll() / readOnce() / mapReading() — Reading = value · status · provenance
├── types.ts                      LightspeedProvider: blockNumber, chainId, balanceOf, syncStatus, call — null = not here
├── providers/local.ts            the default; no network; answers null
├── providers/json-rpc.ts         plain fetch; host stated as origin; external reach
├── registry.ts                   provider choice, persisted per device (parsec:lightspeed-provider / -rpc-url)
├── feeds.ts                      blockNumber$ chainId$ balanceOf$ syncStatus$ makeContract erc20 post$
├── choices.ts                    LIGHTSPEED_ID + LIGHTSPEED_CHOICES
├── dashboard-module.ts           head-block tile; hidden while the provider is local
├── module.ts                     registerModule({...}) — THE TEMPLATE FILE
├── index.ts                      barrel
└── __tests__/                    observable, feeds, provider, privilege boundary
src/views/lightspeed.ts           declaration · provider · readings, torn down via lib/lifecycle
```

The reading rules, everywhere: `read()` resolves `null` → `unknown`, source
`unavailable`; a value → `ok`, `live`; a throw → `deficient` with the message.
A failure never looks like an absence.

## Provider notes

- The desktop build enforces a CSP `connect-src` allowlist in
  `src-tauri/tauri.conf.json`. A JSON-RPC endpoint outside it fails at the
  network layer and renders as `deficient` with the browser's message. Add
  the host there if it should be reachable.
- The endpoint learns which addresses you ask about. The view says so next
  to the URL, and every provenance line says `external service`.
- `ws://` is refused: PARSEC's providers are plain `fetch`.

## Using Lightspeed as the template

1. `cp -r src/lib/lightspeed src/lib/<yours>`; delete `feeds.ts`, `types.ts`,
   `providers/` if your module has no external reads.
2. `choices.ts` — set the id and state the four choices honestly. Raise
   `privilege` only to what the module will actually do.
3. `module.ts` — tier, priority, routes, keywords a person would type.
   `load` points at your view. Keep this file's import cost tiny: it runs
   from `main.ts` on the first-paint path.
4. Your view: print `describeChoices(...)` under the title; every subscription
   or `window` listener goes through `lib/lifecycle`.
5. Add `'<yours>'` to `AppView` in `src/types/wallet.ts` — the one edit the
   manifest does not yet remove (tracked in `modules.md`).
6. `import './lib/<yours>/module';` in `src/main.ts`.
7. A doc under `docs/` and a line in `docs/README.md`.

If the module signs: declare `sign`, call `assertModulePrivilege(id, 'sign')`
at the top of the signing path, and route the signature through the Rust
`*_sign_*` command for the chain. Keys never enter JavaScript.

## Verification

```bash
npx tsc --noEmit
npx vitest run src/lib/lightspeed src/lib/__tests__/module-choices.test.ts
npm run build          # the web bundle stays Tauri-free; lightspeed adds no chain lib to first paint
```

Then open **Lightspeed** in the rail at the *Professional* disclosure level,
leave the provider on Local and confirm every row says `unknown · this device`;
point it at a JSON-RPC node and watch the head block move.
