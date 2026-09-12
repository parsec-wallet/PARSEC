import { describe, it, expect } from 'vitest';
import { assemblePreflight, preflightPassed } from '../gateway/preflight';
import { validateJoinForm } from '../gateway/join';
import { ARIO_PROGRAMS } from '../constants';

const OP = 'HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk';
const plan = validateJoinForm({
  fqdn: 'gw.example.com', label: 'x', operatorStakeArio: '20000', observerAddress: '7EYnhQoR9YM3N7UoaKRoA44Uy8JeaZV3qyouov87awMs',
  allowDelegatedStaking: false, minDelegatedStakeArio: '10', delegateRewardShareRatio: 10, autoStake: true,
}).plan!;
const goodNode = { ok: true, url: 'https://gw.example.com/ar-io/info', release: 82, latencyMs: 90, info: { release: 82, wallet: OP, programIds: { ...ARIO_PROGRAMS } } };

describe('join preflight', () => {
  it('passes when everything lines up', () => {
    const items = assemblePreflight(OP, plan, { node: goodNode, balances: { mario: 25_000_000_000n, sol: 0.6 }, existing: null, registryCount: 640, observerUnique: { unique: true, scanned: 640 } });
    expect(preflightPassed(items)).toBe(true);
    expect(items.find((i) => i.id === 'release')!.ok).toBe(true);
  });
  it('fails on old release, wrong node wallet, short ARIO, existing gateway, observer collision', () => {
    const items = assemblePreflight(OP, plan, {
      node: { ...goodNode, release: 79, info: { ...goodNode.info, release: 79, wallet: 'someoneelse', programIds: { ...ARIO_PROGRAMS, gar: 'wrong' } } },
      balances: { mario: 19_000_000_000n, sol: 0.01 }, existing: { status: 'joined' }, registryCount: 3000, observerUnique: { unique: false, scanned: 3 },
    });
    const failed = items.filter((i) => !i.ok).map((i) => i.id).sort();
    expect(failed).toEqual(['ario', 'cap', 'joined', 'observer', 'programs', 'release', 'sol', 'wallet']);
    expect(preflightPassed(items)).toBe(false);
  });
  it('degrades RPC-dependent checks to warnings rather than failures', () => {
    const items = assemblePreflight(OP, plan, { node: goodNode, balances: { mario: 25_000_000_000n, sol: 1 }, existing: null, registryCount: null, observerUnique: null });
    expect(items.find((i) => i.id === 'cap')!.warn).toBe(true);
    expect(items.find((i) => i.id === 'observer')!.warn).toBe(true);
    expect(preflightPassed(items)).toBe(true);
  });
});
