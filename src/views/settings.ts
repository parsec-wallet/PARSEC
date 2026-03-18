// Parsec Wallet — Settings View

import { el, btn, toast } from '../lib/dom';
import { store } from '../lib/store';
import type { NetworkId } from '../types/wallet';

export function settingsView(): HTMLElement {
  const state = store.get();

  const networkSelect = document.createElement('select');
  networkSelect.className = 'bp5-input parsec-settings__select';
  for (const net of ['mainnet', 'testnet', 'betanet'] as NetworkId[]) {
    const opt = document.createElement('option');
    opt.value = net;
    opt.textContent = net.charAt(0).toUpperCase() + net.slice(1);
    opt.selected = net === state.settings.network;
    networkSelect.appendChild(opt);
  }

  return el('div', {
    cls: 'parsec-view parsec-settings',
    children: [
      el('div', {
        cls: 'parsec-view__header',
        children: [
          btn('Back', { minimal: true, icon: 'arrow-left', onClick: () => store.navigate('dashboard') }),
          el('h2', { cls: 'parsec-view__title', text: 'Settings' }),
        ],
      }),
      el('div', { cls: 'parsec-settings__section', children: [
        el('label', { cls: 'parsec-label', text: 'Network' }),
        networkSelect,
      ]}),
      el('div', { cls: 'parsec-settings__section', children: [
        el('h3', { cls: 'parsec-section-title', text: 'Accounts' }),
        ...state.accounts.map((acct, i) =>
          el('div', {
            cls: `parsec-settings__account ${i === state.activeAccountIndex ? 'parsec-settings__account--active' : ''}`,
            children: [
              el('span', { text: acct.name }),
              el('span', { cls: 'parsec-settings__account-addr', text: `${acct.address.slice(0, 8)}...${acct.address.slice(-4)}` }),
              i !== state.activeAccountIndex
                ? btn('Switch', { minimal: true, onClick: () => { store.set({ activeAccountIndex: i, accountInfo: null, transactions: [] }); store.navigate('dashboard'); } })
                : el('span', { cls: 'parsec-badge', text: 'Active' }),
            ],
          })
        ),
      ]}),
      el('div', { cls: 'parsec-settings__section', children: [
        btn('Create New Account', { outlined: true, icon: 'plus', onClick: () => store.navigate('create-wallet') }),
        btn('Import Account', { outlined: true, icon: 'import', onClick: () => store.navigate('import-wallet') }),
      ]}),
      btn('Save Settings', {
        intent: 'primary',
        onClick: () => {
          const newNetwork = networkSelect.value as NetworkId;
          const changed = newNetwork !== state.settings.network;
          store.set({ settings: { ...state.settings, network: newNetwork }, ...(changed ? { accountInfo: null, transactions: [] } : {}) });
          toast('Settings saved', 'success');
          store.navigate('dashboard');
        },
      }),
      el('div', { cls: 'parsec-settings__section', children: [
        btn('Lock Wallet', { outlined: true, icon: 'lock', onClick: () => { store.lock(); toast('Wallet locked', 'success'); } }),
      ]}),
      el('div', { cls: 'parsec-settings__danger', children: [
        el('h3', { cls: 'parsec-section-title', text: 'Danger Zone' }),
        el('p', { cls: 'parsec-view__desc', text: 'Permanently removes all accounts and keys from this device. You need your recovery phrase to restore.' }),
        btn('Reset Wallet', { intent: 'danger', outlined: true, onClick: () => {
          if (confirm('Delete ALL accounts and keys? Make sure you have your recovery phrase.')) { store.reset(); toast('Wallet reset', 'warning'); }
        }}),
      ]}),
    ],
  });
}
