-- Primary name handler — set the name that a given owner address claims
-- as their canonical identity. Two-step like ArNS:
--
--   1. Owner sends Primary-Name-Request with Name = <their-name>. BNR
--      records the request keyed by msg.From.
--   2. The same address sends Primary-Name-Acknowledge. BNR upgrades the
--      request into a confirmed primary.
--
-- The acknowledge step exists so a record-owner can't be silently
-- assigned a primary they didn't pick (e.g. via Transfer).
--
-- Read: Get-Primary-Name returns the primary for an address (msg.From or
-- Tags.Owner). Used by Parsec UI and any dApp that wants to display
-- 'pythai' instead of an Arweave address.

local json = require('json')

local function register()
  -- request side
  Handlers.add('primary-name-request',
    Handlers.utils.hasMatchingTag('Action', 'Primary-Name-Request'),
    function(msg)
      local name = (msg.Tags.Name or ''):lower()
      local rec = BNR.Records[name]
      if not rec then
        ao.send({ Target = msg.From, Data = json.encode({ error = 'Name not registered' }) })
        return
      end
      if rec.owner ~= msg.From then
        ao.send({ Target = msg.From, Data = json.encode({ error = 'Not the owner of ' .. name }) })
        return
      end
      -- Store as a pending request keyed by the address.
      if BNR.PendingPrimary == nil then BNR.PendingPrimary = {} end
      BNR.PendingPrimary[msg.From] = name
      ao.send({
        Target = msg.From,
        Data = json.encode({ ok = true, pending = name }),
        Tags = {
          { name = 'Action', value = 'Primary-Name-Request-Notice' },
          { name = 'Name', value = name },
        },
      })
    end
  )

  -- acknowledge side
  Handlers.add('primary-name-acknowledge',
    Handlers.utils.hasMatchingTag('Action', 'Primary-Name-Acknowledge'),
    function(msg)
      if BNR.PendingPrimary == nil then BNR.PendingPrimary = {} end
      local pending = BNR.PendingPrimary[msg.From]
      if not pending then
        ao.send({ Target = msg.From, Data = json.encode({ error = 'No pending primary-name request' }) })
        return
      end
      BNR.PrimaryNames[msg.From] = pending
      BNR.PendingPrimary[msg.From] = nil
      ao.send({
        Target = msg.From,
        Data = json.encode({ ok = true, primary = pending }),
        Tags = {
          { name = 'Action', value = 'Primary-Name-Set' },
          { name = 'Name', value = pending },
        },
      })
    end
  )

  -- read side
  Handlers.add('get-primary-name',
    Handlers.utils.hasMatchingTag('Action', 'Get-Primary-Name'),
    function(msg)
      local owner = msg.Tags.Owner or msg.From
      local primary = BNR.PrimaryNames[owner]
      if not primary then
        ao.send({ Target = msg.From, Data = 'null' })
        return
      end
      ao.send({ Target = msg.From, Data = json.encode({ owner = owner, name = primary }) })
    end
  )
end

return { register = register }
