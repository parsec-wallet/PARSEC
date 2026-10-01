-- Cancel-Listing — seller cancels a listing that hasn't sold.
--
-- Tag schema:
--   Action     = 'Cancel-Listing'
--   Listing-Id = '<id>'
--
-- For listings in `escrowed` status, the BMR also needs to transfer the
-- name back to the seller (see settle.lua → returnAsset). v1 just flips
-- the status; the return-transfer is initiated by escrow.lua's reconciler.

local json = require('json')

local function register()
  Handlers.add('cancel-listing',
    Handlers.utils.hasMatchingTag('Action', 'Cancel-Listing'),
    function(msg)
      local id = msg.Tags['Listing-Id']
      local listing = BMR.Listings[id]
      if not listing then
        ao.send({ Target = msg.From, Data = json.encode({ error = 'Unknown listing' }) })
        return
      end
      if listing.seller ~= msg.From then
        ao.send({ Target = msg.From, Data = json.encode({ error = 'Not the seller' }) })
        return
      end
      if listing.status == 'sold' or listing.status == 'cancelled' then
        ao.send({ Target = msg.From, Data = json.encode({ error = 'Listing already ' .. listing.status }) })
        return
      end
      -- Auctions with active bids can't be cancelled — escape valve only.
      if listing.isAuction and listing.auction and listing.auction.currentBid then
        ao.send({ Target = msg.From, Data = json.encode({ error = 'Cannot cancel auction with active bid' }) })
        return
      end
      listing.status = 'cancelled'
      BMR.Listings[id] = listing
      ao.send({
        Target = msg.From,
        Data = json.encode({ ok = true, listing = listing }),
        Tags = {
          { name = 'Action', value = 'Cancel-Listing-Notice' },
          { name = 'Listing-Id', value = id },
        },
      })
    end
  )
end

return { register = register }
