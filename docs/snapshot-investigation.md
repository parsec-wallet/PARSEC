# ARIO Solana Migration Snapshot — Investigation Report

**Date of investigation:** 2026-05-16
**Days to snapshot:** 16
**Sources consulted:**
- `https://ar.io/token/`
- `https://ar.io/solana-migration/`
- `https://docs.ar.io/learn/token`
- BaseScan: contract `0x138746adfa52909e5920def027f5a8dc1c7effb6`
- AO Compute Unit: `https://cu.ardrive.io` (live dry-run against `qNvAoz0TgcH7DMg8BCVn8jF32QH5L6T29VjHxhHqqGE`)

## Findings

### 1. Snapshot date

**June 1, 2026 — firm in published docs.** No extension or slip mentioned across `ar.io/solana-migration/`, `ar.io/token/`, or `docs.ar.io/learn/token`. Both `ar.io/token/` and `solana-migration/` carry the same "before June 1, 2026" registration cutoff.

**Status: confirmed.** No action; proceed with the migration handler.

### 2. Solana mint authority

**Not publicly disclosed.** The official docs ar.io publishes (token/, solana-migration/, docs.ar.io) make zero reference to who controls the Solana mint authority — single keypair, multisig, or program-derived. The Solana token page may exist but no contract / mint addresses are surfaced from the canonical AR.IO pages.

**Status: ⚠️ risk.** The AR.IO team is asking holders to register and trust that a future mint will honor those registrations. Without a published mint-authority key or PDA, the trust assumption is "AR.IO team won't rug at mint time." This is the same trust posture as the BASE↔AO relayer EOA today.

**Recommended action:** ping AR.IO Discord pre-snapshot to confirm the Solana mint authority publicly. Alternatively wait for the mint to land before bridging additional capital.

### 3. AO-native ARIO post-snapshot

The published mechanics:

- "After the snapshot, ar.io on AO will no longer be supported."
- "AO-based legacy version will continue on AO for as long as it remains functional" — no specific decommission date.
- A retroactive claim window exists ("limited-time") for holders who miss registration; window length **not specified**.
- After the reclaim window closes: "unclaimed ARIO is transferred to the Protocol Balance and unclaimed names are assigned to an ownerless wallet."

**Status: ⚠️ partial disclosure.** The "Protocol Balance" destination is named but its governance and the reclaim-window length are not published. Practical reading: if you miss registration AND the reclaim window, your ARIO is reabsorbed by the protocol treasury.

**Recommended action:** complete registration well before June 1, 2026. The Parsec migration view's countdown is calibrated to this.

### 4. BASE ARIO contract status

**Live:** `0x138746adfa52909e5920def027f5a8dc1c7effb6` on BASE (chainId 8453), 6 decimals, ~30.17M visible supply on BASE (out of 1B total). Coinbase lists it as "ario-network-base."

**Bridge:** the public `burn(amount, arweaveAddress)` function on the BASE contract is callable. The relayer EOA `0x79B5B6F47F865194EAa02756883a003f06F7Ba6c` is the sole mint authority on BASE. AR.IO's published mechanism: holder calls `burn`, off-chain relayer observes, mints the equivalent native ARIO on AO process `qNvAoz0Tg...`.

**Status: functional, single-EOA trust assumption.** Same caveat as the Solana mint authority — one keypair controls minting. If the EOA goes silent mid-burn, the burn is unrecoverable.

**Recommended action:** any test-burn of <1% of the holding first to verify the relayer responds within a reasonable window before bridging the bulk.

### 5. Cross-checks performed

- ARIO mainnet process `qNvAoz0Tg...` responds to dry-run queries (`Total-Token-Supply`, `Balance`, `Record`).
- The supply on the AO process is **not** the full 1B; the canonical token page confirms 1B fixed across all venues with most living on AO.
- BANKON Names Registry (BNR) is on a separate process; no shared state with the AR.IO Registry.

### 6. Risk summary

| Risk | Severity | Mitigation |
|---|---|---|
| Mint authority on Solana undisclosed | Medium | Ping Discord; wait-and-see option |
| Reclaim window length undisclosed | Medium | Complete registration well before June 1 |
| BASE bridge relayer is single EOA | High (for full 99,600 ARIO bridge) | Test-burn first; treat full bridge as custodial trust |
| AR.IO retains "Protocol Balance" claim on unclaimed | Low (avoidable by registering) | Register on sol.ar.io before snapshot |
| `Protocol Balance` governance opaque | Low | Inherent to the AR.IO model; sovereign alternative is the BANKON namespace |

### 7. Decision points captured for Parsec

1. **Solana migration handler stays shipped.** The June 1 deadline is firm; the handler is the path of record.
2. **BANKON namespace decoupled from AR.IO trust posture.** BNR runs in parallel with no dependency on AR.IO infrastructure. Names in the BANKON namespace survive any AR.IO snapshot or treasury reabsorption.
3. **Recommended user action sequence pre-June 1**:
   1. Create Arweave HD account in Parsec.
   2. Create Solana destination address in Parsec (BANKON-vault-held).
   3. Open `https://sol.ar.io` from the Parsec migration view; complete BASE → Solana registration.
   4. (Independently) Spawn the BANKON Names Registry once and claim sovereign names in parallel.

---

*Snapshot mechanics will be re-verified ~7 days before June 1, 2026. If the AR.IO team publishes the Solana mint authority before then, this document gets a follow-up entry.*
