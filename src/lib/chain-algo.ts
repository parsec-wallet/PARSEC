// PARSEC Wallet — chain_algo IPC client (Algorand).
//
// Replaces direct `algosdk` key handling in the renderer. Creating an account
// returns an address, never a seed: the secret is generated, stored and dropped
// inside Rust. Showing the participant their backup phrase is a separate,
// explicit call.

import { invoke } from './platform';

export interface AlgoAccountInfo {
  address: string;
  /** 32-byte ed25519 public key, hex. Public data. */
  public_key_hex: string;
}

/** Create an account. The seed never crosses this boundary. */
export async function algoCreateAccount(label?: string): Promise<AlgoAccountInfo> {
  return await invoke<AlgoAccountInfo>('chain_algo_create_account', { label });
}

/** Import from a 25-word Algorand mnemonic. */
export async function algoImportAccount(
  mnemonic: string,
  label?: string,
): Promise<AlgoAccountInfo> {
  return await invoke<AlgoAccountInfo>('chain_algo_import_account', {
    args: { mnemonic, label },
  });
}

/** Preview the address for a mnemonic. Stores nothing. */
export async function algoAddressFromMnemonic(mnemonic: string): Promise<string> {
  return await invoke<string>('chain_algo_address_from_mnemonic', {
    mnemonicPhrase: mnemonic,
  });
}

/** Validate a 25-word Algorand mnemonic (not BIP-39). */
export async function algoValidateMnemonic(mnemonic: string): Promise<boolean> {
  return await invoke<boolean>('chain_algo_validate_mnemonic', { mnemonicPhrase: mnemonic });
}

export interface AlgoSignature {
  signature_b64: string;
  scheme: 'ed25519';
}

/** Sign an arbitrary message with Algorand's `MX` domain prefix. */
export async function algoSignBytes(
  address: string,
  payloadB64: string,
): Promise<AlgoSignature> {
  return await invoke<AlgoSignature>('chain_algo_sign_bytes', {
    args: { address, payload_b64: payloadB64 },
  });
}

/**
 * Sign pre-built transaction bytes with no added prefix.
 *
 * Separate from `algoSignBytes` on purpose: a caller must not be able to obtain a
 * transaction-valid signature over something the participant believed they were
 * signing only for authentication.
 */
export async function algoSignTransaction(
  address: string,
  payloadB64: string,
): Promise<AlgoSignature> {
  return await invoke<AlgoSignature>('chain_algo_sign_transaction', {
    args: { address, payload_b64: payloadB64 },
  });
}
