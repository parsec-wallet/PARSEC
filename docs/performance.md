# Performance — loading and memory

What was measured, what was changed, and what is deliberately still on the list.

## First paint

`index.html` names the entry chunk and every chunk Vite decides to `modulepreload`.
Everything in that set is fetched before the app can render, so it is the number
that matters.

| | JS on first paint | Total critical path |
|---|---|---|
| Before | **1,001 KB** (511 KB entry + 490 KB preloaded `algosdk`) | 1,572 KB |
| After | **158 KB** | 728 KB |

An **84% reduction in first-paint JavaScript.** No code was deleted — the same
work is still there, in chunks that load when something actually needs them.

### What was actually wrong

`algosdk` is ~490 KB and was being fetched before anything could draw. Four
separate causes, each of which had to be removed before the next became visible:

1. **Eager views that are never the first screen.** `create-wallet`,
   `verify-mnemonic` and `import-wallet` were statically imported by `main.ts`.
   You arrive at them *from* onboarding; they are now lazy.

2. **Pure helpers living next to a heavy import.** `microAlgosToAlgo`,
   `truncateAddress` and `formatAssetAmount` are arithmetic and string slicing,
   used in ~45 places — but they lived in modules that statically import
   `algosdk`, so every one of those call sites pulled the SDK in. They now live in
   `src/lib/algorand/format.ts`, which has no dependencies at all.

3. **A barrel re-exporting far more than the caller wanted.** `dashboard.ts`
   imported two name-resolution helpers from `lib/nfd`, whose `index.ts`
   re-exports the entire NFD suite — mint, renew, segments, signer, transfer —
   every one of which imports `algosdk`. Importing the leaf module instead
   (`lib/nfd/resolve`) drops the transaction stack.

4. **The one that hid behind the others:** `matrix.ts`, an eager view, statically
   imported `lib/nfd/login` for a lookup that only runs when someone types an
   identity into the login field. That reached `@txnlab/nfd-sdk` and
   `@algorandfoundation/algokit-utils`, and through them `algosdk`.

Chain-SDK work is now loaded at the call site, inside the async functions that
need it. That costs one extra microtask on first use and nothing after — and the
network round-trip these calls exist to make dominates either way.

### A chunking trap worth knowing about

`vite.config.ts` used the **object** form of `manualChunks`:

```ts
manualChunks: { algosdk: ["algosdk"], blueprint: [...] }
```

The object form declares a chunk unconditionally, and Vite then treats it as part
of the entry's graph and emits a `modulepreload` for it — so the SDK was fetched
eagerly *even after nothing eagerly imported it*.

Removing it entirely was worse: `algosdk` is shared by several lazy chunks, and
Rollup's default is to hoist a module shared by two or more dynamic chunks into
their common ancestor, which is the entry. All 152 of its modules went straight
into the entry chunk.

The **function** form gives it its own chunk without making the entry depend on
it. Both facts are now recorded in the config, because the naive fix in either
direction makes things worse.

## Memory

The router destroys a view with `container.innerHTML = ''`. That reclaims the DOM
and nothing else: a listener the view attached to `window` or `document` stays
attached, keeps firing, and — because its handler closes over the old elements —
pins the entire discarded tree.

There was no teardown hook at all. `src/lib/lifecycle.ts` adds one, and
`router.ts` runs it before building the next view.

| Leak | Effect |
|---|---|
| `matrix.ts` `makeDraggable` bound four `window` listeners **with inline arrows**, three elements per render | Inline handlers cannot be removed — `removeEventListener` matches on identity. Twelve live handlers per visit, each pinning a detached tree, all running on every `mousemove`. |
| `matrix.ts` diagnostics loop cleared itself only if its 20s tick observed a state change | Leaving the view left it **making network requests forever**, once per visit. |
| `matrix.ts` `cancelAnimation()` wired to seven individual navigation buttons | Any other exit — back, command palette, keyboard shortcut, a `store.navigate` from elsewhere — left the animation loop, glyph timer and price poller running for the life of the process. |
| `pmvpn/terminal.ts` `ResizeObserver` never disconnected | An observer holds a strong reference to what it observes; each mount kept its container and the xterm instance behind it alive. |
| `diagnostics.ts` poll relied on an `isConnected` probe | Ran one more full poll after leaving, and left the Rust network monitor enabled until then. |

All are now bound to the view through `onCleanup` / `bindGlobal` / `bindInterval`
/ `bindObserver`. Seven tests in `src/lib/__tests__/lifecycle.test.ts` cover the
contract, including the accumulation case directly.

### Audited and found clean

- The four remaining `window`/`document` listeners are app-lifetime singletons,
  `{ once: true }`, or have paired removals.
- `store.subscribe` returns an unsubscribe; all four callers are registered once
  at startup, so ignoring it is correct.
- **Rust:** no unbounded collections in Tauri managed state.
  `parsec_connect`'s `pending_requests` and `pending_name_requests` are removed in
  a cleanup block that runs unconditionally after the 120-second timeout, so an
  abandoned dApp request does not accumulate. `ThrottleEngine.metrics` is never
  written — dead code, already compiler-warned, not a leak.

## Still on the list

- **CSS is now the dominant first-paint cost**: 569 KB, of which 409 KB is
  Blueprint. It is render-blocking. Blueprint is consumed as CSS only, so a
  coverage-driven trim is the obvious next step and a real project.
- `module-*.js` is 1.3 MB (libsodium, via `@algorandfoundation/xhd-wallet-api`).
  Lazy, so it costs nothing at startup, but it is heavy for whatever loads it.
- 7.7 MB of assets total. Correct for a wallet with six chain packs; it just
  needs to stay off the critical path, which is now the case.
- No runtime profiling has been done — this work was bundle-graph and
  lifecycle analysis. Frame timing and allocation profiling under real use would
  be the next measurement, not the next guess.
