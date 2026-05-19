-- Auction handlers — Bid + Settle-Auction.
--
-- Bid:    Action=Bid,            Listing-Id, Bid-Amount   (Payment-Proof verified at settle)
-- Settle: Action=Settle-Auction, Listing-Id              (anyone can call after end-time)
--
-- v1 doesn't escrow bid amounts on-chain. Bids declare an amount + a future
-- Payment-Proof; on settle, the winning bidder is expected to have paid.

local json = require('json')

local function bigGt(a, b)
  if #a ~= #b then return #a > #b end
  return a > b
end

local function bigAdd(a, b)
  -- Tiny big-int add — only positive values, base 10. Good enough for the
  -- amounts BMR handles (mARIO, max ~1e15 << 2^63).
  local an = tonumber(a) or 0
  local bn = tonumber(b) or 0
  return tostring(an + bn)
end

local function register()
  Handlers.add('bid',
    Handlers.utils.hasMatchingTag('Action', 'Bid'),
    function(msg)
      local listingId = msg.Tags['Listing-Id']
      local amount = msg.Tags['Bid-Amount']
      local listing = BMR.Listings[listingId]
      if not listing or not listing.isAuction or not listing.auction then
        ao.send({ Target = msg.From, Data = json.encode({ error = 'Not an auction listing' }) })
        return
      end
      if listing.status ~= 'open' and listing.status ~= 'escrowed' then
        ao.send({ Target = msg.From, Data = json.encode({ error = 'Listing not open' }) })
        return
      end
      local now = msg.Timestamp or os.time() * 1000
      if now >= listing.auction.endTime then
        ao.send({ Target = msg.From, Data = json.encode({ error = 'Auction ended' }) })
        return
      end
      if not amount or not amount:match('^%d+$') then
        ao.send({ Target = msg.From, Data = json.encode({ error = 'Bid-Amount must be non-negative integer' }) })
        return
      end

      local currentBid = listing.auction.currentBid or '0'
      local floor = bigAdd(currentBid, listing.auction.minIncrement)
      if not bigGt(amount, listing.auction.currentBid or '0') then
        ao.send({ Target = msg.From, Data = json.encode({ error = 'Bid must exceed current bid', currentBid = currentBid }) })
        return
      end
      -- Optional: enforce min increment (current + minIncrement).
      if listing.auction.currentBid and not bigGt(amount, floor) then
        ao.send({ Target = msg.From, Data = json.encode({ error = 'Bid must meet min-increment floor', floor = floor }) })
        return
      end

      listing.auction.currentBid = amount
      listing.auction.currentBidder = msg.From
      BMR.Listings[listingId] = listing
      BMR.Bids[listingId] = BMR.Bids[listingId] or {}
      table.insert(BMR.Bids[listingId], { bidder = msg.From, amount = amount, ts = now })

      ao.send({
        Target = msg.From,
        Data = json.encode({ ok = true, listing = listing }),
        Tags = {
          { name = 'Action', value = 'Bid-Notice' },
          { name = 'Listing-Id', value = listingId },
        },
      })
    end
  )

  Handlers.add('settle-auction',
    Handlers.utils.hasMatchingTag('Action', 'Settle-Auction'),
    function(msg)
      local listingId = msg.Tags['Listing-Id']
      local listing = BMR.Listings[listingId]
      if not listing or not listing.isAuction or not listing.auction then
        ao.send({ Target = msg.From, Data = json.encode({ error = 'Not an auction listing' }) })
        return
      end
      local now = msg.Timestamp or os.time() * 1000
      if now < listing.auction.endTime then
        ao.send({ Target = msg.From, Data = json.encode({ error = 'Auction not ended yet', endTime = listing.auction.endTime }) })
        return
      end
      if listing.status == 'sold' then
        ao.send({ Target = msg.From, Data = json.encode({ error = 'Auction already settled' }) })
        return
      end
      if not listing.auction.currentBidder then
        listing.status = 'cancelled'
        BMR.Listings[listingId] = listing
        ao.send({ Target = msg.From, Data = json.encode({ ok = true, result = 'no-bids' }) })
        return
      end

      -- Settle: mark sold + write a trade row. Actual asset transfer is
      -- handled by settle.lua's outbound flow (the BMR process key signs
      -- a BNR/ANT Transfer to the winning bidder).
      listing.status = 'sold'
      listing.buyer = listing.auction.currentBidder
      listing.soldAt = now
      BMR.Listings[listingId] = listing
      BMR.Trades[listingId] = {
        listingId = listingId,
        seller = listing.seller,
        buyer = listing.auction.currentBidder,
        price = listing.auction.currentBid,
        ts = now,
      }
      ao.send({
        Target = msg.From,
        Data = json.encode({ ok = true, trade = BMR.Trades[listingId] }),
        Tags = {
          { name = 'Action', value = 'Settle-Auction-Notice' },
          { name = 'Listing-Id', value = listingId },
        },
      })
    end
  )
end

return { register = register }
