-- BANKON Marketspace Registry — main entry.
--
-- Single AO process. Spawned via scripts/spawn-bmr.mjs or via the in-wallet
-- Marketspace admin tab (see src/views/bankon-admin.ts). Boot tags:
--   Initial-Controller  — first admin authority (Arweave address)
--   Treasury            — treasury address for fee accrual
--   Bnr-Process-Id      — the BANKON Names Registry id, used in settle.lua
--                         when emitting BNR Transfer messages on sold listings.

local state = require('.state')

local function readSpawnTag(name)
  if not (ao and ao.env and ao.env.Process and ao.env.Process.Tags) then return nil end
  for _, t in ipairs(ao.env.Process.Tags) do
    if t.name == name then return t.value end
  end
  return nil
end

if #BMR.Controllers == 0 then
  local initial = readSpawnTag('Initial-Controller') or (ao and ao.env and ao.env.Process and ao.env.Process.Owner) or ''
  if initial ~= '' then table.insert(BMR.Controllers, initial) end
end

local treasury = readSpawnTag('Treasury')
if treasury and BMR.Treasury == '' then BMR.Treasury = treasury end

require('.handlers.governance').register()
require('.handlers.list').register()
require('.handlers.cancel').register()
require('.handlers.offer').register()
require('.handlers.auction').register()
require('.handlers.escrow').register()
require('.handlers.fees').register()
require('.handlers.settle').register()

-- ── Read handlers ───────────────────────────────────────────────

Handlers.add('get-listing',
  Handlers.utils.hasMatchingTag('Action', 'Get-Listing'),
  function(msg)
    local id = msg.Tags['Listing-Id']
    local listing = BMR.Listings[id]
    if not listing then
      ao.send({ Target = msg.From, Data = 'null' })
      return
    end
    ao.send({ Target = msg.From, Data = require('json').encode(listing) })
  end
)

Handlers.add('list-listings',
  Handlers.utils.hasMatchingTag('Action', 'List-Listings'),
  function(msg)
    local statusFilter = msg.Tags['Status']    -- optional
    local namespaceFilter = msg.Tags['Namespace']
    local items = {}
    for _, listing in pairs(BMR.Listings) do
      local ok = true
      if statusFilter and listing.status ~= statusFilter then ok = false end
      if namespaceFilter and listing.namespace ~= namespaceFilter then ok = false end
      if ok then table.insert(items, listing) end
    end
    ao.send({ Target = msg.From, Data = require('json').encode({ items = items }) })
  end
)

Handlers.add('my-listings',
  Handlers.utils.hasMatchingTag('Action', 'My-Listings'),
  function(msg)
    local seller = msg.Tags['Seller'] or msg.From
    local items = {}
    for _, listing in pairs(BMR.Listings) do
      if listing.seller == seller then table.insert(items, listing) end
    end
    ao.send({ Target = msg.From, Data = require('json').encode({ items = items }) })
  end
)

Handlers.add('my-offers',
  Handlers.utils.hasMatchingTag('Action', 'My-Offers'),
  function(msg)
    local buyer = msg.Tags['Buyer'] or msg.From
    local items = {}
    for _, offer in pairs(BMR.Offers) do
      if offer.buyer == buyer then table.insert(items, offer) end
    end
    ao.send({ Target = msg.From, Data = require('json').encode({ items = items }) })
  end
)

Handlers.add('info',
  Handlers.utils.hasMatchingTag('Action', 'Info'),
  function(msg)
    ao.send({
      Target = msg.From,
      Data = require('json').encode({
        name = BMR.Name,
        version = BMR.Version,
        listingCount = (function() local n = 0; for _ in pairs(BMR.Listings) do n = n + 1 end; return n end)(),
        offerCount = (function() local n = 0; for _ in pairs(BMR.Offers) do n = n + 1 end; return n end)(),
        controllers = BMR.Controllers,
        treasury = BMR.Treasury,
        policy = BMR.Policy,
      }),
    })
  end
)
