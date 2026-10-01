import { describe, it, expect, beforeEach, vi } from 'vitest';
import { record, timed, all, filter, clear, stats, subscribe, CAPACITY } from '../events';

beforeEach(() => clear());

describe('event recorder', () => {
  it('records in order with a monotonic sequence', () => {
    record({ kind: 'participant', label: 'unlock', outcome: 'ok' });
    record({ kind: 'network', label: 'fetch-prices', outcome: 'ok' });
    const seqs = all().map((e) => e.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(new Set(seqs).size).toBe(seqs.length);
  });

  it('is bounded — a long session cannot grow without limit', () => {
    for (let i = 0; i < CAPACITY + 250; i++) {
      record({ kind: 'render', label: `frame-${i}`, outcome: 'ok' });
    }
    expect(all().length).toBe(CAPACITY);
    // The newest survive; the oldest are dropped.
    expect(all()[all().length - 1].label).toBe(`frame-${CAPACITY + 249}`);
  });

  it('filters by kind, newest first — the panel\'s viewing control', () => {
    record({ kind: 'network', label: 'a', outcome: 'ok' });
    record({ kind: 'participant', label: 'b', outcome: 'ok' });
    record({ kind: 'network', label: 'c', outcome: 'ok' });

    const net = filter(new Set(['network'] as const));
    expect(net.map((e) => e.label)).toEqual(['c', 'a']);

    const both = filter(new Set(['network', 'participant'] as const));
    expect(both).toHaveLength(3);
    expect(both[0].label).toBe('c'); // newest first
  });

  it('honours a limit', () => {
    for (let i = 0; i < 20; i++) record({ kind: 'vault', label: `v${i}`, outcome: 'ok' });
    expect(filter(new Set(['vault'] as const), 5)).toHaveLength(5);
  });

  it('times a successful operation', async () => {
    const out = await timed('network', 'fetch', async () => 'value');
    expect(out).toBe('value');
    const e = all()[0];
    expect(e.outcome).toBe('ok');
    expect(typeof e.durationMs).toBe('number');
  });

  it('records a failure and re-throws it', async () => {
    // A failed read is an event too — arguably the interesting one.
    await expect(timed('network', 'fetch', async () => { throw new Error('boom'); }))
      .rejects.toThrow('boom');
    const e = all()[0];
    expect(e.outcome).toBe('failed');
    expect(e.kind).toBe('network');
  });

  it('summarises with median and p95, not a mean', () => {
    // One timeout must not drag the headline figure away from what was typical.
    for (const d of [10, 10, 10, 10, 10, 10, 10, 10, 10, 10000]) {
      record({ kind: 'network', label: 'x', outcome: 'ok', durationMs: d });
    }
    const s = stats('network');
    expect(s.count).toBe(10);
    expect(s.medianMs).toBe(10);      // a mean would be ~1009
    expect(s.maxMs).toBe(10000);      // the outlier is still visible
    expect(s.p95Ms).toBe(10000);
  });

  it('reports quantiles as observed values, never interpolations', () => {
    for (const d of [5, 7, 9]) record({ kind: 'vault', label: 'x', outcome: 'ok', durationMs: d });
    const s = stats('vault');
    expect([5, 7, 9]).toContain(s.medianMs);
    expect([5, 7, 9]).toContain(s.p95Ms);
  });

  it('tracks data staleness separately from latency', () => {
    // A cached read is fast AND stale; a panel showing only latency would call
    // that a good result.
    record({ kind: 'network', label: 'prices', outcome: 'cached', durationMs: 1, ageMs: 240000 });
    expect(stats('network').medianAgeMs).toBe(240000);
    expect(stats('network').medianMs).toBe(1);
  });

  it('counts failures per kind', () => {
    record({ kind: 'network', label: 'a', outcome: 'ok' });
    record({ kind: 'network', label: 'b', outcome: 'failed' });
    record({ kind: 'vault', label: 'c', outcome: 'failed' });
    expect(stats('network').failed).toBe(1);
    expect(stats('vault').failed).toBe(1);
  });

  it('is empty-safe', () => {
    const s = stats('render');
    expect(s.count).toBe(0);
    expect(s.medianMs).toBeUndefined();
  });

  it('notifies subscribers and can be unsubscribed', () => {
    const seen = vi.fn();
    const off = subscribe(seen);
    record({ kind: 'participant', label: 'nav', outcome: 'ok' });
    expect(seen).toHaveBeenCalledTimes(1);
    off();
    record({ kind: 'participant', label: 'nav2', outcome: 'ok' });
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it('survives a listener that throws', () => {
    subscribe(() => { throw new Error('bad listener'); });
    expect(() => record({ kind: 'render', label: 'x', outcome: 'ok' })).not.toThrow();
    expect(all()).toHaveLength(1);
  });
});
