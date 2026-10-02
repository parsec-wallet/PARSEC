// PARSEC — Chain Isolation Layer
// Cryptographic boundary enforcement. Each chain family operates
// in its own signing context. Keys never cross family lines.
// External signers (MetaMask, WalletConnect) are fully sandboxed —
// PARSEC never touches their private keys.
// SPDX-FileCopyrightText: 2026 BANKON
// SPDX-License-Identifier: GPL-3.0-or-later

import type {
  ChainFamily,
  SigningAuthority,
  IsolationContext,
  EIP1193Provider,
  EthTxRequest,
  BuiltTransaction,
} from './types';
import { getChain } from './registry';

// ── Isolation Zone ───────────────────────────────────────────
// Each zone tracks which addresses are authorized for which family
// and enforces that signing requests stay within their boundary.

interface ZoneEntry {
  address: string;
  family: ChainFamily;
  authority: SigningAuthority;
  chainId: string;
}

const zones: Map<string, ZoneEntry> = new Map();

/** Register an address within an isolation zone */
export function registerAddress(
  address: string,
  chainId: string,
  authority: SigningAuthority,
): void {
  const chain = getChain(chainId);
  if (!chain) throw new Error(`Unknown chain: ${chainId}`);

  const key = `${chain.family}:${address.toLowerCase()}`;
  zones.set(key, {
    address,
    family: chain.family,
    authority,
    chainId,
  });
}

/** Create an isolation context for a signing operation */
export function createIsolationContext(
  address: string,
  chainId: string,
  authority: SigningAuthority,
): IsolationContext {
  const chain = getChain(chainId);
  if (!chain) throw new Error(`Unknown chain: ${chainId}`);

  const externalOnly = authority !== 'vault';

  return {
    family: chain.family,
    authority,
    chainId,
    address,
    externalOnly,
  };
}

/** Validate that a built transaction matches its isolation context */
export function validateIsolation(tx: BuiltTransaction): void {
  const chain = getChain(tx.chain);
  if (!chain) throw new Error(`Unknown chain in transaction: ${tx.chain}`);

  // Family must match
  if (tx.family !== chain.family) {
    throw new Error(
      `Isolation violation: tx family '${tx.family}' does not match chain family '${chain.family}'`
    );
  }

  // If signed by vault, verify address is registered in this zone
  if (tx.isolation.authority === 'vault') {
    const key = `${chain.family}:${tx.isolation.address.toLowerCase()}`;
    const entry = zones.get(key);
    if (!entry) {
      throw new Error(
        `Isolation violation: address ${tx.isolation.address} not registered in ${chain.family} zone`
      );
    }
  }
}

// ── Vault Signing (PARSEC holds key) ─────────────────────────
// No JavaScript signer here. A vault-held key signs only in the PARSEC Keycore,
// through each chain pack's `chain_*_sign*` command (src/lib/chain-*.ts); this
// layer only registers addresses and checks that a transaction stays in its zone.

// ── MetaMask / Injected Provider (External Signing) ──────────
// PARSEC never touches the private key. MetaMask owns it entirely.
// We only pass unsigned transactions for the provider to sign.

export async function metamaskSign(
  provider: EIP1193Provider,
  tx: EthTxRequest,
  expectedChainId?: number,
): Promise<string> {
  // Verify we're on the right chain
  if (expectedChainId !== undefined) {
    const currentChainHex = await provider.request({ method: 'eth_chainId' }) as string;
    const currentChain = parseInt(currentChainHex, 16);
    if (currentChain !== expectedChainId) {
      // Request chain switch
      try {
        await provider.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: '0x' + expectedChainId.toString(16) }],
        });
      } catch {
        throw new Error(
          `MetaMask is on chain ${currentChain}, expected ${expectedChainId}. Switch failed.`
        );
      }
    }
  }

  // Verify the signing address is available in MetaMask
  const accounts = await provider.request({ method: 'eth_requestAccounts' }) as string[];
  const fromLower = tx.from.toLowerCase();
  if (!accounts.some(a => a.toLowerCase() === fromLower)) {
    throw new Error(`Address ${tx.from} not available in MetaMask`);
  }

  // Send the transaction — MetaMask signs it internally
  const txHash = await provider.request({
    method: 'eth_sendTransaction',
    params: [tx],
  }) as string;

  return txHash;
}

/** Request MetaMask to sign a message (personal_sign) */
export async function metamaskPersonalSign(
  provider: EIP1193Provider,
  address: string,
  message: string,
): Promise<string> {
  const accounts = await provider.request({ method: 'eth_requestAccounts' }) as string[];
  if (!accounts.some(a => a.toLowerCase() === address.toLowerCase())) {
    throw new Error(`Address ${address} not available in MetaMask`);
  }

  return await provider.request({
    method: 'personal_sign',
    params: [message, address],
  }) as string;
}

/** Detect injected EIP-1193 provider (MetaMask, etc.) */
export function detectInjectedProvider(): EIP1193Provider | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { ethereum?: EIP1193Provider };
  return w.ethereum ?? null;
}

/** Get connected accounts from injected provider */
export async function getInjectedAccounts(provider: EIP1193Provider): Promise<string[]> {
  return await provider.request({ method: 'eth_accounts' }) as string[];
}

// ── Cross-Family Guard ───────────────────────────────────────
// Prevents any operation from crossing family boundaries.

export function assertSameFamily(chainIdA: string, chainIdB: string): void {
  const a = getChain(chainIdA);
  const b = getChain(chainIdB);
  if (!a || !b) throw new Error(`Unknown chain in family check`);
  if (a.family !== b.family) {
    throw new Error(
      `Cross-family operation denied: ${a.name} (${a.family}) ↔ ${b.name} (${b.family})`
    );
  }
}
