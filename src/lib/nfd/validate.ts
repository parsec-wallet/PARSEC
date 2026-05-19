// Name validation + tier classification.
//
// Name validity comes from the SDK (which matches the on-chain contract's
// rules exactly). Tier classification is derived from character length and
// the `metaTags` the NFD API attaches to known names.

import {
  canMintSegment,
  extractParentName,
  isSegmentName,
  isValidName,
} from '@txnlab/nfd-sdk';
import type { Nfd } from './types';

export { canMintSegment, extractParentName, isSegmentName, isValidName };

export type NfdTier = 'curated' | 'premium' | 'common-short' | 'common';
// Re-exported from types.ts index for consumers who import from '../lib/nfd'.

/** Strip .algo and any segment prefix to get the root label. */
export function rootLabel(name: string): string {
  const parts = name.toLowerCase().replace(/\.algo$/, '').split('.');
  // For segments (sub.root.algo) the "root label" is the parent.
  return parts[parts.length - 1];
}

/** Count user-visible characters in the root label. */
export function rootLength(name: string): number {
  return [...rootLabel(name)].length;
}

/**
 * Classify a root NFD into a tier based on character length. Premium
 * classification also requires a hit on metaTags or the NFD's category
 * field when the name is already minted.
 */
export function classifyTier(name: string, existing?: Nfd): NfdTier {
  if (existing?.category === 'curated') return 'curated';
  if (existing?.category === 'premium') return 'premium';
  const len = rootLength(name);
  if (len <= 3) return 'curated';
  if (len <= 5) return 'premium';
  if (len <= 9) return 'common-short';
  return 'common';
}

/**
 * Simple format check before we even hit the network. Returns a reason
 * string when invalid so the UI can render inline feedback.
 */
export function nameError(name: string): string | null {
  if (!name) return 'enter a name';
  const candidate = name.endsWith('.algo') ? name : `${name}.algo`;
  if (!isValidName(candidate)) {
    if (candidate !== candidate.toLowerCase()) return 'must be lowercase';
    if (/[^a-z0-9.]/.test(candidate)) return 'letters and digits only';
    if ((candidate.match(/\./g)?.length ?? 0) > 2) return 'too many dots';
    const seg = candidate.replace(/\.algo$/, '').split('.').pop() ?? '';
    if (seg.length < 1 || seg.length > 27) return 'each segment must be 1–27 chars';
    return 'invalid name';
  }
  return null;
}

/** Normalize user input into a valid full .algo name. */
export function normalizeName(raw: string): string {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return '';
  return trimmed.endsWith('.algo') ? trimmed : `${trimmed}.algo`;
}
