// PARSEC Wallet — the way back to the Matrix.
//
// Every door screen (unlock, onboarding) needs an exit that is not a wallet:
// a "Return to Matrix" link, and Escape doing the same. Leaving clears
// whatever the screen was holding (`onLeave`) before routing away.

import { el } from '../dom';
import { store } from '../store';
import { bindGlobal } from '../lifecycle';

export function matrixEscape(onLeave?: () => void): HTMLElement {
  function leave(): void {
    onLeave?.();
    store.navigate('matrix');
  }
  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); leave(); }
  }
  bindGlobal(document, 'keydown', onKey);
  return el('p', { cls: 'parsec-onboarding__footer parsec-escape', children: [
    el('a', {
      text: 'Return to Matrix',
      attrs: { href: '#', title: 'Esc' },
      onClick: (e) => { e.preventDefault(); leave(); },
    }),
  ]});
}
