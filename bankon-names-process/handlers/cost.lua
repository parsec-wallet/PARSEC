-- Token-Cost handler — returns the cost of an intent in the unit of the
-- requested Payment-Method. Mirror of AR.IO Registry's Token-Cost, but
-- our cost table is indexed by [Intent][Method][PurchaseType].
--
-- Tag schema:
--   Action          = 'Token-Cost'
--   Intent          = 'Buy-Name' | 'Extend-Lease' | ...
--   Payment-Method  = 'free' | 'algorand' | 'arweave-stake' | 'bankon'
--   Purchase-Type   = 'lease' | 'permabuy'    (optional, defaults to lease)
--   Years           = number?                  (multiplier for time-scaled costs)
--   Name            = '<name>'                 (currently ignored; future: length-based pricing)

local json = require('json')

local function register()
  Handlers.add('token-cost',
    Handlers.utils.hasMatchingTag('Action', 'Token-Cost'),
    function(msg)
      local intent = msg.Tags.Intent or 'Buy-Name'
      local method = msg.Tags['Payment-Method'] or 'free'
      local purchaseType = msg.Tags['Purchase-Type'] or 'lease'
      local years = tonumber(msg.Tags.Years) or 1

      local intentCosts = BNR.Policy.Costs[intent]
      if not intentCosts then
        ao.send({ Target = msg.From, Data = json.encode({ error = 'Unknown intent: ' .. intent }) })
        return
      end
      local methodCosts = intentCosts[method]
      if not methodCosts then
        ao.send({ Target = msg.From, Data = json.encode({ error = 'No cost defined for method: ' .. method }) })
        return
      end
      local baseCost = methodCosts[purchaseType]
      if not baseCost then
        ao.send({ Target = msg.From, Data = json.encode({ error = 'No cost defined for purchase type: ' .. purchaseType }) })
        return
      end

      -- Scale by years for leases. We use string arithmetic via Lua numbers
      -- since costs are well under 2^53. AO clients still parse the
      -- response as a string for big-int safety.
      local n = tonumber(baseCost) or 0
      if purchaseType == 'lease' then n = n * years end

      ao.send({
        Target = msg.From,
        Data = tostring(math.floor(n)),
        Tags = {
          { name = 'Method', value = method },
          { name = 'Intent', value = intent },
          { name = 'Years', value = tostring(years) },
        },
      })
    end
  )

  -- Cost-Details — richer breakdown for the UI (intent, method, base, scaled, treasury).
  Handlers.add('cost-details',
    Handlers.utils.hasMatchingTag('Action', 'Cost-Details'),
    function(msg)
      local intent = msg.Tags.Intent or 'Buy-Name'
      local method = msg.Tags['Payment-Method'] or 'free'
      local purchaseType = msg.Tags['Purchase-Type'] or 'lease'
      local years = tonumber(msg.Tags.Years) or 1
      local intentCosts = BNR.Policy.Costs[intent] or {}
      local methodCosts = intentCosts[method] or {}
      local baseCost = tonumber(methodCosts[purchaseType] or '0') or 0
      local scaled = purchaseType == 'lease' and baseCost * years or baseCost
      ao.send({
        Target = msg.From,
        Data = json.encode({
          intent = intent,
          method = method,
          purchaseType = purchaseType,
          years = years,
          baseCost = tostring(math.floor(baseCost)),
          scaledCost = tostring(math.floor(scaled)),
          treasury = BNR.Treasury[method] or '',
          acceptedMethods = BNR.Policy.AcceptedMethods,
          openBeta = BNR.Policy.OpenBeta,
        }),
      })
    end
  )
end

return { register = register }
