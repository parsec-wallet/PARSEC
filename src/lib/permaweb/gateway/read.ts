// Gateway-registry reads (unsigned). Thin wrappers over the SDK's readable client so the views and
// preflight never touch the SDK directly. All return plain JSON-ish objects.

import { readArio } from '../client';
import { getTokenBalance } from '../../solana/token';
import { fetchSolBalance } from '../../solana/balance';
import { ARIO_MINT } from '../constants';

export interface GatewayRecord {
  settings: {
    fqdn: string; port: number; protocol: string; label: string; note: string; properties: string;
    allowDelegatedStaking: boolean | 'allowlist'; delegateRewardShareRatio: number; minDelegatedStake: number;
    autoStake: boolean; allowedDelegates?: string[]; pendingDelegateRewardShareRatio?: number; delegationDisabledAt?: number;
  };
  stats: { passedConsecutiveEpochs: number; failedConsecutiveEpochs: number; totalEpochCount: number; passedEpochCount: number; failedEpochCount: number; observedEpochCount: number; prescribedEpochCount: number };
  totalDelegatedStake: number;
  startTimestamp: number;
  endTimestamp: number;
  observerAddress: string;
  operatorStake: number;
  status: 'joined' | 'leaving';
  weights?: Record<string, number>;
  gatewayAddress?: string;
}

type AnyClient = Record<string, (...a: never[]) => Promise<unknown>>;

async function client(): Promise<AnyClient> {
  return (await readArio()) as unknown as AnyClient;
}

/** `null` when the address has no gateway (the SDK throws / returns undefined for a missing PDA). */
export async function getGatewayFor(address: string): Promise<GatewayRecord | null> {
  try {
    const g = await (await client()).getGateway({ address } as never);
    return (g ?? null) as GatewayRecord | null;
  } catch {
    return null;
  }
}

export async function listGateways(opts: { limit?: number; cursor?: string } = {}): Promise<{ items: (GatewayRecord & { gatewayAddress: string })[]; nextCursor?: string; totalItems?: number; hasMore?: boolean }> {
  return (await (await client()).getGateways({ limit: opts.limit ?? 100, ...(opts.cursor ? { cursor: opts.cursor } : {}) } as never)) as never;
}

/** Count every registered gateway (paged). Cached per session by the caller. */
export async function countGateways(): Promise<number> {
  let cursor: string | undefined;
  let n = 0;
  for (let i = 0; i < 40; i++) {
    const page = await listGateways({ limit: 100, cursor });
    if (typeof page.totalItems === 'number') return page.totalItems;
    n += page.items?.length ?? 0;
    if (!page.nextCursor || page.hasMore === false) break;
    cursor = page.nextCursor;
  }
  return n;
}

export const getDelegatesFor = async (address: string) => (await client()).getGatewayDelegates({ address, limit: 100 } as never);
export const getVaultsFor = async (address: string) => (await client()).getGatewayVaults({ address, limit: 100 } as never);
export const getDelegationsOf = async (address: string) => (await client()).getDelegations({ address, limit: 100 } as never);
export const getRegistrySettings = async () => (await client()).getGatewayRegistrySettings();
export const getDemandFactor = async () => (await client()).getDemandFactor();

export async function getEpochSummary(): Promise<{ epoch: unknown; settings: unknown; prescribedObservers: unknown }> {
  const c = await client();
  const [epoch, settings, prescribedObservers] = await Promise.all([
    c.getCurrentEpoch().catch(() => null),
    c.getEpochSettings().catch(() => null),
    c.getPrescribedObservers({} as never).catch(() => null),
  ]);
  return { epoch, settings, prescribedObservers };
}

/** ARIO (mARIO) + SOL for an address — the two balances every GAR write needs. */
export async function getOperatorBalances(address: string): Promise<{ mario: bigint; sol: number }> {
  const [t, sol] = await Promise.all([getTokenBalance(address, ARIO_MINT), fetchSolBalance(address)]);
  return { mario: t.amount, sol };
}
