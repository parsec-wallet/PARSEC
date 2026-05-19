// Back-compat forwarder for the previous-round dashboard CTA. Pre-fills
// `pythai` into sessionStorage and forwards to the generalized claim flow.

import { store } from '../lib/store';

export function arioClaimPythaiView(): HTMLElement {
  sessionStorage.setItem('parsec:ario-claim-name', 'pythai');
  // Defer navigation to the next tick so the current view's render returns
  // first; otherwise the router rerenders before this view is appended.
  queueMicrotask(() => store.navigate('ario-claim'));
  const placeholder = document.createElement('div');
  placeholder.className = 'parsec-view parsec-view--loading';
  return placeholder;
}
