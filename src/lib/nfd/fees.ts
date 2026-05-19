// BANKON fee layer for NFDominter.
//
// The NFD Registry hardcodes its treasury and commission addresses as TEAL
// template variables — we can't redirect those. Parsec's own fee is
// therefore an additional payment transaction sent to BANKON_FEE_ADDRESS
// alongside the SDK-produced mint group.
//
// Fee policy is intentionally small and fully visible in the mint
// confirmation screen. Anyone can see the receiving address, the
// microAlgo amount, and the source code rule that produced it.

import type { NfdMintQuote } from '@txnlab/nfd-sdk';

/**
 * BANKON fee receiving address (mainnet + testnet share one target for now).
 * Set via env at build time in production; falls back to a zero-placeholder
 * during development so the mint flow remains testable without real funds
 * flowing to an unknown address.
 */
export const BANKON_FEE_ADDRESS: string =
  import.meta.env.VITE_BANKON_FEE_ADDRESS ??
  'BANKON_FEE_ADDRESS_NOT_CONFIGURED';

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
  flatMicroAlgos: 250_000n, // 0.25 ALGO
  premiumBps: 0,
  waivedAddresses: new Set(),
};

/**
 * Compute BANKON's fee for a given quote + buyer. Returns 0 if waived or
 * if the receiving address is not configured (dev mode — we refuse to
 * collect a fee to a placeholder).
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

/** True once a real BANKON fee address has been wired at build time. */
export function isFeeConfigured(): boolean {
  return (
    BANKON_FEE_ADDRESS !== 'BANKON_FEE_ADDRESS_NOT_CONFIGURED' &&
    BANKON_FEE_ADDRESS.length === 58
  );
}
