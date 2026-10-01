// PARSEC Wallet — NFDminter entry view.
// Four tabs: Claim · Search · My Names · Subdomains. Each tab swaps its body
// into the body container without navigating — heavier flows (review-and-
// sign) get their own AppView via store.navigate. Tabs can also hand off to
// one another (Search → Claim) through the `switchTab` callback.

import { el, btn } from '../lib/dom';
import { store } from '../lib/store';
import { buildMintTab } from './nfdominter-mint';
import { buildNamesTab } from './nfdominter-manage';
import { buildSubdomainsTab } from './nfdominter-subdomains';

export type NfdominterTab = 'mint' | 'names' | 'subdomains';

let activeTab: NfdominterTab = 'mint';

export function nfdominterView(): HTMLElement {
  const state = store.get();
  const account = state.accounts[state.activeAccountIndex];

  if (!account) {
    store.navigate('onboarding');
    return el('div');
  }
  const network = state.settings.network;

  const body = el('div', { cls: 'parsec-nfdominter__body' });

  const tabs: { id: NfdominterTab; label: string; icon: string }[] = [
    { id: 'mint', label: 'Claim', icon: 'search' },
    { id: 'names', label: 'My Names', icon: 'tag' },
    { id: 'subdomains', label: 'Subdomains', icon: 'diagram-tree' },
  ];

  const tabButtons: Record<NfdominterTab, HTMLButtonElement> = {} as Record<NfdominterTab, HTMLButtonElement>;

  const switchTab = (tab: NfdominterTab): void => { activeTab = tab; renderBody(); };

  const renderBody = (): void => {
    body.innerHTML = '';
    switch (activeTab) {
      case 'mint':
        body.appendChild(buildMintTab(account.address, network));
        break;
      case 'names':
        body.appendChild(buildNamesTab(account.address, network, switchTab));
        break;
      case 'subdomains':
        body.appendChild(buildSubdomainsTab(account.address, network, switchTab));
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
        onClick: () => switchTab(t.id),
      });
      tabButtons[t.id] = b;
      return b;
    }),
  });

  const header = el('div', {
    cls: 'parsec-view__header',
    children: [
      btn('Back', { minimal: true, icon: 'arrow-left', onClick: () => { if (!store.back()) store.navigate('dashboard'); } }),
      el('span', {
        cls: `parsec-network-badge parsec-network-badge--${network}`,
        text: network.toUpperCase(),
      }),
    ],
  });

  const tagline = el('section', { cls: 'parsec-nfdominter__hero', children: [
    el('p', { cls: 'parsec-nfdominter__kicker', text: 'Algorand · NFD registry' }),
    el('h2', { cls: 'parsec-nfdominter__h', text: '.ALGO NAMES' }),
    el('p', { cls: 'parsec-nfdominter__lede', text: 'A name your wallet answers to. Claim one, manage the ones you hold, and issue subdomains. Registered on the NFD contracts on Algorand; the name is yours, in your wallet.' }),
  ] });

  renderBody();

  return el('div', {
    cls: 'parsec-view parsec-nfdominter parsec-nfdominter--wide',
    children: [header, tagline, tabBar, body],
  });
}
