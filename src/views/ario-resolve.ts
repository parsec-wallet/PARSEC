// Back-compat forwarder.

import { store } from '../lib/store';
import { setActiveNamespaceId } from '../lib/namespaces/registry';

export function arioResolveView(): HTMLElement {
  setActiveNamespaceId('arns');
  queueMicrotask(() => store.navigate('name-resolve'));
  const placeholder = document.createElement('div');
  placeholder.className = 'parsec-view parsec-view--loading';
  return placeholder;
}
