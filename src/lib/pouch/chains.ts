// PARSEC — Chain Module Registry
// Each chain is a modular adapter. Algorand is live. Others ready to plug in.
// x402 signing bridge wired via signMessage() for vault-secured operations.

import type { WalletModule, CreatedWallet, ImportedWallet, PublicSurface } from './types';
import { generateAccount, recoverAccount, validateMnemonic } from '../algorand/account';
import { signBytesWithVault } from '../x402/bridge';
import { xchainModule } from '../xchain/module';
import { algorandHdModule } from '../algorand-hd/module';
import { arweaveHdModule } from '../arweave';
import { solanaModule } from '../solana/module';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { secp256k1 } from '@noble/curves/secp256k1.js';

// ── EIP-55 Checksum Address ────────────────────────────────────
function toChecksumAddress(address: string): string {
  const addr = address.toLowerCase().replace('0x', '');
  const hashBytes = keccak_256(new TextEncoder().encode(addr));
  const hash = Array.from(hashBytes).map(b => b.toString(16).padStart(2, '0')).join('');
  let checksummed = '0x';
  for (let i = 0; i < addr.length; i++) {
    checksummed += parseInt(hash[i], 16) >= 8 ? addr[i].toUpperCase() : addr[i];
  }
  return checksummed;
}

// ── Ethereum address from private key ──────────────────────────
// Standard: privkey → secp256k1 uncompressed pubkey → keccak256(pubkey[1:]) → last 20 bytes
function deriveEthAddress(privateKeyBytes: Uint8Array): string {
  const uncompressedPubKey = secp256k1.getPublicKey(privateKeyBytes, false);
  // Skip the 0x04 prefix byte, hash the remaining 64 bytes
  const hash = keccak_256(uncompressedPubKey.slice(1));
  const addressBytes = hash.slice(hash.length - 20);
  const rawAddress = '0x' + Array.from(addressBytes).map(b => b.toString(16).padStart(2, '0')).join('');
  return toChecksumAddress(rawAddress);
}

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
    // Derive address: keccak256(privateKey), take last 20 bytes, EIP-55 checksum
    const address = deriveEthAddress(randomBytes);
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
      // Derive address from private key via keccak256 + EIP-55 checksum
      const keyBytes = new Uint8Array(secret.slice(2).match(/.{2}/g)!.map(b => parseInt(b, 16)));
      const address = deriveEthAddress(keyBytes);
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

// ── Litecoin Module (STUB — UTXO family, shares Bitcoin isolation zone) ──

export const litecoinModule: WalletModule = {
  chainId: 'litecoin',
  name: 'Litecoin',
  enabled: false,

  async createWallet(): Promise<CreatedWallet> { throw new Error('Litecoin module not yet implemented'); },
  async importWallet(): Promise<ImportedWallet> { throw new Error('Litecoin module not yet implemented'); },
  async deriveReceiveAddress(): Promise<string> { throw new Error('Litecoin module not yet implemented'); },
  async signMessage(): Promise<Uint8Array> { throw new Error('Litecoin module not yet implemented'); },
  async exportPublicSurface(): Promise<PublicSurface> { throw new Error('Litecoin module not yet implemented'); },
};

// ── Monero Module (STUB — CryptoNote family, isolated encryption zone) ──
// Monero requires its own signing context: EdDSA, ring signatures, stealth addresses.
// Private keys are view key + spend key pair. Never shares crypto context with other families.

export const moneroModule: WalletModule = {
  chainId: 'monero',
  name: 'Monero',
  enabled: false,

  async createWallet(): Promise<CreatedWallet> { throw new Error('Monero module requires WASM integration'); },
  async importWallet(): Promise<ImportedWallet> { throw new Error('Monero module requires WASM integration'); },
  async deriveReceiveAddress(): Promise<string> { throw new Error('Monero uses stealth addresses per transaction'); },
  async signMessage(): Promise<Uint8Array> { throw new Error('Monero module requires WASM integration'); },
  async exportPublicSurface(): Promise<PublicSurface> { throw new Error('Monero module requires WASM integration'); },
};

// ── Zilliqa Module (STUB — Schnorr/secp256k1 family, isolated signing zone) ──
// Zilliqa uses Schnorr signatures (NOT ECDSA) over secp256k1.
// Address: SHA-256 of pubkey → last 20 bytes → bech32 "zil1..." encoding.
// Zilliqa 2.0 EVM compat uses standard EVM key — handled by ethereumModule.
// This module is for native Zilliqa (Scilla contracts, Schnorr signing).

export const zilliqaModule: WalletModule = {
  chainId: 'zilliqa',
  name: 'Zilliqa',
  enabled: false,

  async createWallet(): Promise<CreatedWallet> {
    // Key generation: secp256k1 private key → Schnorr-compatible pubkey
    // Address derivation: SHA-256(compressed_pubkey) → last 20 bytes → bech32
    // Requires @zilliqa-js/crypto for proper bech32 encoding + Schnorr key validation
    throw new Error('Zilliqa module requires @zilliqa-js/crypto integration');
  },
  async importWallet(secret: string, format): Promise<ImportedWallet> {
    if (format === 'watch-only') {
      // Accept zil1... bech32 or 0x... base16 address
      const isZil = secret.startsWith('zil1') || (secret.startsWith('0x') && secret.length === 42);
      if (!isZil) throw new Error('Invalid Zilliqa address (expected zil1... or 0x...)');
      return { walletId: `zil_${Date.now().toString(36)}`, chainId: 'zilliqa', address: secret, watchOnly: true };
    }
    throw new Error('Zilliqa key import requires @zilliqa-js/crypto');
  },
  async deriveReceiveAddress(): Promise<string> { throw new Error('Zilliqa addresses are static'); },
  async signMessage(): Promise<Uint8Array> { throw new Error('Zilliqa Schnorr signing requires @zilliqa-js/crypto'); },
  async exportPublicSurface(walletId: string): Promise<PublicSurface> {
    return { chainId: 'zilliqa', surfaceType: 'address', value: walletId };
  },
};

// ── Cardano Module (STUB — Ed25519-BIP32 family, eUTXO model) ──
// Cardano uses Ed25519-BIP32 extended keys with CIP-1852 derivation.
// Address types: base (payment + stake), enterprise (payment only), reward.
// eUTXO: extended UTXO with datum and redeemer for Plutus scripts.
// Native multi-asset: tokens are first-class, not smart contract issued.

export const cardanoModule: WalletModule = {
  chainId: 'cardano',
  name: 'Cardano',
  enabled: false,

  async createWallet(): Promise<CreatedWallet> {
    // Key derivation: 24-word BIP-39 mnemonic → PBKDF2 → BIP32-Ed25519 master key
    // Path: m / 1852' / 1815' / 0' / 0 / 0 (payment key per CIP-1852)
    // Stake key: m / 1852' / 1815' / 0' / 2 / 0
    // Address: CBOR(payment_credential || stake_credential) → bech32 "addr1..."
    // Requires @emurgo/cardano-serialization-lib or cardano-js-sdk
    throw new Error('Cardano module requires cardano-serialization-lib integration');
  },
  async importWallet(secret: string, format): Promise<ImportedWallet> {
    if (format === 'watch-only') {
      // Accept addr1... (mainnet) or addr_test1... (testnet) bech32 addresses
      const isCardano = secret.startsWith('addr1') || secret.startsWith('addr_test1');
      if (!isCardano) throw new Error('Invalid Cardano address (expected addr1... or addr_test1...)');
      return { walletId: `ada_${Date.now().toString(36)}`, chainId: 'cardano', address: secret, watchOnly: true };
    }
    if (format === 'mnemonic') {
      // Cardano uses 24-word BIP-39 mnemonics (NOT 25-word like Algorand)
      const words = secret.trim().split(/\s+/);
      if (words.length !== 24) throw new Error('Cardano requires 24-word BIP-39 mnemonic');
      // Full derivation requires cardano-serialization-lib
      throw new Error('Cardano mnemonic import requires cardano-serialization-lib');
    }
    throw new Error(`Unsupported import format for Cardano: ${format}`);
  },
  async deriveReceiveAddress(): Promise<string> {
    // Cardano supports HD derivation: m/1852'/1815'/0'/0/{index}
    // Each new index derives a fresh payment address
    throw new Error('Cardano HD address derivation requires cardano-serialization-lib');
  },
  async signMessage(): Promise<Uint8Array> {
    // CIP-30 message signing: Ed25519 signature over CBOR-wrapped payload
    throw new Error('Cardano Ed25519-BIP32 signing requires cardano-serialization-lib');
  },
  async exportPublicSurface(walletId: string): Promise<PublicSurface> {
    return { chainId: 'cardano', surfaceType: 'address', value: walletId };
  },
};

// ── Arweave Module (LIVE — vault signing ready via WebCrypto RSA-PSS) ──
// Arweave uses RSA-4096 keypairs stored as JWK.
// Address: SHA-256(base64url_decode(jwk.n)) → base64url (43 chars).
// Signing: RSA-PSS + SHA-256 via WebCrypto — no external deps needed.
// Key format: JWK JSON string stored in vault.
// Pain points addressed:
//   - JWK is large (~3KB) — vault stores it as a single encrypted blob
//   - Fee estimation requires gateway call (/price/{bytes})
//   - Anchor (lastTx) must be fresh — stale anchor = rejected tx
//   - Data chunking for uploads >256KB requires Merkle tree computation

export const arweaveModule: WalletModule = {
  chainId: 'arweave',
  name: 'Arweave',
  enabled: true,

  async createWallet(): Promise<CreatedWallet> {
    // Generate RSA-4096 keypair using WebCrypto
    const keyPair = await crypto.subtle.generateKey(
      { name: 'RSA-PSS', modulusLength: 4096, publicExponent: new Uint8Array([0x01, 0x00, 0x01]), hash: 'SHA-256' },
      true, // extractable — needed to export as JWK for vault storage
      ['sign', 'verify'],
    );

    const jwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey);

    // Address = SHA-256(base64url_decode(n)) → base64url
    const nBytes = base64urlToBytes(jwk.n!);
    const addressHash = await crypto.subtle.digest('SHA-256', nBytes);
    const address = bytesToBase64url(new Uint8Array(addressHash));

    return {
      walletId: `ar_${Date.now().toString(36)}`,
      chainId: 'arweave',
      address,
      recoveryMaterial: JSON.stringify(jwk), // Full JWK — shown once, then encrypted in vault
    };
  },

  async importWallet(secret: string, format): Promise<ImportedWallet> {
    if (format === 'watch-only') {
      // Arweave addresses are 43-char base64url
      if (secret.length !== 43) throw new Error('Invalid Arweave address (expected 43-char base64url)');
      return { walletId: `ar_${Date.now().toString(36)}`, chainId: 'arweave', address: secret, watchOnly: true };
    }
    if (format === 'private-key') {
      // Expect JWK JSON string
      let jwk: JsonWebKey;
      try { jwk = JSON.parse(secret); } catch { throw new Error('Arweave key must be JWK JSON'); }
      if (!jwk.n) throw new Error('Invalid Arweave JWK (missing public modulus n)');

      // Derive address from JWK
      const nBytes = base64urlToBytes(jwk.n);
      const addressHash = await crypto.subtle.digest('SHA-256', nBytes);
      const address = bytesToBase64url(new Uint8Array(addressHash));

      return { walletId: `ar_${Date.now().toString(36)}`, chainId: 'arweave', address, watchOnly: false };
    }
    throw new Error(`Unsupported import format for Arweave: ${format}`);
  },

  async deriveReceiveAddress(): Promise<string> {
    throw new Error('Arweave addresses are static (one RSA key = one address)');
  },

  async signMessage(_walletId: string, _message: Uint8Array): Promise<Uint8Array> {
    // Arweave signing uses vault-secured RSA-PSS.
    // The isolation layer's signArweave() handles this via WebCrypto.
    // This stub exists for the WalletModule interface — actual signing
    // goes through builder/isolation.ts → vaultSign().
    throw new Error('Use builder isolation layer for Arweave signing (vault-secured RSA-PSS)');
  },

  async exportPublicSurface(walletId: string): Promise<PublicSurface> {
    return { chainId: 'arweave', surfaceType: 'address', value: walletId };
  },
};

// ── Arweave base64url helpers ────────────────────────────────

function base64urlToBytes(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - b64.length % 4) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToBase64url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// ── Registry ──────────────────────────────────────────────────

const MODULES: WalletModule[] = [
  algorandModule,
  xchainModule,
  algorandHdModule,
  bitcoinModule,
  ethereumModule,
  litecoinModule,
  moneroModule,
  zilliqaModule,
  cardanoModule,
  arweaveModule,
  arweaveHdModule,
  solanaModule,
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
