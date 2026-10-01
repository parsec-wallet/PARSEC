// PARSEC Wallet — behaviour on a phone (Android, iOS).
//
// The desktop app owns its window; on a phone the system owns the screen, the back
// button and the app's lifetime. This module adapts PARSEC to that, and does nothing on
// desktop (main.ts calls it only when `isMobile`).
//
//   Back button   walks PARSEC's own history, then the dashboard — never quits mid-flow
//   Links         pages outside PARSEC open in the phone's browser, so the wallet never
//                 navigates away from itself (which would reload it and lock it)
//   Resume        the auto-lock is measured on return to the foreground; a phone may
//                 hold timers back while the app is in the background
//
// SPDX-FileCopyrightText: 2026 BANKON
// SPDX-License-Identifier: Apache-2.0

import { store } from './store';
import { isTauri } from './platform';
import { isHttpsUrl, openExternal } from './external';

/** The screens a back press does not leave: the app's own front doors. */
const ROOTS = new Set(['dashboard', 'matrix', 'onboarding']);

export function backTarget(view: string, canGoBack: boolean): 'back' | 'dashboard' | 'stay' {
  if (canGoBack) return 'back';
  return ROOTS.has(view) ? 'stay' : 'dashboard';
}

function onBack(): void {
  const s = store.get();
  const t = backTarget(s.view, store.canGoBack());
  if (t === 'back') store.back();
  else if (t === 'dashboard') store.navigate('dashboard');
}

/** An anchor that would leave PARSEC: a new window, or an http(s) page off this origin. */
export function leavesApp(a: HTMLAnchorElement, origin: string): boolean {
  const href = a.getAttribute('href') ?? '';
  if (!/^https?:/i.test(href)) return false;
  try {
    return a.target === '_blank' || new URL(href).origin !== origin;
  } catch {
    return false;
  }
}

export function initMobile(): void {
  if (isTauri) {
    void import('@tauri-apps/api/app')
      .then(({ onBackButtonPress }) => onBackButtonPress(() => onBack()))
      .catch(() => { /* an older shell: the system back stays as it was */ });
  }

  document.addEventListener('click', (e) => {
    const a = (e.target as Element | null)?.closest?.('a') as HTMLAnchorElement | null;
    if (!a || !leavesApp(a, location.origin)) return;
    e.preventDefault();
    if (isHttpsUrl(a.href)) void openExternal(a.href);
  }, true);

  // The keyboard takes half the screen: once it has opened, bring the field into view.
  document.addEventListener('focusin', (e) => {
    const t = e.target as HTMLElement | null;
    if (!t || !t.matches('input, textarea, select, [contenteditable="true"]')) return;
    window.setTimeout(() => t.scrollIntoView({ block: 'center', behavior: 'smooth' }), 300);
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') store.lockIfIdleTooLong();
  });
}
