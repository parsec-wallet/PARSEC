# Parsec Modules — the expansion contract

> **The rule:** adding a chain, a name registry, or a dApp surface should be
> **one module registration and one doc**. If it takes four file edits in four
> places, the contract has been bypassed — fix the contract, not the symptom.

## Why this exists

Parsec grew to 64 views. Every one of them had to be threaded through four
separate places by hand:

| What | Where |
|---|---|
| the route name | the `AppView` union in `src/types/wallet.ts` — *still required today; the manifest casts, the store's `navigate()` does not* |
| the view factory | a `registerView` line in `src/main.ts` |
| the chain display | a `ChainDescriptor` in `src/lib/chains.ts` |
| the dashboard row | a tile import in `src/lib/dashboard/index.ts` |

Four edits, four chances to forget one, and no single place that describes what
a feature *is*. `src/lib/modules.ts` collapses them into one declaration.

## The four tiers

Navigation mirrors the product architecture (`PARSEC.png`), so the UI teaches
the system instead of listing screens alphabetically. Every module declares
which tier it belongs to.

```
 [Bitcoin] [Ethereum] [Algorand] [Arweave] [Solana]   ← tier: 'modules'
          └───────────────┼───────────────┘
                    ↓  WALLET POUCH                    ← tier: 'pouch'
        multi-chain collection · private compartments
        public addresses · encrypted backups
                    ↓  VAULT IDENTITY                  ← tier: 'identity'
        selective disclosure · intent signatures · cross-chain proofs
                    ↓  AGENTICPLACE                    ← tier: 'agenticplace'
        agents · x402 · dApp signing · names · marketspace
```

| Tier | Code that already implements it |
|---|---|
| `modules` | `src/lib/pouch/types.ts` `WalletModule` + the registry in `pouch/chains.ts` |
| `pouch` | `src/lib/pouch/` — the multi-chain collection itself |
| `identity` | `bankon_vault` (Rust) + `views/identity.ts`, `views/mausoleum.ts` |
| `agenticplace` | `views/agents.ts`, `src/lib/x402/`, `parsec_connect`, Marketspace |

The **Linkage Map** (`src/views/linkage.ts`) renders these tiers live: every
node reports real state, every connector lights only when the tier above it is
actually carrying something. It is the architecture diagram and the diagnostics
in one screen.

## The contract

```ts
import { registerModule } from '../lib/modules';

registerModule({
  id: 'litecoin',
  tier: 'modules',
  priority: 40,
  enabled: true,

  routes: [
    {
      id: 'litecoin-create',
      title: 'Create Litecoin',
      load: async () => (await import('../views/litecoin-create')).litecoinCreateView,
      disclosure: 'more',        // simple | more | pro
      inRail: true,
      keywords: ['ltc', 'bip-39', 'segwit'],
    },
  ],

  // Old route ids that should resolve to a current one. Replaces the
  // back-compat forwarder VIEWS with one-line map entries.
  aliases: { 'ltc-create': 'litecoin-create' },

  // Optional. Uses the existing DashboardModule interface unchanged.
  dashboard: litecoinDashboardModule,

  // What the module elects — the most it will ever ask of the wallet.
  // Omitted = observe-only, assumed external. See "Choices" below.
  choices: { privilege: 'sign', reach: 'external', persistence: 'vault', provider: 'none' },
});
```

`registerModule()` performs all three registrations — router, navigation,
dashboard — and wraps every loader in the synchronous-placeholder dance
`src/lib/router.ts` requires, so a module author never writes that by hand.

### Field notes

- **`disclosure`** is the honest answer to 64 views. A newcomer sees six
  routes, an operator twenty, an auditor all of them. Persisted per device.
  Default `'more'` — opt into `'simple'` deliberately.
- **`modal: true`** marks an approval surface (signing, confirmation). Modal
  routes are kept off the back stack and out of the command palette, so a back
  gesture can never silently cancel a signing decision.
- **`inRail`** lists the route in the left rail. Detail routes stay reachable
  (palette, direct navigation) but unlisted.
- **`keywords`** feed the Ctrl/Cmd-K palette. Write what a person would
  actually type, not synonyms of the title — the palette names which keyword
  matched, so a vague one looks like a bug.
- **`enabled: false`** registers nothing at all. Prefer it over shipping a
  route that throws.

### Choices — privilege, reach, persistence, provider

`choices` (`src/lib/module-choices.ts`) is the module's declaration, printed in
place by its view via `describeChoices()`:

| Choice | Values | Meaning |
|---|---|---|
| `privilege` | `observe` < `sign` < `vault` < `system` | the most the module asks of the wallet |
| `reach` | `internal` · `external` | whether a reading leaves the device |
| `persistence` | `none` · `device` · `vault` | what it keeps between sessions |
| `provider` | `none` · `local` · `optional-external` | dependence on anything outside Parsec |

`assertModulePrivilege(id, needed)` throws a `PrivilegeError` when a module
reaches past its rung — a loud failure in place of a silent escalation. It is
an honesty contract for the UI, not a security boundary: Rust still decides.
**Lightspeed** (`src/lib/lightspeed/`, [`lightspeed.md`](./lightspeed.md)) is
the worked example and the template to copy.

## Adding a chain — the full recipe

1. **Key material** — implement `WalletModule` in `src/lib/<chain>/` and add it
   to `MODULES[]` in `src/lib/pouch/chains.ts`. This is what the Linkage Map's
   module card reads.
2. **Display** — add a `ChainDescriptor` to `src/lib/chains.ts`: label, CAIP-2
   id, `addressType`, explorer URL, optional `balance` fetcher, `sendView`.
3. **Surface** — `registerModule({ tier: 'modules', ... })` with the create and
   send routes.
4. **Offer it at creation** — add an entry to `OFFERS` in
   `src/views/create-select.ts` so it appears on the "Choose your chains"
   screen. Say plainly whether it is required or utility, and why.
5. **Document it** — add a page under `docs/chains/` and link it from that
   folder's README.

**Algorand is not optional and never becomes so.** It is the account Parsec is
built on, for a stated reason: Falcon-1024 native accounts derive from the same
25-word seed and preserve the 58-char address, so today's Algorand account
migrates to Tier-Q without a re-key. See `QUANTUM.md`. Everything else is
utility.

## Rules that keep the seam clean

1. **Never branch on chain name in shared code.** Iterate a registry. If you
   find yourself writing `if (chain === 'algorand')` outside a chain pack, the
   descriptor is missing a field.
2. **Nothing heavy on the first-paint path.** `src/lib/pouch/chains.ts` pulls
   every chain pack — RSA-4096, libsodium with top-level await. Import it
   *inside* the function that needs it. Registering a chain-touching view
   eagerly in `main.ts` has already caused one blank-screen regression.
3. **Frontend suggests; Rust validates.** A module may classify and display.
   The Rust validators in `src-tauri/src/parsec_validate/` decide.
4. **Derive state, never store a "done" flag.** The chain picker reads which
   addresses the account actually holds; the Linkage Map reads real module
   state. A stored flag drifts from reality; a derived one cannot.
5. **A failure must never look like an absence.** Report it. See below.
6. **Never require an optional backend.** A module may be *compatible* with an
   external service without depending on it. Put it behind a provider seam
   (`src/lib/namespaces/registry.ts` and `src/lib/marketplace/providers/` are
   the precedents), ship a `local` default that works with nothing but Parsec,
   and let the participant choose in Settings — never escalate silently. An
   unreachable optional provider is `unknown`, never `deficient`: absence is
   not a fault. Bitcoin is the worked example —
   [`integration/bankon-btc-waas.md`](./integration/bankon-btc-waas.md).

7. **Focus on Parsec.** `bankon_vault` is a shared component that Parsec
   offers as a service, and several projects consume it — so its interface is a
   contract: additive only. But this repo is the wallet. Note a cross-project
   implication in a doc; do not refactor Parsec for another consumer's benefit
   or vendor their code here.

## Shared UI primitives

Built for these modules and expected to be used by them
(`src/lib/ui/`):

| Module | What it gives you |
|---|---|
| `status.ts` | Tri-state `unknown / ok / deficient`. The third state is the point: an unfetched balance is `unknown`, not a failure. `weakest()` folds a set. |
| `provenance.ts` | `provenanceLine()` — source, timestamp, and live/cached/sample, stated in place. `settleAll()` settles many reads without letting one block the surface. |
| `fuzzy.ts` | The palette's subsequence matcher, DOM-free and testable. |
| `palette.ts` | Ctrl/Cmd-K over the route registry. |

**Silence is the bug.** `fetchPrices()` used to swallow every error and return
`[]`; a CoinGecko rate-limit was indistinguishable from an empty market, and
the matrix pyramid simply vanished with no explanation. It now reports a
`FeedStatus` and the wall says which it is. Any new data source must do the
same.

## Verification

```bash
npx tsc --noEmit          # clean
npx vitest run            # green
npm run build             # succeeds, and the web bundle stays Tauri-free
npx stylelint "src/styles/**/*.scss"
```

Then run it — `npm run tauri:dev` — and look. Every regression in this round
that mattered (a permanently-visible palette, a blank screen from an eager
import, a silently-dead price feed) passed tsc, the tests, and the build.
