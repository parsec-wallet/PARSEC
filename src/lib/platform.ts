// PARSEC platform shim — Tauri desktop vs. permaweb-served browser.
//
// Static `import { invoke } from '@tauri-apps/api/core'` crashes at module
// load time in a regular browser. Bundlers tree-shake out the dynamic
// import below when `isTauri` is false at startup, so the web build never
// pays the cost of the Tauri SDK.
//
// Web mode (isTauri=false) is the path used by:
//   * the permaweb deployment at https://pythai.arweave.net
//   * any user who opens dist/index.html via npx vite preview
//   * unit/integration tests in jsdom
//
// In web mode, Tauri-only commands throw a clear error so callers can route
// to the Web Crypto + localStorage fallback (see src/lib/keystore.ts).

import { assertAllowed } from './mode';
export const isTauri: boolean =
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/**
 * Invoke a Tauri command. Throws in web mode — callers that have a web
 * fallback (e.g. `keystoreUnlock`) should check `isTauri` first and route
 * to the alternative.
 */
export async function invoke<T = unknown>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T> {
  if (!isTauri) {
    throw new Error(`Tauri command "${cmd}" not available in web build`);
  }
  // The one place every command passes: viewing mode (the Blue Pill) cannot
  // reach keys, signing, the dApp bridge or the encrypted volume. lib/mode.ts.
  assertAllowed(cmd);
  const mod = await import('@tauri-apps/api/core');
  return mod.invoke<T>(cmd, args);
}

/**
 * Listen for a Tauri event. In web mode this is a no-op that returns an
 * unsubscribe function (so callers can `.then(unsub => ...)` uniformly).
 */
export async function listen<T = unknown>(
  event: string,
  handler: (e: { payload: T; event: string }) => void,
): Promise<() => void> {
  if (!isTauri) {
    return () => { /* no-op */ };
  }
  const mod = await import('@tauri-apps/api/event');
  return await mod.listen<T>(event, handler);
}
