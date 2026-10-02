// 0.1.8: Arweave and Solana sign through the PARSEC Keycore on the desktop —
// no JWK or phrase is read into JavaScript.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../platform', () => ({ isTauri: true, invoke: vi.fn() }));
const retrieve = vi.fn(async () => { throw new Error('a secret was read into JavaScript'); });
vi.mock('../keystore', () => ({ keystoreRetrieve: retrieve }));

const OWNER_BYTES = new Uint8Array(512).fill(3);
const toB64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
const toB64url = (b: Uint8Array) => toB64(b).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const AR = 'A'.repeat(43);
const arSign = vi.fn(async (_a: string, _p: string) => ({ signature_b64: toB64(new Uint8Array(512).fill(9)), scheme: 'rsa-pss-sha256', salt_len: 32 }));
let reported = AR;
vi.mock('../chain-ar', () => ({
  arAccountInfo: async () => ({ address: reported, owner: toB64url(OWNER_BYTES), bits: 4096 }),
  arSign,
}));
const solSign = vi.fn(async (_a: string, _p: string) => ({ signature_b64: toB64(new Uint8Array(64).fill(5)), scheme: 'ed25519' }));
vi.mock('../chain-sol', () => ({ solSign }));

const { buildArweaveSigner } = await import('../arweave/signer');
const { signDataItemFromVault } = await import('../arweave/ans104');
const { createVaultTransactionSigner, solanaMessageSigner } = await import('../solana/kit-signer');

beforeEach(() => { reported = AR; arSign.mockClear(); solSign.mockClear(); });

describe('Arweave signs in the Keycore', () => {
  it('a DataItem is signed by chain_ar_sign, owned by the stored key', async () => {
    const item = await signDataItemFromVault(AR, '', { data: 'hello', tags: [{ name: 'A', value: 'b' }] });
    expect(arSign).toHaveBeenCalledTimes(1);
    expect(arSign.mock.calls[0][0]).toBe(AR);
    expect(item.owner).toBe(toB64url(OWNER_BYTES));
    expect(item.signature).toBe(toB64url(new Uint8Array(512).fill(9)));
    expect(retrieve).not.toHaveBeenCalled();
  });

  it('the dApp signer signs messages through the Keycore', async () => {
    const s = await buildArweaveSigner(AR, '');
    expect(s.publicKey).toBe(toB64url(OWNER_BYTES));
    const sig = await s.signMessage(new Uint8Array([1, 2]));
    expect(arSign).toHaveBeenCalledWith(AR, toB64(new Uint8Array([1, 2])));
    expect(sig).toHaveLength(512);
    s.dispose();
    await expect(s.signMessage(new Uint8Array([1]))).rejects.toThrow(/disposed/);
  });

  it('refuses when the vault reports another address for the key', async () => {
    reported = 'B'.repeat(43);
    await expect(buildArweaveSigner(AR, '')).rejects.toThrow(/reports address/);
    expect(arSign).not.toHaveBeenCalled();
  });
});

describe('Solana signs in the Keycore', () => {
  const SOL = 'HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk';

  it('a message is signed by chain_sol_sign', async () => {
    const sig = await solanaMessageSigner(SOL).sign(new Uint8Array([4, 2]));
    expect(solSign).toHaveBeenCalledWith(SOL, toB64(new Uint8Array([4, 2])));
    expect(sig).toEqual(new Uint8Array(64).fill(5));
  });

  it('the kit signer signs each transaction message as the account', async () => {
    const signer = await createVaultTransactionSigner(SOL, '');
    expect(signer.address).toBe(SOL);
    const msg = new Uint8Array([7, 7, 7]);
    const [dict] = await signer.signTransactions([{ messageBytes: msg, signatures: {} } as never]);
    expect(solSign).toHaveBeenCalledWith(SOL, toB64(msg));
    expect((dict as Record<string, Uint8Array>)[SOL]).toEqual(new Uint8Array(64).fill(5));
    expect(retrieve).not.toHaveBeenCalled();
  });
});
