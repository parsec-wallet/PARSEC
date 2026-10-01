-- Create-Listing — create a fixed-price or auction listing.
--
-- Tag schema:
--   Action          = 'Create-Listing'
--   Namespace       = 'bankon' | 'arns'
--   Name            = '<name>'
--   Ask-Price       = '<big-int, mARIO for v1>'
--   Currency        = 'ARIO'                    (only ARIO in v1)
--   Expires-At-Ms   = '<epoch ms>'              (optional; defaults to now + DefaultListingTtlMs)
--   Is-Auction      = 'true' | 'false'          (optional)
--   Min-Increment   = '<big-int>'               (auction only)
--   End-Time-Ms     = '<epoch ms>'              (auction only; must be > now + MinAuctionDurationMs)
--
-- The listing starts in `open` status. To activate (`escrowed`), the seller
-- must Transfer the asset to the BMR process id; the BMR's Receive-Asset
-- handler observes the inbound transfer and flips the status.

local json = require('json')

local function contains(list, v)
  for _, x in ipairs(list) do if x == v then return true end end
  return false
end

local function register()
  Handlers.add('create-listing',
    Handlers.utils.hasMatchingTag('Action', 'Create-Listing'),
    function(msg)
      if BMR.Policy.Paused then
        ao.send({ Target = msg.From, Data = json.encode({ error = 'Marketplace paused' }) })
        return
      end
      local namespace = msg.Tags.Namespace
      local name = (msg.Tags.Name or ''):lower()
      local askPrice = msg.Tags['Ask-Price']
      local currency = msg.Tags.Currency or 'ARIO'
      local isAuction = msg.Tags['Is-Auction'] == 'true'

      if not contains(BMR.Policy.AcceptedNamespaces, namespace) then
        ao.send({ Target = msg.From, Data = json.encode({ error = 'Unsupported namespace: ' .. tostring(namespace) }) })
        return
      end
      if not contains(BMR.Policy.AcceptedCurrencies, currency) then
        ao.send({ Target = msg.From, Data = json.encode({ error = 'Unsupported currency: ' .. tostring(currency) }) })
        return
      end
      if not name or name == '' then
        ao.send({ Target = msg.From, Data = json.encode({ error = 'Name required' }) })
        return
      end
      if not askPrice or askPrice == '' or not askPrice:match('^%d+$') then
        ao.send({ Target = msg.From, Data = json.encode({ error = 'Ask-Price must be a non-negative integer' }) })
        return
      end

      local now = msg.Timestamp or os.time() * 1000
      local expiresAt = tonumber(msg.Tags['Expires-At-Ms']) or (now + BMR.Policy.DefaultListingTtlMs)

      local listing = {
        id = msg.Id,
        seller = msg.From,
        namespace = namespace,
        name = name,
        askPrice = askPrice,
        currency = currency,
        expiresAt = expiresAt,
        isAuction = isAuction,
        auction = nil,
        status = 'open',
        createdAt = now,
      }
      if isAuction then
        local minInc = msg.Tags['Min-Increment'] or '0'
        local endTime = tonumber(msg.Tags['End-Time-Ms']) or 0
        if endTime <= now + BMR.Policy.MinAuctionDurationMs then
          ao.send({ Target = msg.From, Data = json.encode({ error = 'Auction End-Time-Ms must be at least MinAuctionDurationMs in the future' }) })
          return
        end
        if endTime > now + BMR.Policy.MaxAuctionDurationMs then
          ao.send({ Target = msg.From, Data = json.encode({ error = 'Auction End-Time-Ms exceeds MaxAuctionDurationMs' }) })
          return
        end
        if not minInc:match('^%d+$') then
          ao.send({ Target = msg.From, Data = json.encode({ error = 'Min-Increment must be non-negative integer' }) })
          return
        end
        listing.auction = {
          minIncrement = minInc,
          endTime = endTime,
          currentBid = nil,
          currentBidder = nil,
        }
        BMR.Bids[msg.Id] = {}
      end

      BMR.Listings[msg.Id] = listing
      ao.send({
        Target = msg.From,
        Data = json.encode({ ok = true, listing = listing }),
        Tags = {
          { name = 'Action', value = 'Create-Listing-Notice' },
          { name = 'Listing-Id', value = msg.Id },
        },
      })
    end
  )
end

return { register = register }
