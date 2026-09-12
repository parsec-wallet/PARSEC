// PARSEC — Chain Isolation Layer
// Cryptographic boundary enforcement. Each chain family operates
// in its own signing context. Keys never cross family lines.
// External signers (MetaMask, WalletConnect) are fully sandboxed —
// PARSEC never touches their private keys.
// SPDX-FileCopyrightText: 2026 BANKON
// SPDX-License-Identifier: Apache-2.0

import type {
  ChainFamily,
  SigningAuthority,
  IsolationContext,
  EIP1193Provider,
  EthTxRequest,
  BuiltTransaction,
} from './types';
import { getChain } from './registry';
import { keystoreRetrieve } from '../keystore';

// ── Isolation Zone ───────────────────────────────────────────
// Each zone tracks which addresses are authorized for which family
// and enforces that signing requests stay within their boundary.

interface ZoneEntry {
  address: string;
  family: ChainFamily;
  authority: SigningAuthority;
  chainId: string;
}

const zones: Map<string, ZoneEntry> = new Map();

/** Register an address within an isolation zone */
export function registerAddress(
  address: string,
  chainId: string,
  authority: SigningAuthority,
): void {
  const chain = getChain(chainId);
  if (!chain) throw new Error(`Unknown chain: ${chainId}`);

  const key = `${chain.family}:${address.toLowerCase()}`;
  zones.set(key, {
    address,
    family: chain.family,
    authority,
    chainId,
  });
}

/** Create an isolation context for a signing operation */
export function createIsolationContext(
  address: string,
  chainId: string,
  authority: SigningAuthority,
): IsolationContext {
  const chain = getChain(chainId);
  if (!chain) throw new Error(`Unknown chain: ${chainId}`);

  const externalOnly = authority !== 'vault';

  return {
    family: chain.family,
    authority,
    chainId,
    address,
    externalOnly,
  };
}

/** Validate that a built transaction matches its isolation context */
export function validateIsolation(tx: BuiltTransaction): void {
  const chain = getChain(tx.chain);
  if (!chain) throw new Error(`Unknown chain in transaction: ${tx.chain}`);

  // Family must match
  if (tx.family !== chain.family) {
    throw new Error(
      `Isolation violation: tx family '${tx.family}' does not match chain family '${chain.family}'`
    );
  }

  // If signed by vault, verify address is registered in this zone
  if (tx.isolation.authority === 'vault') {
    const key = `${chain.family}:${tx.isolation.address.toLowerCase()}`;
    const entry = zones.get(key);
    if (!entry) {
      throw new Error(
        `Isolation violation: address ${tx.isolation.address} not registered in ${chain.family} zone`
      );
    }
  }
}

// ── Vault Signing (PARSEC holds key) ─────────────────────────
// Key retrieved ephemerally → sign → discard. Same pattern as x402/bridge.ts.

export async function vaultSign(
  address: string,
  chainId: string,
  payload: Uint8Array,
  passphrase: string,
): Promise<Uint8Array> {
  const chain = getChain(chainId);
  if (!chain) throw new Error(`Unknown chain: ${chainId}`);

  // Enforce isolation: only vault-registered addresses can sign
  const key = `${chain.family}:${address.toLowerCase()}`;
  const entry = zones.get(key);
  if (!entry || entry.authority !== 'vault') {
    throw new Error(`Address ${address} is not vault-managed in ${chain.family} zone`);
  }

  // Retrieve key ephemerally
  const secret = await keystoreRetrieve(address, passphrase);
  if (!secret) throw new Error(`No key in vault for ${address}`);

  // Dispatch to family-specific signing
  switch (chain.family) {
    case 'algorand':
      return signAlgorand(secret, payload);
    case 'evm':
      return signEVM(secret, payload);
    case 'utxo':
      return signUTXO(secret, payload);
    case 'cryptonote':
      return signCryptoNote(secret, payload);
    case 'zilliqa':
      return signZilliqa(secret, payload);
    case 'cardano':
      return signCardano(secret, payload);
    case 'arweave':
      return signArweave(secret, payload);
    default:
      throw new Error(`No vault signer for family: ${chain.family}`);
  }
  // secret goes out of scope → eligible for GC
}

// ── Family-Specific Vault Signers ────────────────────────────

async function signAlgorand(secret: string, payload: Uint8Array): Promise<Uint8Array> {
  const algosdk = await import('algosdk');
  const { sk } = algosdk.default.mnemonicToSecretKey(secret.trim());
  const signed = algosdk.default.signBytes(payload, sk);
  // sk out of scope
  return signed;
}

async function signEVM(secret: string, payload: Uint8Array): Promise<Uint8Array> {
  // EVM signing: secp256k1 + keccak256
  // Uses @noble/curves (already in deps) — no ethers dependency
  const { secp256k1 } = await import('@noble/curves/secp256k1.js');
  const { keccak_256 } = await import('@noble/hashes/sha3.js');

  const keyBytes = hexToBytes(secret);
  // Ethereum personal_sign: keccak256(prefix + message)
  const prefix = new TextEncoder().encode(`\x19Ethereum Signed Message:\n${payload.length}`);
  const prefixed = new Uint8Array(prefix.length + payload.length);
  prefixed.set(prefix);
  prefixed.set(payload, prefix.length);
  const hash = keccak_256(prefixed);

  const sigObj = secp256k1.sign(hash, keyBytes) as unknown as {
    toCompactRawBytes(): Uint8Array;
    recovery: number;
  };
  const compact = sigObj.toCompactRawBytes(); // 64 bytes: r(32) + s(32)
  const result = new Uint8Array(65);
  result.set(compact);
  result[64] = sigObj.recovery + 27;
  return result;
}

async function signUTXO(_secret: string, _payload: Uint8Array): Promise<Uint8Array> {
  // Bitcoin/Litecoin: secp256k1 ECDSA
  // Requires proper SIGHASH computation per input.
  // Implementation deferred until bitcoinjs-lib or equivalent is integrated.
  throw new Error('UTXO vault signing requires bitcoinjs-lib integration');
}

async function signCryptoNote(_secret: string, _payload: Uint8Array): Promise<Uint8Array> {
  // Monero: EdDSA (Ed25519) + ring signatures + stealth addresses
  // Requires monero-javascript or native WASM module.
  // CryptoNote signing is fundamentally different — ring signatures
  // involve multiple public keys and key images.
  throw new Error('CryptoNote vault signing requires monero WASM integration');
}

async function signZilliqa(_secret: string, _payload: Uint8Array): Promise<Uint8Array> {
  // Zilliqa: Schnorr signatures over secp256k1
  // Schnorr is NOT ECDSA — uses a different signing algorithm on the same curve.
  // The Zilliqa Schnorr scheme follows the original Schnorr paper:
  //   k = random nonce, R = k*G, e = H(R || pubkey || msg), s = k - e*privkey
  //   signature = (r, s) where r = R.x
  //
  // @noble/curves supports Schnorr for secp256k1 (BIP-340 variant),
  // but Zilliqa uses a non-BIP-340 variant. Requires @zilliqa-js/crypto
  // or a custom Schnorr implementation matching Zilliqa's spec.
  throw new Error('Zilliqa vault signing requires @zilliqa-js/crypto for Schnorr signatures');
}

async function signCardano(_secret: string, _payload: Uint8Array): Promise<Uint8Array> {
  // Cardano: Ed25519-BIP32 extended keys
  // Key derivation follows CIP-1852 (purpose 1852') with BIP32-Ed25519.
  // Extended keys are 64 bytes (private) + 32 bytes (chain code) = 96 bytes.
  // Standard Ed25519 signing on the derived key.
  //
  // Secret format for Cardano: 24-word BIP-39 mnemonic → PBKDF2 → master key
  // Then derive: m / 1852' / 1815' / 0' / 0 / 0 (payment key)
  //
  // Requires @emurgo/cardano-serialization-lib or cardano-js-sdk for
  // proper BIP32-Ed25519 derivation + CBOR transaction witness building.
  throw new Error('Cardano vault signing requires cardano-serialization-lib for Ed25519-BIP32');
}

async function signArweave(secret: string, payload: Uint8Array): Promise<Uint8Array> {
  // Arweave: RSA-4096 with RSA-PSS + SHA-256
  // Secret is a JWK JSON string containing the full RSA private key.
  // Uses WebCrypto API — available in both browser and Node.js.
  //
  // Flow:
  //   1. Parse JWK from vault secret
  //   2. Import as CryptoKey (RSA-PSS, SHA-256)
  //   3. Sign payload → 512-byte signature
  //   4. Discard CryptoKey reference → eligible for GC
  //
  // ArConnect pattern: freeDecryptedWallet() overwrites JWK fields.
  // We follow the same principle — secret string goes out of scope after this fn.

  let jwk: JsonWebKey;
  try {
    jwk = JSON.parse(secret);
  } catch {
    throw new Error('Arweave vault secret must be a JWK JSON string');
  }

  const cryptoKey = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'RSA-PSS', hash: 'SHA-256' },
    false, // not extractable
    ['sign'],
  );

  const signature = await crypto.subtle.sign(
    { name: 'RSA-PSS', saltLength: 32 },
    cryptoKey,
    payload,
  );

  // cryptoKey + jwk go out of scope → eligible for GC
  return new Uint8Array(signature);
}

// ── MetaMask / Injected Provider (External Signing) ──────────
// PARSEC never touches the private key. MetaMask owns it entirely.
// We only pass unsigned transactions for the provider to sign.

export async function metamaskSign(
  provider: EIP1193Provider,
  tx: EthTxRequest,
  expectedChainId?: number,
): Promise<string> {
  // Verify we're on the right chain
  if (expectedChainId !== undefined) {
    const currentChainHex = await provider.request({ method: 'eth_chainId' }) as string;
    const currentChain = parseInt(currentChainHex, 16);
    if (currentChain !== expectedChainId) {
      // Request chain switch
      try {
        await provider.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: '0x' + expectedChainId.toString(16) }],
        });
      } catch {
        throw new Error(
          `MetaMask is on chain ${currentChain}, expected ${expectedChainId}. Switch failed.`
        );
      }
    }
  }

  // Verify the signing address is available in MetaMask
  const accounts = await provider.request({ method: 'eth_requestAccounts' }) as string[];
  const fromLower = tx.from.toLowerCase();
  if (!accounts.some(a => a.toLowerCase() === fromLower)) {
    throw new Error(`Address ${tx.from} not available in MetaMask`);
  }

  // Send the transaction — MetaMask signs it internally
  const txHash = await provider.request({
    method: 'eth_sendTransaction',
    params: [tx],
  }) as string;

  return txHash;
}

/** Request MetaMask to sign a message (personal_sign) */
export async function metamaskPersonalSign(
  provider: EIP1193Provider,
  address: string,
  message: string,
): Promise<string> {
  const accounts = await provider.request({ method: 'eth_requestAccounts' }) as string[];
  if (!accounts.some(a => a.toLowerCase() === address.toLowerCase())) {
    throw new Error(`Address ${address} not available in MetaMask`);
  }

  return await provider.request({
    method: 'personal_sign',
    params: [message, address],
  }) as string;
}

/** Detect injected EIP-1193 provider (MetaMask, etc.) */
export function detectInjectedProvider(): EIP1193Provider | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { ethereum?: EIP1193Provider };
  return w.ethereum ?? null;
}

/** Get connected accounts from injected provider */
export async function getInjectedAccounts(provider: EIP1193Provider): Promise<string[]> {
  return await provider.request({ method: 'eth_accounts' }) as string[];
}

// ── Cross-Family Guard ───────────────────────────────────────
// Prevents any operation from crossing family boundaries.

export function assertSameFamily(chainIdA: string, chainIdB: string): void {
  const a = getChain(chainIdA);
  const b = getChain(chainIdB);
  if (!a || !b) throw new Error(`Unknown chain in family check`);
  if (a.family !== b.family) {
    throw new Error(
      `Cross-family operation denied: ${a.name} (${a.family}) ↔ ${b.name} (${b.family})`
    );
  }
}

// ── Utility ──────────────────────────────────────────────────

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}
