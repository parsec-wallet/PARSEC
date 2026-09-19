// Parsec Wallet — view lifecycle.
//
// The router destroys a view by setting `container.innerHTML = ''` and building
// the next one. That reclaims the DOM, but nothing else: a listener the old view
// attached to `window` or `document` stays attached, keeps firing, and — because
// its handler closes over the old elements — pins the whole discarded tree in
// memory. Visit such a view ten times and you have ten copies of it alive, plus
// ten sets of handlers all running on every mousemove.
//
// This gives views somewhere to put their teardown. `bindGlobal` is the form to
// reach for: it registers the listener and its removal together, so the two
// cannot drift apart.

type Cleanup = () => void;

let current: Cleanup[] = [];

/**
 * Register work to undo when the current view is replaced.
 *
 * Safe to call during a view factory. Cleanups run in reverse order, so teardown
 * mirrors setup.
 */
export function onCleanup(fn: Cleanup): void {
  current.push(fn);
}

/**
 * Add an event listener that is removed automatically when the view is replaced.
 *
 * Prefer this over a bare `addEventListener` for anything on `window`,
 * `document`, or any node that outlives the view. Note it takes a named handler
 * rather than accepting an inline arrow: an inline function cannot be removed,
 * because `removeEventListener` matches on identity.
 */
export function bindGlobal<K extends keyof WindowEventMap>(
  target: Window,
  type: K,
  handler: (ev: WindowEventMap[K]) => void,
  options?: AddEventListenerOptions,
): void;
export function bindGlobal<K extends keyof DocumentEventMap>(
  target: Document,
  type: K,
  handler: (ev: DocumentEventMap[K]) => void,
  options?: AddEventListenerOptions,
): void;
export function bindGlobal(
  target: Window | Document | HTMLElement,
  type: string,
  handler: EventListenerOrEventListenerObject,
  options?: AddEventListenerOptions,
): void {
  target.addEventListener(type, handler, options);
  onCleanup(() => target.removeEventListener(type, handler, options));
}

/** Register an interval that is cleared when the view is replaced. */
export function bindInterval(fn: () => void, ms: number): ReturnType<typeof setInterval> {
  const id = setInterval(fn, ms);
  onCleanup(() => clearInterval(id));
  return id;
}

/** Register an animation loop that is cancelled when the view is replaced. */
export function bindAnimationFrame(step: (t: number) => void): void {
  let raf = 0;
  let stopped = false;
  const tick = (t: number) => {
    if (stopped) return;
    step(t);
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  onCleanup(() => {
    stopped = true;
    cancelAnimationFrame(raf);
  });
}

/** Register an observer that is disconnected when the view is replaced. */
export function bindObserver(o: { disconnect(): void }): void {
  onCleanup(() => o.disconnect());
}

/**
 * Run and clear every cleanup for the outgoing view. Called by the router.
 *
 * A throwing cleanup must not prevent the others from running — a half-torn-down
 * view is exactly the state this exists to avoid.
 */
export function runCleanups(): void {
  const pending = current;
  current = [];
  for (let i = pending.length - 1; i >= 0; i--) {
    try {
      pending[i]();
    } catch (err) {
      console.error('[lifecycle] cleanup failed', err);
    }
  }
}

/** How many cleanups are registered. For tests and diagnostics. */
export function pendingCleanupCount(): number {
  return current.length;
}
