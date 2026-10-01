// Parsec Wallet — chain_evm IPC client (EVM).
//
// One typed wrapper per Rust module (docs/modules.md). Two doors, deliberately narrow:
// an EIP-1559 transaction, and an EIP-3009 transfer authorization. There is no
// "sign these bytes" door — a generic hash signer would let the renderer decide what
// the participant's key attests to, and Rust would have no way to tell a payment from
// a delegation.
//
// SPDX-FileCopyrightText: 2026 BANKON
// SPDX-License-Identifier: Apache-2.0

import { invoke } from './platform';

export interface EvmTxRequest {
  chain_id: number;
  nonce: number;
  /** Decimal wei. */
  max_priority_fee_per_gas: string;
  /** Decimal wei. */
  max_fee_per_gas: string;
  gas_limit: number;
  /** 0x-hex, 20 bytes. */
  to: string;
  /** Decimal wei. */
  value: string;
  /** 0x-hex calldata. */
  data: string;
}

export interface SignedEvmTx {
  raw_hex: string;
  tx_hash: string;
}

/** Sign an EIP-1559 transaction with the vault-held key for `address`. */
export async function evmSignTx(address: string, tx: EvmTxRequest): Promise<SignedEvmTx> {
  return await invoke<SignedEvmTx>('chain_evm_sign_tx', { address, tx });
}

/** Derive the 0x address for a hex private key. Stores nothing. */
export async function evmAddressFromKey(privateKeyHex: string): Promise<string> {
  return await invoke<string>('chain_evm_address_from_key', { privateKeyHex });
}

/** The EIP-712 domain of the token being spent. */
export interface Eip712Domain {
  name: string;
  version: string;
  chain_id: number;
  /** 0x-hex, 20 bytes — the token contract. */
  verifying_contract: string;
}

/** EIP-3009 `TransferWithAuthorization`, exactly as it travels in an x402 payload. */
export interface TransferAuthorization {
  from: string;
  to: string;
  /** Decimal atomic units. */
  value: string;
  /** Decimal unix seconds. */
  valid_after: string;
  /** Decimal unix seconds. */
  valid_before: string;
  /** 0x-hex, exactly 32 bytes. Single-use. */
  nonce: string;
}

export interface EvmAuthorizationSignature {
  /** 0x-hex, 65 bytes: r || s || v. */
  signature_hex: string;
  /** 0x-hex, 32 bytes: what was signed. Shown, not trusted — useful for an audit trail. */
  digest_hex: string;
  scheme: 'secp256k1-eip712';
}

/**
 * Sign an EIP-3009 transfer authorization with the vault-held key for `address`.
 *
 * The digest is built in Rust from the named fields, so the only thing this door can
 * ever produce is an authorization to move a stated amount of a stated token to a
 * stated address within a stated window.
 */
export async function evmSignTransferAuthorization(
  address: string,
  domain: Eip712Domain,
  authorization: TransferAuthorization,
): Promise<EvmAuthorizationSignature> {
  return await invoke<EvmAuthorizationSignature>('chain_evm_sign_transfer_authorization', {
    address,
    domain,
    authorization,
  });
}
