// Unified resolver — looks up a name on the active adapter, shows the
// root @ + undername table, optionally opens the target.

import { el, btn, input, toast } from '../lib/dom';
import { store } from '../lib/store';
import {
  activeNamespaceId,
  getNamespace,
  listNamespaces,
  setActiveNamespaceId,
  type NormalizedRecord,
} from '../lib/namespaces';

export function nameResolveView(): HTMLElement {
  const root = el('div', { cls: 'parsec-view parsec-confirm' });
  let name = '';
  const ns = getNamespace(activeNamespaceId());

  root.appendChild(el('div', {
    cls: 'parsec-view__header',
    children: [
      btn('Back', { minimal: true, icon: 'arrow-left', onClick: () => store.navigate('name-hub') }),
      el('h2', { cls: 'parsec-view__title', text: ns ? `Resolve · ${ns.displayName}` : 'Resolve a name' }),
    ],
  }));

  const adapters = listNamespaces();
  const switcher = el('select', {
    cls: 'bp5-input',
    children: adapters.map((a) => el('option', {
      attrs: { value: a.id, ...(a.id === ns?.id ? { selected: 'selected' } : {}) },
      text: a.displayName,
    })),
  }) as HTMLSelectElement;
  switcher.addEventListener('change', () => {
    setActiveNamespaceId(switcher.value);
    store.navigate('dashboard');
    requestAnimationFrame(() => store.navigate('name-resolve'));
  });

  const result = el('div', { cls: 'parsec-confirm__details' });
  const nameInput = input({
    placeholder: 'name (e.g. pythai)',
    cls: 'bp5-input bp5-large bp5-fill',
    onInput: (v) => { name = v.toLowerCase().trim(); },
    onEnter: () => void runResolve(),
  });

  root.appendChild(el('div', {
    cls: 'parsec-confirm__details',
    children: [el('label', { text: 'Namespace' }), switcher],
  }));
  root.appendChild(nameInput);
  root.appendChild(el('div', {
    cls: 'parsec-confirm__actions',
    children: [btn('Resolve', { intent: 'primary', large: true, onClick: () => void runResolve() })],
  }));
  root.appendChild(result);

  async function runResolve(): Promise<void> {
    if (!name) { toast('Enter a name', 'warning'); return; }
    if (!ns) { toast('No adapter selected', 'warning'); return; }
    result.innerHTML = '';
    result.appendChild(el('p', { text: 'Resolving...' }));
    try {
      const r = await ns.getRecord(name);
      result.innerHTML = '';
      if (!r) {
        result.appendChild(el('p', { cls: 'parsec-empty', text: `"${name}" is not registered on ${ns.displayName}.` }));
        return;
      }
      renderResolved(result, r);
    } catch (e) {
      result.innerHTML = '';
      result.appendChild(el('p', { cls: 'parsec-empty', text: `Resolve failed: ${e instanceof Error ? e.message : String(e)}` }));
    }
  }

  return root;
}

function renderResolved(container: HTMLElement, r: NormalizedRecord): void {
  container.appendChild(row('Name', r.name));
  container.appendChild(row('Owner', truncAddr(r.owner)));
  container.appendChild(row('Type', r.type + (r.endTimestamp ? ` (expires ${new Date(r.endTimestamp).toLocaleDateString()})` : '')));
  container.appendChild(row('Root target (@)', r.rootTarget ?? '— not set —'));
  container.appendChild(row('TTL', `${r.rootTtl}s`));

  if (r.rootTarget) {
    container.appendChild(el('a', {
      attrs: {
        href: `https://${r.rootTarget}.arweave.net`,
        target: '_blank',
        rel: 'noopener',
        class: 'bp5-button bp5-intent-primary',
      },
      text: 'Open @ target on Arweave →',
    }));
  }

  const subs = Object.entries(r.undernames);
  if (subs.length > 0) {
    container.appendChild(el('h4', { text: 'Undernames' }));
    for (const [sub, val] of subs) container.appendChild(row(sub, truncAddr(val.transactionId)));
  }
}

function row(label: string, value: string): HTMLElement {
  return el('div', {
    cls: 'parsec-confirm__row',
    children: [
      el('span', { cls: 'parsec-confirm__label', text: label }),
      el('span', { cls: 'parsec-confirm__value', text: value }),
    ],
  });
}

function truncAddr(a: string): string {
  if (!a) return '—';
  if (a.length <= 16) return a;
  return `${a.slice(0, 8)}...${a.slice(-6)}`;
}
