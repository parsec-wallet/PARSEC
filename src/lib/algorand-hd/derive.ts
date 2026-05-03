// Derive Algorand (KeyContext.Address) and Identity-context (KeyContext.Identity)
// public keys from a 96-byte extended root key. Spec: ARC-52, BIP-44 paths
// m/44'/283'/account'/0/keyIndex (Algorand) and m/44'/0'/account'/0/keyIndex (Identity).

import algosdk from 'algosdk';
import {
  XHDWalletAPI,
  KeyContext,
  BIP32DerivationType,
} from '@algorandfoundation/xhd-wallet-api';

const api = new XHDWalletAPI();

export interface DerivedKey {
  address: string;       // Standard Algorand 58-char base32
  publicKey: Uint8Array; // 32-byte Ed25519 pubkey
  path: string;          // BIP-44 path string (for display / debugging)
}

/**
 * Derive an Algorand address (KeyContext.Address) at the given account/index.
 * Defaults to Peikert derivation (the more entropic, recommended variant).
 */
export async function deriveAlgo(
  rootKey: Uint8Array,
  account: number,
  keyIndex: number,
  derivationType: BIP32DerivationType = BIP32DerivationType.Peikert,
): Promise<DerivedKey> {
  const publicKey = await api.keyGen(rootKey, KeyContext.Address, account, keyIndex, derivationType);
  return {
    address: algosdk.encodeAddress(publicKey),
    publicKey,
    path: `m/44'/283'/${account}'/0/${keyIndex}`,
  };
}

/**
 * Derive an Identity-context Ed25519 public key (DID / W3C-VC use cases).
 * Path: m/44'/0'/account'/0/keyIndex per ARC-52.
 */
export async function deriveIdentity(
  rootKey: Uint8Array,
  account: number,
  keyIndex: number,
  derivationType: BIP32DerivationType = BIP32DerivationType.Peikert,
): Promise<DerivedKey> {
  const publicKey = await api.keyGen(rootKey, KeyContext.Identity, account, keyIndex, derivationType);
  return {
    address: algosdk.encodeAddress(publicKey),
    publicKey,
    path: `m/44'/0'/${account}'/0/${keyIndex}`,
  };
}

/** Sign an encoded Algorand transaction with a derived child key. */
export async function signTxn(
  rootKey: Uint8Array,
  account: number,
  keyIndex: number,
  prefixEncodedTx: Uint8Array,
  derivationType: BIP32DerivationType = BIP32DerivationType.Peikert,
): Promise<Uint8Array> {
  return api.signAlgoTransaction(rootKey, KeyContext.Address, account, keyIndex, prefixEncodedTx, derivationType);
}
