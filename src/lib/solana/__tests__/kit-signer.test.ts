// Vault → @solana/kit signer bridge: the derived kit signer must present the SAME address the
// wallet displays (else a signature would come from a different key than the user funded).

import { describe, it, expect, vi } from 'vitest';
import { deriveSolanaFromMnemonic } from '../seed';

const ABANDON =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const EXPECTED = 'HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk';

vi.mock('../../keystore', () => ({
  keystoreRetrieve: vi.fn(async (address: string) =>
    address === EXPECTED ? ABANDON : null),
}));

import { createVaultTransactionSigner } from '../kit-signer';

describe('createVaultTransactionSigner', () => {
  it('derives a kit signer whose address matches the wallet address', async () => {
    const signer = await createVaultTransactionSigner(EXPECTED, '');
    expect(signer.address).toBe(EXPECTED);
    // the kit signer exposes the TransactionPartialSigner surface
    expect(typeof (signer as { signTransactions?: unknown }).signTransactions).toBe('function');
  });

  it('rejects when the vault has no key for the address', async () => {
    await expect(createVaultTransactionSigner('SomeOtherAddr', '')).rejects.toThrow(/No Solana key/);
  });

  it('rejects on a vault/address mismatch', async () => {
    const { keystoreRetrieve } = await import('../../keystore');
    (keystoreRetrieve as ReturnType<typeof vi.fn>).mockResolvedValueOnce(ABANDON);
    await expect(createVaultTransactionSigner('WrongAddr11111111111111111111111111111111111', ''))
      .rejects.toThrow(/mismatch/);
  });

  it('sanity: seed derivation itself matches the canonical vector', async () => {
    const kp = await deriveSolanaFromMnemonic(ABANDON);
    expect(kp.address).toBe(EXPECTED);
  });
});
