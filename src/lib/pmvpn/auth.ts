// pmVPN Module — Wallet Authentication
// GPL-3.0 (Parsec client module)
//
// Challenge-response auth using viem signMessage via bankon_vault.
// Private key never leaves Rust memory.

import { invoke } from '@tauri-apps/api/core';
import type { ChallengeResponse } from './types';

/**
 * Fetch a challenge nonce from the PMVPN server.
 */
export async function fetchChallenge(host: string, port: number, address: string): Promise<ChallengeResponse> {
  const url = `http://${host}:${port}/challenge?address=${encodeURIComponent(address)}`;
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: 'unknown' }));
    throw new Error(body.error || `challenge request failed: ${res.status}`);
  }
  return res.json();
}

/**
 * Sign a challenge message using the wallet key from bankon_vault.
 * The key is retrieved from Rust, used to sign, then discarded.
 *
 * This calls a Tauri command that:
 * 1. Retrieves the EVM private key from bankon_vault
 * 2. Signs the message with viem
 * 3. Returns the signature
 * 4. Zeroizes the key in Rust memory
 */
export async function signChallenge(address: string, message: string): Promise<string> {
  return await invoke<string>('pmvpn_sign_challenge', { address, message });
}

/**
 * Build the auth payload JSON that goes into the SSH password field.
 */
export function buildAuthPayload(address: string, signature: string, nonce: string): string {
  return JSON.stringify({ address, signature, nonce });
}
