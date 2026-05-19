-- BMR governance — controller-only knobs.
--   Set-Policy: fee bps, accepted namespaces, pause toggle, durations.
--   Set-Treasury: BMR.Treasury address.
--   Add-Controller / Remove-Controller.
--   Pause / Resume — short-circuit listings during incidents.

local json = require('json')

local function isController(addr)
  for _, c in ipairs(BMR.Controllers) do if c == addr then return true end end
  return false
end

local function deny(msg)
  if not isController(msg.From) then
    ao.send({ Target = msg.From, Data = json.encode({ error = 'Not authorized' }) })
    return true
  end
  return false
end

local function register()
  Handlers.add('set-policy',
    Handlers.utils.hasMatchingTag('Action', 'Set-Policy'),
    function(msg)
      if deny(msg) then return end
      if msg.Tags['Fee-Basis-Points'] then
        local bp = tonumber(msg.Tags['Fee-Basis-Points']) or BMR.Policy.FeeBasisPoints
        if bp < 0 or bp > 5000 then
          ao.send({ Target = msg.From, Data = json.encode({ error = 'Fee-Basis-Points must be 0-5000' }) })
          return
        end
        BMR.Policy.FeeBasisPoints = bp
      end
      if msg.Tags['Paused'] then
        BMR.Policy.Paused = msg.Tags['Paused'] == 'true'
      end
      if msg.Data and #msg.Data > 0 then
        local ok, parsed = pcall(function() return json.decode(msg.Data) end)
        if ok and type(parsed) == 'table' then
          for k, v in pairs(parsed) do BMR.Policy[k] = v end
        end
      end
      ao.send({ Target = msg.From, Data = json.encode({ ok = true, policy = BMR.Policy }) })
    end
  )

  Handlers.add('set-treasury',
    Handlers.utils.hasMatchingTag('Action', 'Set-Treasury'),
    function(msg)
      if deny(msg) then return end
      local addr = msg.Tags['Address']
      if not addr or addr == '' then
        ao.send({ Target = msg.From, Data = json.encode({ error = 'Address required' }) })
        return
      end
      BMR.Treasury = addr
      ao.send({ Target = msg.From, Data = json.encode({ ok = true, treasury = BMR.Treasury }) })
    end
  )

  Handlers.add('add-controller',
    Handlers.utils.hasMatchingTag('Action', 'Add-Controller'),
    function(msg)
      if deny(msg) then return end
      local addr = msg.Tags['Address']
      if not addr or addr == '' then
        ao.send({ Target = msg.From, Data = json.encode({ error = 'Address required' }) })
        return
      end
      if isController(addr) then
        ao.send({ Target = msg.From, Data = json.encode({ error = 'Already a controller' }) })
        return
      end
      table.insert(BMR.Controllers, addr)
      ao.send({ Target = msg.From, Data = json.encode({ ok = true, controllers = BMR.Controllers }) })
    end
  )

  Handlers.add('remove-controller',
    Handlers.utils.hasMatchingTag('Action', 'Remove-Controller'),
    function(msg)
      if deny(msg) then return end
      if #BMR.Controllers <= 1 then
        ao.send({ Target = msg.From, Data = json.encode({ error = 'Cannot remove the last controller' }) })
        return
      end
      local addr = msg.Tags['Address']
      local kept = {}
      for _, c in ipairs(BMR.Controllers) do if c ~= addr then table.insert(kept, c) end end
      BMR.Controllers = kept
      ao.send({ Target = msg.From, Data = json.encode({ ok = true, controllers = BMR.Controllers }) })
    end
  )
end

return { register = register }
