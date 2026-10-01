// PARSEC Wallet — the BANKON facilitation fee, one rule everywhere.
//
// 10 % of the cost of what is facilitated, at least $0.05, paid by the person on top as
// its own x402 payment — never taken out of what goes to the other party. Used by the
// name stores (the price paid to a name's owner) and by Arweave uploads over x402 (the
// price paid to Turbo). Integer micro-USD (= USDC atomic units) throughout.
//
// SPDX-FileCopyrightText: 2026 BANKON
// SPDX-License-Identifier: Apache-2.0

export const FEE_BPS = 1_000;
export const FEE_MIN_MICRO = 50_000;

/** The BANKON facilitation fee on `costMicro` (micro-USD), exactly. */
export function bankonFee(costMicro: bigint): bigint {
  const pct = (costMicro * BigInt(FEE_BPS)) / 10_000n;
  return pct > BigInt(FEE_MIN_MICRO) ? pct : BigInt(FEE_MIN_MICRO);
}
