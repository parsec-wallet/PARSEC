// Undername slots in bulk — ar.io's console stops at 50; PARSEC slides to 4096, or to as many as the
// owner's ARIO covers. Pure and exact: every figure is a BigInt in base units (mARIO), no floats.
//
// The BANKON delivery fee is φ% of the cost: the fraction 0.01618033988749894848 (the golden ratio to
// 18 decimals, over 100) — the same digits as THRUST's PhiFee.sol. A terminating decimal times an
// integer is itself terminating, so the fee is shown EXACTLY (no rounding in either direction); the
// only cut is the indivisible base unit of whatever pays it, and that cut is truncation.

export const SLIDER_MAX = 4096;
export const PRESETS = [10, 50, 512, 4096] as const;

/** φ / 100 = 0.01618033988749894848, as numerator over 10^20. */
export const PHI_FEE_NUM = 1618033988749894848n;
export const PHI_FEE_DEN = 10n ** 20n;
export const PHI_FEE_TEXT = '1.618033988749894848%';

export interface PhiFee {
  /** The fee in base units, truncated at the base unit (what can actually be sent). */
  readonly base: bigint;
  /** The exact fee as a decimal string in whole units — every digit, nothing rounded. */
  readonly exact: string;
}

/** φ% of `cost` (base units with `decimals` places). */
export function phiFee(cost: bigint, decimals: number): PhiFee {
  if (cost < 0n) throw new Error('cost cannot be negative');
  const scaled = cost * PHI_FEE_NUM; // base units × 10^20
  return { base: scaled / PHI_FEE_DEN, exact: exactDecimal(scaled, decimals + 20) };
}

/** An integer with `places` implied decimals, printed with every significant digit and no trailing zeros. */
export function exactDecimal(v: bigint, places: number): string {
  const neg = v < 0n;
  const a = neg ? -v : v;
  const d = 10n ** BigInt(places);
  const whole = a / d;
  const frac = (a % d).toString().padStart(places, '0').replace(/0+$/, '');
  return `${neg ? '-' : ''}${whole}${frac ? `.${frac}` : ''}`;
}

/** The ar.io price is linear per slot; derive it from any one quote. */
export function perSlot(quoteCost: bigint, quantity: number): bigint {
  if (!Number.isInteger(quantity) || quantity < 1) throw new Error('quantity must be a positive integer');
  return quoteCost / BigInt(quantity);
}

/**
 * The most slots `balance` pays for. The φ fee is paid separately (to bankon.eth), so only the slot
 * cost draws on the ARIO balance. Capped at `cap` when given.
 */
export function maxAffordable(balance: bigint, slotCost: bigint, cap?: number): number {
  if (slotCost <= 0n) return 0;
  const n = Number(balance / slotCost);
  return cap === undefined ? n : Math.min(n, cap);
}

export interface SlotQuote {
  readonly quantity: number;
  readonly cost: bigint;
  readonly fee: PhiFee;
}

export function quoteSlots(quantity: number, slotCost: bigint, decimals: number): SlotQuote {
  const cost = slotCost * BigInt(quantity);
  return { quantity, cost, fee: phiFee(cost, decimals) };
}
