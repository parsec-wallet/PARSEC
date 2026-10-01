// Parsec Wallet — the desktop shell: window controls, close-to-tray, start at login.
//
// One typed wrapper over the Rust `app_shell` module (src-tauri/src/app_shell),
// through platform.ts like every other command. Everything here is desktop-only:
// in the browser build each call is a no-op and the title bar is not mounted.
//
// SPDX-FileCopyrightText: 2026 BANKON
// SPDX-License-Identifier: Apache-2.0

import { invoke, isTauri, listen } from './platform';

const CLOSE_TO_TRAY_KEY = 'parsec:close-to-tray';

/** Close hides to the tray unless the participant turned it off. Default on. */
export function getCloseToTray(): boolean {
  try { return localStorage.getItem(CLOSE_TO_TRAY_KEY) !== 'off'; } catch { return true; }
}

export async function setCloseToTray(on: boolean): Promise<void> {
  try { localStorage.setItem(CLOSE_TO_TRAY_KEY, on ? 'on' : 'off'); } catch { /* best effort */ }
  if (isTauri) await invoke('app_shell_set_close_to_tray', { enabled: on });
}

export async function getAutostart(): Promise<boolean> {
  if (!isTauri) return false;
  return await invoke<boolean>('app_shell_autostart_get');
}

/** Returns whether start-at-login is now on, as read back from the system. */
export async function setAutostart(on: boolean): Promise<boolean> {
  if (!isTauri) return false;
  return await invoke<boolean>('app_shell_autostart_set', { enabled: on });
}

export const windowControls = {
  minimize: () => invoke('app_shell_minimize'),
  /** Resolves to whether the window is maximized afterwards. */
  toggleMaximize: () => invoke<boolean>('app_shell_toggle_maximize'),
  /** The same as the system close: hides to the tray when that is on, else quits. */
  close: () => invoke('app_shell_close'),
  quit: () => invoke('app_shell_quit'),
};

/**
 * Wire the shell once at startup: tell Rust the saved close-to-tray choice, and
 * make the tray's "Lock wallet" do what Settings → Lock Wallet does — the
 * complete logout (lib/session.ts), not just a screen change.
 */
export async function initAppShell(): Promise<void> {
  if (!isTauri) return;
  try { await invoke('app_shell_set_close_to_tray', { enabled: getCloseToTray() }); } catch { /* shell absent: older build */ }
  try {
    await listen('parsec://tray-lock', () => {
      void import('./session').then((m) => m.logout());
    });
  } catch { /* events unavailable */ }
}
