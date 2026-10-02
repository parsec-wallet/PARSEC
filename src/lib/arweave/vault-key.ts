// An Arweave key held in the vault, as the two things a signer needs: the public
// modulus (`owner`) and a function that signs a deep-hash.
//
// Desktop: the PARSEC Keycore signs (`chain_ar_sign`, RSA-PSS / SHA-256 / 32-byte salt);
// the JWK never enters JavaScript. Browser build (no Keycore): the JWK is read from the
// browser keystore, held until `dispose()`, and signed with WebCrypto.
// SPDX-FileCopyrightText: 2026 BANKON
// SPDX-License-Identifier: GPL-3.0-or-later

import { isTauri } from '../platform';
import { keystoreRetrieve } from '../keystore';
import { arAccountInfo, arSign } from '../chain-ar';
import { addressFromJwk, parseJwk, type ArweaveJwk } from './jwk';

export interface ArweaveVaultKey {
  address: string;
  /** base64url RSA-4096 public modulus (= JWK `n`, Arweave's `owner`). */
  owner: string;
  /** RSA-PSS signature over `data` (a transaction's or DataItem's deep-hash). */
  sign(data: Uint8Array): Promise<Uint8Array>;
  /** Drop any key material held for the browser build. Idempotent. */
  dispose(): void;
}

export async function vaultArweaveKey(address: string, passphrase = ''): Promise<ArweaveVaultKey> {
  if (isTauri) {
    const { owner, address: stored } = await arAccountInfo(address);
    if (stored !== address) throw new Error(`Vault key for ${address} reports address ${stored}`);
    return {
      address,
      owner,
      async sign(data) {
        const { signature_b64 } = await arSign(address, bytesToB64(data));
        return b64ToBytes(signature_b64);
      },
      dispose() { /* nothing held */ },
    };
  }
  const secret = await keystoreRetrieve(address, passphrase);
  if (!secret) throw new Error(`No Arweave key in vault for ${address}`);
  let jwk: ArweaveJwk | null;
  try {
    jwk = parseJwk(secret);
  } catch {
    throw new Error('Vault secret for Arweave wallet must be a JWK JSON string');
  }
  const derived = await addressFromJwk(jwk);
  if (derived !== address) {
    clearJwk(jwk);
    throw new Error(`Vault JWK address (${derived}) does not match wallet ${address}`);
  }
  return {
    address,
    owner: jwk.n!,
    sign: async (data) => {
      if (!jwk) throw new Error('Arweave key has been disposed');
      return signWithJwk(jwk, data);
    },
    dispose() {
      if (jwk) clearJwk(jwk);
      jwk = null;
    },
  };
}

/** RSA-PSS / SHA-256 / 32-byte salt with a JWK, through WebCrypto. */
export async function signWithJwk(jwk: ArweaveJwk | JsonWebKey, data: Uint8Array): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'RSA-PSS', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign({ name: 'RSA-PSS', saltLength: 32 }, cryptoKey, data as unknown as BufferSource);
  return new Uint8Array(sig);
}

/** Best effort: JS strings are immutable, this only breaks the object graph. */
export function clearJwk(jwk: ArweaveJwk | JsonWebKey): void {
  jwk.d = ''; jwk.p = ''; jwk.q = ''; jwk.dp = ''; jwk.dq = ''; jwk.qi = '';
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
