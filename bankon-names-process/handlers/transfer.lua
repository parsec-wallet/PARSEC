-- Transfer handler — move a record's ownership.
--
-- Tag schema:
--   Action     = 'Transfer'
--   Name       = '<name>'
--   Recipient  = '<destination Arweave address>'

local json = require('json')

local function register()
  Handlers.add('transfer-name',
    Handlers.utils.hasMatchingTag('Action', 'Transfer'),
    function(msg)
      local name = (msg.Tags.Name or ''):lower()
      local recipient = msg.Tags.Recipient or ''
      local rec = BNR.Records[name]

      if not rec then
        ao.send({ Target = msg.From, Data = json.encode({ error = 'Name not registered: ' .. name }) })
        return
      end
      if rec.owner ~= msg.From then
        ao.send({ Target = msg.From, Data = json.encode({ error = 'Not the owner of ' .. name }) })
        return
      end
      if recipient == '' or #recipient < 32 or #recipient > 44 then
        ao.send({ Target = msg.From, Data = json.encode({ error = 'Invalid Recipient address' }) })
        return
      end

      -- Drop the old primary-name binding so the previous owner doesn't
      -- keep a stale primary pointing to a name they no longer control.
      if BNR.PrimaryNames[msg.From] == name then
        BNR.PrimaryNames[msg.From] = nil
      end

      rec.owner = recipient
      rec.processId = recipient
      BNR.Records[name] = rec

      ao.send({
        Target = msg.From,
        Data = json.encode({ ok = true, name = name, record = rec }),
        Tags = {
          { name = 'Action', value = 'Transfer-Notice' },
          { name = 'Name', value = name },
          { name = 'Recipient', value = recipient },
        },
      })
    end
  )
end

return { register = register }
