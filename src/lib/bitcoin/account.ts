// Bitcoin chain pack — thin IPC wrapper.
// Mirrors the Rust API in src-tauri/src/chain_btc/. No secret material
// crosses this boundary; only addresses and metadata come back.

import { invoke } from '@tauri-apps/api/core';

export type BtcNetwork = 'mainnet' | 'testnet' | 'regtest';

export type AddressKind = 'native-segwit' | 'segwit-compat' | 'legacy';

export interface BtcAddressInfo {
  address: string;
  path: string;
  network: BtcNetwork;
  kind: AddressKind;
}

export interface DeriveArgs {
  mnemonic: string;
  passphrase?: string;
  network: BtcNetwork;
  kind: AddressKind;
  account?: number;
  index?: number;
}

/** Generate a fresh BIP-39 mnemonic (12 or 24 words). */
export function btcGenerateMnemonic(words: 12 | 24 = 24): Promise<string> {
  return invoke<string>('chain_btc_generate_mnemonic', { words });
}

/** Validate a BIP-39 mnemonic (wordlist + checksum). */
export function btcValidateMnemonic(phrase: string): Promise<boolean> {
  return invoke<boolean>('chain_btc_validate_mnemonic', { phrase });
}

/** Derive a single address from a mnemonic. Defaults to native segwit, account 0, index 0. */
export function btcDeriveAddress(args: DeriveArgs): Promise<BtcAddressInfo> {
  return invoke<BtcAddressInfo>('chain_btc_derive_address', { args });
}
