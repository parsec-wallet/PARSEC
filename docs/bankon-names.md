# BANKON Names — Sovereign Permaweb Namespace

## Overview

BANKON Names is PARSEC's sovereign alternative to AR.IO's ArNS. A single AO process (the **BANKON Names Registry**, BNR) holds every name; claims are signed ANS-104 DataItems carrying a token-agnostic `Payment-Method` + `Payment-Proof` tag pair. No per-name ANT (different from ArNS — names are records on the BNR directly). No AR.IO dependency at runtime.

The BANKON namespace runs **alongside** ArNS — PARSEC resolves both. A name like `pythai` can exist independently in both registries (different process IDs, different ownership graphs).

## Why a second namespace

- **Sovereignty.** AR.IO's ArNS contract is open source but their registry is theirs. AR.IO's policy decisions (Solana migration, reclaim windows, mint authority) inherit upstream. The BANKON namespace inherits no upstream policy.
- **Token-agnostic payment.** ArNS only accepts ARIO. The BNR accepts a `Payment-Method` tag and dispatches to the verifier for that method (`free`, `algorand`, `arweave-stake`, `bankon`). Day-one policy is permissive: `free` is accepted while `Policy.OpenBeta == true`.
- **No oracle dependency for v1.** The BNR trusts signed attestations from the claimant. Accountability is on-chain: every claim records the claimant's Arweave address. v2 will swap in oracle-verified proofs (Algorand-tx via algod, AR-tx via Arweave-Oracle).

## Architecture

```
PARSEC Wallet                          BANKON Names Registry (BNR)
─────────────                          ──────────────────────────
src/views/bankon-*.ts          ───▶    AO process (single)
src/lib/bankon-names/                  ├── state.lua
├── process-id.ts (constant)           ├── main.lua
├── payment.ts (proof types)           └── handlers/
└── client.ts (read+write)                 ├── claim.lua
                                           ├── transfer.lua
                                           ├── records.lua
                                           ├── lease.lua
                                           ├── primary.lua
                                           ├── cost.lua
                                           ├── governance.lua
                                           └── admin.lua

apps/bankon-resolver/          ───▶    BNR.Resolve (read-only)
(standalone permaweb SPA;              dry-run via cu.ardrive.io;
 3.70 kB; no PARSEC dep)               redirect to <txid>.arweave.net
```

## Lifecycle

### Spawn (one-time, maintainer)

```bash
DEPLOY_KEY=$(base64 -w0 maintainer-jwk.json) \
TREASURY_ARWEAVE=<arweave-address> \
INITIAL_CONTROLLER=<arweave-address> \
npx tsx scripts/spawn-bnr.mjs
```

The script bundles the Lua source from `bankon-names-process/`, signs an AO Spawn DataItem, posts it via `aoSpawn`, polls `aoResult` for confirmation, and writes the resulting process id to `src/lib/bankon-names/process-id.ts`. Idempotent; re-spawn requires `--force`.

### Claim (any user)

From inside PARSEC: Dashboard → **BANKON Names** → **Claim a Name** → search → pick payment method → confirm. One signed DataItem; no ANT spawn round trip.

Payment methods accepted at launch:

| Method | Proof | Cost (configurable via Policy.Costs) |
|---|---|---|
| `free` | `open-beta` constant | 0 (open beta only) |
| `algorand` | Algorand tx id paying `BNR.Treasury.algorand` | configurable microALGO |
| `arweave-stake` | Arweave tx id staking AR to `BNR.Treasury.arweave-stake` | configurable winston |
| `bankon` | BANKON token tx id (placeholder) | `Not-Yet-Supported` until token issued |

#### Paying for a claim (`algorand`) — `src/lib/bankon-names/pay.ts`

Added 2026-09-18. The proof the registry wants is just an Algorand transaction id paying
`BNR.Treasury.algorand`, so the module is thin:

| | |
|---|---|
| `treasuryFor('algorand')` | the treasury address, read live from the registry's own `Info` — never cached, never hardcoded |
| `quoteNameClaim(intent, name, opts, network)` | the cost, the treasury, and **any settlement already on file that covers it** |
| `proveNameClaimPayment(payer, quote, name, network)` | reuses that settlement, or pays the treasury; never both |

An x402 receipt paying the treasury counts. A participant who bought something else from
the same treasury over x402 owes nothing further — `proofFromReceipts()` finds it in the
settlement ledger (`src/lib/x402/receipts.ts`). It is refused if it underpaid, was paid
in another asset (`Payment-Amount` is microALGO; a USDC receipt reads as a shortfall),
paid someone else, or settled on another network.

Otherwise `payTreasury()` sends the quote and waits for finality — Rust-signed through
`sendAlgoPayment()`, so the mnemonic never enters the renderer.

**In the claim view.** `views/name-claim.ts` reads the treasury and price when the
`algorand` method is picked, shows a settlement already on file if one covers the quote,
and otherwise offers to pay it — filling the proof box rather than asking for a
transaction id to be pasted. The box stays, because a payment may have been made outside
this wallet. Changing the term re-quotes, and a proof that no longer covers the new price
is dropped rather than submitted (`proofStillCovers`).

### Record management

The owner of a name can:

- Set the root `@` target (Set-Record with `Sub-Domain: '@'`).
- Set undername targets (Set-Record with `Sub-Domain: <sub>`).
- Extend a lease (Extend-Lease; permabuy never expires).
- Request the name as primary (Primary-Name-Request → Primary-Name-Acknowledge).
- Transfer ownership (Transfer).

## Handler reference

Every handler returns `{ ok, ... }` or `{ error, ... }` JSON via `ao.send`.

### `Buy-Name`

```
Action: Buy-Name
Name: <lowercase a-z0-9-, no leading/trailing hyphen>
Purchase-Type: lease | permabuy
Years: <1-5>         (lease only)
Payment-Method: free | algorand | arweave-stake | bankon
Payment-Proof: <method-specific>
Payment-Amount: <big-int in method-native unit>
Undername-Limit: <number>  (optional; defaults to Policy.UndernameLimitDefault)
```

### `Transfer`

```
Action: Transfer
Name: <name>
Recipient: <43-char Arweave address>
```

Side effect: drops the previous owner's primary-name binding if it pointed to this name.

### `Set-Record`

```
Action: Set-Record
Name: <name>
Sub-Domain: '@' | <subname>
Transaction-Id: <43-char base64url>
TTL-Seconds: <number>      (optional; defaults to Policy.RootTtlSecondsDefault)
```

### `Get-Record` / `Record` / `Reserved-Name`

Read-only. Returns the record JSON or the literal `null`.

### `Resolve`

Read-only convenience. Returns `{ target, ttlSeconds, undernames, owner, type, endTimestamp }`. Used by the public resolver SPA.

### `Paginated-Records`

Read-only sweep. `Limit` + `Cursor` tags; returns `{ items, nextCursor, hasMore }`.

### `Get-Owned-Records`

Read-only. Returns every record where `record.owner == Tags.Owner` (defaults to `msg.From`).

### `Extend-Lease`

```
Action: Extend-Lease
Name: <name>
Years: <1-5>
Payment-Method / Payment-Proof / Payment-Amount: <as for Buy-Name>
```

### `Primary-Name-Request` + `Primary-Name-Acknowledge`

Two-step to prevent silent primary-name reassignment via Transfer. Request stores pending; Acknowledge upgrades it. Read via `Get-Primary-Name` (owner address → name).

### `Token-Cost` / `Cost-Details`

```
Action: Token-Cost
Intent: Buy-Name | Extend-Lease | Upgrade-Name | Primary-Name-Request | Increase-Undername-Limit
Name: <name>
Payment-Method: <method>
Purchase-Type: lease | permabuy   (optional)
Years: <number>                    (optional)
```

`Token-Cost` returns the cost as a bare `Data` field (big-int safe string). `Cost-Details` returns a JSON breakdown including the treasury address and acceptedMethods list.

### Governance (controller-only)

- `Set-Policy` — flat tag overrides or a JSON body
- `Set-Treasury` — `Payment-Method` + `Address`
- `Add-Controller` / `Remove-Controller` — `Address`
- `Set-Reserved` / `Clear-Reserved` — `Name`, optional `Target` + `Reason`

### `Info`

Returns `{ name, version, recordCount, reservedCount, controllers, policy, treasury }` for sanity checks.

## Bootstrap-reserved names

Seeded at process boot (see `handlers/admin.lua`):

`bankon`, `parsec`, `pythai`, `cypherpunk`, `mainnet`, `testnet`, `devnet`, `ar`, `ao`, `arweave`, `vault`, `mausoleum`, `tomb`, `identity`, `agents`, `docs`.

Reserved names target the first controller (the spawn signer) so the deploying address can claim them with `Payment-Method: free` post-spawn; the reservation clears on claim.

## Client surface (TypeScript)

Imports from `src/lib/bankon-names/client.ts`:

```ts
// Reads
getBankonRecord(name: string): Promise<BankonRecord | null>
getReservedBankonName(name: string): Promise<ReservedBankonName | null>
resolveBankon(name: string): Promise<BankonResolveResult | null>
getOwnedBankonRecords(owner: string): Promise<{name, record}[]>
getBankonTokenCost(intent, name, opts): Promise<{method, amount, unit}>
getPrimaryBankonName(owner: string): Promise<string | null>

// Writes (return DataItemInput for signDataItemFromVault + aoMessage)
buildBuyBankonInput(opts)
buildTransferBankonInput({ name, to })
buildSetBankonRecordInput({ name, subdomain, transactionId, ttlSeconds? })
buildExtendBankonLeaseInput({ name, years, payment })
buildPrimaryBankonRequestInput({ name })
buildPrimaryBankonAcknowledgeInput()
```

`PaymentProof` (from `payment.ts`) is a discriminated union; `paymentProofToTags(p)` is the canonical tag mapping. `pay.ts` is what produces one for `algorand` — see [Paying for a claim](#paying-for-a-claim-algorand--srclibbankon-namespayts) above.

## Public resolver

The standalone SPA at `apps/bankon-resolver/` reads a name from `?name=`, `#hash`, or URL pathname; dry-runs the BNR's `Resolve` handler via `cu.ardrive.io`; redirects to `https://<txid>.arweave.net` after a 2-second display.

Build: `npm run build:resolver` → `apps/bankon-resolver/dist/` (~3.70 kB JS).
Deploy: `npm run deploy:resolver` → publishes to Arweave via `permaweb-deploy`.

## Trust posture (v1)

- The BNR Lua trusts the message Owner (= claimant's Arweave address) is the canonical record of the claim. Payment proofs are recorded but not on-chain-verified.
- Squatter cost = social trust + the cost of generating a fresh Arweave key.
- Controller authority is a flat list of Arweave addresses (boot signer + `Add-Controller`). Governance v2 will add token-weighted voting on top.
- Treasury addresses are settable via `Set-Treasury` (controller-only). They're advisory in v1 — the BNR doesn't custody.

## v2 roadmap (post-launch)

- Oracle-verified payment proofs (Algorand-tx via algod oracle, AR-tx via Arweave-Oracle process).
  This is the remaining half: the wallet now **produces** a real proof (`pay.ts`, 2026-09-18) and
  the BNR still records it without verifying it on chain. An x402 settlement to
  `BNR.Treasury.algorand` is already a valid `algorand` proof with **no new method** — see
  [TOON, x402 and naming](./integration/toon-naming-x402.md).
- BANKON token issuance + `bankon` payment-method enablement
- Token-weighted governance voting
- Marketplace handler (transfer with token escrow)
- AR.IO-compatible gateway integration (resolve both ArNS + BANKON under the same `.arweave.net` URL space)

## Related docs

- [Arweave & ar.io source map](./arweave-ario-map.md) — where the BNR's Lua, clients, adapter and views sit in the wider permaweb surface

- [Development Plan](./DEVELOPMENT_PLAN.md) — Phase P (Permaweb & Sovereign Naming) + Phase Q (this round)
- [Snapshot Investigation](./snapshot-investigation.md) — ARIO Solana migration risk report
- [Named-NFT Binding](./named-nft-binding.md) — bind an Algorand ASA to a name's records
- [BANKON Marketspace](./marketspace.md) — order book + auctions for BANKON / ArNS names
- [TOON, x402 and the naming service](./integration/toon-naming-x402.md) — which rails can carry a `Payment-Proof`, and which can only pay for the data a record points at
- [TODO Index](./TODO-INDEX.md) — current session
