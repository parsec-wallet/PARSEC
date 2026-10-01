-- BANKON Marketspace Registry — global state.
-- Mirrors the BNR's flat-table model (one global table per concern). All
-- mutations live behind handlers; reads use Action=Get-Listing etc.

if BMR == nil then BMR = {} end

-- ── Listings ────────────────────────────────────────────────────
-- id -> {
--   id           = string         -- the listing message DataItem id (44-char b64url)
--   seller       = string         -- Arweave address that created the listing
--   namespace    = 'bankon' | 'arns'
--   name         = string         -- the name being sold
--   askPrice     = string         -- big-int (mARIO for now)
--   currency     = string         -- 'ARIO' for v1
--   expiresAt    = number?        -- epoch ms; nil = no expiry
--   isAuction    = boolean
--   auction      = nil | {
--     minIncrement = string
--     endTime      = number       -- epoch ms
--     currentBid   = string?
--     currentBidder = string?
--   }
--   status       = 'open' | 'escrowed' | 'sold' | 'cancelled' | 'expired'
--   createdAt    = number
--   buyer        = string?
--   soldAt       = number?
-- }
if BMR.Listings == nil then BMR.Listings = {} end

-- ── Offers ─────────────────────────────────────────────────────
-- id -> {
--   id           = string
--   listingId    = string
--   buyer        = string
--   offerPrice   = string
--   expiresAt    = number?
--   status       = 'pending' | 'accepted' | 'cancelled' | 'rejected'
-- }
if BMR.Offers == nil then BMR.Offers = {} end

-- ── Auction bids ────────────────────────────────────────────────
-- listingId -> [{ bidder, amount, ts }]  (history; current top is on the listing)
if BMR.Bids == nil then BMR.Bids = {} end

-- ── Trades (settled) ────────────────────────────────────────────
-- listingId -> { listingId, seller, buyer, price, ts }
if BMR.Trades == nil then BMR.Trades = {} end

-- ── Fees + Treasury ─────────────────────────────────────────────
-- Configurable basis points; default 250 = 2.5%.
if BMR.Policy == nil then
  BMR.Policy = {
    FeeBasisPoints = 250,
    AcceptedNamespaces = { 'bankon', 'arns' },
    AcceptedCurrencies = { 'ARIO' },
    DefaultListingTtlMs = 7 * 24 * 60 * 60 * 1000,   -- 7 days
    MinAuctionDurationMs = 60 * 60 * 1000,           -- 1h
    MaxAuctionDurationMs = 14 * 24 * 60 * 60 * 1000, -- 14 days
    Paused = false,
  }
end

if BMR.Treasury == nil then BMR.Treasury = '' end       -- Arweave address
if BMR.Controllers == nil then BMR.Controllers = {} end

-- Metadata
BMR.Version = '0.1.0'
BMR.Name = 'BANKON Marketspace Registry'

return BMR
