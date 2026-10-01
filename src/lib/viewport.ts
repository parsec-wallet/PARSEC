// PARSEC Wallet — screen-size awareness.
//
// One place knows how big the window is, and says so to the stylesheet:
//
//   <html data-viewport="compact | regular | wide">  — layout class
//   --px-app-h                                       — the real visible height
//
// `100vh` is the height of the largest possible viewport, which on a laptop with
// a short window or a phone with browser chrome is taller than what is actually
// visible; a screen sized to it scrolls for no reason. `--px-app-h` is the live
// innerHeight, so full-height screens fit the window they are in.

export type ViewportClass = 'compact' | 'regular' | 'wide';

/** Below this width a screen is compact: one column, tighter spacing. */
export const COMPACT_MAX = 600;
/** Below this width a screen is regular; at or above it, wide. */
export const REGULAR_MAX = 1100;

export function classify(width: number): ViewportClass {
  if (width < COMPACT_MAX) return 'compact';
  if (width < REGULAR_MAX) return 'regular';
  return 'wide';
}

let current: ViewportClass | null = null;
const listeners = new Set<(v: ViewportClass) => void>();

/** The current layout class. */
export function viewport(): ViewportClass {
  return current ?? classify(typeof window === 'undefined' ? REGULAR_MAX : window.innerWidth);
}

/** Be told when the layout class changes (not on every pixel of a resize). */
export function onViewportChange(fn: (v: ViewportClass) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

function apply(): void {
  const root = document.documentElement;
  // The visible app height: the window, less the desktop title bar when present.
  const bar = root.dataset.titlebar === 'on'
    ? parseFloat(getComputedStyle(root).getPropertyValue('--px-titlebar-h')) || 0
    : 0;
  root.style.setProperty('--px-app-h', `${window.innerHeight - bar}px`);
  const next = classify(window.innerWidth);
  if (next === current) return;
  current = next;
  root.dataset.viewport = next;
  for (const fn of listeners) fn(next);
}

let started = false;

/** Start tracking. Idempotent; called once from main. `mobile` marks a phone or tablet
 *  as `<html data-platform="mobile">`, which the stylesheet uses for touch sizing,
 *  safe areas and hiding desktop-only controls. */
export function initViewport(mobile = false): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  document.documentElement.dataset.platform = mobile ? 'mobile' : 'desktop';
  apply();
  let frame = 0;
  // One update per frame at most while a window is being dragged.
  window.addEventListener('resize', () => {
    if (frame) return;
    frame = requestAnimationFrame(() => { frame = 0; apply(); });
  });
}
