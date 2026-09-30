import { afterEach, describe, expect, it, vi } from 'vitest';

const navigate = vi.fn();
let listener: ((s: { view: string; accounts: unknown[]; activeAccountIndex: number }) => void) | null = null;
let state = { view: 'matrix', accounts: [] as unknown[], activeAccountIndex: 0 };
vi.mock('../store', () => ({
  store: {
    get: () => state,
    navigate: (v: string) => navigate(v),
    subscribe: (fn: typeof listener) => { listener = fn; return () => {}; },
  },
}));

import { mountRouter, registerView } from '../router';
import { onCleanup, pendingCleanupCount } from '../lifecycle';
import { __resetMode, arm } from '../mode';

afterEach(() => { __resetMode(); navigate.mockReset(); });

describe('router', () => {
  it('runs the outgoing view\'s cleanups before rendering the next', () => {
    const container = { innerHTML: '', appendChild: vi.fn() } as unknown as HTMLElement;
    const torn: string[] = [];
    registerView('matrix' as never, () => { onCleanup(() => torn.push('matrix')); return {} as HTMLElement; });
    registerView('docs' as never, () => { onCleanup(() => torn.push('docs')); return {} as HTMLElement; });
    mountRouter(container);
    expect(pendingCleanupCount()).toBe(1);
    state = { ...state, view: 'docs' };
    listener!(state);
    expect(torn).toEqual(['matrix']);
    expect(pendingCleanupCount()).toBe(1);
  });

  it('refuses an armed view in viewing mode and routes to the Matrix', async () => {
    registerView('dashboard' as never, () => { throw new Error('must not render'); });
    state = { ...state, view: 'dashboard' };
    listener!(state);
    await Promise.resolve();
    expect(navigate).toHaveBeenCalledWith('matrix');
  });

  it('renders an armed view once armed', () => {
    let rendered = false;
    registerView('send' as never, () => { rendered = true; return {} as HTMLElement; });
    arm();
    state = { ...state, view: 'send' };
    listener!(state);
    expect(rendered).toBe(true);
  });
});
