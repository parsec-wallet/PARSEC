// Back-compat forwarder. See bankon-hub.ts for the rationale.

import { store } from '../lib/store';
import { setActiveNamespaceId } from '../lib/namespaces/registry';

export function bankonResolveView(): HTMLElement {
  setActiveNamespaceId('bankon');
  queueMicrotask(() => store.navigate('name-resolve'));
  const placeholder = document.createElement('div');
  placeholder.className = 'parsec-view parsec-view--loading';
  return placeholder;
}
