// arweave-hd — Arweave wallet derived from a BIP-39 mnemonic, parallel to
// algorandHdModule. Keeps `arweaveModule` (chainId='arweave', src/lib/pouch/
// chains.ts) untouched for the JWK-import / fresh-generation path.
//
// createWallet():   generate fresh 24-word BIP-39, derive RSA-4096, return
//                   the mnemonic as recoveryMaterial. The 3 KB JWK is
//                   regenerable from the 24 words.
// importWallet():   format='mnemonic' → derive; format='private-key' → JWK
//                   passthrough (so a Wander-style JWK still works here too);
//                   format='watch-only' → 43-char address only.

import type {
  WalletModule,
  CreatedWallet,
  ImportedWallet,
  PublicSurface,
} from '../pouch/types';
import * as bip39 from 'bip39';
import { deriveJwkFromMnemonic } from './seed';
import {
  addressFromJwk,
  isArweaveAddress,
  parseJwk,
} from './jwk';

export const arweaveHdModule: WalletModule = {
  chainId: 'arweave-hd',
  name: 'Arweave (HD)',
  enabled: true,

  async createWallet(): Promise<CreatedWallet> {
    const mnemonic = bip39.generateMnemonic(256); // 24 words
    const jwk = await deriveJwkFromMnemonic(mnemonic);
    const address = await addressFromJwk(jwk);
    return {
      walletId: `arhd_${address.slice(0, 8)}`,
      chainId: 'arweave-hd',
      address,
      recoveryMaterial: mnemonic, // shown once; JWK is regenerable
    };
  },

  async importWallet(secret: string, format): Promise<ImportedWallet> {
    if (format === 'mnemonic') {
      const trimmed = secret.trim();
      if (!bip39.validateMnemonic(trimmed)) {
        throw new Error('Invalid BIP-39 mnemonic (wordlist or checksum failure)');
      }
      const jwk = await deriveJwkFromMnemonic(trimmed);
      const address = await addressFromJwk(jwk);
      return {
        walletId: `arhd_${address.slice(0, 8)}`,
        chainId: 'arweave-hd',
        address,
        watchOnly: false,
      };
    }
    if (format === 'private-key') {
      // Wander-style JWK import — accepted here so users coming from Wander
      // can land in the same module rather than a separate chain entry.
      const jwk = parseJwk(secret);
      const address = await addressFromJwk(jwk);
      return {
        walletId: `arhd_${address.slice(0, 8)}`,
        chainId: 'arweave-hd',
        address,
        watchOnly: false,
      };
    }
    if (format === 'watch-only') {
      if (!isArweaveAddress(secret)) {
        throw new Error('Invalid Arweave address (expected 43-char base64url)');
      }
      return {
        walletId: `arhd_${secret.slice(0, 8)}`,
        chainId: 'arweave-hd',
        address: secret,
        watchOnly: true,
      };
    }
    throw new Error(`Unsupported import format for arweave-hd: ${format}`);
  },

  async deriveReceiveAddress(): Promise<string> {
    throw new Error('Arweave addresses are static (one RSA key = one address).');
  },

  async signMessage(): Promise<Uint8Array> {
    // Routing is identical to the standalone arweaveModule — both end up at
    // builder/isolation.ts signArweave() (RSA-PSS via WebCrypto on the JWK
    // stored in the vault). The WalletModule.signMessage hook is unused on
    // this chain family; signing flows through the builder layer instead.
    throw new Error('Use builder/isolation signArweave() for Arweave signing.');
  },

  async exportPublicSurface(walletId: string): Promise<PublicSurface> {
    return { chainId: 'arweave-hd', surfaceType: 'address', value: walletId };
  },
};
