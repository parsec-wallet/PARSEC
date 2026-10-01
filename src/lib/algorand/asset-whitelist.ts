// PARSEC Wallet — the standard Algorand assets offered for one-click opt-in.
//
// A short, curated list. Each entry was checked against the mainnet indexer on
// 2026-10-01: the id, unit, decimals, creator and whether the issuer kept freeze
// or clawback rights. The creator is part of the entry so a match means the
// real asset, not one that copied its name. Anything not on this list is shown
// as unverified, and an asset that borrows a listed unit name under another id
// is called out as not the listed one.

import type { NetworkId } from '../../types/wallet';

export type AssetGroup = 'Stablecoins' | 'Bitcoin & Ether' | 'Algorand ecosystem';

export interface StandardAsset {
  assetId: number;
  unitName: string;
  name: string;
  decimals: number;
  issuer: string;
  creator: string;
  group: AssetGroup;
  /** The issuer can freeze holdings (regulated stablecoins do). */
  freeze: boolean;
  /** The issuer can take tokens back. */
  clawback: boolean;
}

const MAINNET: StandardAsset[] = [
  { assetId: 31566704, unitName: 'USDC', name: 'USD Coin', decimals: 6, issuer: 'Circle', creator: '2UEQTE5QDNXPI7M3TU44G6SYKLFWLPQO7EBZM7K7MHMQQMFI4QJPLHQFHM', group: 'Stablecoins', freeze: true, clawback: false },
  { assetId: 312769, unitName: 'USDt', name: 'Tether USDt', decimals: 6, issuer: 'Tether', creator: 'XIU7HGGAJ3QOTATPDSIIHPFVKMICXKHMOR2FJKHTVLII4FAOA3CYZQDLG4', group: 'Stablecoins', freeze: true, clawback: true },
  { assetId: 227855942, unitName: 'EURS', name: 'STASIS EURO', decimals: 6, issuer: 'STASIS', creator: 'XOS4GHMBFJD3I7TYZQFB7FPZ25NHW5V2LS7O54JFSVTPNDAE45DFTKVN3U', group: 'Stablecoins', freeze: true, clawback: false },
  { assetId: 386192725, unitName: 'goBTC', name: 'goBTC', decimals: 8, issuer: 'Algomint', creator: 'ETGSQKACKC56JWGMDAEP5S2JVQWRKTQUVKCZTMPNUGZLDVCWPY63LSI3H4', group: 'Bitcoin & Ether', freeze: false, clawback: false },
  { assetId: 386195940, unitName: 'goETH', name: 'goETH', decimals: 8, issuer: 'Algomint', creator: 'ETGSQKACKC56JWGMDAEP5S2JVQWRKTQUVKCZTMPNUGZLDVCWPY63LSI3H4', group: 'Bitcoin & Ether', freeze: false, clawback: false },
  { assetId: 793124631, unitName: 'gALGO', name: 'Governance Algo', decimals: 6, issuer: 'Folks Finance', creator: 'GGP73AZM3CMLDLXUDVR2NIULL3M7SORSI4N7DFIOZTVL62UOVSQUTZYEA4', group: 'Algorand ecosystem', freeze: false, clawback: false },
  { assetId: 3203964481, unitName: 'FOLKS', name: 'Folks Finance', decimals: 6, issuer: 'Folks Finance', creator: 'RKBPWO3MXTHHMK2IZQSZK63XQQSWR7LCUCP4GXKD3T6WT5GZNNZI5XZUQE', group: 'Algorand ecosystem', freeze: false, clawback: false },
  { assetId: 2200000000, unitName: 'TINY', name: 'TINY', decimals: 6, issuer: 'Tinyman', creator: 'TINY2IS2LVHYXH6YCVXMRKWET5YTMAUXOTGAMLVYKTJGQOEKNB2BZ6TINY', group: 'Algorand ecosystem', freeze: false, clawback: false },
  { assetId: 700965019, unitName: 'VEST', name: 'Vestige', decimals: 6, issuer: 'Vestige', creator: 'VESTIG3V77NNVBT5SM636UKAZ3M5OQHM76TC5622RQ4Q2XUCYZ5E4ENB3E', group: 'Algorand ecosystem', freeze: false, clawback: false },
  { assetId: 1138500612, unitName: 'GORA', name: 'GORA', decimals: 9, issuer: 'Gora', creator: 'J2GVFTADZB7QPJOZ4R3FHABV4NWGE6CN6SYPHW32N3CNEWCRD6ACYTPYVU', group: 'Algorand ecosystem', freeze: false, clawback: false },
];

const TESTNET: StandardAsset[] = [
  { assetId: 10458941, unitName: 'USDC', name: 'USDC (Testnet)', decimals: 6, issuer: 'Circle', creator: '', group: 'Stablecoins', freeze: true, clawback: false },
];

export function standardAssets(network: NetworkId): StandardAsset[] {
  return network === 'mainnet' ? MAINNET : network === 'testnet' ? TESTNET : [];
}

/** The listed asset with this id on this network, if any. */
export function standardAsset(network: NetworkId, assetId: number): StandardAsset | undefined {
  return standardAssets(network).find((a) => a.assetId === assetId);
}

/**
 * A listed asset whose unit or name this one borrows under a different id —
 * the shape of a lookalike ("USDC" that is not Circle's USDC). Undefined when
 * it is the listed asset itself or borrows nothing.
 */
export function lookalikeOf(network: NetworkId, assetId: number, unitName: string, name: string): StandardAsset | undefined {
  const u = unitName.trim().toLowerCase();
  const n = name.trim().toLowerCase();
  return standardAssets(network).find((a) => a.assetId !== assetId
    && (a.unitName.toLowerCase() === u || a.name.toLowerCase() === n));
}
