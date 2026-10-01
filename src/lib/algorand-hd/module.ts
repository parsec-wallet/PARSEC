// algorand-hd — ARC-52 BIP32-Ed25519 HD wallet as a parsec WalletModule.
// Parallel to the canonical algorandModule (25-word algosdk). The 24-word
// BIP-39 seed is stored in bankon_vault tagged 'algorand-hd' so it is never
// confused with the 25-word path.

import type {
  WalletModule,
  CreatedWallet,
  ImportedWallet,
  PublicSurface,
} from '../pouch/types';
import { vaultStoreKey } from '../vault';
import { generateBip39Mnemonic, validateBip39Mnemonic, rootKeyFromMnemonic } from './seed';
import { deriveAlgo, deriveIdentity } from './derive';
import type { DerivedKey } from './derive';

export const algorandHdModule: WalletModule = {
  chainId: 'algorand-hd',
  name: 'Algorand (HD ARC-52)',
  enabled: true,

  async createWallet(): Promise<CreatedWallet> {
    const mnemonic = generateBip39Mnemonic();
    const primary = await deriveFirst(mnemonic);
    return {
      walletId: primary.address,
      chainId: 'algorand-hd',
      address: primary.address,
      recoveryMaterial: mnemonic, // Shown once for backup; the create-wallet UX must wipe its copy.
    };
  },

  async importWallet(secret: string, format): Promise<ImportedWallet> {
    if (format === 'mnemonic') {
      const trimmed = secret.trim();
      const wordCount = trimmed.split(/\s+/).filter(Boolean).length;
      if (wordCount === 25) {
        throw new Error('25-word mnemonic detected — use the classic Algorand wallet path, not algorand-hd.');
      }
      if (!validateBip39Mnemonic(trimmed)) {
        throw new Error('Invalid 24-word BIP-39 mnemonic (wordlist or checksum failure)');
      }
      const primary = await deriveFirst(trimmed);
      return {
        walletId: primary.address,
        chainId: 'algorand-hd',
        address: primary.address,
        watchOnly: false,
      };
    }
    if (format === 'watch-only') {
      // Static address; HD derivation is impossible without the seed.
      return {
        walletId: secret,
        chainId: 'algorand-hd',
        address: secret,
        watchOnly: true,
      };
    }
    throw new Error(`Unsupported import format for algorand-hd: ${format}`);
  },

  async deriveReceiveAddress(_walletId: string): Promise<string> {
    // True HD multi-account is exposed via listDerivedAddresses() — not the
    // generic WalletModule interface, which only returns a single string.
    throw new Error('Use algorandHdModule.listDerivedAddresses(walletId, range) for HD addresses.');
  },

  async signMessage(_walletId: string, _message: Uint8Array): Promise<Uint8Array> {
    // Algorand signing is for transactions, not arbitrary messages. For the
    // Identity context (DID/VC) use deriveIdentityKey + sign separately.
    throw new Error('Use the algorand-hd vault-bridged transaction signer.');
  },

  async exportPublicSurface(walletId: string): Promise<PublicSurface> {
    return { chainId: 'algorand-hd', surfaceType: 'address', value: walletId };
  },
};

/** Module-specific extras (not on the WalletModule interface). */

/** Derive a range of receive addresses (account=0, indices [start, end)). */
export async function listDerivedAddresses(
  mnemonic: string,
  start: number,
  end: number,
  account = 0,
): Promise<DerivedKey[]> {
  const rootKey = rootKeyFromMnemonic(mnemonic);
  try {
    const out: DerivedKey[] = [];
    for (let i = start; i < end; i++) {
      out.push(await deriveAlgo(rootKey, account, i));
    }
    return out;
  } finally {
    rootKey.fill(0);
  }
}

/** Derive an Identity-context key (W3C VC / DID use cases). */
export async function deriveIdentityKey(
  mnemonic: string,
  account: number,
  keyIndex: number,
): Promise<DerivedKey> {
  const rootKey = rootKeyFromMnemonic(mnemonic);
  try {
    return await deriveIdentity(rootKey, account, keyIndex);
  } finally {
    rootKey.fill(0);
  }
}

/** Persist a freshly created HD wallet's seed in bankon_vault. */
export async function persistHdWallet(
  primaryAddress: string,
  mnemonic: string,
  label?: string,
): Promise<void> {
  await vaultStoreKey(primaryAddress, 'algorand-hd', label || 'HD ARC-52', mnemonic);
}

async function deriveFirst(mnemonic: string): Promise<DerivedKey> {
  const rootKey = rootKeyFromMnemonic(mnemonic);
  try {
    return await deriveAlgo(rootKey, 0, 0);
  } finally {
    rootKey.fill(0);
  }
}
