# TOON, x402, and the Parsec naming service — assessment

> **Question:** can TOON pay for names, and where does x402 actually fit?
> **Written:** 2026-09-02 · Companion to
> [`toon-connector.md`](./toon-connector.md) (the connector review) and
> [`../reference/permaweb/toon-ar-io/`](../reference/permaweb/toon-ar-io/README.md)
> (upstream's published docs, with revision 1's receipts).
> **Verdict:** TOON pays for **what a name points at**, never for the name.
> x402 already fits the BANKON registry and is blocked on one small local gap.

## What the naming service actually charges for

Parsec's naming surface is four things with four different money paths — the
three `NamespaceAdapter`s (`src/lib/namespaces/`), the name desk
([`name-desk-integration.md`](../name-desk-integration.md)), the Marketspace
([`../marketspace.md`](../marketspace.md)), and the public resolver.

| Money surface | Priced by | Unit | Payable from Parsec today | Can x402 reach it | Can TOON reach it |
|---|---|---|---|---|---|
| ArNS lease / permabuy / undername limit | ar.io registry (Solana era) | mARIO | Yes — ARIO only (`src/lib/namespaces/arns.ts:44`) | **No** | **No** |
| BANKON `Buy-Name` / `Extend-Lease` | `BNR.Policy.Costs` per method | microALGO, winston, 0 | Yes, but caller must supply the proof | **Yes** — see Finding 3 | No — Finding 1 |
| Marketspace `Settle-Trade` | seller's ask | ARIO, out of band | Attestation only (v1) | Yes, same shape as BNR | No |
| The Arweave txid a record points at | Turbo / bundler | winc, ARIO, USDC | Yes | Yes (ar.io meters egress with x402) | **Yes** — Finding 2 |
| Resolution reads (`Resolve` dry-run, `Paginated-Records`, gateway `HEAD`) | free today | — | n/a | Yes | **Yes**, if we ever price them |

Two of those five are name-state transitions. Three are HTTP services around
them. That split is the whole assessment: **TOON meters services; a registry
needs a proof.**

## Finding 1 — a TOON claim cannot be a `Payment-Proof`, and should not try

The BNR's payment model is token-agnostic on purpose: `Payment-Method` +
`Payment-Proof` + `Payment-Amount`, dispatched to a per-method verifier
(`bankon-names-process/handlers/claim.lua`), with v1 trusting a signed
attestation and v2 replacing it with an oracle read. Both versions need **an
artifact that exists at the moment the message is posted** — a tx id an oracle
can later resolve.

TOON gives you the opposite by design. Per its own docs: *"Every packet carries
its own covering claim"*, claims *"are exchanged off chain and redeemed on chain
in batches"*, and *"claims are the truth; a balance is a projection of them."* At
the moment a name is claimed there is no transaction — there is a signed claim
that some operator will redeem later, in a batch, possibly on a different chain
than the one the buyer holds.

Three consequences, in order of severity:

1. **The proof would have to be the operator's word.** A verifier that accepts
   "the connector says this was paid" makes that connector an authority over who
   owns names. `../bankon-names.md` exists because *"the BANKON namespace
   inherits no upstream policy"* — accepting an operator attestation as title
   hands that policy straight back to a third party.
2. **Redemption is asynchronous and batched.** A name would have to be issued
   before its money was settled, or held pending on a batch we do not control.
   Neither is a registry semantic we want to invent.
3. **It is testnet anyway.** ADR 0056 — production is a named, empty tier — is
   still on <https://toon.ar.io/> as of 2026-09-02.

**Conclusion: no `Payment-Method: toon`.** Not in v1, not in v2 with an oracle,
not when upstream ships mainnet. The mismatch is semantic, not a maturity issue.

## Finding 2 — TOON fits the data path, and that is not a small thing

Every useful name eventually runs `Set-Record` with a `Transaction-Id`. Getting
that txid onto Arweave costs money, and paying for it per request in a token the
user already holds is exactly the problem TOON solves —
[`toon-protocol/store`](https://github.com/toon-protocol/store) is a paid Arweave
blob store answering NIP-90 `kind:5094` with the connector metering in front,
which is the same shape as our `Set-Record` precondition.

Upstream's own receipts make the boundary vivid. The page under the ArNS name
`toon` was **stored** through paid TOON hops, priced by the kibibyte, with claims
redeemable on Solana mainnet. The **name** was not: Appendix E records
44,170.416 ARIO for a one-year lease, quoted at 44,843, *"funded by Phil via
Drew"* — a human wiring ARIO. The protocol that can meter a storage write end to
end still could not buy the name that points at it.

So the rule to build against: **TOON can pay for what a name points at; it cannot
pay for the name.** The same holds for our read side — if BANKON ever prices the
resolver, a `Paginated-Records` sweep, or a name-desk read API, a connector in
front is the right shape, because those are HTTP services where payment
obliviousness is a feature rather than a trust hole.

## Finding 3 — x402 already fits the BNR, and one local gap blocks it

The BNR's `algorand` verifier wants *"an Algorand tx id paying
`BNR.Treasury.algorand` the declared microALGO"*. Parsec's x402 rail signs
precisely that: `executeX402Payment()` builds
`makePaymentTxnWithSuggestedParamsFromObject({ receiver: pending.requirement.payTo, … })`
and hands it over in the `X-PAYMENT` header. Point a quote's `payTo` at the BNR
treasury and **the existing method already covers it** — no new Lua, no new
verifier, no policy change. `Payment-Method: algorand`, `Payment-Proof: <txid>`.

**The gap, verified in the tree:** the tx id is never captured.
> **Resolved 2026-09-18.** What follows described a settlement id that was never
> captured. Both halves are now built.

`X402PaymentResult.txId` used to be declared and never assigned — nothing read the
settlement header, so a payment that succeeded left no proof it had. **You cannot
submit a proof you never kept.** `src/lib/x402/protocol.ts` now reads
`PAYMENT-RESPONSE` (and the v1 `X-PAYMENT-RESPONSE`), and `receipts.ts` writes a
receipt the moment one is decoded — delivered or not, because a payment that settled
and a resource that failed are two different facts.

`latestReceiptTo(payTo, network)` is the lookup this document was asking for.

The non-402 half is built too. `src/lib/bankon-names/pay.ts` is the paid claim end to
end:

| | |
|---|---|
| `treasuryFor('algorand')` | `BNR.Treasury.algorand`, read live from the registry's own `Info` |
| `quoteNameClaim(intent, name, opts, network)` | the cost, the treasury, and **any settlement already on file that covers it** |
| `proofFromReceipts(...)` | an x402 receipt paying the treasury — refused if it underpaid, was in another asset, paid someone else, or settled on another network |
| `payTreasury(...)` | otherwise: send the quote, Rust-signed via `sendAlgoPayment()`, wait for finality |
| `proveNameClaimPayment(...)` | the two above in order — it never pays twice |

The result feeds straight into `claim({ paymentMethod: 'algorand', paymentProof:
txId, paymentAmount })`, which the adapter already threads through
(`src/lib/namespaces/bankon.ts:109`). No registry change was needed: an Algorand
transaction id paying the treasury is exactly what the existing verifier wants.

`sendPaymentWithVault()` (`src/lib/x402/bridge.ts`) remains unused and is now
superseded — it retrieves the mnemonic into JavaScript, where `sendAlgoPayment()`
signs through Rust.

`Policy.AcceptedMethods` (`bankon-names-process/state.lua:58`) and `Policy.Costs`
are governance-settable, so a future dedicated `x402` method is a `Set-Policy`
call rather than a redeploy. It is not needed for the Algorand rail; it would
matter only if we settle a name on a chain the BNR has no method for.

## Finding 4 — the missing piece is a price quote over HTTP

An AO process cannot answer `402`. `Token-Cost` is a dry-run against the BNR, not
an endpoint, so today only a client that speaks AO can learn what a name costs.

A thin endpoint that turns `Token-Cost` into an x402 document — price, `payTo`
(the treasury), network, intent — makes BANKON names purchasable by **any** x402
client rather than only by Parsec. That is the AgenticPlace thesis applied to
naming, and it is the one place in this assessment where a TOON node would also
be a reasonable fit later: quotes free at `GET /ilp`-style zero cost, expensive
sweeps priced per request.

**Boundary, and it is a hard one: quoting is not spending.** The name desk's
allowlist deliberately omits `buy-name`, `extend-lease` and `transfer`
(`src-tauri/src/parsec_connect/mod.rs:86`, mirrored in `src/lib/names/intent.ts`
and `apps/parsec-names/parsec-names.js`) — *"giving a name away, and spending
ARIO, stay inside the wallet where the user went looking for them."* A quoting
endpoint must not become the back door to that list. The endpoint prices; the
wallet's own confirmation sheet decides; `ALLOWED_NAME_OPS` does not grow.

## ArNS: the honest part

ArNS takes ARIO and nothing else (`acceptedPaymentMethods: ['ario']`). There is
no 402 to answer and no connector to put in front of a Solana program. Anything
that looks like "pay USDC for an ArNS name" is a broker holding ARIO and fronting
it — counterparty risk, custody, and a price the user cannot verify at the moment
they commit. Upstream solved it with a human. **Do not build that broker into the
wallet.**

What Parsec can honestly do for an ArNS purchase: quote the mARIO cost exactly
(`bigint`, via `src/lib/money.ts`), show the user's holdings against it, and pay
the *Arweave data leg* — the upload whose txid the record will point at — over
x402 or, later, a TOON-fronted store.

## Recommended sequence

1. **Capture the settlement tx id.** Read `X-PAYMENT-RESPONSE` in
   `executeX402Payment()` and populate `X402PaymentResult.txId`. Small, standalone,
   unblocks every proof-carrying flow. Ships on its own merit.
2. **Wire a paid BANKON claim end to end** with `Payment-Method: algorand`, using
   the captured tx id (or `sendPaymentWithVault()` for the non-402 path), behind
   the existing confirmation sheet. No registry change.
3. **Quote endpoint** turning `Token-Cost` into a 402 document — built on the
   AgenticPlace side, *not in this repo*, and with no new name-desk op.
4. **BNR v2 oracle verification** for `algorand`: the proof shape from step 2 does
   not change, only the verifier does. Do this before prices stop being nominal.
5. **Only then, and only with a TOON mainnet:** price the Arweave data leg through
   a TOON-fronted store, and show the per-KiB component in the sheet.

Steps 1, 2 and 4 have no TOON dependency at all. That is the point — the naming
service's payment story does not wait on upstream leaving testnet.

## What not to do

- **No `Payment-Method: toon`** — Finding 1. A claim is not a proof.
- **No connector in the wallet**, and no operator surface (`/peers`, `/channels`,
  `/routes`) anywhere near naming — see [`toon-connector.md`](./toon-connector.md).
- **Do not add `buy-name` / `extend-lease` / `transfer` to `ALLOWED_NAME_OPS`**,
  however convenient a 402 quoting endpoint makes it look.
- **Never trust `decimals` from a quote.** Upstream refuses to boot on a
  mismatch — *"a wrong `decimals` is not a rounding error"* — and a name priced
  ten times wrong is a name bought ten times wrong. Read it from chain.
- **No floats in a name price.** `bigint` smallest units through
  `src/lib/money.ts`; cypherpunk4096 commitment IV
  ([`../cypherpunk4096.md`](../cypherpunk4096.md)) still lists ArNS pricing as
  unaudited.
- **Do not read HTTP 200 as success on a TOON route** — a `FULFILL` and a
  `REJECT` both return 200.
- **Do not display a projected balance as settled.** Claims are the truth; if a
  TOON-paid upload is ever shown in the wallet, show it with provenance
  (`src/lib/ui/provenance.ts`).

## Related

- [`toon-connector.md`](./toon-connector.md) — the connector review and the payer-side plan
- [`../bankon-names.md`](../bankon-names.md) — the BNR, its payment methods and v2 roadmap
- [`../marketspace.md`](../marketspace.md) — the BMR, same `Payment-Proof` pattern
- [`../name-desk-integration.md`](../name-desk-integration.md) — `parsec_nameRequest` and its allowlist
- [`../x402-integration.md`](../x402-integration.md) — the x402 module as it stands
- [`../reference/permaweb/toon-ar-io/`](../reference/permaweb/toon-ar-io/README.md) — upstream docs + revision 1 receipts
