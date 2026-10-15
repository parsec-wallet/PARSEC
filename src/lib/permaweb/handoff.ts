// One-shot hand-offs between the upload view and whoever sent the participant there — the name
// controller, usually. sessionStorage, the channel the name views already use (parsec:active-name):
// per tab, gone when it closes, never a secret.

const RETURN_KEY = 'parsec:upload-return';
const TARGET_KEY = 'parsec:upload-target';

export type UploadReturn = 'name-controller' | 'permaweb-desk';

function read(key: string): string | null {
  try { return sessionStorage.getItem(key); } catch { return null; }
}
function write(key: string, value: string | null): void {
  try {
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, value);
  } catch { /* storage unavailable — the hand-off is a convenience, never required */ }
}

/** Remember where to go back to once the upload is done. */
export function setUploadReturn(view: UploadReturn): void {
  write(RETURN_KEY, view);
}

export function peekUploadReturn(): UploadReturn | null {
  const v = read(RETURN_KEY);
  return v === 'name-controller' || v === 'permaweb-desk' ? v : null;
}

export function clearUploadReturn(): void {
  write(RETURN_KEY, null);
}

/** Offer an uploaded id to the next screen that points a name. */
export function offerUploadedTarget(id: string): void {
  write(TARGET_KEY, id);
}

/** Take the offered id, once. A second call returns null, so a re-render never re-fills a form. */
export function takeUploadedTarget(): string | null {
  const v = read(TARGET_KEY);
  if (v !== null) write(TARGET_KEY, null);
  return v && /^[A-Za-z0-9_-]{43}$/.test(v) ? v : null;
}

const SLOT_KEY = 'parsec:upload-undername';

/** The undername an upload is for; null (or never set) means the name's root. */
export function setUploadSlot(undername: string | null): void {
  write(SLOT_KEY, undername);
}

export function peekUploadSlot(): string | null {
  const v = read(SLOT_KEY);
  return v && /^[a-z0-9-]{1,61}$/.test(v) ? v : null;
}

/** Take the slot, once — alongside takeUploadedTarget, so the id lands in the undername form. */
export function takeUploadSlot(): string | null {
  const v = peekUploadSlot();
  write(SLOT_KEY, null);
  return v;
}

/** Forget every hand-off at once — what an offer sheet's ✕ does on the way out. */
export function clearHandoffs(): void {
  for (const key of [RETURN_KEY, TARGET_KEY, SLOT_KEY]) write(key, null);
}
