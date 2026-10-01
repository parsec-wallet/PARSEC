// Back-compat forwarder. The cypherpunk2048 refactor consolidated BANKON
// and ArNS views into a namespace-agnostic name-* family.

import { store } from '../lib/store';
import { setActiveNamespaceId } from '../lib/namespaces/registry';

export function arioHubView(): HTMLElement {
  setActiveNamespaceId('arns');
  queueMicrotask(() => store.navigate('name-hub'));
  const placeholder = document.createElement('div');
  placeholder.className = 'parsec-view parsec-view--loading';
  return placeholder;
}
