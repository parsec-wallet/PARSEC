# Bitcoin in PARSEC — standalone, with BANKON BTC WaaS as an optional provider

> **Rule, from the outset:** **PARSEC is compatible with BANKONBTCWaaS but does
> not require it.** Bitcoin must work with nothing but PARSEC. The WaaS is an
> *optional backend* that adds node truth and diagnostics when present.
>
> **Source:** <https://github.com/cypherpunk4096/BANKONBTCWaaS> ·
> **Licence:** client cryptography GPLv3, infrastructure MIT ·
> **Upstream status: pre-release, diagnostic-only** · Reviewed 2026-08-30.

## The separation that matters

BANKONBTCWaaS is two things, deliberately separate:

| | Needs Bitcoin Core? | What it is |
|---|---|---|
| **BANKONBTC** — `bankon-console`, `bankon-qt`, node tooling | **Yes** | Bitcoin-Core diagnostics: sync, mempool, disk-runway, `₿TC.oracle`, I.C.E., peer globe |
| **The WaaS** — `bankon-waas` | **Partly** | `keygen.mjs` / `offline-client.html` are pure client-side BIP39/32 and offline-capable. `server.mjs` needs node RPC for descriptor import, balances and broadcast |

The client cryptography is node-free by design. Only descriptor import, balance
reads and broadcast touch RPC.

**PARSEC already owns the client-crypto half** — `chain_btc_*` in `src-tauri/`
does BIP-32/39/44/84 derivation, keys live in the vault. So PARSEC does not
adopt the WaaS keygen; it needs the *node-facing* half, and only optionally.

## Architecture: a provider seam

PARSEC already does this twice — `src/lib/namespaces/registry.ts`
(ArNS / BANKON / Solana-ArNS) and `src/lib/marketplace/providers/` whose header
states the principle plainly:

> *"Providers self-register into the registry; every consumer reads them
> generically through this interface — adding a marketplace never edits
> consumer code."*

Bitcoin gets the same seam.

```ts
// src/lib/bitcoin/providers/types.ts
export interface BitcoinBackend {
  readonly id: string;
  readonly label: string;
  /** Is this backend reachable right now? Tri-state, never a guess. */
  health(): Promise<Status>;

  registerDescriptor(descriptor: string, label: string): Promise<void>;
  receiveAddress(wallet: string): Promise<string>;
  balance(wallet: string): Promise<{ confirmed: bigint; unconfirmed: bigint }>;
  buildPsbt(req: SendRequest): Promise<string>;   // unsigned
  broadcast(signedTxHex: string): Promise<string>;

  /** Optional — only a full node can answer these. */
  nodeDiagnostics?(): Promise<NodeDiagnostics>;
}
```

Two implementations, registered the same way:

| Provider | Requires | Gives |
|---|---|---|
| `local` (**default, always present**) | nothing beyond PARSEC | derivation + PSBT signing in Rust; balance/broadcast via a public Esplora-style endpoint, or watch-only if none is configured |
| `bankon-waas` (**optional**) | a reachable WaaS (`:8088`) | descriptor registration, receive, PSBT, broadcast — plus `nodeDiagnostics()` when its bitcoind is up |

**PARSEC never sends a key to either.** Signing is always local, in the Rust
vault. The backend supplies the unsigned PSBT and takes the signed transaction.

```
PARSEC (keys, vault, signing)              BitcoinBackend
  ├── derive descriptor ────────────────►  registerDescriptor()   (watch-only)
  │◄─────────── receive address ─────────  receiveAddress()
  ├── request send ─────────────────────►  buildPsbt()  → unsigned PSBT
  ├── sign in Rust vault (chain_btc_sign_psbt)
  ├── signed tx ────────────────────────►  broadcast()
  │◄──── sync / mempool / fees / peers ──  nodeDiagnostics()   (WaaS only)
```

## Two modules

Per [`../modules.md`](../modules.md):

### `bitcoin` — tier `modules`, the wallet itself

Turns the `enabled: false` throwing stub in `src/lib/pouch/chains.ts` into a
real chain pack, backed by whichever provider is active. Flips the
`create-select.ts` Bitcoin row to a working path.

**It must ship working on the `local` provider alone.** If it only works when a
WaaS is running, the requirement has been broken.

**~~Blocking dependency~~ — resolved.** `chain_btc_sign_psbt` is implemented and
wired (`chain_btc/commands.rs`, `chain_btc/sign.rs`): it retrieves the mnemonic
from the vault, signs the PSBT, and wipes the secret without it crossing the IPC
boundary. The old note here, and the matching comment at `chain_btc/mod.rs:11`,
were both stale and have been corrected.

### `btc-node` — tier `identity`, diagnostics, optional

Registers only when a WaaS is reachable; absent otherwise, exactly like the
BANKON dashboard tile that renders `null` without an Arweave address. Feeds:

- **the blue pill's Chain Health tab** — sync, mempool count/MvB/sat-vB,
  disk-runway, live tx via the ZMQ `rawtx` feed;
- **the Linkage Map's Bitcoin node** — genuinely tri-state: `ok` when synced and
  the descriptor is registered, `unknown` when no backend is reachable,
  `deficient` on a real reported fault. Never `deficient` merely because the
  optional provider is absent — that is `unknown`.

Everything the console reports comes from the node's own RPC or `debug.log` —
*"no external APIs at runtime"* — which is the sovereign posture PARSEC wants.

`₿TC.oracle` carries **exact Decimal arithmetic at 18 dp**. That is cp4096
commitment IV done correctly, and the model for fixing our own float money path
— see [`../cypherpunk4096.md`](../cypherpunk4096.md).

## Cautions

1. **Never require the optional provider.** Every WaaS-backed surface degrades
   to `unknown` and stays usable. A balance of 0 BTC because a backend is
   unreachable is a lie; say "unknown" instead.
2. **Upstream is pre-release.** Its README: *"a work-in-progress build, pending
   cypherpunk audit completion... do not rely on it for custody, mainnet
   transaction workflows, or production deployments."* Phases 0–5 complete,
   regtest and multisig signing tests passing, mainnet gated on audit.
   → Diagnostics first. Wallet module on regtest, `enabled: false`, until the
   audit lands and we have run it ourselves.
3. **Do not adopt the browser keygen path.** PARSEC *is* the client; keys are
   minted in PARSEC and held in the Rust vault. Two keygen paths would be two
   attack surfaces.
4. **~~Name collision to resolve~~ — answered.** They are *related but not the
   same code*. The WaaS `bankon-vault` is Python (PBKDF2-SHA512 600k + two-stage
   HKDF-SHA512 + AES-GCM, plus Shamir, ML-KEM-768 and a policy engine), descended
   from mindX's Python vault. PARSEC's `bankon_vault` is an independent Rust
   implementation, now `bankon-vault/2` (Argon2id + wrapped DEK + per-entry keys).
   At least five codebases carry the name; the full map is in
   [`../security/vault-family.md`](../security/vault-family.md). Say which one you
   mean whenever you write "bankon vault".
5. **Licence split.** Client cryptography GPLv3, infrastructure MIT — the same
   policy PARSEC follows. Code lifted from WaaS client cryptography may land only
   in PARSEC's GPL-3.0-only core (`bankon_vault`, `chain_*`); MIT infrastructure
   code can land anywhere with its notice kept. Record provenance per file if code
   is lifted rather than called.
6. **CSP.** A WaaS origin (`127.0.0.1:8088`, `:8090`) is not in the
   `connect-src` allowlist in `src-tauri/tauri.conf.json`. Add it only when the
   provider is wired, and reach it through `src/lib/platform.ts`.
7. **Provider choice is the participant's.** Which backend is active belongs in
   Settings, defaulting to `local`. No silent escalation to a network service.

## Sequence

1. **Implement `chain_btc_sign_psbt` for real.** PARSEC's own work, no external
   dependency, and everything else is plumbing until it exists.
2. **The provider seam** (`src/lib/bitcoin/providers/`) with the `local`
   implementation — Bitcoin working in PARSEC alone.
3. **`bitcoin` module** on `local`, exercised on **regtest**: descriptor →
   receive → PSBT → sign → broadcast.
4. **`bankon-waas` provider** + the `btc-node` diagnostics module, registered
   only when reachable.
5. Mainnet only after the upstream audit **and** our own regtest pass.

## Open questions for upstream

- Is there a stable contract for a **non-browser** client (PARSEC) to register
  descriptors and fetch PSBTs, or is the web UI the intended path?
- Is WaaS `bankon-vault` the same component as PARSEC's `bankon_vault`?
- Audit timeline, and what "mainnet-ready" is gated on.
