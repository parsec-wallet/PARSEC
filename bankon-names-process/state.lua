-- BANKON Names Registry — global state.
--
-- AO processes use a single persistent Lua VM. Globals live across messages;
-- assigning them once at process boot is the canonical pattern. We namespace
-- everything under BNR so it's obvious which globals belong to the registry.
--
-- The state is intentionally flat: one table per concern, no nested wrappers.
-- Handlers index in/out of these directly.

if BNR == nil then BNR = {} end

-- ── Records ──────────────────────────────────────────────────────
-- name -> {
--   processId  = string         -- the claimant's address (Arweave address)
--   owner      = string         -- alias for processId; transferable
--   type       = 'lease' | 'permabuy'
--   startTimestamp = number     -- ms epoch
--   endTimestamp   = number?    -- ms epoch (nil for permabuy)
--   undernameLimit = number
--   purchasePrice  = string?    -- big int as string, in the unit of the payment method
--   paymentMethod  = string     -- 'free' | 'algorand' | 'arweave-stake' | 'bankon'
--   target         = string?    -- @ (root) target tx id, settable post-claim
--   ttlSeconds     = number     -- root record TTL
--   undernames     = { [sub] = { transactionId, ttlSeconds } }
-- }
if BNR.Records == nil then BNR.Records = {} end

-- ── Reserved ─────────────────────────────────────────────────────
-- Names blocked from public claim. Seeded by admin.lua at process boot
-- (bankon, parsec, pythai, mainnet, testnet, ar, ao, ...).
-- name -> { target = string?, endTimestamp = number?, reason = string }
if BNR.Reserved == nil then BNR.Reserved = {} end

-- ── Treasury (per payment method) ────────────────────────────────
-- method -> address-string. The address that should receive payments for
-- a given method. The registry doesn't custody; verifiers check that the
-- claimant's Payment-Proof tx actually paid this address.
if BNR.Treasury == nil then
  BNR.Treasury = {
    -- Populated by handlers/admin.lua at boot from Spawn tags so we don't
    -- hardcode addresses here. Sane defaults for documentation only:
    algorand = '',           -- set via Set-Policy / Spawn Treasury-Algorand tag
    ['arweave-stake'] = '',  -- set via Set-Policy / Spawn Treasury-Arweave tag
    bankon = '',             -- placeholder until BANKON token exists
  }
end

-- ── Policy ───────────────────────────────────────────────────────
-- Configurable knobs the admin (and later, governance) can adjust.
if BNR.Policy == nil then
  BNR.Policy = {
    OpenBeta = true,                -- if true, 'free' payment method is accepted
    LeaseYearsMin = 1,
    LeaseYearsMax = 5,
    DefaultLeaseYears = 1,
    UndernameLimitDefault = 10,
    RootTtlSecondsDefault = 3600,
    AcceptedMethods = { 'free', 'algorand', 'arweave-stake' },  -- 'bankon' added when token lives
    -- Cost table per method per intent. Values are strings (big-int safe).
    Costs = {
      ['Buy-Name'] = {
        free = { lease = '0', permabuy = '0' },
        algorand = { lease = '1000000', permabuy = '5000000' },  -- 1 ALGO lease / 5 ALGO permabuy (microALGO)
        ['arweave-stake'] = { lease = '100000000', permabuy = '500000000' },  -- 0.1 AR / 0.5 AR (winston)
        bankon = { lease = '0', permabuy = '0' },
      },
      ['Extend-Lease'] = {
        free = { lease = '0' },
        algorand = { lease = '500000' },
        ['arweave-stake'] = { lease = '50000000' },
        bankon = { lease = '0' },
      },
    },
  }
end

-- ── Controllers (admin authority) ────────────────────────────────
-- A list of Arweave addresses with admin powers. At boot the spawn tx
-- owner is the sole controller; can rotate / extend via governance.lua.
if BNR.Controllers == nil then BNR.Controllers = {} end

-- ── Primary names ────────────────────────────────────────────────
-- owner-address -> name. Set when a Primary-Name-Request is acknowledged.
if BNR.PrimaryNames == nil then BNR.PrimaryNames = {} end

-- ── Metadata ─────────────────────────────────────────────────────
BNR.Version = '0.1.0'
BNR.Name = 'BANKON Names Registry'

return BNR
