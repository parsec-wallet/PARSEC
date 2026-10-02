import { describe, it, expect, vi } from 'vitest';
import algosdk from 'algosdk';

const calls: number[][] = [];
vi.mock('../algorand/signer', () => ({
  walletSigner: async (address: string) => ({
    address,
    sign: async (_g: algosdk.Transaction[], idx: number[]) => { calls.push(idx); return idx.map(() => new Uint8Array([9])); },
    dispose: () => {},
  }),
}));

const { makeParsecSigner } = await import('../nfd/signer');
const ME = algosdk.generateAccount().addr.toString();
const OTHER = algosdk.generateAccount().addr.toString();
const params = { fee: 1000n, minFee: 1000n, firstValid: 1n, lastValid: 1000n, genesisID: 'mainnet-v1.0', genesisHash: new Uint8Array(32) };
const pay = (from: string) => algosdk.makePaymentTxnWithSuggestedParamsFromObject({ sender: from, receiver: OTHER, amount: 1, suggestedParams: params });

describe('the NFD signer goes through the Keycore wallet signer', () => {
  it('signs the requested indexes as this account', async () => {
    const out = await makeParsecSigner(ME)([pay(ME), pay(OTHER), pay(ME)], [0, 2]);
    expect(out).toHaveLength(2);
    expect(calls[calls.length - 1]).toEqual([0, 2]);
  });

  it('refuses a transaction from another address before anything is signed', async () => {
    const before = calls.length;
    await expect(makeParsecSigner(ME)([pay(OTHER)], [0])).rejects.toThrow(/address mismatch/);
    expect(calls.length).toBe(before);
  });
});
