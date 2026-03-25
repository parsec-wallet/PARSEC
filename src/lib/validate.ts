// Parsec Wallet — parsec_validate IPC client
// Rust-side chain address validators.
// The frontend classifier suggests; Rust validators are the gatekeepers.

import { invoke } from '@tauri-apps/api/core';
import { isTauri } from './vault';

export interface ValidationResult {
  valid: boolean;
  chain: string;
  address: string;
  reason: string;
}

/** Validate an Algorand address (Rust-side SHA-512/256 checksum) */
export async function validateAlgorandAddress(address: string): Promise<ValidationResult> {
  if (!isTauri()) return fallbackValidation(address, 'algorand');
  return await invoke<ValidationResult>('validate_address_algorand', { address });
}

/** Validate a Bitcoin address (base58check or bech32) */
export async function validateBitcoinAddress(address: string): Promise<ValidationResult> {
  if (!isTauri()) return fallbackValidation(address, 'bitcoin');
  return await invoke<ValidationResult>('validate_address_bitcoin', { address });
}

/** Validate an EVM address (EIP-55 checksum) */
export async function validateEvmAddress(address: string): Promise<ValidationResult> {
  if (!isTauri()) return fallbackValidation(address, 'evm');
  return await invoke<ValidationResult>('validate_address_evm', { address });
}

/** Validate a Solana address (base58 ed25519) */
export async function validateSolanaAddress(address: string): Promise<ValidationResult> {
  if (!isTauri()) return fallbackValidation(address, 'solana');
  return await invoke<ValidationResult>('validate_address_solana', { address });
}

/** Validate a Cosmos bech32 address */
export async function validateCosmosAddress(address: string): Promise<ValidationResult> {
  if (!isTauri()) return fallbackValidation(address, 'cosmos');
  return await invoke<ValidationResult>('validate_address_cosmos', { address });
}

/** Auto-detect chain and validate any address */
export async function validateAnyAddress(address: string): Promise<ValidationResult> {
  if (!isTauri()) return fallbackValidation(address, 'unknown');
  return await invoke<ValidationResult>('validate_address_any', { address });
}

/** Web fallback — basic regex check when not running in Tauri */
function fallbackValidation(address: string, chain: string): ValidationResult {
  const trimmed = address.trim();
  if (!trimmed) return { valid: false, chain, address: trimmed, reason: 'Empty address' };

  // Basic format checks only — Rust does the real validation
  if (chain === 'algorand' && /^[A-Z2-7]{58}$/.test(trimmed)) {
    return { valid: true, chain, address: trimmed, reason: 'Format valid (checksum not verified in browser)' };
  }
  if (chain === 'evm' && /^0x[a-fA-F0-9]{40}$/.test(trimmed)) {
    return { valid: true, chain, address: trimmed, reason: 'Format valid (EIP-55 not verified in browser)' };
  }

  return { valid: false, chain, address: trimmed, reason: 'Validation requires desktop app (Rust backend)' };
}
