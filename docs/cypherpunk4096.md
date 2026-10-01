# cypherpunk4096 — the consortium, and where PARSEC actually stands

> **Goal:** PARSEC joins the **cypherpunk4096** consortium on completion.
> **Standard:** <https://github.com/cypherpunk4096> · `standard` repo
> **Repo:** <https://github.com/parsec-wallet>
> **Assessed:** 2026-08-30 — re-check before making any conformance claim.

cp4096 "inherits its four commitments [from cypherpunk2048] and **doubles the
bar**. Everything that carried the 2048 mark is the floor here, not the
ceiling." Each tier is a strict superset.

**Compliance is binary — all commitments must be met, none optional.** So this
document is a gap list, not a scorecard. PARSEC does not carry the mark today.

## The five commitments, against PARSEC as it is

### I. Determinism as Identity

> *"One deterministic address on every chain. The initcode **is** the name —
> CREATE2/CREATE3 with a fixed salt and fixed constructor."*

**Applies to:** PARSEC's deployed contracts (aORC suite, BonaFide, the BNR/BMR
AO processes), not the wallet binary.

**Status:** Partial. The DeltaVerse/OVERLORD work already deploys deterministic
multichain addresses; the aORC and AO-process side does not yet claim it. The
BNR and BMR are spawned AO processes with recorded ids — a different identity
model that needs its own argument, not an assumed pass.

### II. Zero Dependencies

> *"The whole surface is self-contained, hand-rolled where necessary, auditable
> in one screen, offline-compileable."* No package manager may mediate the
> source-to-bytecode path for permanent units.

**Status: this is the largest gap, and it is honest to say so.**

PARSEC's own README already softened the original rule to *"a lean dependency
set"*. The frontend currently ships `algosdk`, `@algorandfoundation/*`,
`@ar.io/sdk`, `@solana/kit`, `arweave`, `@txnlab/nfd-sdk`, `bip39`,
`node-forge`, `@xterm/*`, `p-map`, `p-ratelimit`, `algo-x-evm-sdk`.

That is defensible engineering and it is **not** commitment II. Closing it is a
multi-phase programme, not a cleanup:

- The `@noble/*` and `@scure/*` primitives are the ones cp4096-adjacent projects
  already accept (BANKONBTCWaaS uses the same). Those are the keepers.
- Chain SDKs are the weight. Each one replaced by a hand-rolled, vendored
  encoder is one commitment-II step.
- **Progress:** Algorand, Solana and Arweave key generation and signing moved
  into Rust (`chain_algo`, `chain_sol`, `chain_ar`), which takes `algosdk`,
  `@solana/kit` and `node-forge` out of the trusted key-handling path. Two audited
  Rust crates (`ed25519-dalek`, `rsa`) replaced three large JavaScript SDKs there
  — a net reduction in trusted code, and key material left a heap where it could
  not be wiped. The SDKs remain for RPC and encoding work; removing those uses is
  the next commitment-II step. Provenance for every source consulted is in
  [`security/provenance.md`](./security/provenance.md).
- The UI layer already conforms: vanilla TS, no framework, Blueprint consumed
  as CSS only.

**Do not claim commitment II until the SDK surface is vendored or replaced.**

### III. Verification Over Trust

> *"The green checkmark of source-code verification on a public explorer"* —
> compiled source matching deployed bytecode byte-for-byte, reproducible via
> standard-input JSON. *"Paid audits and screenshots do not qualify."*

**Status:** Partial. `PROOF.md` is the right instinct. Contract verification
needs to be per-artifact and reproducible, and every claim in our docs should
resolve to something a stranger can re-run.

### IV. Precision Without Approximation

> *"Quantities that can be exact **are** exact. Full-width decimals carried end
> to end... Rounding is a display decision, never a storage decision."*

**Status: closed for the x402 path (2026-08-30). Audit other value paths before
claiming it generally.**

Three violations existed and are fixed:

| Was | Now |
|---|---|
| `payment.ts` `parseFloat(req.price)` | `parseDecimal(req.price, USD_DECIMALS)` — exact from the wire |
| `payment.ts` `Math.ceil(effectivePriceAlgo * 1e6)` | `amountMicroAlgos` computed once at quote time and carried |
| `oracle.ts` `Math.ceil((usd / algoUsd) * 1e6)` | `usdToMicroAlgoExact()` via `usdToAssetUnits()` |
| `discount.ts` `+(price * (1 - pct/100)).toFixed(6)` | `applyDiscountExact()` via `applyPercentOff()` |

**`src/lib/money.ts`** is the new foundation: `bigint` scaled by declared
decimals, no dependencies, one screen — which serves commitment II as well as
IV. `parseDecimal` *refuses* input with more precision than the scale can hold
rather than silently truncating, and rejects junk instead of yielding `NaN`.
`applyPercentOff` floors, so a discount can never round up into a larger charge.
`usdToAssetUnits` rounds up, so a payer covers the remainder rather than
underpaying.

`PendingX402Payment` now carries exact fields as the truth
(`priceUsdExact`, `effectivePriceUsdExact`, `amountMicroAlgos`,
`exchangeRateExact`) with pre-formatted display strings beside them. The
confirmation sheet renders from the exact microALGO figure that will actually
be signed. `oracle.usdToAlgo` was renamed **`usdToAlgoForDisplay`** so its
float return can never be mistaken for a value-path function.

**33 tests** cover it (22 on `money.ts`, 6 on the exact discount, plus existing
x402 coverage), including the case the old float form got wrong:
`0.07 × 50%` is `0.035` exactly, not `0.034999999999999996`.

**Still to audit:** SpinTrade quoting/slippage, ASA amount handling, NFD/ArNS
pricing, and the marketplace listing amounts. The TOON connector review reaches
the same conclusion from the other direction — see
[`integration/toon-connector.md`](./integration/toon-connector.md).

### V. Quantum Compliance

> Signatures as `bytes` (not fixed `(v, r, s)`), ERC-1271 for smart accounts,
> verifier replacement behind published timelocks.

**Status:** Tracked in depth by [`../QUANTUM.md`](../QUANTUM.md). PARSEC is
**Tier-C** on signatures today (sovereign custody, classical schemes) and
targets **Tier-Q on Algorand** via Falcon-1024 native accounts — which derive
from the same 25-word seed and preserve the 58-char address, so the account
migrates without a re-key. This is why the chain picker states Algorand as
**required**, not preferred.

The wallet-side rule that follows: **never persist or pass a signature as a
`(v, r, s)` tuple.** Signature surfaces stay `bytes`. Pinned by
`chain_evm::sign::tests::signed_tx_crosses_the_boundary_as_bytes_not_a_v_r_s_tuple`.

**There is a second commitment-V gate, and it was the actual blocker:** the vault
*container* must be byte-shaped too. `bankon-vault/1` typed secrets as `String`
and ran them through `String::from_utf8`, so a Falcon-1024 private key — ~2,305
bytes of binary — could not be stored at all. Closed in `bankon-vault/2` by a
scheme registry over raw bytes; see
[`security/bankon-vault-spec.md`](./security/bankon-vault-spec.md).

The symmetric side was never the problem: AES-256-GCM and Argon2id are
Grover-survivable at the 128-bit level, as stated above.

## Honest summary

| Commitment | PARSEC today | Gap |
|---|---|---|
| I — Determinism | Partial | AO-process identity model needs its own argument |
| II — Zero dependencies | **No** | Chain SDK surface must be vendored or replaced |
| III — Verification | Partial | Per-artifact reproducible verification |
| IV — Precision | **Partial** | x402 path exact; other value paths unaudited |
| V — Quantum | Tier-C → Tier-Q | Falcon-1024 lands Q3 2026 |

One hard no remains (commitment II). Commitment IV moved to partial: the x402
money path is exact, the rest is unaudited. Nothing here should be described as
conformant until it is.

## Order of work

1. ~~**Commitment IV** — `bigint` smallest-units through the x402 path.~~
   **Done 2026-08-30** (`src/lib/money.ts`). Next: audit SpinTrade, ASA
   amounts, NFD/ArNS pricing and marketplace listings the same way.
2. **Commitment V** — audit every signature surface for `bytes`-shaped handling
   ahead of Falcon-1024.
3. **Commitment III** — make each deployed artifact independently reproducible.
4. **Commitment II** — the long one. Vendor or replace chain SDKs, one pack at
   a time, behind the module contract in [`modules.md`](./modules.md).
5. **Commitment I** — settle the AO-process identity argument.

## Sibling projects in the org

`standard` (the doctrine) · `scientific` (reference ERC-20, 2²⁵⁶−1 supply,
identical address across chains) · `engine` (LUV ENGINE) · `wei` · `exabyte` ·
`chronos` · `kairos` · `liqlocker` · `pay2play` (Bitcoin payment-as-login) ·
**`BANKONBTCWaaS`** — PARSEC's Bitcoin path, see
[`integration/bankon-btc-waas.md`](./integration/bankon-btc-waas.md).
