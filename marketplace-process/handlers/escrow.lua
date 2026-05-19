-- Escrow lifecycle — Receive-Asset + Reconcile.
--
-- When a seller Transfers a name to the BMR process id, the BNR (for
-- BANKON names) or the ANT (for ArNS) sends a Transfer-Notice to the BMR.
-- This handler observes that notice and marks the corresponding listing
-- as `escrowed`. The buyer's Settle-Trade can now proceed.
--
-- v1 deliberately doesn't enforce that the seller transfer matches the
-- listing — we trust the notice. v2 will inspect the originating process.

local json = require('json')

local function register()
  -- BNR Transfer-Notice arrives here when the BMR is the new owner.
  Handlers.add('on-transfer-notice',
    Handlers.utils.hasMatchingTag('Action', 'Transfer-Notice'),
    function(msg)
      local name = (msg.Tags.Name or ''):lower()
      -- Find the matching open listing for this name+seller pair.
      local matched = nil
      for id, listing in pairs(BMR.Listings) do
        if listing.name == name and listing.status == 'open' and listing.seller == msg.From then
          matched = id; break
        end
      end
      if not matched then return end
      local listing = BMR.Listings[matched]
      listing.status = 'escrowed'
      BMR.Listings[matched] = listing
    end
  )

  -- Manual reconcile — controller-only escape hatch when a Transfer-Notice
  -- didn't arrive (CU lag, message lost). Forces the status flip.
  Handlers.add('reconcile-escrow',
    Handlers.utils.hasMatchingTag('Action', 'Reconcile-Escrow'),
    function(msg)
      local id = msg.Tags['Listing-Id']
      local listing = BMR.Listings[id]
      if not listing then
        ao.send({ Target = msg.From, Data = json.encode({ error = 'Unknown listing' }) })
        return
      end
      -- Allow either the seller or a controller to reconcile.
      local isController = false
      for _, c in ipairs(BMR.Controllers) do if c == msg.From then isController = true; break end end
      if listing.seller ~= msg.From and not isController then
        ao.send({ Target = msg.From, Data = json.encode({ error = 'Not authorized' }) })
        return
      end
      if listing.status == 'open' then listing.status = 'escrowed' end
      BMR.Listings[id] = listing
      ao.send({ Target = msg.From, Data = json.encode({ ok = true, listing = listing }) })
    end
  )
end

return { register = register }
