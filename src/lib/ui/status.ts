// Parsec Wallet — Tri-state Status
//
// Adapted from bankon-node-v6's TIMELESS.md rule 1: "a stamp is green only if
// the node is functional." The third state is the point — `unknown` is what an
// unreachable RPC, an unfetched balance, or a not-yet-probed service actually
// is, and collapsing it into `false` tells the user a lie.

export type Status = 'unknown' | 'ok' | 'deficient';

export const STATUS_LABEL: Record<Status, string> = {
  unknown: 'unknown',
  ok: 'ok',
  deficient: 'deficient',
};

/**
 * Map a nullable boolean onto a status. `null`/`undefined` — the answer we
 * do not have yet — stays `unknown` rather than degrading to a failure.
 */
export function statusOf(value: boolean | null | undefined): Status {
  if (value === null || value === undefined) return 'unknown';
  return value ? 'ok' : 'deficient';
}

/** The weakest status in a set — a chain is only as good as its worst link. */
export function weakest(statuses: readonly Status[]): Status {
  if (statuses.some((s) => s === 'deficient')) return 'deficient';
  if (statuses.some((s) => s === 'unknown')) return 'unknown';
  return statuses.length > 0 ? 'ok' : 'unknown';
}
