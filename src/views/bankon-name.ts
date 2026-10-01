// Back-compat forwarder. See bankon-hub.ts for the rationale.
//
// Reads the legacy 'parsec:bankon-active-name' session key (if a caller
// hasn't been migrated yet) and remaps it to 'parsec:active-name'.

import { store } from '../lib/store';
import { setActiveNamespaceId } from '../lib/namespaces/registry';

export function bankonNameView(): HTMLElement {
  setActiveNamespaceId('bankon');
  const legacy = sessionStorage.getItem('parsec:bankon-active-name');
  if (legacy) {
    sessionStorage.setItem('parsec:active-name', legacy);
    sessionStorage.removeItem('parsec:bankon-active-name');
  }
  queueMicrotask(() => store.navigate('name-manage'));
  const placeholder = document.createElement('div');
  placeholder.className = 'parsec-view parsec-view--loading';
  return placeholder;
}
