// ARIO ↔ mARIO. The @ar.io/sdk takes every amount in mARIO (1 ARIO = 1_000_000 mARIO) and passes it
// straight to the on-chain instruction — a whole-ARIO value where mARIO is expected under-stakes by
// a million. `assertMario` is the guard every write path runs before calling the SDK.

import { formatArio, parseArio, MARIO_PER_ARIO } from '../arweave/ario';

export { MARIO_PER_ARIO };

/** "20000" | "0.5" | 20000n → mARIO bigint. */
export function arioToMario(value: string | bigint | number): bigint {
  if (typeof value === 'bigint') return value * MARIO_PER_ARIO;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) throw new Error('ARIO amount must be a non-negative number');
    return parseArio(value.toFixed(6));
  }
  return parseArio(value);
}

/** mARIO bigint → human ARIO string. */
export function marioToArio(mario: bigint): string {
  return formatArio(mario);
}

/**
 * Guard for values that must already be in mARIO. Anything below 1 ARIO's worth of mARIO where the
 * protocol minimum is thousands of ARIO is almost certainly an un-converted whole-ARIO figure.
 */
export function assertMario(value: bigint, label: string, minArio: bigint = 1n): void {
  if (value < 0n) throw new Error(`${label}: negative amount`);
  if (value < minArio * MARIO_PER_ARIO) {
    throw new Error(`${label}: ${value} mARIO is below ${minArio} ARIO — did you pass whole ARIO instead of mARIO?`);
  }
}

/** Number for SDK params that are typed `number | mARIOToken` (safe up to 2^53 mARIO ≈ 9e9 ARIO). */
export function marioToNumber(mario: bigint): number {
  if (mario > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('mARIO amount exceeds safe integer range');
  return Number(mario);
}
