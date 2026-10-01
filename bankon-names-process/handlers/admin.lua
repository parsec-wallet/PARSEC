-- Admin / bootstrap handler.
-- Runs once at process boot to seed the reserved-name list. Subsequent
-- reservation mutations go through Set-Reserved (controller-only).
--
-- Bootstrap reservations target the spawn signer so the deploying address
-- can later claim them with method=free. After they're claimed, the
-- reservation is cleared (see handlers/claim.lua).

local json = require('json')

local DEFAULT_RESERVED = {
  -- Core brand + project identifiers — never let randoms front-run these.
  'bankon',
  'parsec',
  'pythai',
  'cypherpunk',
  -- Standard system identifiers.
  'mainnet',
  'testnet',
  'devnet',
  'ar',
  'ao',
  'arweave',
  -- BANKON internal services (placeholders).
  'vault',
  'mausoleum',
  'tomb',
  'identity',
  'agents',
  'docs',
}

local function isController(addr)
  for _, c in ipairs(BNR.Controllers) do
    if c == addr then return true end
  end
  return false
end

local function seed()
  -- Idempotent: only seed if Reserved is empty.
  local count = 0
  for _ in pairs(BNR.Reserved) do count = count + 1 end
  if count > 0 then return end

  local target = ''
  if #BNR.Controllers > 0 then target = BNR.Controllers[1] end
  for _, name in ipairs(DEFAULT_RESERVED) do
    BNR.Reserved[name] = { target = target, reason = 'bootstrap' }
  end
end

local function register()
  seed()

  Handlers.add('set-reserved',
    Handlers.utils.hasMatchingTag('Action', 'Set-Reserved'),
    function(msg)
      if not isController(msg.From) then
        ao.send({ Target = msg.From, Data = json.encode({ error = 'Not authorized' }) })
        return
      end
      local name = (msg.Tags.Name or ''):lower()
      local target = msg.Tags.Target or ''
      local reason = msg.Tags.Reason or 'manual'
      if name == '' then
        ao.send({ Target = msg.From, Data = json.encode({ error = 'Name required' }) })
        return
      end
      BNR.Reserved[name] = { target = target, reason = reason }
      ao.send({ Target = msg.From, Data = json.encode({ ok = true, name = name, reserved = BNR.Reserved[name] }) })
    end
  )

  Handlers.add('clear-reserved',
    Handlers.utils.hasMatchingTag('Action', 'Clear-Reserved'),
    function(msg)
      if not isController(msg.From) then
        ao.send({ Target = msg.From, Data = json.encode({ error = 'Not authorized' }) })
        return
      end
      local name = (msg.Tags.Name or ''):lower()
      BNR.Reserved[name] = nil
      ao.send({ Target = msg.From, Data = json.encode({ ok = true, name = name }) })
    end
  )
end

return { register = register }
