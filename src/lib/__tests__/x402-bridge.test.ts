import { describe, it, expect, vi } from 'vitest';
import algosdk from 'algosdk';

const calls: number[][] = [];
let disposed = 0;
vi.mock('../algorand/signer', () => ({
  walletSigner: async (address: string) => ({
    address,
    sign: async (_g: algosdk.Transaction[], idx: number[]) => { calls.push(idx); return idx.map((i) => new Uint8Array([i])); },
    dispose: () => { disposed++; },
  }),
}));
const signBytes = vi.fn(async () => ({ signature_b64: btoa('\x01\x02\x03'), scheme: 'ed25519' }));
vi.mock('../chain-algo', () => ({ algoSignBytes: signBytes }));
vi.mock('../platform', () => ({ isTauri: true }));

const { buildAlgorandX402Signer, signBytesWithVault } = await import('../x402/bridge');
const ME = algosdk.generateAccount().addr.toString();
const OTHER = algosdk.generateAccount().addr.toString();
const params = { fee: 1000n, minFee: 1000n, firstValid: 1n, lastValid: 1000n, genesisID: 'mainnet-v1.0', genesisHash: new Uint8Array(32) };
const pay = (from: string) => algosdk.encodeUnsignedTransaction(
  algosdk.makePaymentTxnWithSuggestedParamsFromObject({ sender: from, receiver: OTHER, amount: 1, suggestedParams: params }),
);

describe('the x402 bridge signs through the Keycore', () => {
  it('signs one transaction and releases the signer', async () => {
    const s = await buildAlgorandX402Signer(ME, '', 'mainnet');
    const d = disposed;
    expect(await s.signTransaction(pay(ME))).toEqual(new Uint8Array([0]));
    expect(disposed).toBe(d + 1);
  });

  it('signs only the requested indexes and leaves the rest null', async () => {
    const s = await buildAlgorandX402Signer(ME, '', 'mainnet');
    const out = await s.signTransactions([pay(ME), pay(OTHER), pay(ME)], [0, 2]);
    expect(calls[calls.length - 1]).toEqual([0, 2]);
    expect(out).toEqual([new Uint8Array([0]), null, new Uint8Array([2])]);
  });

  it('refuses a transaction from another sender before anything is signed', async () => {
    const s = await buildAlgorandX402Signer(ME, '', 'mainnet');
    const before = calls.length;
    await expect(s.signTransaction(pay(OTHER))).rejects.toThrow(/Refusing to sign/);
    expect(calls.length).toBe(before);
  });

  it('signs messages with chain_algo_sign_bytes, never a key in JavaScript', async () => {
    const sig = await signBytesWithVault(ME, '', new Uint8Array([7, 8]));
    expect(signBytes).toHaveBeenCalledWith(ME, btoa('\x07\x08'));
    expect(sig).toEqual(new Uint8Array([1, 2, 3]));
  });
});
