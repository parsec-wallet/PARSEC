// PARSEC x402 Integration — signing bridge
// Builds the x402 signer shape over the PARSEC Keycore. On the desktop no key
// enters JavaScript: transactions are signed by `chain_algo_sign_transaction`
// and messages by `chain_algo_sign_bytes`. The browser build (no Keycore) reads
// the key for the moment of signing, through `walletSigner`.
// SPDX-FileCopyrightText: 2026 BANKON
// SPDX-License-Identifier: Apache-2.0

import algosdk from 'algosdk';
import { getAlgodClient } from '../algorand/client';
import { walletSigner } from '../algorand/signer';
import { algoSignBytes } from '../chain-algo';
import { isTauri } from '../platform';
import { keystoreRetrieve } from '../keystore';
import { store } from '../store';
import type { NetworkId } from '../../types/wallet';

// ── x402 Signer Interface ────────────────────────────────────────
// Matches @x402-avm/fetch expected signer shape.

export interface X402Signer {
  address: string;
  getAddresses: () => string[];
  signTransaction: (txnBytes: Uint8Array) => Promise<Uint8Array>;
  signTransactions: (txns: Uint8Array[], indexesToSign?: number[]) => Promise<(Uint8Array | null)[]>;
  getAlgodClient: () => algosdk.Algodv2;
  sendTransactions: (signedTxns: Uint8Array[]) => Promise<string>;
  waitForConfirmation: (txId: string, network: string, waitRounds?: number) => Promise<Record<string, unknown>>;
}

// ── Algorand x402 Signer ─────────────────────────────────────────

/**
 * An x402 signer for a vault account, signed by the PARSEC Keycore.
 *
 * `_passphrase` is kept for callers written against the old bridge; the vault
 * session decides, not a passphrase passed around in JavaScript. A transaction
 * whose sender is not `address` is refused before it reaches the signer.
 */
export async function buildAlgorandX402Signer(
  address: string,
  _passphrase: string,
  network: NetworkId = 'testnet',
): Promise<X402Signer> {
  const client = getAlgodClient(network);

  async function signAt(txns: Uint8Array[], indexes: number[]): Promise<Uint8Array[]> {
    const group = txns.map((t) => algosdk.decodeUnsignedTransaction(t));
    for (const i of indexes) {
      const sender = group[i].sender.toString();
      if (sender !== address) throw new Error(`Refusing to sign for ${sender}: this signer is ${address}`);
    }
    const signer = await walletSigner(address);
    try {
      return await signer.sign(group, indexes);
    } finally {
      signer.dispose();
    }
  }

  return {
    address,
    getAddresses: () => [address],

    signTransaction: async (txnBytes: Uint8Array) => (await signAt([txnBytes], [0]))[0],

    signTransactions: async (txns: Uint8Array[], indexesToSign?: number[]) => {
      const indexes = indexesToSign ?? txns.map((_, i) => i);
      const signed = await signAt(txns, indexes);
      return txns.map((_, i) => {
        const at = indexes.indexOf(i);
        return at < 0 ? null : signed[at];
      });
    },

    getAlgodClient: () => client,

    sendTransactions: async (signedTxns: Uint8Array[]) => {
      const response = await client.sendRawTransaction(signedTxns).do();
      return response.txid as string;
    },

    waitForConfirmation: async (txId: string, _network: string, waitRounds = 4) => {
      const result = await algosdk.waitForConfirmation(client, txId, waitRounds);
      return result as unknown as Record<string, unknown>;
    },
  };
}

// ── xchain (EVM-controlled Algorand) x402 Signer ─────────────────

/**
 * Build an x402 signer for a MetaMask-controlled Algorand LogicSig account.
 * No vault retrieval: the EVM key never enters parsec — MetaMask remains the
 * sole custodian. Each `signTransaction` call routes through EIP-712.
 */
export async function buildXchainX402Signer(
  algoAddress: string,
  evmAddress: string,
  network: NetworkId = 'testnet',
): Promise<X402Signer> {
  // Lazy imports to avoid pulling the EVM stack into non-xchain code paths.
  const { detectInjectedProvider } = await import('../builder/isolation');
  const { signTxnWithMetamask } = await import('../xchain/sign');

  const provider = detectInjectedProvider();
  if (!provider) throw new Error('No injected EVM wallet detected for xchain signer');

  const client = getAlgodClient(network);

  return {
    address: algoAddress,
    getAddresses: () => [algoAddress],

    signTransaction: async (txnBytes: Uint8Array) => {
      const decoded = algosdk.decodeUnsignedTransaction(txnBytes);
      const signed = await signTxnWithMetamask(provider, evmAddress, [decoded], network);
      return signed[0];
    },

    signTransactions: async (txns: Uint8Array[], indexesToSign?: number[]) => {
      // Decode all, then sign as a group so MetaMask sees one EIP-712 prompt.
      const decoded = txns.map((t) => algosdk.decodeUnsignedTransaction(t));
      const signed = await signTxnWithMetamask(provider, evmAddress, decoded, network);
      return signed.map((blob, i) => (indexesToSign && !indexesToSign.includes(i) ? null : blob));
    },

    getAlgodClient: () => client,

    sendTransactions: async (signedTxns: Uint8Array[]) => {
      const response = await client.sendRawTransaction(signedTxns).do();
      return response.txid as string;
    },

    waitForConfirmation: async (txId: string, _network: string, waitRounds = 4) => {
      const result = await algosdk.waitForConfirmation(client, txId, waitRounds);
      return result as unknown as Record<string, unknown>;
    },
  };
}

// ── Algorand Message Signing ─────────────────────────────────────

/**
 * Sign arbitrary bytes (Algorand `MX` prefix) with a vault account.
 * Used for: identity challenges, command channel, EIP-712 equivalent on Algorand.
 * Desktop: `chain_algo_sign_bytes` in the Keycore. Browser build: the key is
 * read for the moment of signing and overwritten after.
 */
export async function signBytesWithVault(
  address: string,
  _passphrase: string,
  message: Uint8Array,
): Promise<Uint8Array> {
  if (isTauri) {
    const { signature_b64 } = await algoSignBytes(address, bytesToB64(message));
    return b64ToBytes(signature_b64);
  }
  const pass = store.getPassphrase();
  if (!pass) throw new Error('Unlock the wallet first.');
  const mnemonic = await keystoreRetrieve(address, pass);
  if (!mnemonic) throw new Error(`No key found in vault for ${address}`);
  const { addr, sk } = algosdk.mnemonicToSecretKey(mnemonic.trim());
  try {
    if (addr.toString() !== address) throw new Error(`Vault key mismatch for ${address}`);
    return algosdk.signBytes(message, sk);
  } finally {
    sk.fill(0);
  }
}

function bytesToB64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function b64ToBytes(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
