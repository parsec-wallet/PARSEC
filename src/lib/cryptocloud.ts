// Parsec Wallet — cryptocloud geometry and weather.
//
// The cloud is the drifting cluster of currency glyphs. Three decisions govern
// it, and all three are pure functions of state, so they live here rather than
// inside the 2,400-line matrix view:
//
//   * where it may draw      — cloudZone
//   * whether it is storming — cloudWeather
//   * where each glyph sits  — findSpot / overlaps
//
// Keeping them separable is what makes "no two glyphs overlap" and "1% an hour
// is volatile" assertions in a test rather than claims in a comment.

import type { CoinPrice } from './prices';

// ── Zone ────────────────────────────────────────────────────────────────────

export interface Zone { x0: number; x1: number; y0: number; y1: number }

/** Which other overlays are currently on the wall. */
export interface OverlayState {
  top10: boolean;
  favourites: boolean;
  stablecoins: boolean;
  pyramid: boolean;
}

/**
 * The region the cloud may occupy, in normalized 0-1 coordinates.
 *
 * The cloud yields to whatever else is on screen rather than being pinned to a
 * fixed corner. Each overlay's real footprint matters, not just whether it is on:
 *
 *   * the left column (top 10 / favourites) holds roughly x < 0.24;
 *   * the pyramid is a TRIANGLE — narrow at its apex, and by its base it spans
 *     nearly the full width (to about x = 0.85). Reserving only the centre is
 *     what put a glyph on top of a pyramid card; above ~45% of the height it
 *     leaves the right genuinely clear, so that is where the ceiling goes;
 *   * the stablecoin ship sits bottom-LEFT, so it constrains the cloud only when
 *     the cloud has reached across to the left in the first place.
 *
 * With everything else off the cloud has the whole wall, which is the point of
 * being able to switch everything else off.
 */
// ── The pyramid as an obstacle ───────────────────────────────────────────────
//
// The pyramid is a TRIANGLE, not a block: `top: 18%`, centred, one brick at the
// apex widening a brick per row to its base. Treating it as a rectangle would
// throw away the wide, empty air beside its apex -- which is exactly where the
// biggest gainers want to sit.

/** Top of the pyramid body, normalized. Matches `.parsec-pyramid__body`. */
export const PYRAMID_TOP = 0.18;
/** Half-width at the apex row (a single card). */
export const PYRAMID_APEX_HALF = 0.06;
/**
 * Half-width at the base row.
 *
 * 0.35 (so the base reaches x ~0.85) is measured, not guessed: an earlier
 * revision reserved only the centre and put a glyph on top of a pyramid card.
 */
export const PYRAMID_BASE_HALF = 0.35;
/**
 * Bottom of the pyramid body. Eight rows of cards from `top: 18%` land well
 * short of the floor, and the band beneath is clear wall -- which is where the
 * heaviest losers want to be anyway.
 */
export const PYRAMID_BOTTOM = 0.82;
/**
 * Clearance between a channel and the pyramid.
 *
 * The drift keyframes translate a glyph up to ~0.7em sideways. At the largest
 * glyph size that is roughly 0.025 of the wall, so without this margin a glyph
 * parked on the inner edge would swing over the bricks -- and "cannot pass from
 * side to side" would be false for precisely the glyphs moving hardest.
 */
export const CHANNEL_MARGIN = 0.03;
/** Below this a channel is too narrow to hold a glyph; drop it entirely. */
const MIN_CHANNEL_WIDTH = 0.08;
/** Vertical tiers the side channels are cut into. */
const CHANNEL_TIERS = 3;

/** How far the pyramid reaches from centre at a given height. 0 above its apex. */
export function pyramidHalfWidth(y: number): number {
  // `> PYRAMID_BOTTOM`, not `>=`: the base row sits AT the bottom edge, so a
  // tier measured exactly there must still see the pyramid at full width.
  // With `>=` the widest tier read a half-width of zero and cut its channels
  // straight through the base bricks.
  if (y <= PYRAMID_TOP || y > PYRAMID_BOTTOM) return 0;
  const t = (y - PYRAMID_TOP) / (PYRAMID_BOTTOM - PYRAMID_TOP);
  return PYRAMID_APEX_HALF + t * (PYRAMID_BASE_HALF - PYRAMID_APEX_HALF);
}

/** The cloud's full rectangle, ignoring the pyramid. */
function openZone(active: OverlayState): Zone {
  const leftTaken = active.top10 || active.favourites;
  const x0 = leftTaken ? 0.65 : 0.04;
  // Only relevant once the cloud extends over the ship's corner.
  const y1 = active.stablecoins && x0 < 0.2 ? 0.8 : 0.94;
  return { x0, x1: 0.97, y0: 0.06, y1 };
}

/**
 * Where the cloud may draw, as one or more rectangles.
 *
 * Pyramid OFF: a single rectangle over the whole available wall -- the cloud
 * flows into the space the pyramid was occupying.
 *
 * Pyramid ON: the wall is cut into left and right channels, tier by tier, each
 * tier narrowing as the pyramid widens beneath it. The channels never meet, so
 * a glyph cannot cross from one side to the other; and because every tier keeps
 * its own slice of the FULL vertical range, height still means price on both
 * sides -- a gainer sits in a high tier whichever side of the pyramid it landed.
 */
export function cloudZones(active: OverlayState): Zone[] {
  const open = openZone(active);
  if (!active.pyramid) return [open];

  const zones: Zone[] = [];
  // Channels only span the pyramid's own height. Below its base the wall is
  // clear, so that band stays one full-width zone -- and it is the bottom of
  // the buoyancy scale, which is exactly where the worst losers sink to.
  const obstructedTo = Math.min(open.y1, PYRAMID_BOTTOM);
  const tierH = (obstructedTo - open.y0) / CHANNEL_TIERS;

  for (let i = 0; i < CHANNEL_TIERS; i++) {
    const y0 = open.y0 + i * tierH;
    const y1 = y0 + tierH;
    // Measure at the tier's LOWEST edge, where the pyramid is widest within it.
    // Clamped to the base: accumulating `y0 + i * tierH` lands the last tier on
    // 0.8200000000000001, a hair PAST the bottom, where the half-width reads
    // zero -- which cut the widest tier's channels straight through the base.
    const half = pyramidHalfWidth(Math.min(y1, PYRAMID_BOTTOM)) + CHANNEL_MARGIN;
    const leftEdge = 0.5 - half;
    const rightEdge = 0.5 + half;

    if (leftEdge - open.x0 >= MIN_CHANNEL_WIDTH) {
      zones.push({ x0: open.x0, x1: leftEdge, y0, y1 });
    }
    if (open.x1 - rightEdge >= MIN_CHANNEL_WIDTH) {
      zones.push({ x0: rightEdge, x1: open.x1, y0, y1 });
    }
  }

  // The clear floor under the pyramid. Starts a margin below the base for the
  // same reason the side channels are inset: a glyph on the boundary drifts.
  const floorTop = obstructedTo + CHANNEL_MARGIN;
  if (open.y1 - floorTop >= 0.05) {
    zones.push({ x0: open.x0, x1: open.x1, y0: floorTop, y1: open.y1 });
  }

  // Nothing fits beside it (the column overlays have taken the left, say), so
  // fall back to the air above the apex rather than returning no wall at all.
  if (zones.length === 0) {
    return [{ ...open, y1: Math.min(open.y1, PYRAMID_TOP) }];
  }
  return zones;
}

/**
 * The single largest zone.
 *
 * Kept for callers that reason about one rectangle. Prefer `cloudZones`: with
 * the pyramid up this returns only one of several channels.
 */
export function cloudZone(active: OverlayState): Zone {
  const zones = cloudZones(active);
  return zones.reduce((best, z) =>
    (z.x1 - z.x0) * (z.y1 - z.y0) > (best.x1 - best.x0) * (best.y1 - best.y0) ? z : best,
  );
}

/** True when the cloud has the wall to itself. */
export function isSolo(active: OverlayState): boolean {
  return !active.top10 && !active.favourites && !active.stablecoins && !active.pyramid;
}

// ── Weather ─────────────────────────────────────────────────────────────────

/** An hourly move of this size or more marks a coin volatile. */
export const VOLATILE_1H_PCT = 1;
/** A fifteen-minute move of this size or more marks a coin surging. */
export const SURGE_15M_PCT = 1;

export interface Weather {
  /** Mean absolute hourly move across the cloud. */
  avg1h: number;
  /** Coins moving at least VOLATILE_1H_PCT in the hour. */
  volatile: number;
  /** Coins moving at least SURGE_15M_PCT in fifteen minutes. */
  surging: number;
  /** Coins whose fifteen-minute move is not yet known. */
  unknown15m: number;
  storm: boolean;
}

/**
 * Read the cloud's weather.
 *
 * Storm needs BOTH timeframes to agree: a sustained hourly average at or above
 * the volatile threshold, *and* at least one coin actually moving right now.
 * Either alone is a poor signal — a high hourly average with nothing moving is
 * yesterday's news, and a single five-minute spike in an otherwise flat market
 * is noise.
 */
export function cloudWeather(coins: CoinPrice[]): Weather {
  if (coins.length === 0) {
    return { avg1h: 0, volatile: 0, surging: 0, unknown15m: 0, storm: false };
  }

  let sum1h = 0;
  let volatile = 0;
  let surging = 0;
  let unknown15m = 0;

  for (const c of coins) {
    const h = Number.isFinite(c.change1h) ? Math.abs(c.change1h) : 0;
    sum1h += h;
    if (h >= VOLATILE_1H_PCT) volatile++;
    if (c.change15m === null) unknown15m++;
    else if (Math.abs(c.change15m.pct) >= SURGE_15M_PCT) surging++;
  }

  const avg1h = sum1h / coins.length;
  return { avg1h, volatile, surging, unknown15m, storm: avg1h >= VOLATILE_1H_PCT && surging > 0 };
}

/** Is this coin moving hard enough in fifteen minutes to earn the candle border? */
export function isSurging(coin: CoinPrice): boolean {
  return coin.change15m !== null && Math.abs(coin.change15m.pct) >= SURGE_15M_PCT;
}

/**
 * Drift duration in seconds, from market activity.
 *
 * Same input the matrix rain uses for its speed (`getMarketActivity`), so the
 * cloud and the rain accelerate together instead of telling different stories
 * about the same market. Storm shortens it further.
 */
export function driftSeconds(activity: number, storm: boolean): number {
  const a = Math.max(0, Math.min(1, activity));
  const calm = 30;
  const wild = 9;
  const base = calm - (calm - wild) * a;
  return storm ? Math.max(5, base * 0.55) : base;
}

// ── Capacity ────────────────────────────────────────────────────────────────

/**
 * How many glyphs of average footprint `box` fit in `zone` without crowding.
 *
 * This is the difference between "we tried not to overlap" and "each currency
 * can be read". A fixed slot count cannot work when the zone changes size with
 * the other overlays: ten glyphs fit comfortably on the whole wall and collide
 * in a top-right corner, which is exactly what happened before this existed.
 *
 * The 0.62 packing factor leaves the cloud looking like a cloud rather than a
 * grid — glyphs are placed at random, so filling the theoretical maximum would
 * guarantee collisions.
 */
export function capacity(zone: Zone, box: { w: number; h: number }, max: number): number {
  if (!(box.w > 0) || !(box.h > 0)) return max;
  const cols = Math.floor((zone.x1 - zone.x0) / box.w);
  const rows = Math.floor((zone.y1 - zone.y0) / box.h);
  const fits = Math.floor(cols * rows * 0.62);
  // Always show at least one; an empty cloud is worse than a tight one.
  return Math.max(1, Math.min(max, fits));
}

// ── Placement ───────────────────────────────────────────────────────────────

export interface Box { x: number; y: number; w: number; h: number }

/** Do two boxes overlap, allowing `pad` of extra breathing room? */
export function overlaps(a: Box, b: Box, pad = 0): boolean {
  return (
    Math.abs(a.x - b.x) < (a.w + b.w) / 2 + pad &&
    Math.abs(a.y - b.y) < (a.h + b.h) / 2 + pad
  );
}

/** Clamp a box's centre so its full extent stays inside the zone. */
export function clampToZone(box: Box, zone: Zone): Box {
  const halfW = box.w / 2;
  const halfH = box.h / 2;
  // A box wider than the zone cannot be satisfied; centre it rather than loop.
  const x = zone.x1 - zone.x0 < box.w
    ? (zone.x0 + zone.x1) / 2
    : Math.min(Math.max(box.x, zone.x0 + halfW), zone.x1 - halfW);
  const y = zone.y1 - zone.y0 < box.h
    ? (zone.y0 + zone.y1) / 2
    : Math.min(Math.max(box.y, zone.y0 + halfH), zone.y1 - halfH);
  return { ...box, x, y };
}

/**
 * Find a spot in `zone` for `box` that clears everything in `occupied`.
 *
 * Size-aware, unlike the fixed 14%-of-screen gap it replaces: a large featured
 * glyph and a small one need different clearances, and treating them alike is
 * why big glyphs used to collide while small ones wasted space. Falls back to
 * the least-bad position rather than giving up, so a crowded cloud degrades into
 * "tight" instead of "stacked".
 */
export function findSpot(
  zone: Zone,
  box: Box,
  occupied: Box[],
  rng: () => number = Math.random,
  pad = 0.01,
  /**
   * Where this glyph WANTS to sit, in normalized wall coordinates.
   *
   * Honoured first, then searched around, before falling back to the random
   * scatter below. Callers previously passed a preference as `box.x`/`box.y`
   * and it did nothing at all: the loop spreads `...box` and then immediately
   * overwrites both coordinates with random ones, so every glyph was placed at
   * random and the featured zigzag never actually applied. Buoyancy -- putting
   * a rising coin high and a falling one low -- needs the preference to mean
   * something, so it is now an explicit parameter rather than a field that
   * silently loses.
   */
  preferred?: { x: number; y: number },
): Box {
  let best: Box | null = null;
  let bestScore = -Infinity;

  if (preferred) {
    // The wanted spot, then rings of increasing jitter around it. Vertical
    // jitter stays tighter than horizontal: drifting sideways to find room
    // preserves the height that encodes the price move, whereas drifting up or
    // down would quietly contradict it.
    const rings: Array<{ dx: number; dy: number }> = [{ dx: 0, dy: 0 }];
    for (const r of [0.06, 0.12, 0.2, 0.3]) {
      for (const dir of [-1, 1]) {
        rings.push({ dx: r * dir, dy: 0 });
        rings.push({ dx: r * dir * 0.6, dy: r * dir * 0.35 });
      }
    }
    for (const ring of rings) {
      const candidate = clampToZone(
        { ...box, x: preferred.x + ring.dx, y: preferred.y + ring.dy },
        zone,
      );
      if (!occupied.some((o) => overlaps(candidate, o, pad))) return candidate;
    }
  }

  for (let attempt = 0; attempt < 120; attempt++) {
    const candidate = clampToZone(
      {
        ...box,
        x: zone.x0 + rng() * (zone.x1 - zone.x0),
        y: zone.y0 + rng() * (zone.y1 - zone.y0),
      },
      zone,
    );
    if (!occupied.some((o) => overlaps(candidate, o, pad))) return candidate;

    // Keep the candidate that is furthest from its nearest neighbour, so the
    // fallback is the roomiest spot found rather than the last one tried.
    let nearest = Infinity;
    for (const o of occupied) {
      const d = Math.hypot(candidate.x - o.x, candidate.y - o.y);
      if (d < nearest) nearest = d;
    }
    if (nearest > bestScore) { bestScore = nearest; best = candidate; }
  }

  return best ?? clampToZone(box, zone);
}
