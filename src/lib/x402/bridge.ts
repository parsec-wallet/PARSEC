// Parsec x402 Integration — Vault-Secured Signing Bridge
// Retrieves keys from vault EPHEMERALLY, builds x402 signer, signs, discards.
// Secrets pass through JS only for a single signing operation.
// (c) 2026 BANKON — GPL-3.0

import algosdk from 'algosdk';
import { keystoreRetrieve } from '../keystore';
import { getAlgodClient } from '../algorand/client';
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
 * Build a vault-secured x402 signer for Algorand.
 *
 * Flow:
 *   1. keystoreRetrieve(address, passphrase) → mnemonic (brief hold)
 *   2. algosdk.mnemonicToSecretKey(mnemonic) → { addr, sk }
 *   3. Build signer object with sk in closure
 *   4. Caller uses signer for one x402 payment cycle
 *   5. Caller discards signer reference → sk eligible for GC
 *
 * The signer closure is the ONLY place the secret key lives in JS.
 */
export async function buildAlgorandX402Signer(
  address: string,
  passphrase: string,
  network: NetworkId = 'testnet',
): Promise<X402Signer> {
  // Step 1: Retrieve mnemonic from vault (Rust AES-256-GCM → JS briefly)
  const mnemonic = await keystoreRetrieve(address, passphrase);
  if (!mnemonic) {
    throw new Error(`No key found in vault for ${address}`);
  }

  // Step 2: Derive signing key
  const { addr, sk } = algosdk.mnemonicToSecretKey(mnemonic.trim());
  const addrStr = addr.toString();

  // Verify address matches
  if (addrStr !== address) {
    throw new Error(`Vault key mismatch: expected ${address}, got ${addrStr}`);
  }

  // Step 3: Build algod client for this network
  const client = getAlgodClient(network);

  // Step 4: Return x402-compatible signer (sk lives in closure only)
  return {
    address: addrStr,
    getAddresses: () => [addrStr],

    signTransaction: async (txnBytes: Uint8Array) => {
      const decoded = algosdk.decodeUnsignedTransaction(txnBytes);
      const signed = algosdk.signTransaction(decoded, sk);
      return signed.blob;
    },

    signTransactions: async (txns: Uint8Array[], indexesToSign?: number[]) => {
      return txns.map((txn, i) => {
        if (indexesToSign && !indexesToSign.includes(i)) return null;
        const decoded = algosdk.decodeUnsignedTransaction(txn);
        const signed = algosdk.signTransaction(decoded, sk);
        return signed.blob;
      });
    },

    getAlgodClient: () => client,

    sendTransactions: async (signedTxns: Uint8Array[]) => {
      const response = await client.sendRawTransaction(signedTxns).do();
      return response.txid as string;
    },

    waitForConfirmation: async (_txId: string, _network: string, waitRounds = 4) => {
      const result = await algosdk.waitForConfirmation(client, _txId, waitRounds);
      return result as unknown as Record<string, unknown>;
    },
  };
}

// ── Algorand Message Signing ─────────────────────────────────────

/**
 * Sign arbitrary bytes using vault-secured key.
 * Used for: identity challenges, command channel, EIP-712 equivalent on Algorand.
 */
export async function signBytesWithVault(
  address: string,
  passphrase: string,
  message: Uint8Array,
): Promise<Uint8Array> {
  const mnemonic = await keystoreRetrieve(address, passphrase);
  if (!mnemonic) {
    throw new Error(`No key found in vault for ${address}`);
  }

  const { sk } = algosdk.mnemonicToSecretKey(mnemonic.trim());
  const signature = algosdk.signBytes(message, sk);
  // sk goes out of scope here → eligible for GC
  return signature;
}

// ── Algorand Payment (direct, non-x402) ──────────────────────────

/**
 * Send a direct ALGO payment using vault-secured key.
 * For x402 payments, use buildAlgorandX402Signer() instead.
 */
export async function sendPaymentWithVault(
  address: string,
  passphrase: string,
  receiver: string,
  amountMicroAlgos: number,
  note: string,
  network: NetworkId = 'testnet',
): Promise<{ txId: string; confirmedRound: number }> {
  const mnemonic = await keystoreRetrieve(address, passphrase);
  if (!mnemonic) {
    throw new Error(`No key found in vault for ${address}`);
  }

  const client = getAlgodClient(network);
  const account = algosdk.mnemonicToSecretKey(mnemonic.trim());
  const suggestedParams = await client.getTransactionParams().do();

  const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    sender: account.addr,
    receiver,
    amount: amountMicroAlgos,
    note: note ? new TextEncoder().encode(note) : undefined,
    suggestedParams,
  });

  const signedTxn = txn.signTxn(account.sk);
  const { txid } = await client.sendRawTransaction(signedTxn).do();
  const result = await algosdk.waitForConfirmation(client, txid, 4);
  // account goes out of scope → sk eligible for GC
  return { txId: txid, confirmedRound: Number(result.confirmedRound || 0) };
}
