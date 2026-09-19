import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  onCleanup, bindGlobal, bindInterval, bindObserver, runCleanups, pendingCleanupCount,
} from '../lifecycle';

beforeEach(() => runCleanups());

// The suite runs in the `node` environment (vitest.config.ts), so there is no
// `window`. Node's global EventTarget has the same addEventListener /
// removeEventListener contract, which is all bindGlobal touches — and testing
// against it keeps this suite from needing a DOM implementation as a dependency.
function fakeWindow(): Window {
  return new EventTarget() as unknown as Window;
}

describe('view lifecycle', () => {
  it('runs cleanups in reverse order, mirroring setup', () => {
    const order: number[] = [];
    onCleanup(() => order.push(1));
    onCleanup(() => order.push(2));
    onCleanup(() => order.push(3));
    runCleanups();
    expect(order).toEqual([3, 2, 1]);
  });

  it('clears the registry so a second teardown is a no-op', () => {
    const fn = vi.fn();
    onCleanup(fn);
    runCleanups();
    runCleanups();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(pendingCleanupCount()).toBe(0);
  });

  it('keeps going when a cleanup throws', () => {
    const after = vi.fn();
    onCleanup(after);
    onCleanup(() => { throw new Error('boom'); });
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => runCleanups()).not.toThrow();
    expect(after).toHaveBeenCalledTimes(1);
    err.mockRestore();
  });

  it('removes global listeners it registered', () => {
    const w = fakeWindow();
    const handler = vi.fn();
    bindGlobal(w, 'resize', handler);
    w.dispatchEvent(new Event('resize'));
    expect(handler).toHaveBeenCalledTimes(1);

    runCleanups();
    w.dispatchEvent(new Event('resize'));
    expect(handler).toHaveBeenCalledTimes(1); // not called again
  });

  /** The leak this module exists to prevent: revisiting a view stacking handlers. */
  it('does not accumulate handlers across simulated view visits', () => {
    // The exact leak this module exists to prevent. matrix.ts bound four window
    // listeners per draggable element, three elements per render, with inline
    // arrows that could never be removed — so every visit stacked another twelve
    // live handlers onto a detached DOM tree.
    const w = fakeWindow();
    const handler = vi.fn();
    for (let visit = 0; visit < 5; visit++) {
      bindGlobal(w, 'resize', handler);
      runCleanups();
    }
    w.dispatchEvent(new Event('resize'));
    expect(handler).not.toHaveBeenCalled();

    // One live visit: exactly one handler, not five.
    bindGlobal(w, 'resize', handler);
    w.dispatchEvent(new Event('resize'));
    expect(handler).toHaveBeenCalledTimes(1);
    runCleanups();
  });

  it('clears intervals it registered', () => {
    vi.useFakeTimers();
    const tick = vi.fn();
    bindInterval(tick, 1000);
    vi.advanceTimersByTime(3000);
    expect(tick).toHaveBeenCalledTimes(3);

    runCleanups();
    vi.advanceTimersByTime(5000);
    expect(tick).toHaveBeenCalledTimes(3); // stopped
    vi.useRealTimers();
  });

  it('disconnects observers it registered', () => {
    const observer = { disconnect: vi.fn() };
    bindObserver(observer);
    expect(observer.disconnect).not.toHaveBeenCalled();
    runCleanups();
    expect(observer.disconnect).toHaveBeenCalledTimes(1);
  });
});
