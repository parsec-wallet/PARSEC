import { describe, it, expect } from 'vitest';
import { generateAccount, recoverAccount, validateMnemonic, microAlgosToAlgo } from '../account';

describe('Account Operations', () => {
  describe('generateAccount', () => {
    it('returns object with address and mnemonic', () => {
      const account = generateAccount();
      expect(account).toHaveProperty('address');
      expect(account).toHaveProperty('mnemonic');
      expect(typeof account.address).toBe('string');
      expect(typeof account.mnemonic).toBe('string');
    });

    it('address is 58 characters (Algorand standard)', () => {
      const account = generateAccount();
      expect(account.address).toHaveLength(58);
    });

    it('mnemonic is 25 words', () => {
      const account = generateAccount();
      const words = account.mnemonic.trim().split(/\s+/);
      expect(words).toHaveLength(25);
    });
  });

  describe('recoverAccount', () => {
    it('with valid mnemonic returns correct address', () => {
      // Generate first, then recover to verify roundtrip
      const original = generateAccount();
      const recovered = recoverAccount(original.mnemonic);
      expect(recovered.valid).toBe(true);
      expect(recovered.address).toBe(original.address);
    });

    it('with invalid mnemonic returns valid=false', () => {
      const result = recoverAccount('invalid mnemonic words that are not valid at all here');
      expect(result.valid).toBe(false);
      expect(result.address).toBe('');
    });
  });

  describe('validateMnemonic', () => {
    it('returns true for valid mnemonic', () => {
      const account = generateAccount();
      expect(validateMnemonic(account.mnemonic)).toBe(true);
    });

    it('returns false for invalid mnemonic', () => {
      expect(validateMnemonic('not a valid mnemonic phrase')).toBe(false);
    });

    it('returns false for empty string', () => {
      expect(validateMnemonic('')).toBe(false);
    });
  });

  describe('microAlgosToAlgo', () => {
    it('converts 1000000 to "1.000000"', () => {
      expect(microAlgosToAlgo(1000000)).toBe('1.000000');
    });

    it('converts 0 to "0.000000"', () => {
      expect(microAlgosToAlgo(0)).toBe('0.000000');
    });

    it('converts 500000 to "0.500000"', () => {
      expect(microAlgosToAlgo(500000)).toBe('0.500000');
    });

    it('converts 123456789 to "123.456789"', () => {
      expect(microAlgosToAlgo(123456789)).toBe('123.456789');
    });

    it('respects custom decimals parameter', () => {
      expect(microAlgosToAlgo(1000000, 2)).toBe('1.00');
    });
  });
});
