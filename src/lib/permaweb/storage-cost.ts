// PARSEC Wallet — what storing bytes on Arweave costs, from every route, exactly.
//
//   Arweave direct   arweave.net/price/{bytes}            winston (10^-12 AR), paid in AR
//   Turbo credits    payment.ardrive.io/v1/price/bytes    winc (= winston), bought by card or token
//   Turbo over x402  priced from Turbo's own rates; the exact figure is Turbo's 402 quote for
//                    the signed item, shown before anything is paid. At least $0.01 per item.
//   BANKONx402 fee       10 %, at least $0.05, on the x402 cost (lib/bankon-fee.ts)
//
// Every value is an integer (winston, winc, micro-USD). A market price (AR/USD) arrives as a
// float from the price feed; it is converted once, to a 6-decimal rate, and every amount after
// that is integer arithmetic, rounded up so an estimate is never low.
//
// SPDX-FileCopyrightText: 2026 BANKON
// SPDX-License-Identifier: Apache-2.0

import { parseDecimal } from '../money';
import { bankonFee } from '../bankon-fee';
import { TURBO_PAYMENT_URL, getTurboPriceWinc } from '../arweave/turbo';

const WINSTON_PER_AR = 10n ** 12n;
const MICRO = 1_000_000n;
/** Turbo's x402 upload charges at least one cent per item (observed 2026-10-01). */
export const X402_MIN_ITEM_MICRO = 10_000n;

const ceilDiv = (a: bigint, b: bigint): bigint => (a + b - 1n) / b;

/** A market USD price (float from a feed) as an exact micro-USD rate. Null when unusable. */
export function usdRateMicro(usd: number | null | undefined): bigint | null {
  if (typeof usd !== 'number' || !Number.isFinite(usd) || usd <= 0) return null;
  return parseDecimal(usd.toFixed(6), 6);
}

/** winston at an AR/USD rate (micro-USD per AR) → micro-USD, rounded up. */
export function winstonToUsdMicro(winston: bigint, arUsdMicro: bigint): bigint {
  return ceilDiv(winston * arUsdMicro, WINSTON_PER_AR);
}

/** Turbo's published rate: how many winc buy one GiB, and what one GiB costs in USD. */
export interface TurboRates {
  wincPerGiB: bigint;
  usdMicroPerGiB: bigint;
}

/** winc at Turbo's rate → micro-USD, rounded up. */
export function wincToUsdMicro(winc: bigint, rates: TurboRates): bigint {
  return ceilDiv(winc * rates.usdMicroPerGiB, rates.wincPerGiB);
}

/** What Turbo's x402 route is expected to charge for one item: its rate, at least $0.01. */
export function x402ItemEstimate(itemUsdMicro: bigint): bigint {
  return itemUsdMicro > X402_MIN_ITEM_MICRO ? itemUsdMicro : X402_MIN_ITEM_MICRO;
}

export async function getArweavePriceWinston(bytes: number): Promise<bigint> {
  if (!Number.isSafeInteger(bytes) || bytes < 0) throw new Error('bytes must be a non-negative integer');
  const res = await fetch(`https://arweave.net/price/${bytes}`);
  if (!res.ok) throw new Error(`Arweave price: HTTP ${res.status}`);
  const text = (await res.text()).trim();
  if (!/^\d+$/.test(text)) throw new Error('Arweave price: malformed');
  return BigInt(text);
}

export async function getTurboRates(): Promise<TurboRates> {
  const res = await fetch(`${TURBO_PAYMENT_URL}/v1/rates`);
  if (!res.ok) throw new Error(`Turbo rates: HTTP ${res.status}`);
  const j = (await res.json()) as { winc?: unknown; fiat?: { usd?: unknown } };
  if (typeof j.winc !== 'string' || !/^\d+$/.test(j.winc)) throw new Error('Turbo rates: malformed winc');
  const usd = usdRateMicro(typeof j.fiat?.usd === 'number' ? j.fiat.usd : null);
  if (usd === null) throw new Error('Turbo rates: no USD rate');
  return { wincPerGiB: BigInt(j.winc), usdMicroPerGiB: usd };
}

/** One route's price; null fields mean that source could not answer (shown as unknown). */
export interface StorageQuote {
  /** Bytes that are not free (the paid items, signed sizes). */
  paidBytes: number;
  paidItems: number;
  arweave: { winston: bigint | null; usdMicro: bigint | null };
  turbo: { winc: bigint | null; usdMicro: bigint | null };
  /** Estimate from Turbo's rate with the per-item minimum; the 402 quote is exact. */
  x402: { usdMicro: bigint | null; bankonFeeMicro: bigint | null; totalMicro: bigint | null };
}

/**
 * Price the paid items (signed sizes) every way. Sources are read in parallel and fail
 * independently: one being down never hides the others.
 */
export async function quoteStorage(paidItemSizes: readonly number[], arUsd: number | null): Promise<StorageQuote> {
  const paidBytes = paidItemSizes.reduce((n, b) => n + b, 0);
  const arRate = usdRateMicro(arUsd);
  const [winston, rates, itemWinc] = await Promise.all([
    getArweavePriceWinston(paidBytes).catch(() => null),
    getTurboRates().catch(() => null),
    Promise.all(paidItemSizes.map((b) => getTurboPriceWinc(b))).catch(() => null),
  ]);
  const turboWinc = itemWinc ? itemWinc.reduce((n, w) => n + w, 0n) : null;
  const x402 = itemWinc && rates
    ? itemWinc.reduce((n, w) => n + x402ItemEstimate(wincToUsdMicro(w, rates)), 0n)
    : null;
  const fee = x402 !== null ? bankonFee(x402) : null;
  return {
    paidBytes,
    paidItems: paidItemSizes.length,
    arweave: { winston, usdMicro: winston !== null && arRate !== null ? winstonToUsdMicro(winston, arRate) : null },
    turbo: { winc: turboWinc, usdMicro: turboWinc !== null && rates ? wincToUsdMicro(turboWinc, rates) : null },
    x402: { usdMicro: x402, bankonFeeMicro: fee, totalMicro: x402 !== null && fee !== null ? x402 + fee : null },
  };
}

export const MICRO_USD = MICRO;
