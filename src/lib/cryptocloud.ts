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

/** Clearance kept between the cloud and an obstacle such as the toggle menu. */
export const OBSTACLE_MARGIN = 0.02;
/** A zone piece thinner than this cannot hold a glyph and is dropped. */
const MIN_PIECE = 0.06;

/**
 * Cut obstacles out of the cloud's zones.
 *
 * Each zone an obstacle touches is replaced by the bands around it -- above,
 * below, left and right -- so the cloud keeps every bit of wall the obstacle
 * does not use. Bands too thin to hold a glyph are dropped. If nothing at all
 * survives, the original zones are returned: a cramped cloud beats none.
 */
export function avoidObstacles(zones: Zone[], obstacles: Zone[], margin = OBSTACLE_MARGIN): Zone[] {
  let out = zones;
  for (const raw of obstacles) {
    const o = { x0: raw.x0 - margin, x1: raw.x1 + margin, y0: raw.y0 - margin, y1: raw.y1 + margin };
    const next: Zone[] = [];
    for (const z of out) {
      const hit = o.x0 < z.x1 && o.x1 > z.x0 && o.y0 < z.y1 && o.y1 > z.y0;
      if (!hit) { next.push(z); continue; }
      const pieces: Zone[] = [
        { x0: z.x0, x1: z.x1, y0: z.y0, y1: Math.min(z.y1, o.y0) },
        { x0: z.x0, x1: z.x1, y0: Math.max(z.y0, o.y1), y1: z.y1 },
        { x0: z.x0, x1: Math.min(z.x1, o.x0), y0: Math.max(z.y0, o.y0), y1: Math.min(z.y1, o.y1) },
        { x0: Math.max(z.x0, o.x1), x1: z.x1, y0: Math.max(z.y0, o.y0), y1: Math.min(z.y1, o.y1) },
      ];
      for (const p of pieces) {
        if (p.x1 - p.x0 >= MIN_PIECE && p.y1 - p.y0 >= MIN_PIECE) next.push(p);
      }
    }
    out = next;
  }
  return out.length > 0 ? out : zones;
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
    const pct15m = c.change15m?.pct ?? null;
    if (pct15m === null) unknown15m++;
    else if (Math.abs(pct15m) >= SURGE_15M_PCT) surging++;
  }

  const avg1h = sum1h / coins.length;
  return { avg1h, volatile, surging, unknown15m, storm: avg1h >= VOLATILE_1H_PCT && surging > 0 };
}

/** Is this coin moving hard enough in fifteen minutes to earn the candle border? */
export function isSurging(coin: CoinPrice): boolean {
  const pct = coin.change15m?.pct ?? null;
  return pct !== null && Math.abs(pct) >= SURGE_15M_PCT;
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

// ── Motion ──────────────────────────────────────────────────────────────────
//
// Placement only guarantees the glyphs START apart. Once they move, something
// has to keep them apart, or the drift carries one straight over another --
// which is what the old per-frame drift did: it shifted every glyph by its
// 24h move after placement had already spaced them, so a gainer slid up into
// whatever sat above it. Here each glyph is a body with a home, and bodies
// collide: they bounce off each other and off their channel's walls, in calm
// and in storm alike. A storm makes them move harder; it never lets them merge.

/** Breathing room kept between two glyphs, in normalized wall units. */
export const CLOUD_GAP = 0.03;
/**
 * How far beyond the gap two glyphs start pushing each other away. The hard
 * collision stops an overlap; this is what makes them visibly repel before one
 * can happen, so the cloud stays spread instead of settling into a clump.
 */
export const REPEL_RANGE = 0.07;
/** Strength of that push, in normalized units per second squared at contact. */
const REPEL_STRENGTH = 1.1;

export interface CloudBody {
  /** Centre, normalized. */
  x: number; y: number;
  /** Extent, normalized. */
  w: number; h: number;
  /** Velocity, normalized units per second. */
  vx: number; vy: number;
  /** Where placement put it -- the spot the spring pulls back towards. */
  hx: number; hy: number;
  /** The channel it lives in; it never leaves. */
  zone: Zone;
  /** Per-body phase so the wander is not in lockstep. */
  phase: number;
  /** 0..1: how hard this coin's own move agitates it. */
  agitation: number;
  /**
   * Foreground vs background. A featured glyph is heavy and wears a halo:
   * background glyphs bounce off it rather than shoving it, and keep clear of
   * it by the halo as well as the gap, so the small faint glyphs never smear
   * across the ones the participant is meant to read.
   */
  mass: number;
  halo: number;
}

/** Extra clearance a foreground glyph keeps around itself. */
export const FOREGROUND_HALO = 0.02;
/** How much heavier a foreground glyph is than a background one. */
export const FOREGROUND_MASS = 4;

export function makeBody(box: Box, zone: Zone, phase: number, agitation: number, foreground = false): CloudBody {
  return {
    x: box.x, y: box.y, w: box.w, h: box.h, vx: 0, vy: 0,
    hx: box.x, hy: box.y, zone, phase, agitation: Math.max(0, Math.min(1, agitation)),
    mass: foreground ? FOREGROUND_MASS : 1,
    halo: foreground ? FOREGROUND_HALO : 0,
  };
}

/** Clearance a pair must keep: the gap, plus the halo of each foreground glyph. */
function pairGap(a: CloudBody, b: CloudBody, gap: number): number {
  return gap + (a.halo ?? 0) + (b.halo ?? 0);
}

export interface StepOptions {
  /** Seconds since the last step. Clamped: a backgrounded tab returns with a huge gap. */
  dt: number;
  /** Wall-clock seconds, for the wander. */
  t: number;
  storm: boolean;
  gap?: number;
}

/** How bouncy a collision is. Below 1 so a storm does not pump energy in forever. */
const RESTITUTION = 0.92;

/**
 * Advance the cloud one frame.
 *
 * Forces: a spring back home (so height keeps meaning the price move), a wander
 * that is stronger in a storm and for coins moving hard, and drag. Then walls,
 * then collisions -- resolved over a few passes, positionally as well as by
 * velocity, so the no-overlap guarantee holds even when a storm drives bodies
 * together faster than one pass can separate them.
 */
export function stepCloud(bodies: CloudBody[], opts: StepOptions): void {
  const gap = opts.gap ?? CLOUD_GAP;
  const dtTotal = Math.min(Math.max(opts.dt, 0), 0.1);
  if (dtTotal === 0) return;
  const substeps = opts.storm ? 3 : 2;
  const dt = dtTotal / substeps;

  const spring = opts.storm ? 0.9 : 1.4;
  const drag = opts.storm ? 0.9 : 1.6;
  const maxSpeed = opts.storm ? 0.22 : 0.08;

  for (let s = 0; s < substeps; s++) {
    const t = opts.t + s * dt;
    repel(bodies, gap, dt);
    for (const b of bodies) {
      const wander = (opts.storm ? 0.16 : 0.035) * (0.4 + b.agitation);
      const ax = spring * (b.hx - b.x) - drag * b.vx
        + wander * Math.sin(t * 0.7 + b.phase * 2.3) + wander * 0.5 * Math.sin(t * 1.9 + b.phase);
      // Vertical wander is kept smaller: height is the price move, sideways is free.
      const ay = spring * (b.hy - b.y) - drag * b.vy
        + wander * 0.45 * Math.cos(t * 0.9 + b.phase * 1.7);
      b.vx += ax * dt;
      b.vy += ay * dt;
      const sp = Math.hypot(b.vx, b.vy);
      if (sp > maxSpeed) { b.vx *= maxSpeed / sp; b.vy *= maxSpeed / sp; }
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      bounceWalls(b);
    }
    for (let pass = 0; pass < 4; pass++) {
      if (!resolveCollisions(bodies, gap)) break;
    }
  }
}

/**
 * The soft field: every pair closer than gap + REPEL_RANGE (edge to edge) is
 * pushed apart along the line between their centres, harder the closer they are.
 */
function repel(bodies: CloudBody[], gap: number, dt: number): void {
  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      const a = bodies[i];
      const b = bodies[j];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      // Edge-to-edge clearance on each axis; the pair is only as far apart as
      // its larger clearance (boxes clear on either axis do not touch).
      const cx = Math.abs(dx) - (a.w + b.w) / 2;
      const cy = Math.abs(dy) - (a.h + b.h) / 2;
      const clearance = Math.max(cx, cy);
      const reach = pairGap(a, b, gap) + REPEL_RANGE;
      if (clearance >= reach) continue;
      const strength = REPEL_STRENGTH * (1 - Math.max(0, clearance) / reach);
      const dist = Math.hypot(dx, dy) || 1e-6;
      const ux = dx === 0 && dy === 0 ? (i % 2 ? 1 : -1) : dx / dist;
      const uy = dy / dist;
      // Equal and opposite force, so the lighter glyph does the moving.
      const ia = 1 / a.mass;
      const ib = 1 / b.mass;
      const k = (2 * strength * dt) / (ia + ib);
      a.vx -= ux * k * ia;
      a.vy -= uy * k * ia;
      b.vx += ux * k * ib;
      b.vy += uy * k * ib;
    }
  }
}

/**
 * Spread the homes before anything moves.
 *
 * Placement works from ESTIMATED glyph sizes; once a glyph is on the wall its
 * real size is known and is usually larger -- a price like $0.00001234 is far
 * wider than the estimate. Homes that overlap at their real size would have the
 * springs dragging bodies back into each other forever, which is the clump.
 * This pushes them apart at their true size, then moves each body onto its
 * spread home. Returns the indices still overlapping, so the caller can drop
 * what genuinely does not fit rather than draw a blob.
 */
export function relaxHomes(bodies: CloudBody[], gap = CLOUD_GAP, iterations = 300): number[] {
  for (const b of bodies) { b.x = b.hx; b.y = b.hy; bounceWalls(b); }
  for (let k = 0; k < iterations; k++) {
    if (!resolveCollisions(bodies, gap)) break;
  }
  for (const b of bodies) { b.hx = b.x; b.hy = b.y; b.vx = 0; b.vy = 0; }
  const bad = new Set<number>();
  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      if (overlaps(bodies[i], bodies[j], pairGap(bodies[i], bodies[j], gap) * 0.5)) { bad.add(i); bad.add(j); }
    }
  }
  return [...bad];
}

function bounceWalls(b: CloudBody): void {
  const z = b.zone;
  const hw = b.w / 2;
  const hh = b.h / 2;
  if (z.x1 - z.x0 >= b.w) {
    if (b.x < z.x0 + hw) { b.x = z.x0 + hw; if (b.vx < 0) b.vx = -b.vx * RESTITUTION; }
    if (b.x > z.x1 - hw) { b.x = z.x1 - hw; if (b.vx > 0) b.vx = -b.vx * RESTITUTION; }
  } else { b.x = (z.x0 + z.x1) / 2; b.vx = 0; }
  if (z.y1 - z.y0 >= b.h) {
    if (b.y < z.y0 + hh) { b.y = z.y0 + hh; if (b.vy < 0) b.vy = -b.vy * RESTITUTION; }
    if (b.y > z.y1 - hh) { b.y = z.y1 - hh; if (b.vy > 0) b.vy = -b.vy * RESTITUTION; }
  } else { b.y = (z.y0 + z.y1) / 2; b.vy = 0; }
}

/**
 * One pass of pairwise separation. Returns whether anything moved.
 *
 * Axis-aligned boxes, separated along the axis of least penetration. Equal
 * mass, so an approaching pair exchanges that velocity component -- the bounce.
 */
function resolveCollisions(bodies: CloudBody[], gap: number): boolean {
  let moved = false;
  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      const a = bodies[i];
      const b = bodies[j];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const g = pairGap(a, b, gap);
      const px = (a.w + b.w) / 2 + g - Math.abs(dx);
      const py = (a.h + b.h) / 2 + g - Math.abs(dy);
      if (px <= 0 || py <= 0) continue;
      moved = true;
      // The lighter body takes the larger share of the separation: a background
      // glyph is pushed off a foreground one, not the other way round.
      const ia = 1 / a.mass;
      const ib = 1 / b.mass;
      const sa = ia / (ia + ib);
      const sb = ib / (ia + ib);
      if (px < py) {
        const sign = dx === 0 ? (i % 2 ? 1 : -1) : Math.sign(dx);
        a.x -= sign * px * sa;
        b.x += sign * px * sb;
        const rel = b.vx - a.vx;
        if (rel * sign < 0) {
          // Elastic bounce with unequal masses, along the contact axis.
          const jn = (-(1 + RESTITUTION) * rel) / (ia + ib);
          a.vx -= jn * ia;
          b.vx += jn * ib;
        }
      } else {
        const sign = dy === 0 ? (i % 2 ? 1 : -1) : Math.sign(dy);
        a.y -= sign * py * sa;
        b.y += sign * py * sb;
        const rel = b.vy - a.vy;
        if (rel * sign < 0) {
          const jn = (-(1 + RESTITUTION) * rel) / (ia + ib);
          a.vy -= jn * ia;
          b.vy += jn * ib;
        }
      }
      bounceWalls(a);
      bounceWalls(b);
    }
  }
  return moved;
}
