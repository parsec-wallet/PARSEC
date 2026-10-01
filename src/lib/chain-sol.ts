// PARSEC Wallet — chain_sol IPC client (Solana).
//
// SLIP-0010 ed25519 at m/44'/501'/0'/0', the Phantom / Solflare convention, so an
// address PARSEC shows is one an external sender's wallet derives identically.

import { invoke } from './platform';

export interface SolAccountInfo {
  address: string;
  public_key_hex: string;
  /** The derivation path, e.g. m/44'/501'/0'/0' */
  path: string;
}

/** Preview the address for a BIP-39 mnemonic. Stores nothing. */
export async function solAddressFromMnemonic(mnemonic: string): Promise<SolAccountInfo> {
  return await invoke<SolAccountInfo>('chain_sol_address_from_mnemonic', {
    mnemonicPhrase: mnemonic,
  });
}

export async function solImportAccount(
  mnemonic: string,
  label?: string,
): Promise<SolAccountInfo> {
  return await invoke<SolAccountInfo>('chain_sol_import_account', {
    args: { mnemonic, label },
  });
}

/** Sign a Solana message. The signature returns; the key does not. */
export async function solSign(
  address: string,
  payloadB64: string,
): Promise<{ signature_b64: string; scheme: 'ed25519' }> {
  return await invoke('chain_sol_sign', { args: { address, payloadB64 } });
}
