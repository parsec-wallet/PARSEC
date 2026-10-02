// Arweave transaction builder + vault-bridged signer.
//
// The signing flow is Arweave-specific (deep-hash → RSA-PSS → derive id from
// signature) and is not a plain "sign this payload, return signature" call.
// Arweave needs the signature THEN sets it back onto the tx and derives an
// id from it. So this module owns its own vault-retrieval path — but uses
// the same primitives (keystoreRetrieve + WebCrypto RSA-PSS) for parity.
//
// Public surface:
//   buildUploadTx   — construct an unsigned tx (fetches anchor + price)
//   signTx          — sign with a JWK (pure, no vault, useful for tests)
//   signTxFromVault — retrieve JWK from vault, sign, zero JWK
//   uploadTx        — chunked POST to the gateway with progress callbacks
//   uploadData      — one-shot: build → sign → upload

import type Transaction from 'arweave/node/lib/transaction';
import { getArweaveClient } from './client';
import {
  addressFromJwk,
  bytesToBase64url,
  type ArweaveJwk,
} from './jwk';
import { keystoreRetrieve } from '../keystore';

export interface ArweaveTag {
  name: string;
  value: string;
}

export interface UploadOptions {
  /** Bytes to upload. Strings are UTF-8 encoded. */
  data: Uint8Array | string;
  /** ANS-104-style tags. Common: { name: 'Content-Type', value: 'image/png' }. */
  tags?: ArweaveTag[];
  /** Optional AR recipient — only set for AR transfers, not data uploads. */
  target?: string;
  /** Optional AR amount in winston (1e-12 AR) — paired with `target`. */
  quantityWinston?: string;
}

export interface UploadProgress {
  uploadedChunks: number;
  totalChunks: number;
  pctComplete: number;
}

export interface TxReceipt {
  id: string;
  reward: string;     // winston paid as miner fee
  dataSize: number;
  owner: string;      // base64url-encoded public modulus
}

/**
 * Build an unsigned Arweave transaction. Fetches a fresh anchor and price
 * from the active gateway. The returned Transaction is mutable — caller
 * adds tags and signs.
 */
export async function buildUploadTx(
  ownerN: string,
  opts: UploadOptions,
): Promise<Transaction> {
  const arweave = getArweaveClient();
  const data = typeof opts.data === 'string'
    ? new TextEncoder().encode(opts.data)
    : opts.data;

  const tx = await arweave.createTransaction({
    data,
    target: opts.target,
    quantity: opts.quantityWinston,
  });
  tx.setOwner(ownerN);

  if (opts.tags) {
    for (const t of opts.tags) tx.addTag(t.name, t.value);
  }

  return tx;
}

/**
 * Sign an unsigned tx with a JWK. Pure — does not touch the vault or
 * network. Mutates `tx` by setting its signature and id.
 *
 * Caller is responsible for zeroing the JWK after use if it came from
 * a vault retrieval.
 */
export async function signTx(
  tx: Transaction,
  jwk: ArweaveJwk | JsonWebKey,
): Promise<Transaction> {
  if (!jwk.n) throw new Error('JWK missing public modulus n');

  // Ensure owner matches the JWK we're signing with. Mismatches here
  // would post a tx whose signature doesn't verify against owner.
  if (!tx.owner) {
    tx.setOwner(jwk.n);
  } else if (tx.owner !== jwk.n) {
    throw new Error('Transaction owner does not match signing JWK');
  }

  const sigData = await tx.getSignatureData();

  const cryptoKey = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'RSA-PSS', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sigBuf = await crypto.subtle.sign(
    { name: 'RSA-PSS', saltLength: 32 },
    cryptoKey,
    sigData as unknown as BufferSource,
  );
  const signature = new Uint8Array(sigBuf);

  // Arweave tx id = SHA-256(signature), base64url-encoded.
  const idBuf = await crypto.subtle.digest('SHA-256', signature as unknown as BufferSource);
  const id = bytesToBase64url(new Uint8Array(idBuf));

  tx.setSignature({
    id,
    owner: jwk.n,
    signature: bytesToBase64url(signature),
  });
  return tx;
}

/**
 * Retrieve the JWK from the vault, sign the tx, zero the plaintext JWK.
 */
export async function signTxFromVault(
  address: string,
  passphrase: string,
  tx: Transaction,
): Promise<Transaction> {
  const secret = await keystoreRetrieve(address, passphrase);
  if (!secret) throw new Error(`No Arweave key in vault for ${address}`);

  let jwk: ArweaveJwk;
  try {
    jwk = JSON.parse(secret) as ArweaveJwk;
  } catch {
    throw new Error('Vault secret for Arweave wallet must be a JWK JSON string');
  }

  try {
    return await signTx(tx, jwk);
  } finally {
    // Best-effort: drop references to JWK fields. JS strings are immutable
    // so true zeroing requires Uint8Array buffers — this at least breaks
    // the object graph so the JWK is eligible for GC immediately.
    jwk.d = '';
    jwk.p = '';
    jwk.q = '';
    jwk.dp = '';
    jwk.dq = '';
    jwk.qi = '';
  }
}

/**
 * Send AR to a recipient. A value transfer is an empty-data transaction with
 * `target` + `quantity` set — it reuses the build → sign → upload path, so
 * the vault retrieval and JWK zeroing are identical to a data upload.
 */
export async function transferAr(
  address: string,
  passphrase: string,
  target: string,
  quantityWinston: string,
): Promise<TxReceipt> {
  return uploadData(address, passphrase, {
    data: new Uint8Array(0),
    target,
    quantityWinston,
  });
}

/**
 * Post a signed transaction to the gateway with chunked upload. Progress
 * fires once per chunk for files >256 KiB; smaller payloads complete
 * in a single call.
 */
export async function uploadTx(
  tx: Transaction,
  onProgress?: (p: UploadProgress) => void,
): Promise<TxReceipt> {
  const arweave = getArweaveClient();
  const uploader = await arweave.transactions.getUploader(tx);

  while (!uploader.isComplete) {
    await uploader.uploadChunk();
    if (onProgress) {
      onProgress({
        uploadedChunks: uploader.uploadedChunks,
        totalChunks: uploader.totalChunks,
        pctComplete: uploader.pctComplete,
      });
    }
  }

  return {
    id: tx.id,
    reward: tx.reward,
    dataSize: parseInt(tx.data_size, 10) || 0,
    owner: tx.owner,
  };
}

/**
 * One-shot: build → sign (from vault) → upload. Most callers want this.
 * Throws if the vault is locked or the JWK is missing.
 */
export async function uploadData(
  address: string,
  passphrase: string,
  opts: UploadOptions,
  onProgress?: (p: UploadProgress) => void,
): Promise<TxReceipt> {
  const secret = await keystoreRetrieve(address, passphrase);
  if (!secret) throw new Error(`No Arweave key in vault for ${address}`);
  let jwk: ArweaveJwk;
  try {
    jwk = JSON.parse(secret) as ArweaveJwk;
  } catch {
    throw new Error('Vault secret for Arweave wallet must be a JWK JSON string');
  }
  try {
    // Sanity-check: confirm JWK address matches the requested wallet.
    const derived = await addressFromJwk(jwk);
    if (derived !== address) {
      throw new Error(`Vault JWK address (${derived}) does not match wallet ${address}`);
    }
    const tx = await buildUploadTx(jwk.n!, opts);
    await signTx(tx, jwk);
    return await uploadTx(tx, onProgress);
  } finally {
    jwk.d = '';
    jwk.p = '';
    jwk.q = '';
    jwk.dp = '';
    jwk.dq = '';
    jwk.qi = '';
  }
}
