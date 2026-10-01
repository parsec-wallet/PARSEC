# .algo registry and subdomain stores — design

**Status:** proposal (2026-10-01). Nothing here is built yet beyond what exists today: root-name
registration in PARSEC (NFD price in ALGO + the BANKON fee over x402).

## The idea

- **Anyone registers a `.algo` name** in PARSEC.
- **Any name owner opens a subdomain store** under their name — `alice.yourname.algo` — and sets
  their own prices, tiered by length: **3 letters premium, 4 letters valuable, 5+ standard**, with
  PARSEC suggesting prices for each tier.
- **Buyers pay in USDC over x402**, from any wallet that speaks x402 (agents included).
- **BANKON takes a facilitation fee** on every transaction made through PARSEC.
- **Nobody hands their keys to a server.** Owners sign their own mints, in PARSEC.

## What the NFD contract does and does not do

| Capability | NFD on chain | Consequence |
|---|---|---|
| Mint a root name for someone else | yes — `reservedFor` | a buyer can receive a name minted by another account |
| Owner mints subdomains of their name | yes, always | an owner can fulfil any order |
| Open subdomains to the public | yes, at **one flat USD price** (`segmentLock(false, usdPrice)`) | instant self-service minting, but no tiers |
| Price subdomains by length | **no** | tiers must be enforced by the store, not the contract |

So a tiered store keeps subdomain minting **locked** (only the owner can mint) and the owner's
PARSEC mints each sold name for its buyer. An owner who wants instant sales at one price can open
public minting instead.

## Proposed design

### 1. Store listing (owner, in PARSEC)

`.algo Names → My Names → Open a store` on a name the account owns:

- tier prices in USDC, with suggestions (e.g. 3 letters **$50**, 4 letters **$15**, 5+ **$3**), each
  editable, and optional per-name reserves ("not for sale") and featured names;
- the payout address (default: the owner's address, which must be opted in to USDC);
- a **delegation choice** for fulfilment: *manual* (approve each order), or *auto-mint* while PARSEC
  is open (every paid order is minted at once, signed by the owner's Keycore).

The listing is signed by the owner's key and published to the **store registry** (below). The
signature is what makes a listing valid: nobody can open a store under a name they do not own.

### 2. Store registry (mindX, Postgres on the VPS)

A small service on mindX holding **listings and orders, never keys**:

| Table | Holds |
|---|---|
| `stores` | parent name, parent NFD app id, owner, payout address, tier prices, signed listing, status |
| `orders` | store, requested label, buyer address, price, x402 settlement id, BANKON fee settlement id, state (`paid` → `minted` / `refunded`) |

Endpoints:

- `GET /names/stores` and `GET /names/stores/{parent}` — free; Bazaar-listed for discovery.
- `GET /names/stores/{parent}/quote?label=…` — free; tier, price, availability (checked on chain).
- `POST /names/stores/{parent}/buy` — **x402**: the 402 names the **store owner's payout address**
  as `payTo` and the tier price as `amount`. The buyer pays the owner directly; mindX never holds
  the money. On settlement an order is recorded as `paid`.
- `GET /names/stores/{parent}/orders` — for the owner, authenticated by a signature from the owner
  key; PARSEC polls it.

### 3. Fulfilment (owner, in PARSEC)

PARSEC shows the owner's order inbox. Each `paid` order is minted as
`label.parent.algo` **reserved for the buyer**, signed by the owner's Keycore — by a click
(manual) or at once while PARSEC is open (auto-mint). The order becomes `minted` with the mint
transaction id; the buyer's PARSEC shows the new name.

An order not fulfilled within a set time (e.g. 72 hours) is flagged; the store shows its fulfilment
record so buyers can judge it. Refunds are the owner's to make (a USDC transfer back); the registry
records them.

### 4. Root names paid in USDC (optional, later)

For a buyer with USDC and no ALGO: mindX quotes **NFD price × live ALGO/USD + 10%**, valid for a few
minutes, takes it over x402, buys the name with ALGO from a BANKON names treasury and mints it
**reserved for the buyer**. This is the one part that needs a server-held key (the treasury's),
funded with only what mints need. Today's path — the buyer's own ALGO plus the BANKON fee — stays.

### 5. BANKON facilitation fee

Charged over x402 in USDC to the BANKON fee address, shown on its own line and never added to the
price paid to another party (as today on root names):

| Transaction | Fee (proposal) |
|---|---|
| Root name registered through PARSEC | the existing BANKON fee ($0.50) |
| Subdomain bought through a store | **5% of the price**, minimum $0.10, paid by the buyer |
| Opening a store | free (stores bring buyers) |
| Root name paid in USDC (4.) | the 10% in its price |

## Phases

1. **Store listing and quote** — open a store in PARSEC (signed listing), registry tables and the
   free `stores` / `quote` endpoints on mindX; stores appear in PARSEC and the Bazaar.
2. **Buying** — the x402 `buy` endpoint paying the owner, the BANKON fee, orders recorded; buyer
   flow in PARSEC.
3. **Fulfilment** — owner inbox, manual and auto-mint, buyer sees the minted name; fulfilment
   record per store.
4. **Root names in USDC** — the treasury path (needs its own custody decision).

## Decisions needed before phase 1

1. The fee for subdomain sales (proposed 5%, min $0.10) and whether it is paid by the buyer or taken
   from the owner's price.
2. Suggested tier prices ($50 / $15 / $3 proposed).
3. The first store: `mindx.algo` once its recovery phrase is found (owner `L24WEG…`).
