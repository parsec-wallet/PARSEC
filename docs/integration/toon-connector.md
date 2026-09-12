# TOON Connector — review & in-house expansion plan

> **Source:** <https://github.com/toon-protocol/connector> · MIT (code),
> CC BY-SA 4.0 (vendored Interledger RFCs)
> **Published docs:** <https://toon.ar.io/> — snapshot in
> [`../reference/permaweb/toon-ar-io/`](../reference/permaweb/toon-ar-io/README.md)
> **Reviewed:** 2026-08-30 · **Re-checked against toon.ar.io:** 2026-09-02
> **Status upstream: testnet only**

## What it is

Its own description:

> *"A paid reverse proxy. You put it in front of an ordinary HTTP app, you set
> a price, and it collects that price from whoever calls — in tokens, per
> request, without your app knowing payment exists."*

A Rust Interledger (ILP) connector that terminates payment at the application
layer. Sixteen crates: `connector-domain` / `-runtime` / `-btp` / `-vectors`
(protocol), `-settlement` + `-settlement-evm` + `-settlement-solana`
(settlement), `-client-edge` (the proxy), `-peer-*`, `-operator`, `-signer`,
`-config`, `-cli`, `-bin`. Settles on **Base Sepolia** and **Solana devnet**.
Peering over BTP/WebSocket or ILP-over-HTTP. Node identity and operator writes
are ed25519 (RFC 9421 HTTP Message Signatures).

Adds three headers to the backend request: `X-TOON-Payer`, `X-TOON-Amount`,
`X-TOON-Chain`.

## The published docs, and why they are in the permaweb corpus

<https://toon.ar.io/> is upstream's own documentation, and it is not on a web
server. It is one HTML file stored on Arweave, resolved through the ar.io
gateway network under the ArNS name `toon`, and the write that put it there was
bought through the connector it documents. Snapshot:
[`../reference/permaweb/toon-ar-io/`](../reference/permaweb/toon-ar-io/README.md)
(`python3 scripts/sync-toon-docs.py` to refresh). It embeds, verbatim at commit
`deded9f9`: the operator guide, the ten-RFC delta table, ADRs 0046 and 0058, and
revision 1's receipts.

Two reasons it sits in the permaweb reference and not only here.

**It confirms a constant we already ship.** The gateway answers with
`x-arns-ant-program-id: 2MWexMHfMhGJwMHv9Qm9YAVCqjUFUJwDJAysW4oCUGk5` — byte-identical
to `ARIO_PROGRAMS.ant` in `src/lib/permaweb/constants.ts`. A live third-party
name resolving through the same program is independent confirmation of a number
the permaweb module depends on.

**It is a priced permaweb write with the receipts attached.** Appendix E gives
revision 1 line by line: the ArNS lease of `toon` at **44,170.416 ARIO** for one
year (quoted 44,843, ends 2027-08-27), and an x402 leg of **0.004298 USDC** on
Base **mainnet**. It also records a live Turbo defect —
[`turbo-sdk#455`](https://github.com/ardriveapp/turbo-sdk/issues/455): the paid
ARIO upload path refuses to debit a funded storage account, so the page shipped
under the free signed tier and was trimmed to fit. Anything Parsec builds on
Turbo-paid uploads should assume that path is not yet reliable. Upstream retired
the x402-to-AR.IO leg on 2026-08-29 in favour of paying uploads in ARIO directly.

### What it changes for the plan below

- **The caution still holds.** ADR 0056 — *production is a named, empty tier* —
  is on the page as of 2026-09-02. No mainnet contracts. `enabled: false` stands.
- **There is a payer library** —
  [`toon-client`](https://github.com/toon-protocol/toon-client): *"You do not
  need to build the payer."* It is unlicensed TypeScript (see below), so it is
  something to read, not to depend on. Our 402-shaped payer path is unchanged.
- **An ILP outcome is never an HTTP one.** *"A `FULFILL` and a `REJECT` both come
  back at HTTP 200."* `x402Fetch()` must not read 200 as success on a TOON route;
  the body decides.
- **Per-hop price is `base + per_kib`.** A quote is not flat — payload size is on
  the bill at every hop. The confirmation sheet has to say so, or a user will
  see a figure that does not match what they are charged.
- **Booting a config is not a dry run.** A Solana backend submits a real
  transaction at `connect`. Relevant only if we ever run a connector in Docker
  to exercise Steps 2–3 — do it with an unfunded key.
- Health is an unauthenticated `GET /ilp/identity`; a node self-describes at
  `GET /ilp` and announces nothing. Reachability checks have somewhere to point.
- The published image is **`linux/amd64` only**.

## The finding that decides the integration

> *"a caller with no claim on a priced route gets `402`"* — with an **x402
> document quoting the price** before any transmission.

**Parsec already speaks that.** `src/lib/x402/payment.ts` implements the whole
payer flow: `parse402Response()` → `executeX402Payment()` → retry with an
`X-PAYMENT` header, wrapped by `x402Fetch()` with an `onPaymentRequired`
callback for the confirmation sheet.

So Parsec does **not** need ILP, BTP, claims, or channels to be a *payer*. That
machinery is the connector operator's concern. Paying a TOON-fronted route is
the x402 path we already have, pointed at a different settlement chain.

This is the difference between vendoring sixteen Rust crates and writing one
adapter.

## Two surfaces, deliberately separated

| | Who | Where it belongs | Effort |
|---|---|---|---|
| **Payer** | Parsec wallet calls a TOON-fronted service | `agenticplace` tier module in the wallet | Small — extend an existing path |
| **Operator** | BANKON node monetizes THOT storage / the gateway per request | `bankon-node`, **not** the wallet | Separate work, separate repo |

Keeping these apart matters. The wallet must never grow a payment-channel
daemon; it holds keys and signs. The connector is infrastructure that sits in
front of a service.

## The actual gap (payer side)

`executeX402Payment()` hardcodes Algorand:

```ts
const signer = await buildAlgorandX402Signer(payerAddress, passphrase, network);
```

TOON settles on **EVM (Base)** and **Solana**. Parsec has both chain packs, and
`src/lib/x402/bridge.ts` already has `buildXchainX402Signer` and
`buildAlgorandHdX402Signer` — but the payment path never reaches them.

**The work is signer selection, not a new protocol.** Choose the signer from
the 402 document's declared network (`detectNetworkFamily()` in
`x402/constants.ts` already maps an address to `'evm' | 'solana' | 'algorand'`),
then sign with the corresponding chain pack.

## Proposed module

Per [`../modules.md`](../modules.md), one registration:

```ts
registerModule({
  id: 'toon',
  tier: 'agenticplace',      // a payment rail for agent services
  priority: 55,
  enabled: false,            // OFF until upstream leaves testnet — see below
  routes: [
    { id: 'toon-confirm', title: 'Confirm ILP Payment',
      load: async () => (await import('../views/toon-confirm')).toonConfirmView,
      modal: true },         // approval surface: off the back stack, off the palette
    { id: 'toon-desk', title: 'Paid Services', inRail: true, disclosure: 'pro',
      load: async () => (await import('../views/toon-desk')).toonDeskView,
      keywords: ['ilp', 'interledger', 'toon', 'paid api', 'per request'] },
  ],
  dashboard: toonDashboardModule,   // renders only when an EVM or Solana address exists
});
```

### Step 1 — multi-chain signer selection (the only load-bearing change)

In `src/lib/x402/payment.ts`, pick the signer from the 402 document rather than
assuming Algorand. This benefits **every** x402 payee, not just TOON.

### Step 2 — recognize TOON's dialect

A small adapter reading `X-TOON-Payer` / `X-TOON-Amount` / `X-TOON-Chain` off
the response so the confirmation sheet can say *what* is being bought, on which
chain, at what price — rather than showing a bare figure.

### Step 3 — surface it honestly

The confirmation sheet states: service, route, price in the **smallest token
unit and its human value**, settlement chain, and that this is a per-request
charge. Reuse `lib/ui/provenance.ts` for where the quote came from and
`lib/ui/status.ts` for reachability.

For how any of this meets the naming service — ArNS, BANKON Names, the
Marketspace and the name desk — see
[`toon-naming-x402.md`](./toon-naming-x402.md). Short version: TOON meters the
data a name points at; it cannot be a `Payment-Proof`.

## The wider org — what else is upstream

The connector is one repo of about twenty. Two are directly adjacent to work
Parsec already does, and are worth reading before anyone reinvents them:

| Repo | Licence | What it is | Why it matters here |
|---|---|---|---|
| [`store`](https://github.com/toon-protocol/store) | none | Paid Arweave blob store — answers NIP-90 `kind:5094`, uploads via Turbo, returns a txid, with the connector metering in front | A working paid-permaweb-write rail. The BANKON-node monetization option in the table above, already built by someone else |
| [`swap`](https://github.com/toon-protocol/swap) | MIT | Cross-chain USDC through a relay; each side verifies the other's signed payment-channel claim, newest claim redeemed once | Overlaps SpinTrade's problem space on a different rail |
| [`gas-station`](https://github.com/toon-protocol/gas-station) | MIT | Pays other people's gas — Solana fee-payer co-sign (`5096`), EVM ERC-2771 relay (`5098`) | The answer to "the user holds ARIO but no SOL", which the permaweb module hits directly |
| `relay`, `rig`, `hub`, `toon-client` | none | Nostr relay, git→TOON write path, operator orchestrator, payer client | Context only |

**Licence discipline.** Licensing is per-repo and uneven: `connector`, `swap`,
`gas-station`, `swarm`, `Forge`, `town` and `toon-meta` are MIT, `Town-Frontend`
is AGPL-3.0, `buzz` is Apache-2.0 — while `store`, `relay`, `rig`, `hub`,
`toon-client` and `capability-market` carry no licence file at all, which means
all rights reserved: readable on GitHub, not copyable into this tree. Check the
repo, not the org. And every one of the
TypeScript repos is an npm package, so Parsec's zero-dependency commitment rules
them out as dependencies regardless of licence. Read them for the protocol, write
our own code.

## Cautions — read before writing code

1. **Testnet only.** Upstream says production is *"a named, empty tier"* — no
   mainnet contracts, no mainnet infrastructure. Base **Sepolia** and Solana
   **devnet**. The module ships `enabled: false` and stays that way until
   upstream has mainnet contracts we have independently verified. Registering a
   disabled module is the documented pattern; shipping a route that spends real
   value against testnet contracts is not.
2. **`decimals` is a mispricing bomb.** Upstream refuses to start when
   configured `decimals` disagrees with the token's on-chain value: *"a wrong
   `decimals` is not a rounding error: it misprices every route by a factor of
   ten or more."* Parsec must apply the same rule on the payer side — read
   decimals from chain, never from the quote, and refuse to sign on a mismatch.
   This is exactly the "frontend suggests, Rust validates" boundary.
3. **Prices are whole smallest-units.** With `decimals = 6`, `price = 1000000`
   is one token. Never render a raw price as a currency figure.
4. **Claims are the truth.** *"a balance is a projection of them."* Parsec
   should display a claim-derived figure with provenance, never present a
   projected balance as settled.
5. **No new frontend runtime dependency.** The payer path is `fetch` plus
   existing chain packs. If ILP packet handling is ever genuinely needed, it
   belongs in `src-tauri/` as a Rust crate behind an IPC command — never in the
   TS bundle. MIT code can come in with its notice kept; a connector crate would sit
   outside the GPL-3.0-only core, under Apache-2.0 (`REUSE.toml`).
6. **Licence hygiene.** MIT code may be incorporated; the `docs/rfcs/`
   directory is CC BY-SA 4.0 and must not be copied into Parsec docs without
   its own attribution. Link to the RFCs instead.

## What NOT to do

- Do not vendor the connector crates into `src-tauri/`. Parsec is not a
  connector node, and the operator surface (`/peers`, `/channels`, `/routes`)
  has no business in a wallet.
- Do not build a channel-management UI in the wallet. Opening a channel needs a
  funded settlement key and on-chain verification — that is operator work.
- Do not let the wallet hold a long-lived settlement key for this. Parsec's
  model is ephemeral retrieval for signing, zeroized after.

## Recommended sequence

1. **Step 1 alone**, shipped on its own merit — multi-chain x402 signer
   selection improves the existing AgenticPlace path today, with no TOON
   dependency and no testnet exposure.
2. Watch upstream for a mainnet tier. Re-review contracts when one exists.
3. Then Steps 2–3 behind `enabled: false`, exercised against a local connector
   in Docker.
4. Separately, and only if BANKON wants per-request monetization: evaluate
   running a connector in front of THOT storage — in `bankon-node`, tracked
   there, not here.

## Open questions for upstream

- ~~Is there a documented client/payer library?~~ **Answered by toon.ar.io:**
  [`toon-client`](https://github.com/toon-protocol/toon-client) is it — but see
  the section above; it is unlicensed TypeScript, so it is a reference, not a
  dependency. The 402 + x402 document remains our client contract.
- What is the x402 document shape exactly — does it match the
  `paymentRequirements` / `accepts` shape `parse402Response()` expects? Still
  open: the published docs describe the `402` and the "x402 greeting" but do not
  print the document. Capture one from a local connector before writing Step 2.
- Mainnet timeline and contract addresses, once they exist. Still open — ADR
  0056 names the production tier and leaves it empty.
- Licence intent for the unlicensed org repos (`store`, `swap`, `relay`,
  `toon-client`, `rig`, `hub`). Ask before reading them as anything but prose.
