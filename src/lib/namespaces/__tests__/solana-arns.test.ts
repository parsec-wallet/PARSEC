// solana-arns adapter — normalization + capability flags + write routing (client mocked).

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../arweave/solana-arns-client', () => ({
  getRecord: vi.fn(),
  getAntState: vi.fn(),
  getCost: vi.fn(),
  isReserved: vi.fn(),
  buyName: vi.fn(),
  setBaseNameRecord: vi.fn(),
  setUndernameRecord: vi.fn(),
  removeUndernameRecord: vi.fn(),
  transferAnt: vi.fn(),
  transferRecord: vi.fn(),
  addController: vi.fn(),
  removeController: vi.fn(),
  extendLease: vi.fn(),
  increaseUndernameLimit: vi.fn(),
  requestPrimaryName: vi.fn(),
}));

import * as client from '../../arweave/solana-arns-client';
import { solanaArnsAdapter } from '../solana-arns';
import { getNamespace } from '../registry';

const REC = { name: 'bankon', type: 'permabuy' as const, processId: 'P1', undernameLimit: 10 };
const STATE = {
  owner: 'OwnerSol111',
  controllers: ['Ctl1'],
  records: {
    '@': { transactionId: 'RootTx', ttlSeconds: 900 },
    shop: { transactionId: 'ShopTx', ttlSeconds: 3600 },
  },
};

beforeEach(() => {
  vi.mocked(client.getRecord).mockResolvedValue(REC as never);
  vi.mocked(client.getAntState).mockResolvedValue(STATE as never);
});

describe('solanaArnsAdapter', () => {
  it('registers itself under solana-arns', () => {
    expect(getNamespace('solana-arns')).toBe(solanaArnsAdapter);
  });

  it('declares controller + undername-limit capabilities, no child spawn', () => {
    expect(solanaArnsAdapter.capabilities).toEqual({
      controllers: true,
      increaseUndernameLimit: true,
      spawnsChildProcess: false,
      acceptedPaymentMethods: ['ario'],
    });
  });

  it('normalizes record + ANT state into NormalizedRecord', async () => {
    const rec = await solanaArnsAdapter.getRecord('bankon');
    expect(rec).not.toBeNull();
    expect(rec!.owner).toBe('OwnerSol111');
    expect(rec!.controllers).toEqual(['Ctl1']);
    expect(rec!.type).toBe('permabuy');
    expect(rec!.rootTarget).toBe('RootTx');
    expect(rec!.rootTtl).toBe(900);
    expect(rec!.undernames).toEqual({ shop: { transactionId: 'ShopTx', ttlSeconds: 3600 } });
    expect(rec!.undernameLimit).toBe(10);
  });

  it('returns null for an unregistered name', async () => {
    vi.mocked(client.getRecord).mockResolvedValue(null);
    expect(await solanaArnsAdapter.getRecord('nope')).toBeNull();
  });

  it('cost quotes come back as bigint ARIO', async () => {
    vi.mocked(client.getCost).mockResolvedValue(85731687500n);
    const q = await solanaArnsAdapter.getCost({ intent: 'Buy-Name', name: 'mindx', purchaseType: 'permabuy' });
    expect(q).toEqual({ amount: 85731687500n, unit: 'ARIO' });
    expect(client.getCost).toHaveBeenCalledWith(expect.objectContaining({ intent: 'Buy-Name', purchaseType: 'permabuy' }));
  });

  it('claim routes to buyName and surfaces the ANT process id', async () => {
    vi.mocked(client.buyName).mockResolvedValue({ id: 'sig1', processId: 'P1' });
    const res = await solanaArnsAdapter.claim({
      address: 'A', passphrase: 'p', name: 'bankon', purchaseType: 'permabuy', paymentMethod: 'ario',
    });
    expect(res).toEqual({ id: 'sig1', childProcessId: 'P1' });
  });

  it('setUndername maps subdomain → undername', async () => {
    vi.mocked(client.setUndernameRecord).mockResolvedValue({ id: 'sig2' });
    await solanaArnsAdapter.setUndername({ address: 'A', passphrase: 'p', name: 'bankon', subdomain: 'shop', transactionId: 'T'.repeat(43).slice(0, 43) });
    expect(client.setUndernameRecord).toHaveBeenCalledWith(expect.objectContaining({ undername: 'shop' }));
  });

  it('optional capabilities are wired', async () => {
    vi.mocked(client.addController).mockResolvedValue({ id: 'sig3' });
    await solanaArnsAdapter.addController!({ address: 'A', passphrase: 'p', name: 'bankon', controller: 'C' });
    expect(client.addController).toHaveBeenCalled();
    vi.mocked(client.increaseUndernameLimit).mockResolvedValue({ id: 'sig4' });
    await solanaArnsAdapter.increaseUndernameLimit!({ address: 'A', passphrase: 'p', name: 'bankon', quantity: 5 });
    expect(client.increaseUndernameLimit).toHaveBeenCalledWith(expect.objectContaining({ quantity: 5 }));
  });
});
