// PARSEC Wallet — chain_ar IPC client (Arweave).
//
// RSA-4096 with RSA-PSS / SHA-256 / 32-byte salt, matching ANS-104 signature
// type 1.
//
// NOTE ON RECOVERY: a Rust-generated Arweave key comes from the OS CSPRNG and is
// **not** derivable from a mnemonic. Its JWK is the backup. The legacy
// mnemonic→RSA path in `arweave/seed.ts` is kept for recovering accounts created
// that way — derive there, import the JWK here, and all later signing is in Rust.

import { invoke } from './platform';

export interface ArAccountInfo {
  address: string;
  /** The RSA modulus, base64url — Arweave's "owner" field. Public data. */
  owner: string;
  bits: number;
}

/**
 * Generate a new Arweave account.
 *
 * Takes several seconds — RSA-4096 prime search is slow. Show progress; do not
 * let the UI look hung.
 */
export async function arCreateAccount(label?: string): Promise<ArAccountInfo> {
  return await invoke<ArAccountInfo>('chain_ar_create_account', { label });
}

/** Import from a JWK, including one derived by the legacy TypeScript path. */
export async function arImportAccount(jwk: string, label?: string): Promise<ArAccountInfo> {
  return await invoke<ArAccountInfo>('chain_ar_import_account', { args: { jwk, label } });
}

export async function arAccountInfo(address: string): Promise<ArAccountInfo> {
  return await invoke<ArAccountInfo>('chain_ar_account_info', { address });
}

/** Sign with RSA-PSS. Randomized by design — two signatures differ and both verify. */
export async function arSign(
  address: string,
  payloadB64: string,
  approval?: string,
): Promise<{ signature_b64: string; scheme: 'rsa-pss-sha256'; salt_len: number }> {
  return await invoke('chain_ar_sign', { args: { address, payload_b64: payloadB64, approval } });
}
