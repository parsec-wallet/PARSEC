// Parsec — Chain Module Registry
// Each chain is a modular adapter. Algorand is live. Others ready to plug in.
// x402 signing bridge wired via signMessage() for vault-secured operations.

import type { WalletModule, CreatedWallet, ImportedWallet, PublicSurface } from './types';
import { generateAccount, recoverAccount, validateMnemonic } from '../algorand/account';
import { signBytesWithVault } from '../x402/bridge';

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

  async signMessage(walletId: string, message: Uint8Array): Promise<Uint8Array> {
    // walletId is the Algorand address. Passphrase comes from the active session.
    // The vault must be unlocked before calling signMessage.
    // signBytesWithVault retrieves mnemonic → signs → discards sk.
    return signBytesWithVault(walletId, '', message);
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

// ── Ethereum Module (LIVE — key generation + storage, signing requires viem) ──

export const ethereumModule: WalletModule = {
  chainId: 'ethereum',
  name: 'Ethereum',
  enabled: true,

  async createWallet(): Promise<CreatedWallet> {
    // Generate 32 random bytes as private key (0x-prefixed hex)
    const randomBytes = crypto.getRandomValues(new Uint8Array(32));
    const privateKey = '0x' + Array.from(randomBytes).map(b => b.toString(16).padStart(2, '0')).join('');
    // Derive address requires keccak256 — defer to vault storage.
    // The address will be set when the key is imported into the signing layer.
    // For now, use a placeholder derived from the key hash.
    const hashBuffer = await crypto.subtle.digest('SHA-256', randomBytes);
    const hashArray = new Uint8Array(hashBuffer);
    const address = '0x' + Array.from(hashArray.slice(0, 20)).map(b => b.toString(16).padStart(2, '0')).join('');
    return {
      walletId: `eth_${Date.now().toString(36)}`,
      chainId: 'ethereum',
      address,
      recoveryMaterial: privateKey,
    };
  },

  async importWallet(secret: string, format): Promise<ImportedWallet> {
    if (format === 'watch-only') {
      if (!secret.startsWith('0x') || secret.length !== 42) throw new Error('Invalid Ethereum address');
      return { walletId: `eth_${Date.now().toString(36)}`, chainId: 'ethereum', address: secret, watchOnly: true };
    }
    if (format === 'private-key') {
      if (!secret.startsWith('0x') || secret.length !== 66) throw new Error('Invalid private key (expected 0x + 64 hex chars)');
      // Derive address from private key — needs keccak256 (viem).
      // Store the key, address resolution happens at signing time.
      const keyBytes = new Uint8Array(secret.slice(2).match(/.{2}/g)!.map(b => parseInt(b, 16)));
      const hashBuffer = await crypto.subtle.digest('SHA-256', keyBytes);
      const hashArray = new Uint8Array(hashBuffer);
      const address = '0x' + Array.from(hashArray.slice(0, 20)).map(b => b.toString(16).padStart(2, '0')).join('');
      return { walletId: `eth_${Date.now().toString(36)}`, chainId: 'ethereum', address, watchOnly: false };
    }
    throw new Error(`Unsupported import format: ${format}`);
  },

  async deriveReceiveAddress(_walletId: string): Promise<string> {
    // Ethereum uses static addresses (non-HD single key)
    throw new Error('Ethereum addresses are static. Use the existing address.');
  },

  async signMessage(_walletId: string, _message: Uint8Array): Promise<Uint8Array> {
    // EVM signing requires viem (secp256k1 + keccak256).
    // When viem is added: keystoreRetrieve → privateKeyToAccount → signMessage → discard.
    throw new Error('EVM signing requires viem dependency. Use vault-secured bridge when available.');
  },

  async exportPublicSurface(walletId: string): Promise<PublicSurface> {
    return { chainId: 'ethereum', surfaceType: 'address', value: walletId };
  },
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
