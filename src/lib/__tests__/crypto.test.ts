import { describe, it, expect, beforeEach } from 'vitest';
import { saveMnemonic, loadMnemonic, hasVault, removeAccount, verifyPassphrase, listAccounts } from '../crypto';

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
  };
})();

Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock });

describe('Web Crypto Encryption (PBKDF2 + AES-256-GCM)', () => {
  const address = 'TESTADDR1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ012345678901';
  const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
  const passphrase = 'strong-test-passphrase-123!';

  beforeEach(() => {
    localStorageMock.clear();
  });

  it('encrypt then decrypt roundtrip returns original data', async () => {
    await saveMnemonic(address, mnemonic, passphrase);
    const recovered = await loadMnemonic(address, passphrase);
    expect(recovered).toBe(mnemonic);
  });

  it('decrypt with wrong passphrase returns null', async () => {
    await saveMnemonic(address, mnemonic, passphrase);
    const recovered = await loadMnemonic(address, 'wrong-passphrase');
    expect(recovered).toBeNull();
  });

  it('different passphrases produce different ciphertexts', async () => {
    const address2 = 'TESTADDR2_____________________________________________234';
    await saveMnemonic(address, mnemonic, 'passphrase-A');
    await saveMnemonic(address2, mnemonic, 'passphrase-B');

    const vault = JSON.parse(localStorageMock.getItem('parsec-encrypted-keys')!);
    const cipher1 = vault.accounts.find((a: { address: string }) => a.address === address)?.cipher;
    const cipher2 = vault.accounts.find((a: { address: string }) => a.address === address2)?.cipher;
    expect(cipher1).not.toBe(cipher2);
  });

  it('empty string encrypts/decrypts correctly', async () => {
    await saveMnemonic(address, '', passphrase);
    const recovered = await loadMnemonic(address, passphrase);
    expect(recovered).toBe('');
  });

  it('hasVault returns false when empty, true after save', async () => {
    expect(hasVault()).toBe(false);
    await saveMnemonic(address, mnemonic, passphrase);
    expect(hasVault()).toBe(true);
  });

  it('removeAccount removes the account from vault', async () => {
    await saveMnemonic(address, mnemonic, passphrase);
    expect(hasVault()).toBe(true);
    removeAccount(address);
    expect(hasVault()).toBe(false);
  });

  it('verifyPassphrase returns true for correct passphrase', async () => {
    await saveMnemonic(address, mnemonic, passphrase);
    expect(await verifyPassphrase(passphrase)).toBe(true);
    expect(await verifyPassphrase('wrong')).toBe(false);
  });

  it('listAccounts returns addresses only, never ciphertext', async () => {
    await saveMnemonic(address, mnemonic, passphrase);
    expect(listAccounts()).toEqual([{ address }]);
    removeAccount(address);
    expect(listAccounts()).toEqual([]);
  });
});
