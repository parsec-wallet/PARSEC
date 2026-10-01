-- BANKON Names Registry (BNR) — main entry.
--
-- Single AO process. One spawn call per network (mainnet, eventually testnet).
-- The process loads state.lua + every handler, then registers each handler
-- with the AO Handlers module. Order of handler registration matters: the
-- first matching handler wins, so we register the most specific actions first.
--
-- Boot tags consumed (from the Spawn DataItem):
--   Treasury-Algorand   — initial treasury address for ALGO payments
--   Treasury-Arweave    — initial treasury address for AR-stake payments
--   Treasury-Bankon     — placeholder for BANKON-token payments
--   Initial-Controller  — first admin authority (Arweave address)
--   Reserved-Names      — comma-separated list of bootstrap-reserved names
--
-- See ../scripts/spawn-bnr.mjs for the canonical spawn invocation.

local state = require('.state')

-- ── Boot-time configuration ─────────────────────────────────────
-- ao.env.Process.Tags is exposed by AO at boot time. We read the spawn
-- tags once and populate Treasury + Controllers from them. Falling back
-- to the message Owner (= spawn signer) for the initial controller.

local function readSpawnTag(name)
  if not (ao and ao.env and ao.env.Process and ao.env.Process.Tags) then return nil end
  for _, t in ipairs(ao.env.Process.Tags) do
    if t.name == name then return t.value end
  end
  return nil
end

if #BNR.Controllers == 0 then
  local initial = readSpawnTag('Initial-Controller') or (ao and ao.env and ao.env.Process and ao.env.Process.Owner) or ''
  if initial ~= '' then table.insert(BNR.Controllers, initial) end
end

local treasuryAlgo = readSpawnTag('Treasury-Algorand'); if treasuryAlgo then BNR.Treasury.algorand = treasuryAlgo end
local treasuryAr   = readSpawnTag('Treasury-Arweave');  if treasuryAr   then BNR.Treasury['arweave-stake'] = treasuryAr end
local treasuryBkn  = readSpawnTag('Treasury-Bankon');   if treasuryBkn  then BNR.Treasury.bankon = treasuryBkn end

-- ── Load handlers ───────────────────────────────────────────────
-- Each handler module returns a function `register()` that adds the
-- needed Handlers.add calls. Keeping the registry side-effect inside
-- the modules keeps main.lua a flat manifest.

require('.handlers.admin').register()
require('.handlers.governance').register()
require('.handlers.cost').register()
require('.handlers.claim').register()
require('.handlers.transfer').register()
require('.handlers.records').register()
require('.handlers.lease').register()
require('.handlers.primary').register()

-- ── Diagnostics handler ─────────────────────────────────────────
-- Lets clients sanity-check connectivity to BNR with no side-effects.

Handlers.add('info',
  Handlers.utils.hasMatchingTag('Action', 'Info'),
  function(msg)
    ao.send({
      Target = msg.From,
      Data = require('json').encode({
        name = BNR.Name,
        version = BNR.Version,
        recordCount = (function() local n = 0; for _ in pairs(BNR.Records) do n = n + 1 end; return n end)(),
        reservedCount = (function() local n = 0; for _ in pairs(BNR.Reserved) do n = n + 1 end; return n end)(),
        controllers = BNR.Controllers,
        policy = BNR.Policy,
        treasury = BNR.Treasury,
      }),
    })
  end
)
