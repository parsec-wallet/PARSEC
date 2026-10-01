// Parsec Wallet — the custom title bar.
//
// The window is undecorated (tauri.conf.json `decorations: false`), so this bar
// is the window's frame: the Parsec mark and name, a drag region (Tauri's
// `data-tauri-drag-region`, which also maximizes on double-click), and minimize,
// maximize/restore and close. Close behaves like the system close: it hides to
// the tray when that preference is on, otherwise it quits.
//
// SPDX-FileCopyrightText: 2026 BANKON
// SPDX-License-Identifier: Apache-2.0

import { el } from '../dom';
import { windowControls } from '../app-shell';
import brandMarkUrl from '../../assets/brand/parsec-mark.svg';

/** Height of the bar; the app below it starts here (styles/layout/_titlebar.scss). */
export const TITLEBAR_HEIGHT_PX = 34;

function control(label: string, glyph: string, cls: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', {
    cls: `parsec-titlebar__btn parsec-titlebar__btn--${cls}`,
    attrs: { type: 'button', 'aria-label': label, title: label },
    text: glyph,
  }) as HTMLButtonElement;
  b.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
  // A press on a control must not start a window drag.
  b.addEventListener('mousedown', (e) => e.stopPropagation());
  return b;
}

/** Build the bar and mark the document so the layout makes room for it. */
export function mountTitlebar(): HTMLElement {
  const mark = document.createElement('img');
  mark.src = brandMarkUrl;
  mark.alt = '';
  mark.width = 18;
  mark.height = 18;
  mark.className = 'parsec-titlebar__mark';
  mark.setAttribute('data-tauri-drag-region', '');

  const maxBtn = control('Maximize', '▢', 'max', () => {
    void windowControls.toggleMaximize().then((maximized) => {
      maxBtn.textContent = maximized ? '❐' : '▢';
      maxBtn.title = maxBtn.ariaLabel = maximized ? 'Restore' : 'Maximize';
    });
  });

  const bar = el('header', {
    cls: 'parsec-titlebar',
    attrs: { 'data-tauri-drag-region': '', role: 'banner' },
    children: [
      mark,
      el('span', { cls: 'parsec-titlebar__title', text: 'Parsec Wallet', attrs: { 'data-tauri-drag-region': '' } }),
      el('div', { cls: 'parsec-titlebar__spacer', attrs: { 'data-tauri-drag-region': '' } }),
      control('Minimize', '—', 'min', () => { void windowControls.minimize(); }),
      maxBtn,
      control('Close', '✕', 'close', () => { void windowControls.close(); }),
    ],
  });

  document.documentElement.dataset.titlebar = 'on';
  document.documentElement.style.setProperty('--px-titlebar-h', `${TITLEBAR_HEIGHT_PX}px`);
  document.body.prepend(bar);
  return bar;
}
