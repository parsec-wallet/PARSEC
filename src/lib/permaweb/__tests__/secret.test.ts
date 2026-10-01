import { describe, it, expect } from 'vitest';
import { parseSolanaSecret, encodeVaultSecret, keypairFromVaultSecret, previewSolanaSecret, toKeypairJson, RAW_TAG } from '../../solana/secret';
import { base58Encode } from '../../solana/address';

const MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const ADDR = 'HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk';

describe('solana secret formats', () => {
  it('resolves a mnemonic to the pinned vector', async () => {
    const p = parseSolanaSecret(MNEMONIC);
    expect(p.kind).toBe('mnemonic');
    expect((await keypairFromVaultSecret(encodeVaultSecret(p))).address).toBe(ADDR);
  });
  it('accepts base58 keypair, JSON keypair, bare seed and tagged secret — same address', async () => {
    const kp = await keypairFromVaultSecret(MNEMONIC);
    const json = toKeypairJson(kp);
    const arr = JSON.parse(json) as number[];
    expect(arr).toHaveLength(64);
    const b58 = base58Encode(Uint8Array.from(arr));
    const seed58 = base58Encode(kp.secretSeed);
    for (const input of [json, b58, seed58]) {
      const parsed = parseSolanaSecret(input);
      expect(parsed.kind).toBe('raw');
      const vault = encodeVaultSecret(parsed);
      expect(vault.startsWith(RAW_TAG)).toBe(true);
      expect((await keypairFromVaultSecret(vault)).address).toBe(ADDR);
      expect((await previewSolanaSecret(input)).address).toBe(ADDR);
    }
  });
  it('rejects a keypair whose public half does not match', () => {
    const bad = new Uint8Array(64); bad[0] = 1; bad[63] = 9;
    expect(() => encodeVaultSecret({ kind: 'raw', secret: bad })).toThrow(/does not match/);
  });
  it('rejects garbage', () => {
    expect(() => parseSolanaSecret('')).toThrow();
    expect(() => parseSolanaSecret('abandon abandon nope')).toThrow(/mnemonic/);
    expect(() => parseSolanaSecret('[1,2,3]')).not.toThrow(); // parses; fails at keypair stage
    expect(() => encodeVaultSecret(parseSolanaSecret('[1,2,3]'))).toThrow(/32- or 64-byte/);
  });
});
