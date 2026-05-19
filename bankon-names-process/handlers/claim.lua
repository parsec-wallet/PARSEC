-- Buy-Name handler.
--
-- Token-agnostic: the message carries Payment-Method + Payment-Proof tags;
-- the handler dispatches to the verifier for that method. v1 verifiers
-- trust signed attestations (the message Owner is on record). v2 will
-- swap in oracle-verified proofs.
--
-- Tag schema (Buy-Name):
--   Action          = 'Buy-Name'
--   Name            = '<lowercase, [a-z0-9-]{1,32}>'
--   Purchase-Type   = 'lease' | 'permabuy'
--   Years           = number  (only for lease, 1-5)
--   Payment-Method  = 'free' | 'algorand' | 'arweave-stake' | 'bankon'
--   Payment-Proof   = '<method-specific proof string>'
--   Payment-Amount  = '<big-int string, in method-native unit>'
--   Undername-Limit = number?  (defaults to Policy.UndernameLimitDefault)

local json = require('json')

local function isValidName(name)
  if type(name) ~= 'string' then return false end
  if #name < 1 or #name > 32 then return false end
  return name:match('^[a-z0-9-]+$') ~= nil and name:sub(1,1) ~= '-' and name:sub(-1) ~= '-'
end

local function contains(list, v)
  for _, x in ipairs(list) do if x == v then return true end end
  return false
end

-- ── Payment verifiers ───────────────────────────────────────────
-- Each returns { ok = bool, reason = string?, amount = bigint-string }.
-- v1: trust signed attestation (squatter accountability = on-chain claim record).
-- v2 hook points marked TODO-V2.

local verifiers = {}

verifiers.free = function(_msg, _amount)
  if not BNR.Policy.OpenBeta then
    return { ok = false, reason = 'Free claims disabled' }
  end
  return { ok = true, amount = '0' }
end

verifiers.algorand = function(msg, declaredAmount)
  -- TODO-V2: dry-run an Algorand oracle process for the indicated txId
  -- and confirm it paid BNR.Treasury.algorand the declared microALGO.
  if BNR.Treasury.algorand == '' then
    return { ok = false, reason = 'ALGO treasury not configured' }
  end
  if not msg.Tags['Payment-Proof'] or msg.Tags['Payment-Proof'] == '' then
    return { ok = false, reason = 'Missing Payment-Proof (Algorand tx id)' }
  end
  return { ok = true, amount = declaredAmount }
end

verifiers['arweave-stake'] = function(msg, declaredAmount)
  -- TODO-V2: verify via Arweave-Oracle or via AR.IO Registry tx visibility.
  if BNR.Treasury['arweave-stake'] == '' then
    return { ok = false, reason = 'AR treasury not configured' }
  end
  if not msg.Tags['Payment-Proof'] or msg.Tags['Payment-Proof'] == '' then
    return { ok = false, reason = 'Missing Payment-Proof (Arweave tx id)' }
  end
  return { ok = true, amount = declaredAmount }
end

verifiers.bankon = function(_msg, _amount)
  return { ok = false, reason = 'BANKON token payment method not yet supported' }
end

-- ── Handler ─────────────────────────────────────────────────────

local function register()
  Handlers.add('buy-name',
    Handlers.utils.hasMatchingTag('Action', 'Buy-Name'),
    function(msg)
      local name = (msg.Tags.Name or ''):lower()
      local purchaseType = msg.Tags['Purchase-Type'] or 'lease'
      local yearsTag = msg.Tags.Years
      local method = msg.Tags['Payment-Method'] or 'free'
      local declaredAmount = msg.Tags['Payment-Amount'] or '0'

      if not isValidName(name) then
        ao.send({ Target = msg.From, Data = json.encode({ error = 'Invalid name (must match ^[a-z0-9-]{1,32}$ and not start/end with -)' }) })
        return
      end
      if BNR.Records[name] then
        ao.send({ Target = msg.From, Data = json.encode({ error = 'Name already registered', record = BNR.Records[name] }) })
        return
      end
      if BNR.Reserved[name] and (BNR.Reserved[name].target ~= msg.From) then
        ao.send({ Target = msg.From, Data = json.encode({ error = 'Name is reserved', reserved = BNR.Reserved[name] }) })
        return
      end
      if purchaseType ~= 'lease' and purchaseType ~= 'permabuy' then
        ao.send({ Target = msg.From, Data = json.encode({ error = 'Purchase-Type must be lease|permabuy' }) })
        return
      end
      if not contains(BNR.Policy.AcceptedMethods, method) then
        ao.send({ Target = msg.From, Data = json.encode({ error = 'Payment-Method not accepted', accepted = BNR.Policy.AcceptedMethods }) })
        return
      end

      local years = nil
      if purchaseType == 'lease' then
        years = tonumber(yearsTag or BNR.Policy.DefaultLeaseYears) or BNR.Policy.DefaultLeaseYears
        if years < BNR.Policy.LeaseYearsMin or years > BNR.Policy.LeaseYearsMax then
          ao.send({ Target = msg.From, Data = json.encode({ error = 'Years out of range', min = BNR.Policy.LeaseYearsMin, max = BNR.Policy.LeaseYearsMax }) })
          return
        end
      end

      local verifier = verifiers[method]
      if not verifier then
        ao.send({ Target = msg.From, Data = json.encode({ error = 'Unknown payment method: ' .. tostring(method) }) })
        return
      end
      local proof = verifier(msg, declaredAmount)
      if not proof.ok then
        ao.send({ Target = msg.From, Data = json.encode({ error = 'Payment proof rejected', reason = proof.reason }) })
        return
      end

      local now = (msg.Timestamp or os.time() * 1000)
      local oneYearMs = 365 * 24 * 60 * 60 * 1000
      local record = {
        processId = msg.From,
        owner = msg.From,
        type = purchaseType,
        startTimestamp = now,
        endTimestamp = (purchaseType == 'lease') and (now + (years or 1) * oneYearMs) or nil,
        undernameLimit = tonumber(msg.Tags['Undername-Limit']) or BNR.Policy.UndernameLimitDefault,
        purchasePrice = proof.amount,
        paymentMethod = method,
        target = nil,
        ttlSeconds = BNR.Policy.RootTtlSecondsDefault,
        undernames = {},
      }
      BNR.Records[name] = record
      -- Clear the reservation if this claim matched the reserved target.
      if BNR.Reserved[name] and BNR.Reserved[name].target == msg.From then
        BNR.Reserved[name] = nil
      end

      ao.send({
        Target = msg.From,
        Data = json.encode({ ok = true, name = name, record = record }),
        Tags = {
          { name = 'Action', value = 'Buy-Name-Notice' },
          { name = 'Name', value = name },
        },
      })
    end
  )
end

return { register = register }
