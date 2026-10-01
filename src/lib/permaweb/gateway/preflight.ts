// Join-network preflight — every check the operator must pass before staking 20,000 ARIO. Pure
// assembly over injected reads so it is unit-testable without a network; `runJoinPreflight` wires the
// real reads.

import { MIN_OPERATOR_STAKE_ARIO, MIN_DELEGATE_STAKE_ARIO, MAX_REWARD_SHARE, REGISTRY_CAP, MIN_NODE_RELEASE, MIN_OPERATOR_SOL } from '../constants';
import { marioToArio } from '../units';
import type { JoinPlan } from './join';
import { probeNodeInfo, nodeReleaseOk, nodeWalletMatches, nodeProgramsMatch, type NodeProbe } from './health';
import { getGatewayFor, countGateways, getOperatorBalances } from './read';
import { isObserverUnique } from '../wallet/observer';

export interface PreflightItem { id: string; label: string; ok: boolean; detail: string; warn?: boolean }

export interface PreflightReads {
  node: NodeProbe;
  balances: { mario: bigint; sol: number };
  existing: unknown | null;
  registryCount: number | null;
  observerUnique: { unique: boolean; scanned: number } | null;
}

export function assemblePreflight(operator: string, plan: JoinPlan, r: PreflightReads): PreflightItem[] {
  const items: PreflightItem[] = [];
  const stakeMario = BigInt(plan.operatorStake);
  items.push({ id: 'node', label: 'Gateway node reachable', ok: r.node.ok, detail: r.node.ok ? `${r.node.url} (${r.node.latencyMs ?? '?'} ms)` : `${r.node.url}: ${r.node.error ?? 'unreachable'}` });
  items.push({ id: 'release', label: `ar-io-node release ≥ ${MIN_NODE_RELEASE}`, ok: nodeReleaseOk(r.node), detail: r.node.ok ? `release ${r.node.release ?? '?'}` : 'no node info' });
  items.push({ id: 'wallet', label: 'Node AR_IO_WALLET == operator', ok: nodeWalletMatches(r.node, operator), detail: r.node.info?.wallet ? `node reports ${String(r.node.info.wallet)}` : 'node reports no wallet' });
  const pm = nodeProgramsMatch(r.node);
  items.push({ id: 'programs', label: 'Node program ids == mainnet', ok: pm.ok, detail: pm.ok ? 'core / gar / arns / ant match' : `mismatch: ${pm.mismatched.join(', ')}` });
  items.push({ id: 'stake-min', label: `Operator stake ≥ ${MIN_OPERATOR_STAKE_ARIO} ARIO`, ok: stakeMario >= MIN_OPERATOR_STAKE_ARIO * 1_000_000n, detail: `${marioToArio(stakeMario)} ARIO` });
  items.push({ id: 'ario', label: 'ARIO balance covers the stake', ok: r.balances.mario >= stakeMario, detail: `${marioToArio(r.balances.mario)} ARIO held, ${marioToArio(stakeMario)} needed` });
  items.push({ id: 'sol', label: `SOL ≥ ${MIN_OPERATOR_SOL} for fees`, ok: r.balances.sol >= MIN_OPERATOR_SOL, detail: `${r.balances.sol.toFixed(4)} SOL` });
  items.push({ id: 'joined', label: 'Not already registered', ok: !r.existing, detail: r.existing ? 'a gateway already exists for this address — use Update settings' : 'no gateway PDA for this address' });
  if (r.registryCount !== null) {
    items.push({ id: 'cap', label: `Registry below cap (${REGISTRY_CAP})`, ok: r.registryCount < REGISTRY_CAP, detail: `${r.registryCount} gateways registered` });
  } else {
    items.push({ id: 'cap', label: `Registry below cap (${REGISTRY_CAP})`, ok: true, warn: true, detail: 'count unavailable (RPC) — verify on gateways.ar.io' });
  }
  const observer = plan.observerAddress ?? operator;
  if (r.observerUnique) {
    items.push({ id: 'observer', label: 'Observer address unique', ok: r.observerUnique.unique, detail: r.observerUnique.unique ? `${observer} (scanned ${r.observerUnique.scanned})` : `${observer} is already another gateway's observer` });
  } else {
    items.push({ id: 'observer', label: 'Observer address unique', ok: true, warn: true, detail: 'not verified (RPC) — registration fails on-chain if it collides' });
  }
  if (!plan.observerAddress) items.push({ id: 'observer-same', label: 'Observer == operator', ok: true, warn: true, detail: 'single-key setup: the operator key will have to live on the node host — prefer a separate observer key' });
  items.push({ id: 'share', label: `Reward share 0–${MAX_REWARD_SHARE}%`, ok: plan.delegateRewardShareRatio >= 0 && plan.delegateRewardShareRatio <= MAX_REWARD_SHARE, detail: `${plan.delegateRewardShareRatio}%` });
  items.push({ id: 'min-delegate', label: `Min delegated stake ≥ ${MIN_DELEGATE_STAKE_ARIO} ARIO`, ok: BigInt(plan.minDelegatedStake) >= MIN_DELEGATE_STAKE_ARIO * 1_000_000n, detail: `${marioToArio(BigInt(plan.minDelegatedStake))} ARIO` });
  return items;
}

export const preflightPassed = (items: PreflightItem[]): boolean => items.every((i) => i.ok);

export async function runJoinPreflight(operator: string, plan: JoinPlan): Promise<PreflightItem[]> {
  const [node, balances, existing, registryCount, observerUnique] = await Promise.all([
    probeNodeInfo(plan.fqdn, plan.port),
    getOperatorBalances(operator).catch(() => ({ mario: 0n, sol: 0 })),
    getGatewayFor(operator),
    countGateways().catch(() => null),
    isObserverUnique(plan.observerAddress ?? operator).catch(() => null),
  ]);
  return assemblePreflight(operator, plan, { node, balances, existing, registryCount, observerUnique });
}
