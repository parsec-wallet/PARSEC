// store.back() reports whether there was a view to return to, so each Back button
// can pick its own fallback instead of the store silently choosing 'dashboard'.

import { describe, it, expect } from 'vitest';

const storage = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => storage.get(k) ?? null,
  setItem: (k: string, v: string) => void storage.set(k, v),
  removeItem: (k: string) => void storage.delete(k),
};

const { store } = await import('../store');

describe('store.back', () => {
  it('returns false and stays put with no history', () => {
    while (store.back()) { /* drain */ }
    const before = store.get().view;
    expect(store.back()).toBe(false);
    expect(store.get().view).toBe(before);
  });

  it('returns true and restores the previous view', () => {
    store.navigate('settings');
    store.navigate('diagnostics');
    expect(store.back()).toBe(true);
    expect(store.get().view).toBe('settings');
  });
});
