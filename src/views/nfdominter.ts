// Parsec Wallet — NFDominter entry view.
// Four tabs: Mint · Search · Mine · Manage. Each tab swaps its body into
// the #parsec-nfdominter__body container without navigating — heavier
// flows (review-and-sign) get their own AppView via store.navigate.

import { el, btn } from '../lib/dom';
import { store } from '../lib/store';
import { buildMintTab } from './nfdominter-mint';
import { buildSearchTab } from './nfdominter-search';
import { buildMineTab } from './nfdominter-manage';

type Tab = 'mint' | 'search' | 'mine' | 'manage';

let activeTab: Tab = 'mint';

export function nfdominterView(): HTMLElement {
  const state = store.get();
  const account = state.accounts[state.activeAccountIndex];

  if (!account) {
    store.navigate('onboarding');
    return el('div');
  }

  const body = el('div', { cls: 'parsec-nfdominter__body' });

  const tabs: { id: Tab; label: string; icon: string }[] = [
    { id: 'mint', label: 'Mint', icon: 'plus' },
    { id: 'search', label: 'Search', icon: 'search' },
    { id: 'mine', label: 'Mine', icon: 'tag' },
    { id: 'manage', label: 'Manage', icon: 'cog' },
  ];

  const tabButtons: Record<Tab, HTMLButtonElement> = {} as Record<Tab, HTMLButtonElement>;

  const renderBody = () => {
    body.innerHTML = '';
    switch (activeTab) {
      case 'mint':
        body.appendChild(buildMintTab(account.address, state.settings.network));
        break;
      case 'search':
        body.appendChild(buildSearchTab(state.settings.network));
        break;
      case 'mine':
        body.appendChild(buildMineTab(account.address, state.settings.network, 'mine'));
        break;
      case 'manage':
        body.appendChild(buildMineTab(account.address, state.settings.network, 'manage'));
        break;
    }
    for (const t of tabs) {
      tabButtons[t.id].classList.toggle('parsec-nfdominter__tab--active', t.id === activeTab);
    }
  };

  const tabBar = el('div', {
    cls: 'parsec-nfdominter__tabs',
    children: tabs.map((t) => {
      const b = btn(t.label, {
        minimal: true,
        icon: t.icon,
        cls: 'parsec-nfdominter__tab',
        onClick: () => { activeTab = t.id; renderBody(); },
      });
      tabButtons[t.id] = b;
      return b;
    }),
  });

  const header = el('div', {
    cls: 'parsec-view__header',
    children: [
      btn('Back', { minimal: true, icon: 'arrow-left', onClick: () => store.navigate('dashboard') }),
      el('h2', { cls: 'parsec-view__title', text: 'NFDominter' }),
      el('span', {
        cls: `parsec-network-badge parsec-network-badge--${state.settings.network}`,
        text: state.settings.network.toUpperCase(),
      }),
    ],
  });

  const tagline = el('p', {
    cls: 'parsec-view__desc',
    text: 'Mint and manage .algo names. Powered by NFD contracts on Algorand — hosted in Parsec by BANKON.',
  });

  renderBody();

  return el('div', {
    cls: 'parsec-view parsec-nfdominter',
    children: [header, tagline, tabBar, body],
  });
}
