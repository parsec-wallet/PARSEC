// PARSEC Wallet — is this asset the verified one, a lookalike of it, or neither?
//
// The verified asset list (asset-whitelist.ts) is the authority; this is the one function every
// surface asks — the asset picker, the ragebar, the asset views and SPINTRADE — so "verified"
// means the same thing everywhere:
//
//   verified    its id is on the list (and, when the creator is known, the creator matches);
//   lookalike   not listed, but its unit or name folds to a listed asset's unit or name —
//               after case, look-alike letters (Cyrillic, Greek, fullwidth), invisible and
//               combining characters, spacing and punctuation, and 0/O, 1/l/I, 5/S, $/S;
//   unverified  anything else.
//
// A lookalike is never verified, by construction: verification is by id, and folding is only
// ever used to find what an asset is pretending to be.

import type { NetworkId } from '../../types/wallet';
import { standardAsset, standardAssets, type StandardAsset } from './asset-whitelist';

export type AssetClass =
  | { kind: 'verified'; asset: StandardAsset }
  | { kind: 'lookalike'; of: StandardAsset; by: 'unit' | 'name' }
  | { kind: 'unverified' };

export interface AssetFacts {
  assetId: number;
  unitName: string;
  name: string;
  /** When known, it must match the listed creator for the asset to be verified. */
  creator?: string;
}

// Letters that render like Latin ones. Folded to the Latin letter (lowercase), so "UЅDС" with
// Cyrillic Ѕ and С reads as "usdc". Not exhaustive — Unicode's confusables are thousands — but it
// covers the scripts used in real token-impersonation (Cyrillic, Greek) and is extended as found.
const CONFUSABLE: Record<string, string> = {
  // Cyrillic
  'а': 'a', 'в': 'b', 'е': 'e', 'ё': 'e', 'к': 'k', 'м': 'm', 'н': 'h', 'о': 'o', 'р': 'p', 'с': 'c',
  'т': 't', 'у': 'y', 'х': 'x', 'ѕ': 's', 'і': 'i', 'ј': 'j', 'һ': 'h', 'ԁ': 'd', 'ԛ': 'q', 'ԝ': 'w',
  'А': 'a', 'В': 'b', 'Е': 'e', 'К': 'k', 'М': 'm', 'Н': 'h', 'О': 'o', 'Р': 'p', 'С': 'c', 'Т': 't',
  'У': 'y', 'Х': 'x', 'Ѕ': 's', 'І': 'i', 'Ј': 'j', 'Ү': 'y',
  // Greek
  'α': 'a', 'β': 'b', 'ε': 'e', 'ι': 'i', 'κ': 'k', 'ν': 'v', 'ο': 'o', 'ρ': 'p', 'τ': 't', 'υ': 'u',
  'χ': 'x', 'Α': 'a', 'Β': 'b', 'Ε': 'e', 'Ζ': 'z', 'Η': 'h', 'Ι': 'i', 'Κ': 'k', 'Μ': 'm', 'Ν': 'n',
  'Ο': 'o', 'Ρ': 'p', 'Τ': 't', 'Υ': 'y', 'Χ': 'x',
};

// Digits and symbols standing in for letters, applied after lowercasing.
const STAND_INS: Record<string, string> = { '0': 'o', '1': 'l', 'i': 'l', '|': 'l', '5': 's', '$': 's' };

/**
 * The comparable form of a ticker or name. Two strings that fold equal would be read as the same
 * by a person glancing at them.
 */
export function foldTicker(s: string): string {
  const nfkc = s.normalize('NFKC'); // fullwidth "ＵＳＤＣ" → "USDC"
  let out = '';
  for (const ch of nfkc.normalize('NFKD')) {
    if (/\p{M}/u.test(ch)) continue; // combining marks: "Ú" → "U"
    if (/[\p{Cf}\p{Z}\s]/u.test(ch)) continue; // zero-width, joiners, spaces
    const c = (CONFUSABLE[ch] ?? ch).toLowerCase();
    if (/[\p{P}\p{S}]/u.test(c) && c !== '$' && c !== '|') continue; // punctuation, symbols
    out += STAND_INS[c] ?? c;
  }
  return out;
}

/** What `facts` is, against the verified list for `network`. */
export function classifyAsset(network: NetworkId, facts: AssetFacts): AssetClass {
  const listed = standardAsset(network, facts.assetId);
  if (listed && (!facts.creator || facts.creator === listed.creator)) return { kind: 'verified', asset: listed };

  const unit = foldTicker(facts.unitName);
  const name = foldTicker(facts.name);
  for (const a of standardAssets(network)) {
    if (a.assetId === facts.assetId) continue;
    const au = foldTicker(a.unitName);
    const an = [a.name, a.label ?? ''].map(foldTicker).filter(Boolean);
    if (unit && (unit === au || an.includes(unit))) return { kind: 'lookalike', of: a, by: 'unit' };
    if (name && (name === au || an.includes(name))) return { kind: 'lookalike', of: a, by: 'name' };
  }
  return { kind: 'unverified' };
}
