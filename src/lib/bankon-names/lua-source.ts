// Build-time bundle of the BANKON Names Registry (BNR) Lua source.
// Vite's `?raw` query loads each .lua file as a string literal at build time,
// so the wallet ships every byte of the contract source inside its bundle.
// This lets the in-wallet spawn UI replicate `scripts/spawn-bnr.mjs` without
// any filesystem reads at runtime.
//
// Order matches scripts/spawn-bnr.mjs so the in-wallet and CLI flows produce
// identical Spawn DataItems for the same input.

import state from '../../../bankon-names-process/state.lua?raw';
import adminH from '../../../bankon-names-process/handlers/admin.lua?raw';
import governanceH from '../../../bankon-names-process/handlers/governance.lua?raw';
import costH from '../../../bankon-names-process/handlers/cost.lua?raw';
import claimH from '../../../bankon-names-process/handlers/claim.lua?raw';
import transferH from '../../../bankon-names-process/handlers/transfer.lua?raw';
import recordsH from '../../../bankon-names-process/handlers/records.lua?raw';
import leaseH from '../../../bankon-names-process/handlers/lease.lua?raw';
import primaryH from '../../../bankon-names-process/handlers/primary.lua?raw';
import main from '../../../bankon-names-process/main.lua?raw';

const SEPARATOR = '\n\n-- ──\n\n';

export const BNR_LUA_SOURCE: string = [
  state,
  adminH,
  governanceH,
  costH,
  claimH,
  transferH,
  recordsH,
  leaseH,
  primaryH,
  main,
].join(SEPARATOR);

export const BNR_LUA_SIZE: number = BNR_LUA_SOURCE.length;

/** SHA-256 of the bundled source, hex-encoded. Useful for the spawn UI so
 * the maintainer sees exactly what's about to be deployed. */
export async function bnrLuaDigest(): Promise<string> {
  const bytes = new TextEncoder().encode(BNR_LUA_SOURCE);
  const buf = await crypto.subtle.digest('SHA-256', bytes as unknown as BufferSource);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
