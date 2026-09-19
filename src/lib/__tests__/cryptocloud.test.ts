import { describe, it, expect } from 'vitest';
import {
  cloudZone, isSolo, cloudWeather, isSurging, driftSeconds,
  overlaps, clampToZone, findSpot, capacity,
  cloudZones, pyramidHalfWidth, PYRAMID_TOP, PYRAMID_BOTTOM,
  VOLATILE_1H_PCT, SURGE_15M_PCT,
  type Box, type OverlayState,
} from '../cryptocloud';
import type { CoinPrice, DerivedChange } from '../prices';

/** A derived change with a plausible observed span. */
const d = (pct: number, observedMinutes = 15): DerivedChange => ({ pct, observedMinutes });

const ALL_ON: OverlayState = { top10: true, favourites: true, stablecoins: true, pyramid: true };
const ALL_OFF: OverlayState = { top10: false, favourites: false, stablecoins: false, pyramid: false };

function coin(over: Partial<CoinPrice> = {}): CoinPrice {
  return {
    id: 'x', symbol: 'X', usd: 1, marketCap: 1,
    change24h: 0, change1h: 0, change5m: null, change15m: d(0), change4h: null, image: '',
    ...over,
  };
}

describe('cloud zone', () => {
  it('is on the right when the left column is up', () => {
    const z = cloudZone(ALL_ON);
    expect(z.x0).toBeGreaterThan(0.5);  // right half
    // No longer clamped to the upper portion: with the pyramid up the cloud
    // now runs down BESIDE it in channels rather than sitting above it.
    for (const c of cloudZones(ALL_ON)) expect(c.x0).toBeGreaterThan(0.5);
  });

  it('is the whole wall when the cloud is alone', () => {
    const z = cloudZone(ALL_OFF);
    expect(z.x0).toBeLessThan(0.1);
    expect(z.x1).toBeGreaterThan(0.9);
    expect(z.y0).toBeLessThan(0.1);
    expect(z.y1).toBeGreaterThan(0.9);
    expect(isSolo(ALL_OFF)).toBe(true);
  });

  it('reclaims the left only when the left column is gone', () => {
    // Asked of the channel SET, not of cloudZone(): with the pyramid up the
    // largest single channel is on the right even when the left is free.
    const noLeft = cloudZones({ ...ALL_ON, top10: false, favourites: false });
    expect(Math.min(...noLeft.map(z => z.x0))).toBeLessThan(0.1);

    // one of the two is enough to keep the left reserved
    for (const st of [{ ...ALL_ON, top10: false }, { ...ALL_ON, favourites: false }]) {
      for (const z of cloudZones(st)) expect(z.x0).toBeGreaterThan(0.5);
    }
  });

  it('splits into side channels when the pyramid is up, and one wall when it is down', () => {
    const down = cloudZones({ ...ALL_OFF });
    expect(down).toHaveLength(1);
    expect(down[0].x1 - down[0].x0).toBeGreaterThan(0.8); // flows into the space

    const up = cloudZones({ ...ALL_OFF, pyramid: true });
    expect(up.length).toBeGreaterThan(1);
  });

  it('never lets a channel touch the pyramid, at any height', () => {
    // The pyramid is a triangle: by its base it reaches x ~0.85. An earlier
    // revision reserved only the centre and put a glyph on a pyramid card, so
    // this walks every channel at every height rather than spot-checking.
    for (const state of [
      { ...ALL_OFF, pyramid: true },
      { ...ALL_ON },
      { ...ALL_ON, stablecoins: false },
    ]) {
      for (const z of cloudZones(state)) {
        for (let y = z.y0; y <= z.y1 + 1e-9; y += 0.002) {
          const half = pyramidHalfWidth(y);
          if (half === 0) continue; // above the apex or below the base
          const intersects = z.x1 > 0.5 - half && z.x0 < 0.5 + half;
          expect(intersects).toBe(false);
        }
      }
    }
  });

  it('keeps the left and right channels disjoint so a glyph cannot cross', () => {
    const zones = cloudZones({ ...ALL_OFF, pyramid: true });
    // Only the clear floor beneath the base may span the centre line.
    const spanning = zones.filter(z => z.x0 < 0.5 && z.x1 > 0.5);
    for (const z of spanning) expect(z.y0).toBeGreaterThan(PYRAMID_BOTTOM);
  });

  it('measures the pyramid as a triangle: nothing at the apex, widest at the base', () => {
    expect(pyramidHalfWidth(PYRAMID_TOP - 0.01)).toBe(0);
    expect(pyramidHalfWidth(PYRAMID_BOTTOM + 0.01)).toBe(0);
    const upper = pyramidHalfWidth(0.3);
    const lower = pyramidHalfWidth(0.7);
    expect(lower).toBeGreaterThan(upper);
    // The boundary itself must still read as full width — measured with `>=`
    // it read zero and the widest tier cut straight through the base bricks.
    expect(pyramidHalfWidth(PYRAMID_BOTTOM)).toBeGreaterThan(0.3);
  });

  it('spans the full height across channels, so price still means height', () => {
    const zones = cloudZones({ ...ALL_OFF, pyramid: true });
    const top = Math.min(...zones.map(z => z.y0));
    const bottom = Math.max(...zones.map(z => z.y1));
    expect(top).toBeLessThan(0.1);
    expect(bottom).toBeGreaterThan(0.9);
  });

  it('is constrained by the stablecoin ship only when it reaches the ship', () => {
    // The ship sits bottom-LEFT. With the left column up, the cloud is nowhere
    // near it and should not be limited.
    const rightOnly = cloudZone({ top10: true, favourites: true, stablecoins: true, pyramid: false });
    expect(rightOnly.y1).toBeGreaterThan(0.9);

    // Once the cloud spreads left, the ship's corner matters.
    const spreadLeft = cloudZone({ top10: false, favourites: false, stablecoins: true, pyramid: false });
    expect(spreadLeft.x0).toBeLessThan(0.2);
    expect(spreadLeft.y1).toBeLessThan(0.9);
  });

  it('always yields a non-empty region', () => {
    for (const t of [true, false]) for (const f of [true, false])
      for (const s of [true, false]) for (const p of [true, false]) {
        const z = cloudZone({ top10: t, favourites: f, stablecoins: s, pyramid: p });
        expect(z.x1).toBeGreaterThan(z.x0);
        expect(z.y1).toBeGreaterThan(z.y0);
      }
  });
});

describe('cloud weather', () => {
  it('is calm with an empty cloud', () => {
    const w = cloudWeather([]);
    expect(w.storm).toBe(false);
    expect(w.avg1h).toBe(0);
  });

  it('counts 1% an hour as volatile', () => {
    const w = cloudWeather([coin({ change1h: VOLATILE_1H_PCT }), coin({ change1h: 0.9 })]);
    expect(w.volatile).toBe(1);
  });

  it('counts a 1% fifteen-minute move as surging, either direction', () => {
    const w = cloudWeather([
      coin({ change15m: d(SURGE_15M_PCT) }),
      coin({ change15m: d(-SURGE_15M_PCT) }),
      coin({ change15m: d(0.5) }),
    ]);
    expect(w.surging).toBe(2);
  });

  it('needs BOTH timeframes to declare a storm', () => {
    // Hourly average high, but nothing moving in the last fifteen minutes.
    expect(cloudWeather([coin({ change1h: 5, change15m: d(0) })]).storm).toBe(false);
    // Something moving now, but a flat hour.
    expect(cloudWeather([coin({ change1h: 0.1, change15m: d(4) })]).storm).toBe(false);
    // Both.
    expect(cloudWeather([coin({ change1h: 2, change15m: d(1.5) })]).storm).toBe(true);
  });

  it('does not treat unknown fifteen-minute data as calm or as surging', () => {
    const w = cloudWeather([coin({ change1h: 5, change15m: null })]);
    expect(w.unknown15m).toBe(1);
    expect(w.surging).toBe(0);
    // No storm can be declared on data we do not have.
    expect(w.storm).toBe(false);
  });

  it('isSurging is false while the fifteen-minute move is unknown', () => {
    expect(isSurging(coin({ change15m: null }))).toBe(false);
    expect(isSurging(coin({ change15m: d(2) }))).toBe(true);
    expect(isSurging(coin({ change15m: d(-2) }))).toBe(true);
    expect(isSurging(coin({ change15m: d(0.2) }))).toBe(false);
  });
});

describe('drift speed', () => {
  it('accelerates with market activity', () => {
    expect(driftSeconds(0.9, false)).toBeLessThan(driftSeconds(0.1, false));
  });

  it('accelerates further in a storm', () => {
    expect(driftSeconds(0.5, true)).toBeLessThan(driftSeconds(0.5, false));
  });

  it('stays positive and bounded for any input', () => {
    for (const a of [-5, 0, 0.5, 1, 99, NaN]) {
      for (const storm of [true, false]) {
        const d = driftSeconds(Number.isNaN(a) ? 0 : a, storm);
        expect(d).toBeGreaterThan(0);
        expect(d).toBeLessThanOrEqual(30);
      }
    }
  });
});

describe('capacity', () => {
  const glyph = { w: 0.15, h: 0.18 }; // a featured glyph in the corner zone

  it('is smaller in the corner than on the whole wall', () => {
    const corner = capacity(cloudZone(ALL_ON), glyph, 10);
    const whole = capacity(cloudZone(ALL_OFF), glyph, 10);
    expect(corner).toBeLessThan(whole);
  });

  it('never exceeds the requested maximum', () => {
    expect(capacity(cloudZone(ALL_OFF), { w: 0.01, h: 0.01 }, 10)).toBe(10);
  });

  it('always leaves at least one glyph', () => {
    // A glyph larger than the whole zone still yields one rather than an empty
    // cloud — showing nothing is worse than showing one thing tightly.
    expect(capacity(cloudZone(ALL_ON), { w: 5, h: 5 }, 10)).toBe(1);
  });

  it('degrades gracefully on nonsense input', () => {
    expect(capacity(cloudZone(ALL_ON), { w: 0, h: 0 }, 7)).toBe(7);
  });

  /** The property that matters: what fits, fits without overlapping. */
  it('yields a count that actually places without collisions', () => {
    const zone = cloudZone(ALL_ON);
    const n = capacity(zone, glyph, 10);
    const placed: Box[] = [];
    for (let i = 0; i < n; i++) {
      placed.push(findSpot(zone, { x: 0, y: 0, w: glyph.w, h: glyph.h }, placed));
    }
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        expect(overlaps(placed[i], placed[j])).toBe(false);
      }
    }
  });
});

describe('placement', () => {
  const box = (x: number, y: number, w = 0.1, h = 0.06): Box => ({ x, y, w, h });

  it('detects overlap by extent, not by a fixed gap', () => {
    // Two small boxes close together do NOT overlap...
    expect(overlaps(box(0.5, 0.5, 0.02, 0.02), box(0.54, 0.5, 0.02, 0.02))).toBe(false);
    // ...but two large ones at the same separation do. A fixed gap cannot
    // express this, which is why big glyphs used to collide.
    expect(overlaps(box(0.5, 0.5, 0.2, 0.2), box(0.54, 0.5, 0.2, 0.2))).toBe(true);
  });

  it('keeps a box fully inside its zone', () => {
    const zone = { x0: 0.6, x1: 0.95, y0: 0.05, y1: 0.7 };
    const c = clampToZone(box(0.99, 0.99), zone);
    expect(c.x - c.w / 2).toBeGreaterThanOrEqual(zone.x0 - 1e-9);
    expect(c.x + c.w / 2).toBeLessThanOrEqual(zone.x1 + 1e-9);
    expect(c.y + c.h / 2).toBeLessThanOrEqual(zone.y1 + 1e-9);
  });

  /** The headline requirement: every currency must be readable. */
  it('places a full cloud without any two glyphs overlapping', () => {
    // The cloud alone on the wall. Ten glyphs into one narrow side channel is
    // not a property findSpot can guarantee -- random sequential packing tops
    // out well below that density, which is what made this test intermittent.
    // Production never asks for it either: `capacity` caps the count and the
    // glyphs spread across every channel. The next test covers that case.
    const zone = cloudZone(ALL_OFF);
    const placed: Box[] = [];
    let seed = 1;
    const rng = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;

    for (let i = 0; i < 10; i++) {
      const b = findSpot(zone, box(0, 0, 0.07, 0.05), placed, rng);
      placed.push(b);
    }
    expect(placed).toHaveLength(10);
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        expect(overlaps(placed[i], placed[j])).toBe(false);
      }
    }
  });

  it('fills every channel beside the pyramid without collisions', () => {
    // Mirrors createGlyphs: capacity per channel, placed round-robin across
    // them, sharing one occupied list so no two glyphs collide anywhere.
    const zones = cloudZones({ ...ALL_OFF, pyramid: true });
    const glyph = { w: 0.07, h: 0.05 };
    const placed: Box[] = [];
    let seed = 7;
    const rng = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;

    for (const z of zones) {
      const n = capacity(z, glyph, 4);
      for (let i = 0; i < n; i++) {
        placed.push(findSpot(z, { x: 0, y: 0, ...glyph }, placed, rng));
      }
    }
    expect(placed.length).toBeGreaterThan(zones.length); // every channel used
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        expect(overlaps(placed[i], placed[j])).toBe(false);
      }
    }
  });

  it('never returns a spot outside the zone, even when crowded', () => {
    const zone = cloudZone(ALL_ON);
    const placed: Box[] = [];
    for (let i = 0; i < 40; i++) placed.push(findSpot(zone, box(0, 0, 0.08, 0.06), placed));
    for (const b of placed) {
      expect(b.x).toBeGreaterThanOrEqual(zone.x0 - 1e-6);
      expect(b.x).toBeLessThanOrEqual(zone.x1 + 1e-6);
      expect(b.y).toBeGreaterThanOrEqual(zone.y0 - 1e-6);
      expect(b.y).toBeLessThanOrEqual(zone.y1 + 1e-6);
    }
  });
});
