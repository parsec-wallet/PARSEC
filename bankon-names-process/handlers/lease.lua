-- Lease handler — Extend-Lease.
--
-- Tag schema:
--   Action          = 'Extend-Lease'
--   Name            = '<name>'
--   Years           = number (1-5, summed with existing remainder)
--   Payment-Method  = '<method>'
--   Payment-Proof   = '<proof>'
--   Payment-Amount  = '<big-int>'

local json = require('json')

local function register()
  Handlers.add('extend-lease',
    Handlers.utils.hasMatchingTag('Action', 'Extend-Lease'),
    function(msg)
      local name = (msg.Tags.Name or ''):lower()
      local years = tonumber(msg.Tags.Years) or BNR.Policy.DefaultLeaseYears
      local method = msg.Tags['Payment-Method'] or 'free'
      local rec = BNR.Records[name]

      if not rec then
        ao.send({ Target = msg.From, Data = json.encode({ error = 'Name not registered' }) })
        return
      end
      if rec.owner ~= msg.From then
        ao.send({ Target = msg.From, Data = json.encode({ error = 'Not the owner of ' .. name }) })
        return
      end
      if rec.type ~= 'lease' then
        ao.send({ Target = msg.From, Data = json.encode({ error = 'Cannot extend a permabuy' }) })
        return
      end
      if years < BNR.Policy.LeaseYearsMin or years > BNR.Policy.LeaseYearsMax then
        ao.send({ Target = msg.From, Data = json.encode({ error = 'Years out of range', min = BNR.Policy.LeaseYearsMin, max = BNR.Policy.LeaseYearsMax }) })
        return
      end

      -- v1: trust the signed claim that payment proof was attached.
      -- v2 will reuse the same verifiers as claim.lua via a shared module.
      if not BNR.Policy.OpenBeta and method == 'free' then
        ao.send({ Target = msg.From, Data = json.encode({ error = 'Free Extend-Lease disabled' }) })
        return
      end

      local oneYearMs = 365 * 24 * 60 * 60 * 1000
      local base = math.max(rec.endTimestamp or 0, msg.Timestamp or os.time() * 1000)
      rec.endTimestamp = base + years * oneYearMs
      BNR.Records[name] = rec

      ao.send({
        Target = msg.From,
        Data = json.encode({ ok = true, name = name, record = rec }),
        Tags = {
          { name = 'Action', value = 'Extend-Lease-Notice' },
          { name = 'Name', value = name },
        },
      })
    end
  )
end

return { register = register }
