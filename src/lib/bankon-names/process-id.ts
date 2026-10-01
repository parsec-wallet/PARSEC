// BANKON Names Registry process id — three layers, in priority order:
//   1. localStorage override (in-wallet spawn flow; see bankon-admin.ts)
//   2. Vite env var VITE_BNR_PROCESS_ID (production builds)
//   3. build-time constant below (committed after off-line CLI spawn)
//
// The first to provide a valid 43-char base64url id wins. An unconfigured
// wallet returns the empty string and isBnrConfigured() reports false.

export const BNR_PROCESS_ID = '<TO_BE_SET_AFTER_SPAWN>';
export const BNR_SPAWN_TIMESTAMP = 0;

const STORAGE_KEY = 'parsec:bnr-process-id';
const ID_RE = /^[A-Za-z0-9_-]{43}$/;

function envProcessId(): string {
  try {
    const v = (import.meta.env as Record<string, string | undefined>).VITE_BNR_PROCESS_ID;
    if (v && ID_RE.test(v)) return v;
  } catch { /* import.meta.env unavailable */ }
  return '';
}

export function getBnrProcessId(): string {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v && ID_RE.test(v)) return v;
  } catch { /* localStorage unavailable (SSR / restricted browser) */ }
  const fromEnv = envProcessId();
  if (fromEnv) return fromEnv;
  if (ID_RE.test(BNR_PROCESS_ID)) return BNR_PROCESS_ID;
  return '';
}

/** Persist a process id from the in-wallet spawn flow. Throws if the input
 * isn't a 43-char base64url string (an Arweave/AO process id). */
export function setBnrProcessId(id: string): void {
  if (typeof id !== 'string' || !ID_RE.test(id)) {
    throw new Error('Invalid BNR process id (expected 43-char base64url)');
  }
  localStorage.setItem(STORAGE_KEY, id);
}

/** Drop the localStorage override (revert to the build-time sentinel). */
export function clearBnrProcessId(): void {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* noop */ }
}

/** True iff the BNR is reachable — i.e. some 43-char id is configured. */
export function isBnrConfigured(): boolean {
  return ID_RE.test(getBnrProcessId());
}
