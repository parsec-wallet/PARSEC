-- Fee accounting — exposes the running fee totals + lets the controller
-- withdraw to the configured treasury (v1: a notional balance; v2 will
-- emit actual outbound ARIO transfers from the BMR's wallet).

local json = require('json')

local function bigAdd(a, b)
  local an = tonumber(a) or 0
  local bn = tonumber(b) or 0
  return tostring(an + bn)
end

local function isController(addr)
  for _, c in ipairs(BMR.Controllers) do if c == addr then return true end end
  return false
end

if BMR.FeesAccrued == nil then BMR.FeesAccrued = '0' end

local function register()
  -- Internal: callable by other handlers (see settle.lua) via Send.
  Handlers.add('record-fee',
    Handlers.utils.hasMatchingTag('Action', 'Record-Fee'),
    function(msg)
      if msg.From ~= ao.id then
        -- Only the BMR can self-call this. Reject foreign callers.
        return
      end
      local amount = msg.Tags['Amount'] or '0'
      if amount:match('^%d+$') then
        BMR.FeesAccrued = bigAdd(BMR.FeesAccrued, amount)
      end
    end
  )

  Handlers.add('fees-info',
    Handlers.utils.hasMatchingTag('Action', 'Fees-Info'),
    function(msg)
      ao.send({
        Target = msg.From,
        Data = json.encode({
          feesAccrued = BMR.FeesAccrued,
          feeBasisPoints = BMR.Policy.FeeBasisPoints,
          treasury = BMR.Treasury,
        }),
      })
    end
  )

  Handlers.add('withdraw-fees',
    Handlers.utils.hasMatchingTag('Action', 'Withdraw-Fees'),
    function(msg)
      if not isController(msg.From) then
        ao.send({ Target = msg.From, Data = json.encode({ error = 'Not authorized' }) })
        return
      end
      -- v1: just zero the counter — actual outbound transfer happens
      -- off-band (the controller pulls from the BMR's wallet manually).
      local snapshot = BMR.FeesAccrued
      BMR.FeesAccrued = '0'
      ao.send({
        Target = msg.From,
        Data = json.encode({ ok = true, withdrew = snapshot, treasury = BMR.Treasury }),
      })
    end
  )
end

return { register = register }
