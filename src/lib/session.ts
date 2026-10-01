// PARSEC Wallet — complete logout
//
// The Red Pill is a live wallet session. Leaving it must leave nothing behind:
// no secret in memory, no open channel a dApp can still talk to, no cached
// read of an address, no half-finished hand-off in storage.
//
// `store.lock()` already zeroes the passphrase and mnemonic fields and locks
// the Rust vault. Everything else a session touches is torn down here, step by
// step, and every step runs even if an earlier one fails — a logout that stops
// at the first error is exactly how a session lingers.
//
// What survives, on purpose:
//   - the vault on disk (it is the wallet; logging out is not deleting)
//   - the account list in 'parsec-wallet-state' — public addresses only, and
//     the only record of watch-only accounts, which have no keys to recover from
//   - records the participant keeps: x402 receipts, swap and bridge history
//   - Blue Pill profiles and display preferences (no wallet data in them)
//
// A JavaScript string cannot be wiped in place (see docs/security/threat-model.md);
// what must truly be erased lives in Rust `SecretBytes`, and locking the vault
// drops those.

import { store } from './store';
import { isTauri } from './vault';

export interface LogoutStep { step: string; ok: boolean; detail?: string }
export interface LogoutReport { steps: LogoutStep[]; ok: boolean }

/** localStorage keys that are session residue rather than records. */
export const SESSION_RESIDUE_KEYS: ReadonlyArray<string> = [
  'parsec-permaweb-join-draft',
];

type Step = [name: string, run: () => Promise<void> | void];

/** The teardown, in order. Exported so tests can see every step is present. */
export function logoutSteps(): Step[] {
  return [
    // Channels first: nothing outside the wallet should be able to reach it
    // while the rest is being cleared.
    ['close dApp bridge', async () => {
      if (!isTauri()) return;
      const c = await import('./connect');
      const [sessions, signs, names] = await Promise.all([
        c.connectSessions().catch(() => []),
        c.connectPendingRequests().catch(() => []),
        c.connectPendingNameRequests().catch(() => []),
      ]);
      await Promise.allSettled([
        ...signs.map((r) => c.connectRejectSign(r.request_id, 'Wallet logged out')),
        ...names.map((r) => c.connectRejectName(r.requestId, 'Wallet logged out')),
        ...sessions.map((x) => c.connectDisconnectSession(x.session_id)),
      ]);
      await c.connectStop();
    }],
    ['close Arweave connections', async () => {
      const a = await import('./arweave/inject');
      if (a.getPendingArweaveApproval()) a.rejectArweaveApproval('Wallet logged out');
      a.disposeArweaveConnections();
    }],
    ['disconnect pmVPN', async () => {
      const p = await import('./pmvpn/connector');
      await p.disconnectAll();
    }],
    ['lock vault', async () => {
      const k = await import('./keystore');
      await k.keystoreLock();
    }],
    // Then memory: every cache that could hold an address or a read of one.
    ['clear chain read caches', async () => {
      (await import('./algorand/query-cache')).clearQueryCache();
      (await import('./nfd/resolve')).invalidateNfdCaches();
      (await import('./x402/discount')).clearHolderCache();
    }],
    ['clear market caches', async () => {
      (await import('./prices')).clearPriceCaches();
      (await import('./market-global')).clearMarketCache();
      (await import('./chainmarketcap')).__resetCache();
    }],
    ['clear session event log', async () => {
      (await import('./events')).clear();
    }],
    // Then storage: hand-offs and drafts, and any HTTP cache the page opened.
    ['clear session storage', () => {
      try { sessionStorage.clear(); } catch { /* unavailable is already clear */ }
    }],
    ['clear session residue', () => {
      for (const k of SESSION_RESIDUE_KEYS) {
        try { localStorage.removeItem(k); } catch { /* best effort */ }
      }
    }],
    ['clear cache storage', async () => {
      if (typeof caches === 'undefined') return;
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }],
    // Last: zero the store's secrets and state, and return to the Matrix.
    ['end store session', () => { store.lock(); }],
    // Back to viewing mode: from here the IPC layer refuses every key, signing
    // and bridge command until the Red Pill is taken again.
    ['disarm', async () => { (await import('./mode')).disarm(); }],
  ];
}

let inFlight: Promise<LogoutReport> | null = null;

/**
 * Log out completely. Safe to call twice: a second call joins the first.
 * Resolves with what each step did, so the UI can say if anything resisted.
 */
export function logout(steps: Step[] = logoutSteps()): Promise<LogoutReport> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    const report: LogoutStep[] = [];
    for (const [name, run] of steps) {
      try {
        await run();
        report.push({ step: name, ok: true });
      } catch (e) {
        report.push({ step: name, ok: false, detail: e instanceof Error ? e.message : String(e) });
      }
    }
    return { steps: report, ok: report.every((s) => s.ok) };
  })().finally(() => { inFlight = null; });
  return inFlight;
}

/** Whether a Red Pill session is open — a passphrase is held for this session. */
export function hasLiveSession(): boolean {
  return store.getPassphrase() !== null;
}
