// Cross-validation against @algorandfoundation/xhd-wallet-api.
//
// The README of the upstream lib publishes a "BIP44 paths" hex table whose
// values are derived through a manual node-by-node walk that does not align
// 1:1 with keyGen()'s path semantics. The lib's own jest suite asserts
// equality against an external reference impl on the fly, not against pinned
// hex. We do the next-best thing here: lock down the *behavioral* invariants
// of our wrapper so any future Rust port (chain_algo_hd) must reproduce them.
//
// The upstream lib carries its own spec test that proves BIP32-Ed25519
// compliance. Our test proves that parsec's wrapper preserves the lib's
// behavior end-to-end (BIP-39 → seed → rootKey → keyGen → algosdk address).

import { describe, it, expect } from 'vitest';
import { BIP32DerivationType } from '@algorandfoundation/xhd-wallet-api';
import { generateBip39Mnemonic, validateBip39Mnemonic, rootKeyFromMnemonic } from '../seed';
import { deriveAlgo, deriveIdentity, signTxn } from '../derive';

const REF_MNEMONIC =
  'salon zoo engage submit smile frost later decide wing sight chaos renew lizard rely canal coral scene hobby scare step bus leaf tobacco slice';

const REF_ROOT_KEY_HEX =
  'a8ba80028922d9fcfa055c78aede55b5c575bcd8d5a53168edf45f36d9ec8f4694592b4bc892907583e22669ecdf1b0409a9f3bd5549f2dd751b51360909cd05796b9206ec30e142e94b790a98805bf999042b55046963174ee6cee2d0375946';

function hex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

describe('algorand-hd: BIP-39 → root key', () => {
  it('produces the official 96-byte root key for the reference mnemonic', () => {
    const rootKey = rootKeyFromMnemonic(REF_MNEMONIC);
    expect(rootKey.length).toBe(96);
    expect(hex(rootKey)).toBe(REF_ROOT_KEY_HEX);
  });

  it('rejects 25-word algosdk mnemonics implicitly via BIP-39 validation', () => {
    const algosdkLike = Array(25).fill('abandon').join(' ');
    expect(validateBip39Mnemonic(algosdkLike)).toBe(false);
  });

  it('generates valid 24-word mnemonics', () => {
    const phrase = generateBip39Mnemonic();
    expect(phrase.split(/\s+/)).toHaveLength(24);
    expect(validateBip39Mnemonic(phrase)).toBe(true);
  });
});

describe('algorand-hd: derivation', () => {
  it('derives a 32-byte Ed25519 pubkey at m/44/283/0/0/0 (Peikert)', async () => {
    const rootKey = rootKeyFromMnemonic(REF_MNEMONIC);
    const k = await deriveAlgo(rootKey, 0, 0);
    expect(k.publicKey.length).toBe(32);
    expect(k.address).toMatch(/^[A-Z2-7]{58}$/);
    expect(k.path).toBe("m/44'/283'/0'/0/0");
  });

  it('is deterministic: same args → same output', async () => {
    const rootKey1 = rootKeyFromMnemonic(REF_MNEMONIC);
    const rootKey2 = rootKeyFromMnemonic(REF_MNEMONIC);
    const a = await deriveAlgo(rootKey1, 0, 0);
    const b = await deriveAlgo(rootKey2, 0, 0);
    expect(hex(a.publicKey)).toBe(hex(b.publicKey));
  });

  it('Peikert and Khovratovich produce different outputs for the same path', async () => {
    const rootKey = rootKeyFromMnemonic(REF_MNEMONIC);
    const peikert = await deriveAlgo(rootKey, 0, 0, BIP32DerivationType.Peikert);
    const khov = await deriveAlgo(rootKey, 0, 0, BIP32DerivationType.Khovratovich);
    expect(hex(peikert.publicKey)).not.toBe(hex(khov.publicKey));
  });

  it('different keyIndex produces different addresses', async () => {
    const rootKey = rootKeyFromMnemonic(REF_MNEMONIC);
    const a = await deriveAlgo(rootKey, 0, 0);
    const b = await deriveAlgo(rootKey, 0, 1);
    expect(a.address).not.toBe(b.address);
  });

  it('different account produces different addresses', async () => {
    const rootKey = rootKeyFromMnemonic(REF_MNEMONIC);
    const a = await deriveAlgo(rootKey, 0, 0);
    const b = await deriveAlgo(rootKey, 1, 0);
    expect(a.address).not.toBe(b.address);
  });

  it('Address (283) and Identity (0) coin types produce different keys for the same indices', async () => {
    const rootKey = rootKeyFromMnemonic(REF_MNEMONIC);
    const algo = await deriveAlgo(rootKey, 0, 0);
    const id = await deriveIdentity(rootKey, 0, 0);
    expect(hex(algo.publicKey)).not.toBe(hex(id.publicKey));
    expect(algo.path).toBe("m/44'/283'/0'/0/0");
    expect(id.path).toBe("m/44'/0'/0'/0/0");
  });

  it('Identity context paths use coin type 0', async () => {
    const rootKey = rootKeyFromMnemonic(REF_MNEMONIC);
    const id = await deriveIdentity(rootKey, 7, 3);
    expect(id.path).toBe("m/44'/0'/7'/0/3");
    expect(id.publicKey.length).toBe(32);
  });
});

describe('algorand-hd: signing produces 64-byte sigs', () => {
  it('signs an arbitrary payload deterministically (Ed25519)', async () => {
    const rootKey = rootKeyFromMnemonic(REF_MNEMONIC);
    // Algorand transactions are msgpack with a "TX" prefix; here we just
    // exercise the signer with a non-tagged payload to confirm 64-byte output.
    const payload = new Uint8Array(64).fill(0x42);
    const sig1 = await signTxn(rootKey, 0, 0, payload);
    const sig2 = await signTxn(rootKey, 0, 0, payload);
    expect(sig1.length).toBe(64);
    expect(hex(sig1)).toBe(hex(sig2));
  });
});
