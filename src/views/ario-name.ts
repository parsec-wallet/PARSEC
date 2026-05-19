// Back-compat forwarder. Remaps the legacy 'parsec:ario-active-name'
// session key to the unified 'parsec:active-name'.

import { store } from '../lib/store';
import { setActiveNamespaceId } from '../lib/namespaces/registry';

export function arioNameView(): HTMLElement {
  setActiveNamespaceId('arns');
  const legacy = sessionStorage.getItem('parsec:ario-active-name');
  if (legacy) {
    sessionStorage.setItem('parsec:active-name', legacy);
    sessionStorage.removeItem('parsec:ario-active-name');
  }
  queueMicrotask(() => store.navigate('name-manage'));
  const placeholder = document.createElement('div');
  placeholder.className = 'parsec-view parsec-view--loading';
  return placeholder;
}
