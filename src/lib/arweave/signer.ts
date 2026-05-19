// Vault-bridged Arweave signer factory. Mirrors src/lib/x402/bridge.ts's
// buildAlgorandX402Signer pattern: retrieve the JWK from BANKON once, hold
// it in a closure for one logical interaction, sign whatever the dApp asks,
// then discard. The keys never leave the closure scope.
//
// The injected window.arweaveWallet API consumes one of these per connection.

import type Transaction from 'arweave/node/lib/transaction';
import { addressFromJwk, base64urlToBytes, bytesToBase64url, parseJwk, type ArweaveJwk } from './jwk';
import { signDataItem, type DataItemInput, type SignedDataItem } from './ans104';
import { signTx, uploadTx, type TxReceipt } from './tx';
import { getArweaveClient } from './client';
import { keystoreRetrieve } from '../keystore';

export interface ArweaveSigner {
  /** 43-char base64url address bound to this signer's JWK. */
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

  /** Zero the held JWK fields. Idempotent. Call when the dApp disconnects. */
  dispose(): void;
}

/**
 * Build a vault-secured Arweave signer for the given address. The JWK is
 * retrieved once and held until dispose() is called. Re-issue per dApp
 * connection so disposal is bounded to that session.
 */
export async function buildArweaveSigner(
  address: string,
  passphrase: string,
): Promise<ArweaveSigner> {
  const secret = await keystoreRetrieve(address, passphrase);
  if (!secret) throw new Error(`No Arweave key in vault for ${address}`);

  let jwk: ArweaveJwk | null;
  try {
    jwk = parseJwk(secret);
  } catch {
    throw new Error('Vault secret for Arweave wallet must be a JWK JSON string');
  }

  // Sanity-check the JWK belongs to the requested address.
  const derived = await addressFromJwk(jwk);
  if (derived !== address) {
    throw new Error(`Vault JWK address (${derived}) does not match wallet ${address}`);
  }

  const publicKey = jwk.n!;
  let publicKeyImported: CryptoKey | null = null;

  function requireKey(): ArweaveJwk {
    if (!jwk) throw new Error('Arweave signer has been disposed');
    return jwk;
  }

  return {
    address,
    publicKey,

    async signTransaction(tx: Transaction): Promise<Transaction> {
      return await signTx(tx, requireKey());
    },

    async dispatch(tx: Transaction): Promise<TxReceipt> {
      // Sign in-place, then post to the base layer. Bundling via Turbo is a
      // separate path (Phase 3+) and would slot in here as an optional route.
      await signTx(tx, requireKey());
      return await uploadTx(tx);
    },

    async signDataItem(input): Promise<SignedDataItem> {
      const k = requireKey();
      return await signDataItem({ ...input, owner: k.n! }, k);
    },

    async signMessage(data: Uint8Array): Promise<Uint8Array> {
      const k = requireKey();
      const cryptoKey = await crypto.subtle.importKey(
        'jwk',
        k,
        { name: 'RSA-PSS', hash: 'SHA-256' },
        false,
        ['sign'],
      );
      const sigBuf = await crypto.subtle.sign(
        { name: 'RSA-PSS', saltLength: 32 },
        cryptoKey,
        data as unknown as BufferSource,
      );
      return new Uint8Array(sigBuf);
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
      if (jwk) {
        jwk.d = '';
        jwk.p = '';
        jwk.q = '';
        jwk.dp = '';
        jwk.dq = '';
        jwk.qi = '';
      }
      jwk = null;
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
