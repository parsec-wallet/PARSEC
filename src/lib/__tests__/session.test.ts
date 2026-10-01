import { describe, expect, it, vi } from 'vitest';

vi.mock('../store', () => ({
  store: { lock: vi.fn(), getPassphrase: vi.fn(() => null) },
}));

import { logout, logoutSteps, SESSION_RESIDUE_KEYS } from '../session';
import { store } from '../store';

describe('logout', () => {
  it('covers channels, vault, caches, storage and the store — in that order', () => {
    const names = logoutSteps().map(([n]) => n);
    expect(names).toEqual([
      'close dApp bridge',
      'close Arweave connections',
      'disconnect pmVPN',
      'lock vault',
      'clear chain read caches',
      'clear market caches',
      'clear session event log',
      'clear session storage',
      'clear session residue',
      'clear cache storage',
      'end store session',
      'disarm',
    ]);
  });

  it('runs every step even when one fails, and reports which', async () => {
    const ran: string[] = [];
    const report = await logout([
      ['a', () => { ran.push('a'); }],
      ['b', () => { ran.push('b'); throw new Error('resisted'); }],
      ['c', () => { ran.push('c'); }],
    ]);
    expect(ran).toEqual(['a', 'b', 'c']);
    expect(report.ok).toBe(false);
    expect(report.steps[1]).toEqual({ step: 'b', ok: false, detail: 'resisted' });
  });

  it('joins a second call to the one already running', async () => {
    let calls = 0;
    const slow: Parameters<typeof logout>[0] = [['s', async () => { calls++; await new Promise((r) => setTimeout(r, 5)); }]];
    const [x, y] = await Promise.all([logout(slow), logout(slow)]);
    expect(calls).toBe(1);
    expect(x).toBe(y);
  });

  it('ends the store session and clears storage residue in the real sequence', async () => {
    const mem = new Map<string, string>([['parsec-permaweb-join-draft', '{}'], ['parsec-wallet-state', '{}']]);
    const session = new Map<string, string>([['parsec:claim-name', 'x']]);
    const fake = (m: Map<string, string>) => ({
      getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); },
      removeItem: (k: string) => { m.delete(k); }, clear: () => m.clear(),
    });
    vi.stubGlobal('localStorage', fake(mem));
    vi.stubGlobal('sessionStorage', fake(session));
    const report = await logout();
    expect(store.lock).toHaveBeenCalled();
    expect(session.size).toBe(0);
    for (const k of SESSION_RESIDUE_KEYS) expect(mem.has(k)).toBe(false);
    // The account list is a record, not residue.
    expect(mem.has('parsec-wallet-state')).toBe(true);
    expect(report.steps.find((s) => s.step === 'end store session')!.ok).toBe(true);
    vi.unstubAllGlobals();
  });
});
