// Parsec — Chain Module Registry
// Each chain is a modular adapter. Algorand is live. Others ready to plug in.

import type { WalletModule, CreatedWallet, ImportedWallet, PublicSurface } from './types';
import { generateAccount, recoverAccount, validateMnemonic } from '../algorand/account';

// ── Algorand Module (LIVE) ────────────────────────────────────

export const algorandModule: WalletModule = {
  chainId: 'algorand',
  name: 'Algorand',
  enabled: true,

  async createWallet(): Promise<CreatedWallet> {
    const { mnemonic, address } = generateAccount();
    return {
      walletId: `algo_${Date.now().toString(36)}`,
      chainId: 'algorand',
      address,
      recoveryMaterial: mnemonic,
    };
  },

  async importWallet(secret: string, format): Promise<ImportedWallet> {
    if (format === 'watch-only') {
      return { walletId: `algo_${Date.now().toString(36)}`, chainId: 'algorand', address: secret, watchOnly: true };
    }
    if (format === 'mnemonic') {
      if (!validateMnemonic(secret)) throw new Error('Invalid Algorand mnemonic');
      const { address } = recoverAccount(secret);
      return { walletId: `algo_${Date.now().toString(36)}`, chainId: 'algorand', address, watchOnly: false };
    }
    throw new Error(`Unsupported import format: ${format}`);
  },

  async deriveReceiveAddress(_walletId: string): Promise<string> {
    // Algorand uses static addresses — no derivation needed
    throw new Error('Algorand addresses are static. Use the existing address.');
  },

  async signMessage(_walletId: string, _message: Uint8Array): Promise<Uint8Array> {
    throw new Error('Sign via keystoreRetrieve + algosdk');
  },

  async exportPublicSurface(walletId: string): Promise<PublicSurface> {
    // Would need wallet storage lookup — placeholder
    return { chainId: 'algorand', surfaceType: 'address', value: walletId };
  },
};

// ── Bitcoin Module (STUB — ready to implement) ────────────────

export const bitcoinModule: WalletModule = {
  chainId: 'bitcoin',
  name: 'Bitcoin',
  enabled: false,

  async createWallet(): Promise<CreatedWallet> { throw new Error('Bitcoin module not yet implemented'); },
  async importWallet(): Promise<ImportedWallet> { throw new Error('Bitcoin module not yet implemented'); },
  async deriveReceiveAddress(): Promise<string> { throw new Error('Bitcoin module not yet implemented'); },
  async signMessage(): Promise<Uint8Array> { throw new Error('Bitcoin module not yet implemented'); },
  async exportPublicSurface(): Promise<PublicSurface> { throw new Error('Bitcoin module not yet implemented'); },
};

// ── Ethereum Module (STUB) ────────────────────────────────────

export const ethereumModule: WalletModule = {
  chainId: 'ethereum',
  name: 'Ethereum',
  enabled: false,

  async createWallet(): Promise<CreatedWallet> { throw new Error('Ethereum module not yet implemented'); },
  async importWallet(): Promise<ImportedWallet> { throw new Error('Ethereum module not yet implemented'); },
  async deriveReceiveAddress(): Promise<string> { throw new Error('Ethereum module not yet implemented'); },
  async signMessage(): Promise<Uint8Array> { throw new Error('Ethereum module not yet implemented'); },
  async exportPublicSurface(): Promise<PublicSurface> { throw new Error('Ethereum module not yet implemented'); },
};

// ── Registry ──────────────────────────────────────────────────

const MODULES: WalletModule[] = [
  algorandModule,
  bitcoinModule,
  ethereumModule,
];

export function getChainModule(chainId: string): WalletModule | undefined {
  return MODULES.find(m => m.chainId === chainId);
}

export function getEnabledChains(): WalletModule[] {
  return MODULES.filter(m => m.enabled);
}

export function getAllChains(): WalletModule[] {
  return MODULES;
}
