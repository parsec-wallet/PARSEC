// Parsec Wallet — Receive View

import { el, btn, toast } from '../lib/dom';
import { store } from '../lib/store';

export function receiveView(): HTMLElement {
  const state = store.get();
  const account = state.accounts[state.activeAccountIndex];

  if (!account) {
    store.navigate('onboarding');
    return el('div');
  }

  return el('div', {
    cls: 'parsec-view parsec-receive',
    children: [
      el('div', {
        cls: 'parsec-view__header',
        children: [
          btn('Back', {
            minimal: true,
            icon: 'arrow-left',
            onClick: () => store.navigate('dashboard'),
          }),
          el('h2', { cls: 'parsec-view__title', text: 'Receive ALGO' }),
        ],
      }),
      el('p', {
        cls: 'parsec-view__desc',
        text: 'Share your public address to receive ALGO or ASAs.',
      }),
      el('div', {
        cls: 'parsec-receive__address-box',
        children: [
          el('div', { cls: 'parsec-receive__label', text: 'Your Algorand Address' }),
          el('div', {
            cls: 'parsec-receive__address',
            text: account.address,
          }),
        ],
      }),
      btn('Copy Address', {
        intent: 'primary',
        large: true,
        icon: 'clipboard',
        onClick: () => {
          navigator.clipboard.writeText(account.address);
          toast('Address copied to clipboard', 'success');
        },
      }),
      el('p', {
        cls: 'parsec-view__desc parsec-receive__note',
        text: 'Only send Algorand (ALGO) and Algorand Standard Assets (ASAs) to this address.',
      }),
    ],
  });
}
