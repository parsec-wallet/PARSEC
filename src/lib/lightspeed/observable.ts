// Parsec Wallet — Lightspeed observable
//
// The one idea worth keeping from @parity/light.js: a chain value is not a
// promise you await once, it is a stream you subscribe to, and the stream
// polls only while somebody is listening. light.js built that on rxjs. Parsec
// carries no rxjs, so this is the whole primitive — subscribe, replay the last
// reading to a late subscriber, refcount the timer, emit on change only.
//
// Every emission is a Reading: value-or-null, a tri-state status and a
// provenance line, so a surface can always render a plausible shape and say
// where the number came from. `null` from `read` means "not available here"
// and stays `unknown`; a throw is a failure and is `deficient`. A failure must
// never look like an absence (docs/modules.md rule 5).

import type { Status } from '../ui/status';
import type { Provenance, Reach } from '../ui/provenance';

export type Unsubscribe = () => void;

export interface Observable<T> {
  subscribe(next: (value: T) => void): Unsubscribe;
}

export interface Reading<T> {
  readonly value: T | null;
  readonly status: Status;
  readonly provenance: Provenance;
  /** Set when status is `deficient`. */
  readonly error?: string;
}

export interface Source {
  readonly origin: string;
  readonly reach: Reach;
}

export interface ReadOptions<T> {
  /** Where the reading comes from. A function is re-evaluated on every read,
   *  so a provider the participant switches mid-stream is stated correctly. */
  readonly source: Source | (() => Source);
  readonly read: () => Promise<T | null>;
  /** Clock seam for tests. */
  readonly now?: () => number;
}

export interface PollOptions<T> extends ReadOptions<T> {
  readonly everyMs: number;
  /** Change detection. Defaults to `===`, which is right for bigint. */
  readonly equals?: (a: T, b: T) => boolean;
}

function sourceOf<T>(opts: ReadOptions<T>): Source {
  return typeof opts.source === 'function' ? opts.source() : opts.source;
}

/** One read, folded into a Reading. Never throws. */
export async function readOnce<T>(opts: ReadOptions<T>): Promise<Reading<T>> {
  const { origin, reach } = sourceOf(opts);
  const readAt = (opts.now ?? Date.now)();
  try {
    const value = await opts.read();
    if (value === null) {
      return { value: null, status: 'unknown', provenance: { source: 'unavailable', origin, reach, readAt } };
    }
    return { value, status: 'ok', provenance: { source: 'live', origin, reach, readAt } };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return { value: null, status: 'deficient', provenance: { source: 'unavailable', origin, reach, readAt }, error };
  }
}

function sameReading<T>(a: Reading<T>, b: Reading<T>, equals: (x: T, y: T) => boolean): boolean {
  if (a.status !== b.status || a.error !== b.error) return false;
  if (a.provenance.origin !== b.provenance.origin) return false;
  if (a.value === null || b.value === null) return a.value === b.value;
  return equals(a.value, b.value);
}

/**
 * Poll `read` every `everyMs` while at least one subscriber is attached.
 *
 * The first subscriber starts the loop and gets the first reading as soon as
 * it lands; later subscribers get the last reading immediately. The last
 * unsubscribe stops the loop; a read still in flight when that happens is
 * dropped, not delivered. Reads never overlap — the next is scheduled only
 * after the current one settles.
 */
export function poll<T>(opts: PollOptions<T>): Observable<Reading<T>> {
  const equals = opts.equals ?? ((a: T, b: T) => a === b);
  const listeners = new Set<(r: Reading<T>) => void>();
  let last: Reading<T> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let generation = 0;

  async function tick(gen: number): Promise<void> {
    const reading = await readOnce(opts);
    if (gen !== generation) return; // stopped while in flight
    if (!last || !sameReading(last, reading, equals)) {
      last = reading;
      for (const fn of listeners) fn(reading);
    }
    if (listeners.size > 0) timer = setTimeout(() => void tick(gen), opts.everyMs);
  }

  function stop(): void {
    generation++;
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }

  return {
    subscribe(next) {
      listeners.add(next);
      if (last) next(last);
      if (listeners.size === 1) void tick(generation);
      return () => {
        listeners.delete(next);
        if (listeners.size === 0) stop();
      };
    },
  };
}

/** Derive one stream from another. The reading's status and provenance carry over. */
export function mapReading<T, U>(source: Observable<Reading<T>>, fn: (v: T) => U): Observable<Reading<U>> {
  return {
    subscribe(next) {
      return source.subscribe((r) => next({ ...r, value: r.value === null ? null : fn(r.value) }));
    },
  };
}
