// PARSEC Wallet — Data Provenance
//
// TIMELESS.md rule 4: "Estimates are labelled estimates, in place, every
// time." With five chains behind flaky public RPC, a number on screen is
// meaningless unless it says where it came from and when.

export type SourceKind = 'live' | 'cached' | 'sample' | 'unavailable';

/**
 * How far a reading reached to be obtained.
 *
 * Separate from `SourceKind` on purpose: "live" and "cached" describe how FRESH
 * a number is, and say nothing about WHO learned that you asked for it. A cached
 * value can still have come from a third party, and a live one can be computed
 * entirely on this device.
 *
 *   internal — read from this device. Nobody else learns anything.
 *   external — a third party served it, and therefore knows you asked.
 *
 * A sovereign wallet should make that difference visible rather than leave the
 * participant to infer it from an endpoint name.
 */
export type Reach = 'internal' | 'external';

export const REACH_WORD: Readonly<Record<Reach, string>> = {
  internal: 'this device',
  external: 'external service',
};

export interface Provenance {
  readonly source: SourceKind;
  /** Whether obtaining this reading left the device. Defaults to external. */
  readonly reach?: Reach;
  /** Where the value came from — an endpoint host, a chain name, a file. */
  readonly origin?: string;
  /** Epoch millis the value was read. */
  readonly readAt?: number;
}

const SOURCE_WORD: Record<SourceKind, string> = {
  live: 'live',
  cached: 'cached',
  sample: 'sample data',
  unavailable: 'unavailable',
};

function clockOf(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/**
 * One line stating origin, read time and source, e.g.
 * `mainnet-api.algonode.cloud · read 14:22:03 · live`.
 */
export function provenanceLine(p: Provenance): string {
  const parts: string[] = [];
  if (p.origin) parts.push(p.origin);
  parts.push(p.readAt ? `read ${clockOf(p.readAt)}` : 'reading…');
  parts.push(SOURCE_WORD[p.source]);
  // Default to `external`: assuming a reading stayed local when it did not is
  // the mistake with consequences, so the unmarked case takes the cautious side.
  parts.push(REACH_WORD[p.reach ?? 'external']);
  return parts.join(' · ');
}

/**
 * Settle several independent reads without letting any one of them block or
 * fail the whole surface — TIMELESS's "graceful degradation instead of a
 * loading state". Every entry resolves to a value-or-null plus its provenance,
 * so the caller can always render a plausible shape.
 */
export async function settleAll<T>(
  tasks: ReadonlyArray<{ origin: string; run: () => Promise<T> }>,
): Promise<Array<{ origin: string; value: T | null; provenance: Provenance }>> {
  const settled = await Promise.allSettled(tasks.map((t) => t.run()));
  return settled.map((r, i) => ({
    origin: tasks[i].origin,
    value: r.status === 'fulfilled' ? r.value : null,
    provenance: {
      source: r.status === 'fulfilled' ? 'live' : 'unavailable',
      origin: tasks[i].origin,
      readAt: Date.now(),
    },
  }));
}
