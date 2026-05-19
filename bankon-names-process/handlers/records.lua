-- Record handlers:
--   Set-Record     — set the @ (root) target or an undername target
--   Get-Record     — read one record (also exposed as Record for ArNS parity)
--   Reserved-Name  — read a reservation
--   Records        — paginated list (cursor-based, simple)
--   Resolve        — resolve a name to its target (read-only convenience)
--
-- Tag schema for Set-Record:
--   Action          = 'Set-Record'
--   Name            = '<name>'
--   Sub-Domain      = '@' | '<subname>'
--   Transaction-Id  = '<43-char base64url>'
--   TTL-Seconds     = number?

local json = require('json')

local function isValidTxId(s)
  return type(s) == 'string' and #s == 43 and s:match('^[A-Za-z0-9_-]+$') ~= nil
end

local function register()
  -- ── Set-Record ─────────────────────────────────────────────
  Handlers.add('set-record',
    Handlers.utils.hasMatchingTag('Action', 'Set-Record'),
    function(msg)
      local name = (msg.Tags.Name or ''):lower()
      local sub = msg.Tags['Sub-Domain'] or '@'
      local txId = msg.Tags['Transaction-Id'] or ''
      local ttl = tonumber(msg.Tags['TTL-Seconds']) or BNR.Policy.RootTtlSecondsDefault
      local rec = BNR.Records[name]

      if not rec then
        ao.send({ Target = msg.From, Data = json.encode({ error = 'Name not registered: ' .. name }) })
        return
      end
      if rec.owner ~= msg.From then
        ao.send({ Target = msg.From, Data = json.encode({ error = 'Not the owner of ' .. name }) })
        return
      end
      if not isValidTxId(txId) then
        ao.send({ Target = msg.From, Data = json.encode({ error = 'Transaction-Id must be 43-char base64url' }) })
        return
      end
      if sub == '@' then
        rec.target = txId
        rec.ttlSeconds = ttl
      else
        local undernameCount = 0
        for _ in pairs(rec.undernames) do undernameCount = undernameCount + 1 end
        if not rec.undernames[sub] and undernameCount >= (rec.undernameLimit or BNR.Policy.UndernameLimitDefault) then
          ao.send({ Target = msg.From, Data = json.encode({ error = 'Undername limit reached', limit = rec.undernameLimit }) })
          return
        end
        rec.undernames[sub] = { transactionId = txId, ttlSeconds = ttl }
      end
      BNR.Records[name] = rec

      ao.send({
        Target = msg.From,
        Data = json.encode({ ok = true, name = name, subDomain = sub, transactionId = txId, ttlSeconds = ttl }),
        Tags = {
          { name = 'Action', value = 'Set-Record-Notice' },
          { name = 'Name', value = name },
          { name = 'Sub-Domain', value = sub },
        },
      })
    end
  )

  -- ── Get-Record / Record (ArNS parity) ──────────────────────
  local function recordResponder(msg)
    local name = (msg.Tags.Name or ''):lower()
    local rec = BNR.Records[name]
    if not rec then
      ao.send({ Target = msg.From, Data = 'null' })
      return
    end
    ao.send({ Target = msg.From, Data = json.encode(rec) })
  end
  Handlers.add('get-record', Handlers.utils.hasMatchingTag('Action', 'Get-Record'), recordResponder)
  Handlers.add('record', Handlers.utils.hasMatchingTag('Action', 'Record'), recordResponder)

  -- ── Reserved-Name ──────────────────────────────────────────
  Handlers.add('reserved-name',
    Handlers.utils.hasMatchingTag('Action', 'Reserved-Name'),
    function(msg)
      local name = (msg.Tags.Name or ''):lower()
      local r = BNR.Reserved[name]
      if not r then
        ao.send({ Target = msg.From, Data = 'null' })
        return
      end
      ao.send({ Target = msg.From, Data = json.encode(r) })
    end
  )

  -- ── Records (paginated) ────────────────────────────────────
  -- Cursor = the lex-greater name we've already shown. Simple sweep over
  -- the table sorted by key. v1 keeps it minimal; v2 can keep an index
  -- sorted in state if the namespace grows past tens of thousands.
  Handlers.add('records-list',
    Handlers.utils.hasMatchingTag('Action', 'Paginated-Records'),
    function(msg)
      local limit = tonumber(msg.Tags.Limit) or 100
      local cursor = msg.Tags.Cursor or ''
      local keys = {}
      for k in pairs(BNR.Records) do
        if k > cursor then table.insert(keys, k) end
      end
      table.sort(keys)
      local items = {}
      for i = 1, math.min(limit, #keys) do
        items[i] = { name = keys[i], record = BNR.Records[keys[i]] }
      end
      local nextCursor = #items > 0 and items[#items].name or ''
      ao.send({
        Target = msg.From,
        Data = json.encode({ items = items, nextCursor = nextCursor, hasMore = #keys > #items }),
      })
    end
  )

  -- ── Resolve (read-only convenience) ────────────────────────
  -- Single call: name -> resolved target + undernames + ttl. Used by the
  -- standalone permaweb resolver SPA so it doesn't have to assemble two
  -- separate responses.
  Handlers.add('resolve',
    Handlers.utils.hasMatchingTag('Action', 'Resolve'),
    function(msg)
      local name = (msg.Tags.Name or ''):lower()
      local rec = BNR.Records[name]
      if not rec then
        ao.send({ Target = msg.From, Data = 'null' })
        return
      end
      ao.send({
        Target = msg.From,
        Data = json.encode({
          target = rec.target,
          ttlSeconds = rec.ttlSeconds,
          undernames = rec.undernames,
          owner = rec.owner,
          type = rec.type,
          endTimestamp = rec.endTimestamp,
        }),
      })
    end
  )

  -- ── Get-Owned-Records (filter by owner) ───────────────────
  Handlers.add('get-owned-records',
    Handlers.utils.hasMatchingTag('Action', 'Get-Owned-Records'),
    function(msg)
      local owner = msg.Tags.Owner or msg.From
      local items = {}
      for name, rec in pairs(BNR.Records) do
        if rec.owner == owner then
          table.insert(items, { name = name, record = rec })
        end
      end
      ao.send({ Target = msg.From, Data = json.encode(items) })
    end
  )
end

return { register = register }
