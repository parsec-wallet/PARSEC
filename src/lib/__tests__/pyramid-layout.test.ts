import { describe, it, expect } from 'vitest';
import { classify, layoutPyramid } from '../pyramid-layout';

type C = { id: string; pct: number | null };
const coins = (pcts: Array<number | null>): C[] => pcts.map((pct, i) => ({ id: `c${i}`, pct }));
const pctOf = (c: C) => c.pct;

describe('pyramid layout', () => {
  it('keeps the full shape and never crosses sides, even when the market is lopsided', () => {
    // 5 gainers, 60 losers: the kind of split a 4h window produces.
    const items = coins([...[5, 4, 3, 2, 1], ...Array.from({ length: 60 }, (_, i) => -(i + 1))]);
    const L = layoutPyramid(items, pctOf);
    expect(L.rows.map((r) => r.left.length + r.right.length)).toEqual([2, 3, 4, 5, 6, 7, 8]);
    for (const r of L.rows) {
      for (const c of r.right) expect(c.pct!).toBeGreaterThan(0);
      for (const c of r.left) expect(c.pct!).toBeLessThanOrEqual(0);
    }
    expect(L.apex!.pct).toBe(5);
  });

  it('places the largest gains and the largest losses nearest the apex', () => {
    const items = coins(Array.from({ length: 80 }, (_, i) => 40 - i));
    const L = layoutPyramid(items, pctOf);
    expect(L.apex!.pct).toBe(40);
    expect(L.rows[0].right[0].pct).toBe(39);
    expect(L.rows[0].left[0].pct).toBe(-39); // the largest loss
  });

  it('sends the middle of the ranking and unknowns to the base strip', () => {
    const items = coins([...Array.from({ length: 80 }, (_, i) => 40 - i), null]);
    const L = layoutPyramid(items, pctOf);
    const placed = 1 + L.rows.reduce((n, r) => n + r.left.length + r.right.length, 0);
    expect(placed + L.base.length).toBe(items.length);
    expect(L.base[L.base.length - 1].pct).toBeNull();
  });

  it('works with no gainers at all', () => {
    const L = layoutPyramid(coins(Array.from({ length: 50 }, (_, i) => -(i + 1))), pctOf);
    expect(L.rows.map((r) => r.left.length + r.right.length)).toEqual([2, 3, 4, 5, 6, 7, 8]);
    expect(L.rows.every((r) => r.right.length === 0)).toBe(true);
  });
});

describe('classify', () => {
  it('rises gainers and sinks losers, strongest at the extremes', () => {
    const items = coins([3, 1, 0, -1, -4, null]);
    const k = classify(items, pctOf);
    expect(k.get(items[0])).toEqual({ side: 'rise', strength: 1 });
    expect(k.get(items[1])!.side).toBe('rise');
    expect(k.get(items[1])!.strength).toBeLessThan(1);
    expect(k.get(items[2])!.side).toBe('flat');
    expect(k.get(items[4])).toEqual({ side: 'fall', strength: 1 });
    expect(k.get(items[3])!.side).toBe('fall');
    expect(k.get(items[5])!.side).toBe('flat');
  });
});

describe('layoutPyramid row count (+/− on the PYRAMID switch)', () => {
  it('more rows put more coins on the wall and fewer in the base', () => {
    const items = Array.from({ length: 80 }, (_, i) => ({ id: i, pct: i % 2 ? i : -i }));
    const placed = (rows: number) => {
      const l = layoutPyramid(items, (t) => t.pct, rows);
      return { wall: l.rows.reduce((n, r) => n + r.left.length + r.right.length, 1), base: l.base.length, rows: l.rows.length };
    };
    const seven = placed(7), ten = placed(10), three = placed(3);
    expect(ten.rows).toBe(10);
    expect(ten.wall).toBeGreaterThan(seven.wall);
    expect(three.wall).toBeLessThan(seven.wall);
    expect(seven.wall + seven.base).toBe(80);
    expect(ten.wall + ten.base).toBe(80);
  });
});
