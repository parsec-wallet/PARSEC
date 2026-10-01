import { describe, it, expect } from 'vitest';
import algosdk from 'algosdk';
import { encodeArc26, parseArc26, isArc26Uri } from '../arc26';

const VALID_ADDR = 'VM5TYSZ4TCR433566MUUGF2X4SJ3QYVNMCJFJ34ZKSKBRGUAVVPEHLGCQY';

describe('arc26', () => {
  describe('encodeArc26', () => {
    it('encodes address-only', () => {
      expect(encodeArc26({ address: VALID_ADDR })).toBe(`algorand://${VALID_ADDR}`);
    });

    it('encodes amount in microalgos', () => {
      const uri = encodeArc26({ address: VALID_ADDR, amount: 1_500_000 });
      expect(uri).toBe(`algorand://${VALID_ADDR}?amount=1500000`);
    });

    it('encodes assetId as ?asset=', () => {
      const uri = encodeArc26({ address: VALID_ADDR, assetId: 31566704, amount: 100 });
      expect(uri).toContain('asset=31566704');
      expect(uri).toContain('amount=100');
    });

    it('url-encodes the note', () => {
      const uri = encodeArc26({ address: VALID_ADDR, note: 'hello world & friends' });
      expect(uri).toContain('note=hello+world+%26+friends');
    });

    it('rejects invalid address', () => {
      expect(() => encodeArc26({ address: 'not-valid' })).toThrow();
    });

    it('rejects negative amount', () => {
      expect(() => encodeArc26({ address: VALID_ADDR, amount: -1 })).toThrow();
    });
  });

  describe('parseArc26', () => {
    it('parses bare address', () => {
      const r = parseArc26(`algorand://${VALID_ADDR}`);
      expect(r).toEqual({ address: VALID_ADDR });
    });

    it('parses amount + asset + note', () => {
      const r = parseArc26(
        `algorand://${VALID_ADDR}?amount=2500000&asset=31566704&note=test`,
      );
      expect(r).toEqual({
        address: VALID_ADDR,
        amount: 2_500_000,
        assetId: 31566704,
        note: 'test',
      });
    });

    it('parses xnote and label', () => {
      const r = parseArc26(`algorand://${VALID_ADDR}?xnote=immut&label=Coffee`);
      expect(r?.xnote).toBe('immut');
      expect(r?.label).toBe('Coffee');
    });

    it('returns null for non-algorand:// URIs', () => {
      expect(parseArc26('https://example.com')).toBeNull();
      expect(parseArc26('')).toBeNull();
    });

    it('returns null for invalid address', () => {
      expect(parseArc26('algorand://not-valid?amount=1')).toBeNull();
    });
  });

  describe('round-trip', () => {
    it('encode → parse round-trip preserves all fields', () => {
      const args = {
        address: VALID_ADDR,
        amount: 12345,
        assetId: 99,
        note: 'meta+stuff',
        xnote: 'immut',
        label: 'Tip jar',
      };
      const uri = encodeArc26(args);
      const parsed = parseArc26(uri);
      expect(parsed).toEqual({
        address: VALID_ADDR,
        amount: 12345,
        assetId: 99,
        note: 'meta+stuff',
        xnote: 'immut',
        label: 'Tip jar',
      });
    });
  });

  describe('isArc26Uri', () => {
    it('detects algorand:// URIs', () => {
      expect(isArc26Uri(`algorand://${VALID_ADDR}`)).toBe(true);
      expect(isArc26Uri('https://example.com')).toBe(false);
    });
  });

  it('algosdk validates the test address (sanity check)', () => {
    expect(algosdk.isValidAddress(VALID_ADDR)).toBe(true);
  });
});
