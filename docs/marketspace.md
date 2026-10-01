# BANKON Marketspace

## Overview

BANKON Marketspace is PARSEC's sovereign secondary market for names — both BANKON-namespace names (from the BNR) and ArNS names (via the ANT processes). A single AO process (the BANKON Marketspace Registry, **BMR**) holds listings, offers, auction state, and trade history. Listed names are escrowed on-process by transferring them to the BMR; settlement releases them to the buyer.

**Web mirror**: [`agenticplace.pythai.net/marketspace`](https://agenticplace.pythai.net/marketspace) — the public-facing companion dApp for non-PARSEC users. The in-wallet view in PARSEC is the sovereign client.

## Why a sovereign marketspace

- ArNS doesn't have a built-in marketplace. Existing AR.IO-side trade venues are third-party.
- BANKON Names + ArNS share an Arweave-key custody model — one Marketspace can list names from either namespace and settle them through the same on-AO escrow.
- The BMR's payment model is token-agnostic by design (same `Payment-Method` + `Payment-Proof` pattern as the BNR). v1 ships ARIO-priced listings only; v2 will add Algorand ASA and BANKON-token payments. The rails that can and cannot produce a settle-time proof are assessed in [TOON, x402 and the naming service](./integration/toon-naming-x402.md) — a TOON claim cannot, an x402 settlement can.

## Architecture

```
PARSEC wallet                          BMR (AO process)
─────────────                          ────────────────
src/views/market-*.ts        ───▶      Listings / Offers / Bids
src/lib/marketplace/                   Trades / Fees / Treasury / Policy
├── process-id.ts (sentinel +          ├── list.lua     (Create-Listing)
│   localStorage override)             ├── cancel.lua   (Cancel-Listing)
├── lua-source.ts (build-time          ├── offer.lua    (Make-Offer / Accept-Offer …)
│   Lua bundle for in-wallet spawn)    ├── auction.lua  (Bid / Settle-Auction)
├── client.ts (read+write helpers)     ├── escrow.lua   (Receive-Asset + Reconcile)
└── escrow.ts (composite transfer      ├── settle.lua   (Settle-Trade)
    BNR/ANT → BMR)                     ├── fees.lua     (Record-Fee + Withdraw-Fees)
                                       └── governance.lua (Set-Policy + controllers)

scripts/spawn-bmr.mjs                  Public mirror dApp
└── one-time spawn (CLI)               └── agenticplace.pythai.net/marketspace
                                          (companion site; not in this repo)

In-wallet spawn flow
└── Dashboard → BANKON Names → bankon-admin → Marketspace tab → "Spawn BMR"
```

## Lifecycle of a listing

1. **Seller** opens `Manage` on a name they own → `Marketspace` section → **List for sale**.
2. PARSEC posts a `Create-Listing` DataItem (fixed-price or auction) to the BMR.
3. The wallet immediately follows up with the asset escrow: a BNR `Transfer` (for BANKON names) or an ANT `Transfer` (for ArNS) to the BMR's process id.
4. The BMR's `escrow.lua` observes the inbound `Transfer-Notice` and flips the listing to `escrowed`.
5. **Buyer** opens the listing in `market-listing` (or `market-auction` for auctions):
   - **Fixed-price**: pay the ask price out-of-band (an ARIO transfer to the BMR treasury with the listing id in the note field), then submit `Settle-Trade` with the payment tx-id as `Payment-Proof`.
   - **Auction**: place `Bid` messages until end-time, then anyone can call `Settle-Auction` after the deadline.
6. The BMR's `settle.lua` verifies the Payment-Proof (v1 trusts the signed attestation), records the trade, and **emits the outbound asset transfer**: a BNR `Transfer` to the buyer (BANKON names) or a `Pending-Ant-Transfer` notice (ArNS; v2 will sign the ANT transfer directly from the BMR process key).
7. Fees are recorded against `BMR.FeesAccrued` (default 250 basis points = 2.5%); controllers withdraw to `BMR.Treasury` via `Withdraw-Fees`.

## Cancel + refund

- A seller can `Cancel-Listing` while the listing is `open` or `escrowed` (but not for auctions with active bids — that's an escape hatch only).
- On cancel, the BMR's reconciler returns the escrowed asset to the seller. v1 surfaces an explicit `Reconcile-Escrow` action; v2 will auto-return on cancel.

## Auctions

Same lifecycle as fixed-price, with:

- `Start-Auction` (encoded via `Is-Auction=true` on `Create-Listing`): opening price, min increment, end time.
- `Bid`: must exceed the current bid + min-increment floor.
- `Settle-Auction`: anyone can call after `endTime`; highest bidder wins, asset transfers, BMR records the trade.

Bid escrow is **not** held on the BMR in v1 (no ARIO custody on AO yet); bids are signed declarations of intent. The winning bidder is expected to pay out-of-band via a `Payment-Proof` tag at settle.

## Fees

- Configurable via `Set-Policy` with `Fee-Basis-Points` (default 250).
- Bounds: 0-5000 bps (0 to 50%).
- Accrued in `BMR.FeesAccrued`; `Withdraw-Fees` zeroes the counter (v1) and the controller pulls from the BMR's wallet out-of-band.

## Spawning the BMR

### Preferred (in-wallet)

1. Dashboard → BANKON Names → admin (any maintainer with the BNR's controller key).
2. Scroll to the "Marketspace (BMR)" panel.
3. Confirm bundle digest, click **Spawn BMR**.
4. The wallet signs + posts the Spawn DataItem and persists `BMR_PROCESS_ID` to localStorage.

### Maintainer fallback (CLI)

```bash
DEPLOY_KEY=$(base64 -w0 maintainer-jwk.json) \
INITIAL_CONTROLLER=<arweave-address> \
TREASURY=<arweave-address> \
BNR_PROCESS_ID=<bnr-id> \
npx tsx scripts/spawn-bmr.mjs
```

## Client API (TypeScript)

```ts
import {
  buildCreateListingInput,
  buildCancelListingInput,
  buildMakeOfferInput,
  buildAcceptOfferInput,
  buildBidInput,
  buildSettleAuctionInput,
  buildSettleTradeInput,
  getListing,
  getMyListings,
  getMyOffers,
  listListings,
  isBmrConfigured,
  type Listing,
  type Offer,
} from '../lib/marketplace';
```

Writes return `Omit<DataItemInput, 'owner'>`; caller signs via `signDataItemFromVault` and posts via `aoMessage`.

## v1 trust posture

- Listing escrow is real: the BMR holds the asset.
- Payment proofs are signed attestations (the wallet that posts `Settle-Trade` is on-record).
- Auctions trust the winning bidder to honor their bid. v1 doesn't on-chain-escrow bid amounts.
- Single-controller v1; governance voting deferred to v2.
- The Marketspace web mirror at `agenticplace.pythai.net/marketspace` is the public-facing client. It uses the same BMR and the same payment-proof model. PARSEC is the sovereign client; the web mirror is the public client.

## v2 roadmap

- Algorand ASA listings (BMR controls an Algorand custody account, ASA opt-in + receive).
- Cross-chain payment (BANKON token when it ships; BASE ARIO via the relayer).
- On-AO bid escrow (escrow bid amounts when the AO ARIO ledger exposes programmatic custody).
- Order-book queries (cursor-paginated, price-band filter).
- Dispute resolution / 3-phase arbitration.
- Governance voting on fee bps + accepted currencies (BANKON token-weighted).

## Related docs

- [BANKON Names](./bankon-names.md) — the namespace whose names are listed here.
- [Named-NFT binding](./named-nft-binding.md) — bind an Algorand ASA to a listed name.
- [Development Plan](./DEVELOPMENT_PLAN.md) — Phase Q.
