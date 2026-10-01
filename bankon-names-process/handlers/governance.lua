-- Governance handler — admin-only knobs. v1 has a single controller list;
-- v2 will add BANKON-token-weighted voting on top.
--
-- Actions:
--   Set-Policy          — admin-only mutation of the Policy table
--   Set-Treasury        — admin-only mutation of the Treasury table
--   Add-Controller      — admin-only controller-list extension
--   Remove-Controller   — admin-only controller-list shrink

local json = require('json')

local function isController(addr)
  for _, c in ipairs(BNR.Controllers) do
    if c == addr then return true end
  end
  return false
end

local function denyIfNotController(msg)
  if not isController(msg.From) then
    ao.send({ Target = msg.From, Data = json.encode({ error = 'Not authorized (controller-only)' }) })
    return false
  end
  return true
end

local function register()
  -- Set-Policy: free-form key/value updates. v1 supports flat top-level keys
  -- plus a JSON-encoded body for nested updates (Costs / AcceptedMethods).
  Handlers.add('set-policy',
    Handlers.utils.hasMatchingTag('Action', 'Set-Policy'),
    function(msg)
      if not denyIfNotController(msg) then return end
      local body = nil
      if msg.Data and #msg.Data > 0 then
        local ok, parsed = pcall(function() return json.decode(msg.Data) end)
        if ok and type(parsed) == 'table' then body = parsed end
      end
      if body then
        for k, v in pairs(body) do BNR.Policy[k] = v end
      end
      -- Flat tag-level overrides take precedence over the body.
      if msg.Tags['OpenBeta'] ~= nil then BNR.Policy.OpenBeta = msg.Tags['OpenBeta'] == 'true' end
      if msg.Tags['LeaseYearsMin'] then BNR.Policy.LeaseYearsMin = tonumber(msg.Tags['LeaseYearsMin']) end
      if msg.Tags['LeaseYearsMax'] then BNR.Policy.LeaseYearsMax = tonumber(msg.Tags['LeaseYearsMax']) end
      ao.send({ Target = msg.From, Data = json.encode({ ok = true, policy = BNR.Policy }) })
    end
  )

  Handlers.add('set-treasury',
    Handlers.utils.hasMatchingTag('Action', 'Set-Treasury'),
    function(msg)
      if not denyIfNotController(msg) then return end
      local method = msg.Tags['Payment-Method']
      local addr = msg.Tags['Address']
      if not method or not addr then
        ao.send({ Target = msg.From, Data = json.encode({ error = 'Payment-Method and Address required' }) })
        return
      end
      BNR.Treasury[method] = addr
      ao.send({ Target = msg.From, Data = json.encode({ ok = true, treasury = BNR.Treasury }) })
    end
  )

  Handlers.add('add-controller',
    Handlers.utils.hasMatchingTag('Action', 'Add-Controller'),
    function(msg)
      if not denyIfNotController(msg) then return end
      local addr = msg.Tags['Address']
      if not addr or addr == '' then
        ao.send({ Target = msg.From, Data = json.encode({ error = 'Address required' }) })
        return
      end
      if isController(addr) then
        ao.send({ Target = msg.From, Data = json.encode({ error = 'Already a controller' }) })
        return
      end
      table.insert(BNR.Controllers, addr)
      ao.send({ Target = msg.From, Data = json.encode({ ok = true, controllers = BNR.Controllers }) })
    end
  )

  Handlers.add('remove-controller',
    Handlers.utils.hasMatchingTag('Action', 'Remove-Controller'),
    function(msg)
      if not denyIfNotController(msg) then return end
      local addr = msg.Tags['Address']
      if #BNR.Controllers <= 1 then
        ao.send({ Target = msg.From, Data = json.encode({ error = 'Cannot remove the last controller' }) })
        return
      end
      local kept = {}
      for _, c in ipairs(BNR.Controllers) do
        if c ~= addr then table.insert(kept, c) end
      end
      BNR.Controllers = kept
      ao.send({ Target = msg.From, Data = json.encode({ ok = true, controllers = BNR.Controllers }) })
    end
  )
end

return { register = register }
