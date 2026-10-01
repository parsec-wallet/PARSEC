import { describe, it, expect, vi, afterEach } from 'vitest';
import { poll, readOnce, mapReading } from '../observable';
import type { Reading } from '../observable';

const src = { origin: 'test', reach: 'internal' as const };

afterEach(() => vi.useRealTimers());

describe('readOnce — a read folded into a Reading', () => {
  it('null is unknown, not a failure', async () => {
    const r = await readOnce({ source: src, read: async () => null });
    expect(r.status).toBe('unknown');
    expect(r.provenance.source).toBe('unavailable');
    expect(r.error).toBeUndefined();
  });

  it('a value is ok and live, with origin and reach stated', async () => {
    const r = await readOnce({ source: src, read: async () => 7n, now: () => 1000 });
    expect(r).toMatchObject({ value: 7n, status: 'ok', provenance: { source: 'live', origin: 'test', reach: 'internal', readAt: 1000 } });
  });

  it('a throw is deficient and carries the message', async () => {
    const r = await readOnce({ source: src, read: async () => { throw new Error('rpc down'); } });
    expect(r.status).toBe('deficient');
    expect(r.error).toBe('rpc down');
  });

  it('re-evaluates a source function per read', async () => {
    let origin = 'a';
    const opts = { source: () => ({ origin, reach: 'external' as const }), read: async () => 1n };
    expect((await readOnce(opts)).provenance.origin).toBe('a');
    origin = 'b';
    expect((await readOnce(opts)).provenance.origin).toBe('b');
  });
});

describe('poll — subscribe, refcount, emit on change', () => {
  it('polls only while subscribed and stops on the last unsubscribe', async () => {
    vi.useFakeTimers();
    const read = vi.fn(async () => 1n);
    const obs = poll({ source: src, everyMs: 100, read });
    expect(read).not.toHaveBeenCalled();

    const seen: Reading<bigint>[] = [];
    const off = obs.subscribe((r) => seen.push(r));
    await vi.advanceTimersByTimeAsync(0);
    expect(read).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(250);
    expect(read).toHaveBeenCalledTimes(3);

    off();
    await vi.advanceTimersByTimeAsync(500);
    expect(read).toHaveBeenCalledTimes(3);
    expect(seen).toHaveLength(1); // same value each time → one emission
  });

  it('emits when the value changes, and when status changes', async () => {
    vi.useFakeTimers();
    const values: Array<bigint | Error> = [1n, 1n, 2n, new Error('x'), 2n];
    const read = vi.fn(async () => { const v = values.shift(); if (v instanceof Error) throw v; return v ?? 2n; });
    const obs = poll({ source: src, everyMs: 10, read });
    const seen: string[] = [];
    const off = obs.subscribe((r) => seen.push(`${r.status}:${r.value ?? '-'}`));
    await vi.advanceTimersByTimeAsync(60);
    off();
    expect(seen).toEqual(['ok:1', 'ok:2', 'deficient:-', 'ok:2']);
  });

  it('replays the last reading to a late subscriber without a new read', async () => {
    vi.useFakeTimers();
    const read = vi.fn(async () => 5n);
    const obs = poll({ source: src, everyMs: 1000, read });
    const off1 = obs.subscribe(() => undefined);
    await vi.advanceTimersByTimeAsync(0);
    const late: Reading<bigint>[] = [];
    const off2 = obs.subscribe((r) => late.push(r));
    expect(late).toHaveLength(1);
    expect(late[0].value).toBe(5n);
    expect(read).toHaveBeenCalledTimes(1);
    off1(); off2();
  });

  it('drops a read that lands after the last unsubscribe', async () => {
    vi.useFakeTimers();
    let resolve: (v: bigint) => void = () => undefined;
    const read = () => new Promise<bigint>((res) => { resolve = res; });
    const obs = poll({ source: src, everyMs: 10, read });
    const seen: unknown[] = [];
    const off = obs.subscribe((r) => seen.push(r));
    off();
    resolve(9n);
    await vi.advanceTimersByTimeAsync(50);
    expect(seen).toHaveLength(0);
  });
});

describe('mapReading', () => {
  it('maps the value and keeps status and provenance', async () => {
    vi.useFakeTimers();
    const obs = mapReading(poll({ source: src, everyMs: 10, read: async () => 3n }), (n) => `#${n}`);
    const seen: Reading<string>[] = [];
    const off = obs.subscribe((r) => seen.push(r));
    await vi.advanceTimersByTimeAsync(0);
    off();
    expect(seen[0]).toMatchObject({ value: '#3', status: 'ok', provenance: { origin: 'test' } });
  });
});
