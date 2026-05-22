// BANKON fee layer for NFDominter.
//
// The NFD Registry hardcodes its treasury and commission addresses as TEAL
// template variables — we can't redirect those. Parsec's own fee is
// therefore an additional payment transaction sent to the BANKON treasury
// alongside the SDK-produced mint group.
//
// Fee policy is intentionally small and fully visible in the mint
// confirmation screen. Anyone can see the receiving address, the
// microAlgo amount, and the source code rule that produced it.

import type { NfdMintQuote } from '@txnlab/nfd-sdk';
import { store, getAccountAddress } from '../store';

// Optional production override — a build-time env address. When unset (the
// default), the treasury resolves at runtime from the wallet (see below).
const ENV_FEE_ADDRESS: string = import.meta.env.VITE_BANKON_FEE_ADDRESS ?? '';

function isAlgoAddress(a: string): boolean {
  return typeof a === 'string' && a.length === 58;
}

/**
 * BANKON treasury — the address that receives the BANKON mint fee.
 *
 * The treasury is the wallet's **first account** Algorand address (its key has
 * never been compromised). A `VITE_BANKON_FEE_ADDRESS` env value overrides it
 * when set to a valid 58-char address, for production deployments that route
 * the fee to a dedicated treasury.
 */
export function getBankonFeeAddress(): string {
  if (isAlgoAddress(ENV_FEE_ADDRESS)) return ENV_FEE_ADDRESS;
  const first = store.get().accounts[0];
  if (first) {
    const algo = getAccountAddress(first, 'algorand') ?? first.address;
    if (isAlgoAddress(algo)) return algo;
  }
  return 'BANKON_FEE_ADDRESS_NOT_CONFIGURED';
}

/** Fee policy. Tweak in one place. */
export interface BankonFeeConfig {
  /** Flat micro-ALGO fee applied to every mint. */
  flatMicroAlgos: bigint;
  /**
   * Additional bps (1/100 of 1%) of the NFD base price, applied to premium
   * NFDs only. 200 bps = 2%. Default 0 so only the flat fee applies until
   * we decide to layer on a percentage.
   */
  premiumBps: number;
  /** Set of address classes that bypass the fee (e.g. BANKON agents). */
  waivedAddresses: Set<string>;
}

export const BANKON_FEE_CONFIG: BankonFeeConfig = {
  flatMicroAlgos: 2_000_000n, // 2 ALGO
  premiumBps: 0,
  waivedAddresses: new Set(),
};

/**
 * Compute BANKON's fee for a given quote + buyer. Returns 0 if waived or
 * if the treasury address cannot be resolved (e.g. no wallet yet).
 */
export function bankonFeeFor(
  quote: Pick<NfdMintQuote, 'basePrice' | 'isSegment'>,
  buyer: string,
  cfg: BankonFeeConfig = BANKON_FEE_CONFIG,
): bigint {
  if (!isFeeConfigured()) return 0n;
  if (cfg.waivedAddresses.has(buyer)) return 0n;

  const premium = (quote.basePrice * BigInt(cfg.premiumBps)) / 10_000n;
  return cfg.flatMicroAlgos + premium;
}

/** True once the BANKON treasury address resolves to a valid Algorand address. */
export function isFeeConfigured(): boolean {
  return isAlgoAddress(getBankonFeeAddress());
}
