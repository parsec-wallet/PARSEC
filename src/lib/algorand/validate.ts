// PARSEC Wallet — Algorand Input Validation
// Detects and validates: addresses, 25-word mnemonics, base64 private keys,
// and ARC-26 algorand:// transaction-request URIs.
// Frontend classifies, backend (Rust) validates in production.

import algosdk from 'algosdk';
import { parseArc26 } from './arc26';
import type { Arc26Payload } from './arc26';

export type InputKind =
  | 'algorand_address'
  | 'algorand_mnemonic'
  | 'algorand_private_key'
  | 'algorand_uri'
  | 'watch_only'
  | 'unknown';

export interface ClassifiedInput {
  kind: InputKind;
  confidence: number;
  reason: string;
  address?: string;
  valid: boolean;
  uri?: Arc26Payload;
}

/** Classify and validate raw user input */
export function classifyInput(raw: string): ClassifiedInput {
  const trimmed = raw.trim();
  if (!trimmed) return { kind: 'unknown', confidence: 0, reason: '', valid: false };

  // ARC-26 algorand:// URI — recognized before splitting on whitespace
  if (trimmed.startsWith('algorand://')) {
    const parsed = parseArc26(trimmed);
    if (parsed) {
      return {
        kind: 'algorand_uri',
        confidence: 1.0,
        reason: 'Valid ARC-26 transaction-request URI',
        address: parsed.address,
        uri: parsed,
        valid: true,
      };
    }
    return {
      kind: 'algorand_uri',
      confidence: 0.4,
      reason: 'algorand:// URI present but address invalid',
      valid: false,
    };
  }

  const words = trimmed.split(/\s+/).filter(Boolean);

  // 25-word Algorand mnemonic
  if (words.length === 25) {
    return classifyMnemonic(trimmed);
  }

  // Single token — could be address or private key
  if (words.length === 1) {
    // Algorand address: 58-char base32 uppercase + digits 2-7
    if (/^[A-Z2-7]{58}$/.test(trimmed)) {
      return classifyAddress(trimmed);
    }

    // Base64 private key (ed25519 = 64 bytes → ~88 base64 chars)
    if (/^[a-zA-Z0-9+/=]{80,}$/.test(trimmed)) {
      return classifyPrivateKey(trimmed);
    }

    // Might be a lowercase/mixed-case address attempt
    if (/^[a-zA-Z2-7]{58}$/i.test(trimmed)) {
      return classifyAddress(trimmed.toUpperCase());
    }
  }

  // Wrong word count
  if (words.length > 1 && words.length < 25) {
    return {
      kind: 'algorand_mnemonic',
      confidence: 0.3,
      reason: `${words.length} words — Algorand uses 25 words`,
      valid: false,
    };
  }

  return { kind: 'unknown', confidence: 0, reason: 'Unrecognized input', valid: false };
}

function classifyMnemonic(mnemonic: string): ClassifiedInput {
  try {
    const account = algosdk.mnemonicToSecretKey(mnemonic.trim());
    return {
      kind: 'algorand_mnemonic',
      confidence: 1.0,
      reason: 'Valid 25-word Algorand recovery phrase',
      address: account.addr.toString(),
      valid: true,
    };
  } catch {
    return {
      kind: 'algorand_mnemonic',
      confidence: 0.6,
      reason: '25 words detected but invalid — check for typos',
      valid: false,
    };
  }
}

function classifyAddress(address: string): ClassifiedInput {
  const valid = algosdk.isValidAddress(address);
  return {
    kind: valid ? 'algorand_address' : 'watch_only',
    confidence: valid ? 1.0 : 0.5,
    reason: valid ? 'Valid Algorand address' : 'Invalid checksum — verify the address',
    address: valid ? address : undefined,
    valid,
  };
}

function classifyPrivateKey(b64: string): ClassifiedInput {
  try {
    const keyBytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    if (keyBytes.length === 64) {
      const mnemonic = algosdk.secretKeyToMnemonic(keyBytes);
      const account = algosdk.mnemonicToSecretKey(mnemonic);
      return {
        kind: 'algorand_private_key',
        confidence: 1.0,
        reason: 'Valid Algorand private key (ed25519)',
        address: account.addr.toString(),
        valid: true,
      };
    }
    return {
      kind: 'algorand_private_key',
      confidence: 0.4,
      reason: `Invalid key length: ${keyBytes.length} bytes (expected 64)`,
      valid: false,
    };
  } catch {
    return {
      kind: 'unknown',
      confidence: 0.2,
      reason: 'Could not decode — not a valid base64 key',
      valid: false,
    };
  }
}
