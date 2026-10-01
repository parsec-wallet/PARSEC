// Build-time bundle of the BMR Lua source. Same shape as the BNR bundle.

import state from '../../../marketplace-process/state.lua?raw';
import governanceH from '../../../marketplace-process/handlers/governance.lua?raw';
import listH from '../../../marketplace-process/handlers/list.lua?raw';
import cancelH from '../../../marketplace-process/handlers/cancel.lua?raw';
import offerH from '../../../marketplace-process/handlers/offer.lua?raw';
import auctionH from '../../../marketplace-process/handlers/auction.lua?raw';
import escrowH from '../../../marketplace-process/handlers/escrow.lua?raw';
import feesH from '../../../marketplace-process/handlers/fees.lua?raw';
import settleH from '../../../marketplace-process/handlers/settle.lua?raw';
import main from '../../../marketplace-process/main.lua?raw';

const SEPARATOR = '\n\n-- ──\n\n';

export const BMR_LUA_SOURCE: string = [
  state,
  governanceH,
  listH,
  cancelH,
  offerH,
  auctionH,
  escrowH,
  feesH,
  settleH,
  main,
].join(SEPARATOR);

export const BMR_LUA_SIZE: number = BMR_LUA_SOURCE.length;

export async function bmrLuaDigest(): Promise<string> {
  const bytes = new TextEncoder().encode(BMR_LUA_SOURCE);
  const buf = await crypto.subtle.digest('SHA-256', bytes as unknown as BufferSource);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
