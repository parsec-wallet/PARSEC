-- Settle-Trade — verify payment + initiate outbound asset transfer.
--
-- Tags:
--   Action          = 'Settle-Trade'
--   Listing-Id      = '<id>'
--   Offer-Id        = '<id>'                 (optional — bound to a previously-accepted offer)
--   Payment-Method  = 'ario' | 'algorand' | 'arweave-stake'
--   Payment-Proof   = '<tx id>'
--   Payment-Amount  = '<big-int>'            (must >= askPrice or current bid for auctions)
--
-- v1 trusts the signed Payment-Proof attestation (same model as BNR's
-- token-agnostic claim). The BMR records the trade and emits an outbound
-- Transfer message (BNR or ANT) to the buyer.
--
-- The outbound Transfer is signed by the BMR process key — AO processes
-- can hold an Arweave keypair created at spawn; the process key signs
-- DataItems whose `Owner` is the process's modulus. The actual key
-- handling happens at the process-runtime level; this handler just emits
-- the right Send call.

local json = require('json')

local function feeAmount(price, basisPoints)
  -- price * basisPoints / 10000, integer division.
  local n = tonumber(price) or 0
  return tostring(math.floor(n * basisPoints / 10000))
end

local function net(price, basisPoints)
  local n = tonumber(price) or 0
  local fee = math.floor(n * basisPoints / 10000)
  return tostring(n - fee)
end

local function bigGte(a, b)
  if #a > #b then return true end
  if #a < #b then return false end
  return a >= b
end

local function register()
  Handlers.add('settle-trade',
    Handlers.utils.hasMatchingTag('Action', 'Settle-Trade'),
    function(msg)
      local id = msg.Tags['Listing-Id']
      local listing = BMR.Listings[id]
      if not listing then
        ao.send({ Target = msg.From, Data = json.encode({ error = 'Unknown listing' }) })
        return
      end
      if listing.status ~= 'escrowed' then
        ao.send({ Target = msg.From, Data = json.encode({ error = 'Listing not escrowed', status = listing.status }) })
        return
      end

      -- Determine the price: auction settle uses currentBid; fixed-price
      -- uses askPrice (or the accepted-offer price, if Offer-Id supplied).
      local price = listing.askPrice
      if listing.isAuction and listing.auction and listing.auction.currentBid then
        price = listing.auction.currentBid
      end
      local offerId = msg.Tags['Offer-Id']
      if offerId then
        local offer = BMR.Offers[offerId]
        if not offer or offer.listingId ~= id or offer.status ~= 'accepted' then
          ao.send({ Target = msg.From, Data = json.encode({ error = 'Offer not accepted for this listing' }) })
          return
        end
        price = offer.offerPrice
      end

      local paymentMethod = msg.Tags['Payment-Method'] or 'ario'
      local paymentProof = msg.Tags['Payment-Proof']
      local paymentAmount = msg.Tags['Payment-Amount'] or '0'
      if not paymentProof or paymentProof == '' then
        ao.send({ Target = msg.From, Data = json.encode({ error = 'Payment-Proof required' }) })
        return
      end
      if not paymentAmount:match('^%d+$') or not bigGte(paymentAmount, price) then
        ao.send({ Target = msg.From, Data = json.encode({ error = 'Payment-Amount < price', price = price }) })
        return
      end

      -- Mark sold.
      local now = msg.Timestamp or os.time() * 1000
      listing.status = 'sold'
      listing.buyer = msg.From
      listing.soldAt = now
      BMR.Listings[id] = listing

      local fee = feeAmount(price, BMR.Policy.FeeBasisPoints)
      local sellerNet = net(price, BMR.Policy.FeeBasisPoints)
      BMR.Trades[id] = {
        listingId = id,
        seller = listing.seller,
        buyer = msg.From,
        price = price,
        fee = fee,
        sellerNet = sellerNet,
        paymentMethod = paymentMethod,
        paymentProof = paymentProof,
        ts = now,
      }

      -- Emit the outbound asset transfer. In v1 the BMR sends a Transfer
      -- message to the namespace's owning process; the AO runtime signs
      -- the DataItem on behalf of the process.
      if listing.namespace == 'bankon' then
        -- BNR Transfer.
        Send({
          Target = ao.env.Process.Tags['Bnr-Process-Id'] or '',
          Tags = {
            { name = 'Action', value = 'Transfer' },
            { name = 'Name', value = listing.name },
            { name = 'Recipient', value = msg.From },
          },
        })
      else
        -- ArNS ANT Transfer — target is the ANT process; we'd need the
        -- listing to record the ANT process id when escrowed (see escrow.lua).
        -- For v1 we emit a generic notice; the client side observes and
        -- the BMR controller wraps the actual ANT transfer.
        Send({
          Target = listing.seller,  -- placeholder; v2 records ANT process id.
          Tags = {
            { name = 'Action', value = 'Pending-Ant-Transfer' },
            { name = 'Name', value = listing.name },
            { name = 'Recipient', value = msg.From },
          },
        })
      end

      ao.send({
        Target = msg.From,
        Data = json.encode({ ok = true, trade = BMR.Trades[id] }),
        Tags = {
          { name = 'Action', value = 'Settle-Trade-Notice' },
          { name = 'Listing-Id', value = id },
        },
      })
    end
  )
end

return { register = register }
