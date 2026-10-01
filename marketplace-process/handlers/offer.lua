-- Offer flow — buyer-initiated bids on fixed-price listings.
--
-- Tags:
--   Make-Offer:   Action=Make-Offer, Listing-Id, Offer-Price, Expires-At-Ms?
--   Cancel-Offer: Action=Cancel-Offer, Offer-Id
--   Accept-Offer: Action=Accept-Offer, Offer-Id  (seller-only)
--   Reject-Offer: Action=Reject-Offer, Offer-Id  (seller-only)
--
-- v1 doesn't custody offer escrow on-chain (no programmatic ARIO custody on
-- AO side). The buyer's accepted-offer payment is verified at Settle-Trade
-- via Payment-Proof tags (same model as BNR Buy-Name's Payment-Method).

local json = require('json')

local function register()
  Handlers.add('make-offer',
    Handlers.utils.hasMatchingTag('Action', 'Make-Offer'),
    function(msg)
      local listingId = msg.Tags['Listing-Id']
      local listing = BMR.Listings[listingId]
      if not listing then
        ao.send({ Target = msg.From, Data = json.encode({ error = 'Unknown listing' }) })
        return
      end
      if listing.status ~= 'open' and listing.status ~= 'escrowed' then
        ao.send({ Target = msg.From, Data = json.encode({ error = 'Listing not open' }) })
        return
      end
      if listing.isAuction then
        ao.send({ Target = msg.From, Data = json.encode({ error = 'Use Bid on auction listings' }) })
        return
      end
      local offerPrice = msg.Tags['Offer-Price']
      if not offerPrice or not offerPrice:match('^%d+$') then
        ao.send({ Target = msg.From, Data = json.encode({ error = 'Offer-Price must be non-negative integer' }) })
        return
      end
      local now = msg.Timestamp or os.time() * 1000
      local expiresAt = tonumber(msg.Tags['Expires-At-Ms']) or (now + 24 * 60 * 60 * 1000)
      local offer = {
        id = msg.Id,
        listingId = listingId,
        buyer = msg.From,
        offerPrice = offerPrice,
        expiresAt = expiresAt,
        status = 'pending',
      }
      BMR.Offers[msg.Id] = offer
      ao.send({ Target = msg.From, Data = json.encode({ ok = true, offer = offer }) })
    end
  )

  Handlers.add('cancel-offer',
    Handlers.utils.hasMatchingTag('Action', 'Cancel-Offer'),
    function(msg)
      local id = msg.Tags['Offer-Id']
      local offer = BMR.Offers[id]
      if not offer then
        ao.send({ Target = msg.From, Data = json.encode({ error = 'Unknown offer' }) })
        return
      end
      if offer.buyer ~= msg.From then
        ao.send({ Target = msg.From, Data = json.encode({ error = 'Not the offerer' }) })
        return
      end
      if offer.status ~= 'pending' then
        ao.send({ Target = msg.From, Data = json.encode({ error = 'Offer already ' .. offer.status }) })
        return
      end
      offer.status = 'cancelled'
      BMR.Offers[id] = offer
      ao.send({ Target = msg.From, Data = json.encode({ ok = true, offer = offer }) })
    end
  )

  Handlers.add('reject-offer',
    Handlers.utils.hasMatchingTag('Action', 'Reject-Offer'),
    function(msg)
      local id = msg.Tags['Offer-Id']
      local offer = BMR.Offers[id]
      if not offer then
        ao.send({ Target = msg.From, Data = json.encode({ error = 'Unknown offer' }) })
        return
      end
      local listing = BMR.Listings[offer.listingId]
      if not listing or listing.seller ~= msg.From then
        ao.send({ Target = msg.From, Data = json.encode({ error = 'Not the listing seller' }) })
        return
      end
      offer.status = 'rejected'
      BMR.Offers[id] = offer
      ao.send({ Target = msg.From, Data = json.encode({ ok = true, offer = offer }) })
    end
  )

  -- Accept-Offer is a seller-only signal — actual settlement happens in
  -- settle.lua once the buyer's Payment-Proof tag is verified.
  Handlers.add('accept-offer',
    Handlers.utils.hasMatchingTag('Action', 'Accept-Offer'),
    function(msg)
      local id = msg.Tags['Offer-Id']
      local offer = BMR.Offers[id]
      if not offer then
        ao.send({ Target = msg.From, Data = json.encode({ error = 'Unknown offer' }) })
        return
      end
      local listing = BMR.Listings[offer.listingId]
      if not listing or listing.seller ~= msg.From then
        ao.send({ Target = msg.From, Data = json.encode({ error = 'Not the listing seller' }) })
        return
      end
      offer.status = 'accepted'
      BMR.Offers[id] = offer
      ao.send({
        Target = msg.From,
        Data = json.encode({ ok = true, offer = offer, listing = listing }),
        Tags = {
          { name = 'Action', value = 'Accept-Offer-Notice' },
          { name = 'Offer-Id', value = id },
          { name = 'Listing-Id', value = offer.listingId },
        },
      })
    end
  )
end

return { register = register }
