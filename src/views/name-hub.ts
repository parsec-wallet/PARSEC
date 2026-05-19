// Unified namespace hub. The active adapter is selected via
// sessionStorage['parsec:namespace-id'] (default: 'bankon').
// Replaces the bankon-hub and ario-hub duplicates.

import { el, btn, toast } from '../lib/dom';
import { store, getAccountAddress } from '../lib/store';
import {
  activeNamespaceId,
  getNamespace,
  listNamespaces,
  setActiveNamespaceId,
  type NamespaceAdapter,
  type NormalizedRecord,
} from '../lib/namespaces';

export function nameHubView(): HTMLElement {
  const state = store.get();
  const account = state.accounts[state.activeAccountIndex];
  const address = account
    ? (getAccountAddress(account, 'arweave-hd') ?? getAccountAddress(account, 'arweave'))
    : undefined;

  const root = el('div', { cls: 'parsec-view parsec-confirm' });
  const ns = getNamespace(activeNamespaceId());

  root.appendChild(el('div', {
    cls: 'parsec-view__header',
    children: [
      btn('Back', { minimal: true, icon: 'arrow-left', onClick: () => store.navigate('dashboard') }),
      el('h2', { cls: 'parsec-view__title', text: ns?.displayName ?? 'Names' }),
    ],
  }));

  // Namespace switcher — surfaces every registered adapter.
  const adapters = listNamespaces();
  const switcher = el('select', {
    cls: 'bp5-input',
    children: adapters.map((a) =>
      el('option', {
        attrs: { value: a.id, ...(a.id === ns?.id ? { selected: 'selected' } : {}) },
        text: a.displayName,
      }),
    ),
  }) as HTMLSelectElement;
  switcher.addEventListener('change', () => {
    setActiveNamespaceId(switcher.value);
    store.navigate('dashboard');                          // force re-render
    requestAnimationFrame(() => store.navigate('name-hub'));
  });
  root.appendChild(el('div', {
    cls: 'parsec-confirm__details',
    children: [el('label', { text: 'Namespace' }), switcher],
  }));

  if (!ns) {
    root.appendChild(el('p', { cls: 'parsec-empty', text: `No adapter registered for "${activeNamespaceId()}".` }));
    return root;
  }
  if (!address) {
    root.appendChild(el('div', {
      cls: 'parsec-callout bp5-callout bp5-intent-warning',
      children: [
        el('p', { text: 'No Arweave address on the active account.' }),
        btn('Create Arweave', { intent: 'primary', onClick: () => store.navigate('arweave-create') }),
      ],
    }));
    return root;
  }

  // Owned-names list.
  const ownedSection = el('div', {
    cls: 'parsec-confirm__details',
    children: [el('h4', { text: 'Names you own' }), el('p', { text: 'Loading...' })],
  });
  root.appendChild(ownedSection);
  void renderOwned(ns, address, ownedSection);

  root.appendChild(el('div', {
    cls: 'parsec-confirm__actions',
    children: [
      btn('Claim a Name', {
        intent: 'primary',
        large: true,
        icon: 'tag',
        onClick: () => store.navigate('name-claim'),
      }),
      btn('Resolve', {
        outlined: true,
        large: true,
        icon: 'search',
        onClick: () => store.navigate('name-resolve'),
      }),
      btn('Refresh', {
        minimal: true,
        icon: 'refresh',
        onClick: () => {
          ownedSection.innerHTML = '';
          ownedSection.appendChild(el('h4', { text: 'Names you own' }));
          ownedSection.appendChild(el('p', { text: 'Loading...' }));
          void renderOwned(ns, address, ownedSection);
        },
      }),
    ],
  }));

  return root;
}

async function renderOwned(ns: NamespaceAdapter, address: string, section: HTMLElement): Promise<void> {
  try {
    const items = await ns.getOwnedRecords(address);
    section.innerHTML = '';
    section.appendChild(el('h4', { text: `Names you own (${items.length})` }));
    if (items.length === 0) {
      section.appendChild(el('p', { cls: 'parsec-empty', text: 'No names yet. Click "Claim a Name" to start.' }));
      return;
    }
    for (const item of items) section.appendChild(renderNameRow(item));
  } catch (e) {
    section.innerHTML = '';
    section.appendChild(el('h4', { text: 'Names you own' }));
    section.appendChild(el('p', {
      cls: 'parsec-empty',
      text: `Could not load: ${e instanceof Error ? e.message : String(e)}`,
    }));
  }
}

function renderNameRow(record: NormalizedRecord): HTMLElement {
  return el('div', {
    cls: 'parsec-confirm__row',
    children: [
      el('span', { cls: 'parsec-confirm__label', text: record.name }),
      el('span', {
        cls: 'parsec-confirm__value',
        children: [
          el('span', { text: `${record.type}${record.endTimestamp ? ` · expires ${new Date(record.endTimestamp).toLocaleDateString()}` : ''}` }),
          btn('Manage', {
            minimal: true,
            onClick: () => {
              sessionStorage.setItem('parsec:active-name', record.name);
              store.navigate('name-manage');
            },
          }),
          record.rootTarget
            ? btn('Copy @', {
                minimal: true,
                onClick: () => {
                  void navigator.clipboard.writeText(record.rootTarget!);
                  toast('@ target copied', 'success');
                },
              })
            : el('span', {}),
        ],
      }),
    ],
  });
}
