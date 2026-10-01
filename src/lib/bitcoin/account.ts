// Bitcoin chain pack — thin IPC wrapper.
// Mirrors the Rust API in src-tauri/src/chain_btc/. No secret material
// crosses this boundary; only addresses and metadata come back.

import { invoke } from '../platform';

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

// ── Vault-aware API ────────────────────────────────────────────────────
// Preferred path for real wallet use. The mnemonic lives encrypted in
// bankon_vault; only the primary address identifies the account here.

export interface ImportArgs {
  mnemonic: string;
  passphrase?: string;
  label?: string;
}

export interface NewAccountInfo extends BtcAddressInfo {
  /** Shown to the user once for backup. Clear from memory after the backup flow completes. */
  mnemonic: string;
}

export interface VaultDeriveArgs {
  primaryAddress: string;
  network: BtcNetwork;
  kind: AddressKind;
  account?: number;
  index?: number;
  passphrase?: string;
}

/** Import an existing mnemonic into bankon_vault. Returns the primary address. */
export function btcImportAccount(args: ImportArgs): Promise<BtcAddressInfo> {
  return invoke<BtcAddressInfo>('chain_btc_import_account', { args });
}

/** Generate a fresh 24-word mnemonic, persist it, return both address and mnemonic (once, for backup). */
export function btcCreateAccount(label?: string): Promise<NewAccountInfo> {
  return invoke<NewAccountInfo>('chain_btc_create_account', { label });
}

/** Derive any sub-address for an account already stored in the vault. Mnemonic never crosses IPC. */
export function btcDeriveFromVault(args: VaultDeriveArgs): Promise<BtcAddressInfo> {
  // Rust uses snake_case for this field via the VaultDeriveArgs struct.
  return invoke<BtcAddressInfo>('chain_btc_derive_from_vault', {
    args: {
      primary_address: args.primaryAddress,
      network: args.network,
      kind: args.kind,
      account: args.account,
      index: args.index,
      passphrase: args.passphrase,
    },
  });
}

export interface SignPsbtArgs {
  primaryAddress: string;
  network: BtcNetwork;
  psbtBase64: string;
  passphrase?: string;
}

export interface SignedPsbt {
  psbt_base64: string;
}

/** Sign a PSBT using the vault-stored mnemonic. Returns the updated PSBT as Base64. */
export function btcSignPsbt(args: SignPsbtArgs): Promise<SignedPsbt> {
  return invoke<SignedPsbt>('chain_btc_sign_psbt', {
    args: {
      primary_address: args.primaryAddress,
      network: args.network,
      psbt_base64: args.psbtBase64,
      passphrase: args.passphrase,
    },
  });
}
