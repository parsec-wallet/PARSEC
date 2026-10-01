// Parsec Wallet — percentage change formatting.
//
// One formatter, because the app previously had several and they disagreed:
// 1dp in the top-10 column, the pyramid and the cloud; 2dp in the coin panel and
// the tooltip. The same coin read as "+5.0%" in one place and "+4.97%" in
// another, and nothing said which time period either figure covered.
//
// Three rules it exists to enforce:
//
//   1. The SIGN comes from the ROUNDED value. Taking it from the raw value
//      printed "-0.0%" for a coin down 0.04% — a minus sign on a zero, which is
//      not a number anyone should have to interpret.
//   2. An UNKNOWN is not a zero. A change we have not observed renders as "—",
//      never as "0.0%", which would claim the market was flat.
//   3. Every figure carries its PERIOD. "+5%" is meaningless without knowing
//      whether that is five minutes or a month.

/** Time periods the wallet reports changes over. */
export type Period = '5m' | '15m' | '1h' | '4h' | '24h' | '7d' | '30d';

export const PERIOD_LABELS: Readonly<Record<Period, string>> = {
  '5m': '5m',
  '15m': '15m',
  '1h': '1h',
  '4h': '4h',
  '24h': '24h',
  '7d': '7d',
  '30d': '30d',
};

/** What we render when a figure is not known. Never "0". */
export const UNKNOWN = '—';

/**
 * The sign to display, derived from the value AFTER rounding.
 *
 * Returns '' for a value that rounds to zero: neither "+0.0%" nor "-0.0%" is a
 * sensible thing to show, and the second is actively wrong.
 */
export function displaySign(value: number, decimals = 1): string {
  const rounded = Number(value.toFixed(decimals));
  if (rounded > 0) return '+';
  if (rounded < 0) return '-';
  return '';
}

/**
 * Format a percentage change.
 *
 * `null` — genuinely unknown — renders as [`UNKNOWN`]. Note the magnitude is
 * formatted from the absolute value with the sign prepended, so the minus never
 * comes from `toFixed` on a negative that rounds to zero.
 */
export function formatPercent(value: number | null, decimals = 1): string {
  if (value === null || !Number.isFinite(value)) return UNKNOWN;
  const sign = displaySign(value, decimals);
  return `${sign}${Math.abs(value).toFixed(decimals)}%`;
}

/**
 * Format a change together with the period it covers, e.g. `+5.0% 24h`.
 *
 * For use where the period is not already obvious from a column header.
 */
export function formatChange(value: number | null, period: Period, decimals = 1): string {
  return `${formatPercent(value, decimals)} ${PERIOD_LABELS[period]}`;
}

/**
 * A full sentence for a tooltip or aria-label, e.g. `AAVE +5.0% over 24h`.
 *
 * `observedMinutes` is for figures we derive ourselves rather than read from the
 * API: the fifteen-minute change is computed from our own samples, and the true
 * span depends on when those samples landed. Saying "over 19 minutes" when that
 * is what happened is more use than insisting on a round 15.
 */
export function describeChange(
  symbol: string,
  value: number | null,
  period: Period,
  observedMinutes?: number,
): string {
  if (value === null || !Number.isFinite(value)) {
    return `${symbol} — ${PERIOD_LABELS[period]} change not yet known`;
  }
  const span = observedMinutes !== undefined
    ? `${Math.round(observedMinutes)} minutes`
    : PERIOD_LABELS[period];
  return `${symbol} ${formatPercent(value, 2)} over ${span}`;
}

/**
 * Is this move big enough to be worth colouring?
 *
 * Below this the display shows the figure but treats it as flat, so a market
 * drifting by hundredths of a percent does not light up green and red.
 */
export const FLAT_THRESHOLD_PCT = 0.05;

export function isFlat(value: number | null, decimals = 1): boolean {
  if (value === null || !Number.isFinite(value)) return false;
  return Number(value.toFixed(decimals)) === 0;
}
