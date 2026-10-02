// Solana wallet module — BIP-39 → SLIP-0010 ed25519 child → base58 address.
// Mirrors arweaveHdModule but with the much lighter ed25519 primitives;
// keys are 32 bytes, signing is fast, derivation is deterministic.
//
// Used in this round specifically as the destination address for the
// ARIO BASE→Solana migration via sol.ar.io. Signing is wired but not
// yet surfaced in any UI flow; the migration just needs the address.

import * as bip39 from 'bip39';
import type {
  WalletModule,
  CreatedWallet,
  ImportedWallet,
  PublicSurface,
} from '../pouch/types';
import { deriveSolanaFromMnemonic } from './seed';
import { isSolanaAddress } from './address';

export const solanaModule: WalletModule = {
  chainId: 'solana',
  name: 'Solana',
  enabled: true,

  async createWallet(): Promise<CreatedWallet> {
    const mnemonic = bip39.generateMnemonic(256); // 24 words
    const { address } = await deriveSolanaFromMnemonic(mnemonic);
    return {
      walletId: `sol_${address.slice(0, 8)}`,
      chainId: 'solana',
      address,
      recoveryMaterial: mnemonic,
    };
  },

  async importWallet(secret: string, format): Promise<ImportedWallet> {
    if (format === 'mnemonic') {
      const trimmed = secret.trim();
      if (!bip39.validateMnemonic(trimmed)) {
        throw new Error('Invalid BIP-39 mnemonic');
      }
      const { address } = await deriveSolanaFromMnemonic(trimmed);
      return { walletId: `sol_${address.slice(0, 8)}`, chainId: 'solana', address, watchOnly: false };
    }
    if (format === 'watch-only') {
      if (!isSolanaAddress(secret)) {
        throw new Error('Invalid Solana address (expected 32-44 base58 chars)');
      }
      return { walletId: `sol_${secret.slice(0, 8)}`, chainId: 'solana', address: secret, watchOnly: true };
    }
    throw new Error(`Unsupported import format for Solana: ${format}`);
  },

  async deriveReceiveAddress(): Promise<string> {
    throw new Error('Solana addresses are static (one key = one address).');
  },

  async signMessage(walletId: string, message: Uint8Array): Promise<Uint8Array> {
    // walletId = Solana base58 address. Signed by the Keycore on the desktop.
    const { solanaMessageSigner } = await import('./kit-signer');
    return solanaMessageSigner(walletId).sign(message);
  },

  async exportPublicSurface(walletId: string): Promise<PublicSurface> {
    return { chainId: 'solana', surfaceType: 'address', value: walletId };
  },
};
