// BMR process id — three layers, in priority order:
//   1. localStorage override (in-wallet spawn flow)
//   2. Vite env var VITE_BMR_PROCESS_ID (production builds)
//   3. build-time constant below
//
// Mirrors the BNR pattern in src/lib/bankon-names/process-id.ts.

export const BMR_PROCESS_ID = '<TO_BE_SET_AFTER_SPAWN>';

const STORAGE_KEY = 'parsec:bmr-process-id';
const ID_RE = /^[A-Za-z0-9_-]{43}$/;

function envProcessId(): string {
  try {
    const v = (import.meta.env as Record<string, string | undefined>).VITE_BMR_PROCESS_ID;
    if (v && ID_RE.test(v)) return v;
  } catch { /* import.meta.env unavailable */ }
  return '';
}

export function getBmrProcessId(): string {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v && ID_RE.test(v)) return v;
  } catch { /* noop */ }
  const fromEnv = envProcessId();
  if (fromEnv) return fromEnv;
  if (ID_RE.test(BMR_PROCESS_ID)) return BMR_PROCESS_ID;
  return '';
}

export function setBmrProcessId(id: string): void {
  if (typeof id !== 'string' || !ID_RE.test(id)) {
    throw new Error('Invalid BMR process id (expected 43-char base64url)');
  }
  localStorage.setItem(STORAGE_KEY, id);
}

export function clearBmrProcessId(): void {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* noop */ }
}

export function isBmrConfigured(): boolean {
  return ID_RE.test(getBmrProcessId());
}
