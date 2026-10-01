// PARSEC Wallet — event recorder.
//
// What actually happened, when, and how long it took. Feeds the Advanced
// diagnostics panel, where the questions are "is this number fresh?" and "why
// did that take so long?" — neither of which a snapshot of current state can
// answer.
//
// Three properties this is built around:
//
//   * BOUNDED. A wallet may sit open for days. The buffer is a fixed-size ring,
//     so a long session costs a known amount of memory rather than a growing one.
//   * TRUTHFUL ABOUT ACCURACY. A price read from a five-minute cache is not the
//     same fact as one fetched just now, and an event records which it was. The
//     panel exists to show drift, so hiding staleness would defeat it.
//   * NO SECRETS. Events are metadata: what kind, when, how long, whether it
//     worked. Never an address, never a mnemonic, never a passphrase. The vault
//     work in docs/security/ makes that a rule; this is a place it would be easy
//     to break by logging "signed for <address>".

/** What kind of thing happened. */
export type EventKind =
  /** The participant did something: unlock, sign, navigate. */
  | 'participant'
  /** A network read: price feed, chain RPC, explorer. */
  | 'network'
  /** Vault activity: unlock, store, retrieve, lock. */
  | 'vault'
  /** Rendering and timing of the view itself. */
  | 'render';

export type EventOutcome = 'ok' | 'failed' | 'cached' | 'pending';

export interface ParsecEvent {
  /** Monotonic sequence, so equal timestamps still order deterministically. */
  seq: number;
  kind: EventKind;
  /** Short verb: 'unlock', 'sign', 'fetch-prices'. Never contains a secret. */
  label: string;
  /** Wall-clock start, epoch ms. */
  at: number;
  /** How long it took, ms. Absent for instantaneous marks. */
  durationMs?: number;
  outcome: EventOutcome;
  /**
   * How old the underlying data was when used, ms.
   *
   * This is the accuracy dimension: a price served from cache may be minutes
   * stale, and a panel that showed only latency would call that a fast read.
   */
  ageMs?: number;
  /** Extra context. Metadata only — no addresses, no key material. */
  detail?: string;
}

/** Fixed ring capacity. A long session costs this much and no more. */
export const CAPACITY = 500;

let buffer: ParsecEvent[] = [];
let seq = 0;
type Listener = (e: ParsecEvent) => void;
const listeners = new Set<Listener>();

/**
 * Record an event.
 *
 * Returns the stored event so a caller can reference its seq. Dropping the
 * oldest when full is deliberate: recent activity is what a diagnostic panel is
 * for, and refusing new events to preserve ancient ones would be backwards.
 */
export function record(e: Omit<ParsecEvent, 'seq' | 'at'> & { at?: number }): ParsecEvent {
  const stored: ParsecEvent = { ...e, seq: ++seq, at: e.at ?? Date.now() };
  buffer.push(stored);
  if (buffer.length > CAPACITY) buffer.splice(0, buffer.length - CAPACITY);
  for (const fn of listeners) {
    try { fn(stored); } catch { /* a bad listener must not break recording */ }
  }
  return stored;
}

/**
 * Time an async operation and record the result either way.
 *
 * A failure is an event too — arguably the more interesting one — so the error
 * is re-thrown after recording rather than swallowed.
 */
export async function timed<T>(
  kind: EventKind,
  label: string,
  fn: () => Promise<T>,
  detail?: string,
): Promise<T> {
  const start = Date.now();
  try {
    const result = await fn();
    record({ kind, label, durationMs: Date.now() - start, outcome: 'ok', detail });
    return result;
  } catch (err) {
    record({
      kind,
      label,
      durationMs: Date.now() - start,
      outcome: 'failed',
      detail: detail ?? (err instanceof Error ? err.name : 'error'),
    });
    throw err;
  }
}

/** Every event held, oldest first. */
export function all(): ReadonlyArray<ParsecEvent> {
  return buffer;
}

/** Events of the given kinds, newest first. The panel's viewing control. */
export function filter(kinds: ReadonlySet<EventKind>, limit = CAPACITY): ParsecEvent[] {
  const out: ParsecEvent[] = [];
  for (let i = buffer.length - 1; i >= 0 && out.length < limit; i--) {
    if (kinds.has(buffer[i].kind)) out.push(buffer[i]);
  }
  return out;
}

export function clear(): void {
  buffer = [];
}

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export interface KindStats {
  count: number;
  failed: number;
  /** Median duration, ms. Absent when nothing timed was recorded. */
  medianMs?: number;
  /** 95th percentile duration, ms. */
  p95Ms?: number;
  /** Worst duration seen, ms. */
  maxMs?: number;
  /** Median staleness of the data used, ms. */
  medianAgeMs?: number;
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  // Nearest-rank: returns an OBSERVED value rather than an interpolation
  // between two, so every figure the panel shows actually happened.
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[rank];
}

/**
 * Summarise one kind of event.
 *
 * Median and p95 rather than a mean: one 10-second timeout would drag an average
 * far from anything the participant experienced, and the tail is the part worth
 * seeing anyway.
 */
export function stats(kind: EventKind): KindStats {
  const mine = buffer.filter((e) => e.kind === kind);
  const durations = mine
    .map((e) => e.durationMs)
    .filter((d): d is number => typeof d === 'number' && Number.isFinite(d))
    .sort((a, b) => a - b);
  const ages = mine
    .map((e) => e.ageMs)
    .filter((a): a is number => typeof a === 'number' && Number.isFinite(a))
    .sort((a, b) => a - b);

  return {
    count: mine.length,
    failed: mine.filter((e) => e.outcome === 'failed').length,
    medianMs: durations.length ? quantile(durations, 0.5) : undefined,
    p95Ms: durations.length ? quantile(durations, 0.95) : undefined,
    maxMs: durations.length ? durations[durations.length - 1] : undefined,
    medianAgeMs: ages.length ? quantile(ages, 0.5) : undefined,
  };
}
