// Operator / delegate stake writes — every amount converted from ARIO exactly once, here.

import { arioToMario, marioToNumber } from '../units';
import { writeArio, sig } from '../client';

type Ctx = { address: string; passphrase: string };
type W = Record<string, (p?: unknown) => Promise<unknown>>;

async function w(ctx: Ctx): Promise<W> {
  return (await writeArio(ctx.address, ctx.passphrase)).ario as unknown as W;
}

const qty = (ario: string) => {
  const m = arioToMario(ario);
  if (m <= 0n) throw new Error('amount must be positive');
  return marioToNumber(m);
};

export const increaseOperatorStake = async (ctx: Ctx, amountArio: string) =>
  ({ id: sig(await (await w(ctx)).increaseOperatorStake({ increaseQty: qty(amountArio) })) });

export const decreaseOperatorStake = async (ctx: Ctx, amountArio: string, instant = false) =>
  ({ id: sig(await (await w(ctx)).decreaseOperatorStake({ decreaseQty: qty(amountArio), instant })) });

export const delegateStake = async (ctx: Ctx, target: string, amountArio: string) =>
  ({ id: sig(await (await w(ctx)).delegateStake({ target, stakeQty: qty(amountArio) })) });

export const decreaseDelegateStake = async (ctx: Ctx, target: string, amountArio: string, instant = false) =>
  ({ id: sig(await (await w(ctx)).decreaseDelegateStake({ target, decreaseQty: qty(amountArio), instant })) });

export const redelegateStake = async (ctx: Ctx, o: { source: string; target: string; amountArio: string; vaultId?: string }) =>
  ({ id: sig(await (await w(ctx)).redelegateStake({ source: o.source, target: o.target, stakeQty: qty(o.amountArio), ...(o.vaultId ? { vaultId: o.vaultId } : {}) })) });

export const instantWithdrawal = async (ctx: Ctx, vaultId: string, gatewayAddress?: string) =>
  ({ id: sig(await (await w(ctx)).instantWithdrawal({ vaultId, ...(gatewayAddress ? { gatewayAddress } : {}) })) });

export const cancelWithdrawal = async (ctx: Ctx, vaultId: string, gatewayAddress?: string) =>
  ({ id: sig(await (await w(ctx)).cancelWithdrawal({ vaultId, ...(gatewayAddress ? { gatewayAddress } : {}) })) });
