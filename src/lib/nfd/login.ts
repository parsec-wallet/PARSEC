// PARSEC Wallet — Identity Login (.algo names)
//
// Open the wallet by typing `mindx.algo` instead of hunting for a 58-character
// address.
//
// IMPORTANT — a name is a SELECTOR, not a credential. Resolving `mindx.algo`
// proves nothing about who is typing it: NFD records are public, and anyone
// can look one up. It only answers "which of the keys on this device do you
// mean?". The passphrase is what authenticates, exactly as before, and a name
// that resolves to an address this device holds no key for must open nothing.
//
// Resolution is network-dependent, so every path here degrades to the raw
// address rather than blocking login.

import { resolveName, resolveAddress } from './resolve';
import type { NetworkId, WalletAccount } from '../../types/wallet';

/** Anything the identity field accepts. */
export type IdentityKind = 'name' | 'address';

export interface ResolvedIdentity {
  /** What the user typed, trimmed. */
  readonly input: string;
  readonly kind: IdentityKind;
  /** Canonical NFD name, when the input resolved to one. */
  readonly name?: string;
  /**
   * Candidate Algorand addresses this identity points at, best match first:
   * the owner (the controlling account, i.e. the identity), then any linked
   * caAlgo addresses, then the deposit account.
   */
  readonly addresses: readonly string[];
}

const ALGORAND_ADDRESS = /^[A-Z2-7]{58}$/;

/** Roughly, does this look like a `.algo` name rather than an address? */
export function isAlgoName(input: string): boolean {
  const s = input.trim().toLowerCase();
  if (!s || ALGORAND_ADDRESS.test(input.trim())) return false;
  // A bare label ("mindx") is treated as a name; the suffix is added for them.
  return /^[a-z0-9-]{1,27}(\.algo)?$/.test(s) || s.includes('.algo');
}

/** Normalize what the user typed into a full NFD name. */
export function normalizeAlgoName(input: string): string {
  const s = input.trim().toLowerCase();
  return s.endsWith('.algo') ? s : `${s}.algo`;
}

/**
 * Turn typed input into candidate addresses.
 *
 * Returns null when a name simply does not resolve — the caller should say so
 * plainly rather than silently falling back to something else.
 */
export async function resolveIdentity(
  network: NetworkId,
  input: string,
): Promise<ResolvedIdentity | null> {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // A raw address needs no lookup; we still try the reverse direction so the
  // wallet can greet the user by name, but a failure there is not fatal.
  if (ALGORAND_ADDRESS.test(trimmed)) {
    const nfd = await resolveAddress(network, trimmed).catch(() => null);
    return { input: trimmed, kind: 'address', name: nfd?.name, addresses: [trimmed] };
  }

  if (!isAlgoName(trimmed)) return null;

  const name = normalizeAlgoName(trimmed);
  const nfd = await resolveName(network, name).catch(() => null);
  if (!nfd) return null;

  const addresses = candidateAddresses(nfd);
  if (addresses.length === 0) return null;

  return { input: trimmed, kind: 'name', name: nfd.name ?? name, addresses };
}

/**
 * Addresses an NFD record points at, best-first for identity matching.
 *
 * Note this ordering is deliberately NOT the SDK's funds precedence
 * (caAlgo[0] → unverifiedCaAlgo[0] → owner). For "who is this?", the owner —
 * the account that controls the name — is the better first guess; the linked
 * addresses follow.
 */
function candidateAddresses(nfd: {
  owner?: string;
  caAlgo?: string[];
  depositAccount?: string;
}): string[] {
  const out: string[] = [];
  const push = (a?: string): void => {
    if (a && ALGORAND_ADDRESS.test(a) && !out.includes(a)) out.push(a);
  };
  push(nfd.owner);
  for (const a of nfd.caAlgo ?? []) push(a);
  push(nfd.depositAccount);
  return out;
}

/**
 * Index of the first local account matching any candidate address, or -1.
 * Matches on the account's Algorand address and its per-chain map, so an
 * account recovered under a different primary still resolves.
 */
export function matchAccount(
  accounts: readonly WalletAccount[],
  addresses: readonly string[],
): number {
  for (const address of addresses) {
    const i = accounts.findIndex(
      (a) => a.address === address || Object.values(a.chains ?? {}).includes(address),
    );
    if (i !== -1) return i;
  }
  return -1;
}
