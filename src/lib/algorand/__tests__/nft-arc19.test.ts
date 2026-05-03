import { describe, it, expect } from 'vitest';
import { isArc19Template, resolveArc19 } from '../nft-arc19';
import algosdk from 'algosdk';

describe('arc19', () => {
  describe('isArc19Template', () => {
    it('detects template-ipfs URLs', () => {
      expect(
        isArc19Template('template-ipfs://{ipfscid:1:raw:reserve:sha2-256}'),
      ).toBe(true);
    });
    it('rejects plain ipfs URLs', () => {
      expect(isArc19Template('ipfs://QmFoo')).toBe(false);
    });
    it('rejects empty / null', () => {
      expect(isArc19Template('')).toBe(false);
      expect(isArc19Template(null)).toBe(false);
      expect(isArc19Template(undefined)).toBe(false);
    });
  });

  describe('resolveArc19', () => {
    it('rebuilds a CIDv1 from a known reserve address', () => {
      // Construct a known 32-byte digest, encode as an Algorand address, then
      // re-decode through resolveArc19 and assert the CID round-trips.
      const digest = new Uint8Array(32);
      for (let i = 0; i < 32; i++) digest[i] = i + 1;
      const address = algosdk.encodeAddress(digest);

      const result = resolveArc19(
        'template-ipfs://{ipfscid:1:raw:reserve:sha2-256}',
        address,
      );
      expect(result).not.toBeNull();
      expect(result!.startsWith('ipfs://b')).toBe(true);
      // CIDv1 raw with sha2-256 is 36 bytes raw = 58 base32 chars + 'b' multibase prefix.
      const cidPart = result!.slice('ipfs://'.length);
      expect(cidPart.length).toBe(59);
    });

    it('returns null for non-template URL', () => {
      const r = resolveArc19('ipfs://QmFoo', 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
      expect(r).toBeNull();
    });

    it('returns null for unsupported version', () => {
      const r = resolveArc19(
        'template-ipfs://{ipfscid:0:raw:reserve:sha2-256}',
        'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      );
      expect(r).toBeNull();
    });

    it('returns null for invalid reserve address', () => {
      const r = resolveArc19(
        'template-ipfs://{ipfscid:1:raw:reserve:sha2-256}',
        'not-an-address',
      );
      expect(r).toBeNull();
    });
  });
});
