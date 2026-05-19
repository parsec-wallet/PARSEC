// Back-compat forwarder. Cypherpunk2048 refactor consolidated BANKON and
// ArNS views into the namespace-agnostic name-* family. Old routes keep
// working by setting the active namespace and redirecting.

import { store } from '../lib/store';
import { setActiveNamespaceId } from '../lib/namespaces/registry';

export function bankonHubView(): HTMLElement {
  setActiveNamespaceId('bankon');
  queueMicrotask(() => store.navigate('name-hub'));
  const placeholder = document.createElement('div');
  placeholder.className = 'parsec-view parsec-view--loading';
  return placeholder;
}
