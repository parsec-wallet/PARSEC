// Litecoin chain pack — thin IPC wrapper over chain_ltc.
// Same shape as Bitcoin's wrapper; LTC's differences (coin type 2', ltc
// bech32 HRP, base58 prefixes L/M) all live in Rust.

import { invoke } from '../platform';

export type LtcNetwork = 'mainnet' | 'testnet';
export type LtcAddressKind = 'native-segwit' | 'segwit-compat' | 'legacy';

export interface LtcAddressInfo {
  address: string;
  path: string;
  network: LtcNetwork;
  kind: LtcAddressKind;
}

export interface DeriveArgs {
  mnemonic: string;
  passphrase?: string;
  network: LtcNetwork;
  kind: LtcAddressKind;
  account?: number;
  index?: number;
}

export interface ImportArgs {
  mnemonic: string;
  passphrase?: string;
  label?: string;
}

/** A new account: the phrase stays in the vault (back it up with `vaultExportSecret`). */
export type NewAccountInfo = LtcAddressInfo;

export interface VaultDeriveArgs {
  primaryAddress: string;
  network: LtcNetwork;
  kind: LtcAddressKind;
  account?: number;
  index?: number;
  passphrase?: string;
}

export interface SignPsbtArgs {
  primaryAddress: string;
  psbtBase64: string;
  passphrase?: string;
}

export interface SignedPsbt {
  psbt_base64: string;
}

/** Derive a single LTC address from a mnemonic passed in the call. Pre-vault / testing path. */
export function ltcDeriveAddress(args: DeriveArgs): Promise<LtcAddressInfo> {
  return invoke<LtcAddressInfo>('chain_ltc_derive_address', { args });
}

/** Import an existing mnemonic into the vault. Returns the primary address used as the handle. */
export function ltcImportAccount(args: ImportArgs): Promise<LtcAddressInfo> {
  return invoke<LtcAddressInfo>('chain_ltc_import_account', { args });
}

/** Generate a fresh 24-word mnemonic inside the Keycore and seal it in the vault; returns the address only. */
export function ltcCreateAccount(label?: string): Promise<NewAccountInfo> {
  return invoke<NewAccountInfo>('chain_ltc_create_account', { label });
}

/** Derive any sub-address for a vault-stored account. Mnemonic never crosses IPC. */
export function ltcDeriveFromVault(args: VaultDeriveArgs): Promise<LtcAddressInfo> {
  return invoke<LtcAddressInfo>('chain_ltc_derive_from_vault', {
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

/** Sign a PSBT using the vault-stored mnemonic. */
export function ltcSignPsbt(args: SignPsbtArgs): Promise<SignedPsbt> {
  return invoke<SignedPsbt>('chain_ltc_sign_psbt', {
    args: {
      primary_address: args.primaryAddress,
      psbt_base64: args.psbtBase64,
      passphrase: args.passphrase,
    },
  });
}
