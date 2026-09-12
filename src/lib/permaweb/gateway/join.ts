// joinNetwork / updateGatewaySettings / leaveNetwork — pure validation + conversion, then the vault-
// signed SDK call. The SDK takes `operatorStake` and `minDelegatedStake` in mARIO (numbers); the form
// works in whole ARIO and converts exactly once, here.

import { MIN_OPERATOR_STAKE_ARIO, MIN_DELEGATE_STAKE_ARIO, MAX_REWARD_SHARE } from '../constants';
import { arioToMario, assertMario, marioToNumber } from '../units';
import { writeArio, sig } from '../client';
import { isSolanaAddress } from '../../solana/address';

/** Same rule the SDK exports as FQDN_REGEX. */
export const FQDN_RE = /^(?!-)[A-Za-z0-9-]{1,63}(?<!-)(\.(?!-)[A-Za-z0-9-]{1,63}(?<!-))*\.[A-Za-z]{2,}$/;

export interface JoinForm {
  fqdn: string;
  label: string;
  note?: string;
  properties?: string;
  operatorStakeArio: string;
  observerAddress?: string;
  allowDelegatedStaking: boolean;
  minDelegatedStakeArio: string;
  delegateRewardShareRatio: number;
  autoStake: boolean;
  port?: number;
}

export interface JoinPlan {
  operatorStake: number;          // mARIO
  minDelegatedStake: number;      // mARIO
  fqdn: string; port: number; protocol: 'https';
  label: string; note: string; properties: string;
  allowDelegatedStaking: boolean; delegateRewardShareRatio: number; autoStake: boolean;
  observerAddress?: string;
}

export function validateJoinForm(f: JoinForm): { errors: string[]; plan?: JoinPlan } {
  const errors: string[] = [];
  const fqdn = f.fqdn.trim().toLowerCase();
  if (!FQDN_RE.test(fqdn)) errors.push('FQDN must be a bare hostname like gw.example.com (no scheme, no path)');
  if (!f.label.trim()) errors.push('Label is required');
  if (f.label.trim().length > 64) errors.push('Label must be ≤ 64 characters');
  let operatorStake = 0n;
  try { operatorStake = arioToMario(f.operatorStakeArio); } catch { errors.push('Operator stake must be a number'); }
  if (operatorStake < MIN_OPERATOR_STAKE_ARIO * 1_000_000n) errors.push(`Operator stake must be ≥ ${MIN_OPERATOR_STAKE_ARIO} ARIO`);
  let minDelegated = 0n;
  try { minDelegated = arioToMario(f.minDelegatedStakeArio || '0'); } catch { errors.push('Min delegated stake must be a number'); }
  if (f.allowDelegatedStaking && minDelegated < MIN_DELEGATE_STAKE_ARIO * 1_000_000n) errors.push(`Min delegated stake must be ≥ ${MIN_DELEGATE_STAKE_ARIO} ARIO`);
  const share = Number(f.delegateRewardShareRatio);
  if (!Number.isInteger(share) || share < 0 || share > MAX_REWARD_SHARE) errors.push(`Delegate reward share must be an integer 0–${MAX_REWARD_SHARE}`);
  if (f.observerAddress && !isSolanaAddress(f.observerAddress.trim())) errors.push('Observer address must be a Solana address');
  const port = f.port ?? 443;
  if (!Number.isInteger(port) || port < 1 || port > 65535) errors.push('Port must be 1–65535');
  if (errors.length) return { errors };
  assertMario(operatorStake, 'operatorStake', MIN_OPERATOR_STAKE_ARIO);
  return {
    errors,
    plan: {
      operatorStake: marioToNumber(operatorStake),
      minDelegatedStake: marioToNumber(f.allowDelegatedStaking ? minDelegated : MIN_DELEGATE_STAKE_ARIO * 1_000_000n),
      fqdn, port, protocol: 'https',
      label: f.label.trim(), note: (f.note ?? '').trim(), properties: (f.properties ?? '').trim(),
      allowDelegatedStaking: f.allowDelegatedStaking, delegateRewardShareRatio: share, autoStake: f.autoStake,
      ...(f.observerAddress?.trim() ? { observerAddress: f.observerAddress.trim() } : {}),
    },
  };
}

/** The exact object handed to `ario.joinNetwork` (SDK 4.x JoinNetworkParams). */
export function buildJoinNetworkParams(plan: JoinPlan): Record<string, unknown> {
  return {
    operatorStake: plan.operatorStake,
    fqdn: plan.fqdn, port: plan.port, protocol: plan.protocol,
    label: plan.label, note: plan.note, properties: plan.properties,
    allowDelegatedStaking: plan.allowDelegatedStaking,
    delegateRewardShareRatio: plan.delegateRewardShareRatio,
    minDelegatedStake: plan.minDelegatedStake,
    autoStake: plan.autoStake,
    ...(plan.observerAddress ? { observerAddress: plan.observerAddress } : {}),
  };
}

type Ctx = { address: string; passphrase: string };
type W = Record<string, (p?: unknown) => Promise<unknown>>;

export async function joinNetwork(ctx: Ctx, plan: JoinPlan): Promise<{ id: string }> {
  const { ario } = await writeArio(ctx.address, ctx.passphrase);
  return { id: sig(await (ario as unknown as W).joinNetwork(buildJoinNetworkParams(plan))) };
}

export type SettingsUpdate = Partial<Omit<JoinPlan, 'operatorStake' | 'protocol'>>;

export async function updateGatewaySettings(ctx: Ctx, update: SettingsUpdate): Promise<{ id: string }> {
  if (Object.keys(update).length === 0) throw new Error('nothing to update');
  const { ario } = await writeArio(ctx.address, ctx.passphrase);
  return { id: sig(await (ario as unknown as W).updateGatewaySettings(update)) };
}

export async function leaveNetwork(ctx: Ctx): Promise<{ id: string }> {
  const { ario } = await writeArio(ctx.address, ctx.passphrase);
  return { id: sig(await (ario as unknown as W).leaveNetwork()) };
}
