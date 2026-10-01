import { describe, it, expect } from 'vitest';
import { validateJoinForm, buildJoinNetworkParams, type JoinForm } from '../gateway/join';

const base: JoinForm = {
  fqdn: 'gw.bankon.pythai.net', label: 'BANKON', note: 'BANKON gateway', properties: '',
  operatorStakeArio: '20000', observerAddress: 'HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk',
  allowDelegatedStaking: true, minDelegatedStakeArio: '100', delegateRewardShareRatio: 15, autoStake: true,
};

describe('join-network validation', () => {
  it('converts ARIO to mARIO exactly once and pins the SDK param shape', () => {
    const { errors, plan } = validateJoinForm(base);
    expect(errors).toEqual([]);
    expect(plan!.operatorStake).toBe(20_000_000_000);
    expect(plan!.minDelegatedStake).toBe(100_000_000);
    const p = buildJoinNetworkParams(plan!);
    expect(p).toEqual({
      operatorStake: 20_000_000_000, fqdn: 'gw.bankon.pythai.net', port: 443, protocol: 'https',
      label: 'BANKON', note: 'BANKON gateway', properties: '', allowDelegatedStaking: true,
      delegateRewardShareRatio: 15, minDelegatedStake: 100_000_000, autoStake: true,
      observerAddress: 'HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk',
    });
    expect(p).not.toHaveProperty('qty'); // the pre-4.x param name
  });
  it('rejects 19,999 ARIO and accepts 20,000', () => {
    expect(validateJoinForm({ ...base, operatorStakeArio: '19999' }).errors.join()).toMatch(/≥ 20000 ARIO/);
    expect(validateJoinForm({ ...base, operatorStakeArio: '20000' }).errors).toEqual([]);
  });
  it('rejects reward share 96, bad fqdn, bad observer, tiny min-delegate', () => {
    expect(validateJoinForm({ ...base, delegateRewardShareRatio: 96 }).errors.join()).toMatch(/0–95/);
    expect(validateJoinForm({ ...base, fqdn: 'https://gw.example.com' }).errors.join()).toMatch(/FQDN/);
    expect(validateJoinForm({ ...base, observerAddress: '0xabc' }).errors.join()).toMatch(/Observer/);
    expect(validateJoinForm({ ...base, minDelegatedStakeArio: '5' }).errors.join()).toMatch(/≥ 10 ARIO/);
  });
  it('omits observerAddress when blank (observer defaults to operator on-chain)', () => {
    const { plan } = validateJoinForm({ ...base, observerAddress: '' });
    expect(buildJoinNetworkParams(plan!)).not.toHaveProperty('observerAddress');
  });
});
