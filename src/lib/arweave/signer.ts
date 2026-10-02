// Vault-bridged Arweave signer factory: one signer per dApp connection or
// logical interaction. Signatures come from `vaultArweaveKey` — the PARSEC
// Keycore (`chain_ar_sign`) on the desktop, so the JWK never enters JavaScript;
// the browser build holds the JWK until dispose().
//
// The injected window.arweaveWallet API consumes one of these per connection.

import type Transaction from 'arweave/node/lib/transaction';
import { base64urlToBytes, bytesToBase64url } from './jwk';
import { signDataItemWith, type DataItemInput, type SignedDataItem } from './ans104';
import { signTxWith, uploadTx, type TxReceipt } from './tx';
import { getArweaveClient } from './client';
import { vaultArweaveKey, type ArweaveVaultKey } from './vault-key';

export interface ArweaveSigner {
  /** 43-char base64url address bound to this signer's key. */
  address: string;
  /** base64url RSA-4096 public modulus (= JWK `n`). */
  publicKey: string;

  /** Sign an Arweave native transaction. Mutates and returns the same tx. */
  signTransaction(tx: Transaction): Promise<Transaction>;
  /** Sign + post an Arweave native transaction (base-layer dispatch). */
  dispatch(tx: Transaction): Promise<TxReceipt>;
  /** Sign a DataItem (the AO-critical method). */
  signDataItem(input: Omit<DataItemInput, 'owner'>): Promise<SignedDataItem>;
  /** RSA-PSS / SHA-256 signature over arbitrary bytes. */
  signMessage(data: Uint8Array): Promise<Uint8Array>;
  /** Convenience: verify a signature against this signer's public key. */
  verifyMessage(data: Uint8Array, signature: Uint8Array): Promise<boolean>;

  /** Release the signer (and, in the browser build, the held JWK). Idempotent. */
  dispose(): void;
}

/**
 * Build a vault-secured Arweave signer for the given address. Re-issue per
 * dApp connection so disposal is bounded to that session.
 */
export async function buildArweaveSigner(
  address: string,
  passphrase: string,
): Promise<ArweaveSigner> {
  let key: ArweaveVaultKey | null = await vaultArweaveKey(address, passphrase);
  const publicKey = key.owner;
  let publicKeyImported: CryptoKey | null = null;

  function requireKey(): ArweaveVaultKey {
    if (!key) throw new Error('Arweave signer has been disposed');
    return key;
  }

  return {
    address,
    publicKey,

    async signTransaction(tx: Transaction): Promise<Transaction> {
      const k = requireKey();
      return await signTxWith(tx, k.owner, k.sign);
    },

    async dispatch(tx: Transaction): Promise<TxReceipt> {
      // Sign in-place, then post to the base layer. Bundling via Turbo is a
      // separate path (Phase 3+) and would slot in here as an optional route.
      const k = requireKey();
      await signTxWith(tx, k.owner, k.sign);
      return await uploadTx(tx);
    },

    async signDataItem(input): Promise<SignedDataItem> {
      const k = requireKey();
      return await signDataItemWith({ ...input, owner: k.owner }, k.sign);
    },

    async signMessage(data: Uint8Array): Promise<Uint8Array> {
      return await requireKey().sign(data);
    },

    async verifyMessage(data: Uint8Array, signature: Uint8Array): Promise<boolean> {
      if (!publicKeyImported) {
        publicKeyImported = await crypto.subtle.importKey(
          'jwk',
          { kty: 'RSA', e: 'AQAB', n: publicKey, alg: 'PS256', ext: true },
          { name: 'RSA-PSS', hash: 'SHA-256' },
          false,
          ['verify'],
        );
      }
      return await crypto.subtle.verify(
        { name: 'RSA-PSS', saltLength: 32 },
        publicKeyImported,
        signature as unknown as BufferSource,
        data as unknown as BufferSource,
      );
    },

    dispose(): void {
      key?.dispose();
      key = null;
      publicKeyImported = null;
    },
  };
}

// ── Bare helpers exposed for the injected API's stateless paths ──

/** Resolve the active gateway as the {host, port, protocol} the dApp expects. */
export function activeArweaveConfig(): { host: string; port: number; protocol: string } {
  const c = getArweaveClient().api.getConfig();
  const rawPort = typeof c.port === 'string' ? parseInt(c.port, 10) : c.port;
  const port: number = typeof rawPort === 'number' && Number.isFinite(rawPort) ? rawPort : 443;
  return {
    host: c.host ?? 'arweave.net',
    port,
    protocol: c.protocol ?? 'https',
  };
}

/** base64url helpers re-exported so the injected API doesn't import from jwk.ts. */
export { base64urlToBytes, bytesToBase64url };
