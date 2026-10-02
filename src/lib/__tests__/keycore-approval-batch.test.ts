// 0.2.0: a batch is approved once in a Keycore dialog; each signature carries the token.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import algosdk from 'algosdk';

vi.mock('../platform', () => ({ isTauri: true, invoke: vi.fn() }));
const approve = vi.fn(async (_r: { payloads: Uint8Array[]; title: string }) => 'TOKEN');
vi.mock('../keycore-approval', () => ({ keycoreApprove: approve }));
const algoSign = vi.fn(async (_a: string, _p: string, _t?: string) => ({ signature_b64: btoa('s'.repeat(64)), scheme: 'ed25519' }));
vi.mock('../chain-algo', () => ({ algoSignTransaction: algoSign, algoSignBytes: vi.fn() }));
const OWNER = btoa(String.fromCharCode(...new Uint8Array(512).fill(3))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const arSign = vi.fn(async (_a: string, _p: string, _t?: string) => ({ signature_b64: btoa(String.fromCharCode(...new Uint8Array(512).fill(9))), scheme: 'rsa-pss-sha256', salt_len: 32 }));
vi.mock('../chain-ar', () => ({ arAccountInfo: async () => ({ address: 'AR', owner: OWNER, bits: 4096 }), arSign }));

const { parsecAvmSigner } = await import('../x402/adapters/parsec');
const { uploadSignerFor, planUpload, runUpload } = await import('../arweave/turbo');

const ME = algosdk.generateAccount().addr.toString();
const params = { fee: 1000n, minFee: 1000n, firstValid: 1n, lastValid: 1000n, genesisID: 'mainnet-v1.0', genesisHash: new Uint8Array(32) };
const pay = (amount: number) => algosdk.makePaymentTxnWithSuggestedParamsFromObject({ sender: ME, receiver: ME, amount, suggestedParams: params });

beforeEach(() => { approve.mockClear(); algoSign.mockClear(); arSign.mockClear(); });

describe('Algorand groups ask the Keycore once', () => {
  it('a group of three is one dialog, and every signature carries its token', async () => {
    const group = algosdk.assignGroupID([pay(1), pay(2), pay(3)]);
    await parsecAvmSigner(ME).sign(group, [0, 1, 2]);
    expect(approve).toHaveBeenCalledTimes(1);
    expect(approve.mock.calls[0][0].payloads).toHaveLength(3);
    expect(algoSign.mock.calls.map((c) => c[2])).toEqual(['TOKEN', 'TOKEN', 'TOKEN']);
  });

  it('a single transaction is asked about by the signing command itself', async () => {
    await parsecAvmSigner(ME).sign([pay(1)], [0]);
    expect(approve).not.toHaveBeenCalled();
    expect(algoSign.mock.calls[0][2]).toBeUndefined();
  });
});

describe('uploads ask once for the files', () => {
  it('the files share one approval; the manifest (whose bytes depend on them) is asked singly', async () => {
    const files = [1, 2].map((n) => ({ path: `f${n}.txt`, bytes: new TextEncoder().encode(`file ${n}`), contentType: 'text/plain' }));
    const plan = planUpload(files, 107_520, { asSite: true });
    const sign = uploadSignerFor('AR', null);
    let k = 0;
    await runUpload(plan, sign, () => {}, async (raw) => {
      const idBuf = await crypto.subtle.digest('SHA-256', raw.slice(2, 514));
      k++;
      return { id: btoa(String.fromCharCode(...new Uint8Array(idBuf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') } as never;
    });
    expect(approve).toHaveBeenCalledTimes(1);
    expect(approve.mock.calls[0][0].payloads).toHaveLength(2);
    expect(arSign.mock.calls.map((c) => c[2])).toEqual(['TOKEN', 'TOKEN', undefined]);
    expect(k).toBe(3);
  });
});
