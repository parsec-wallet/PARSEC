// Parsec Wallet — Onboarding View
// Shows unlock for returning participants, create/import for new ones.

import { el, btn, input, toast } from '../lib/dom';
import { store } from '../lib/store';
import { hasVault } from '../lib/crypto';
import { isTauri } from '../lib/vault';
import { keystoreUnlock } from '../lib/keystore';

export function onboardingView(): HTMLElement {
  const hasAccounts = store.get().accounts.length > 0;
  const hasKeys = isTauri() || hasVault();
  const isReturning = hasAccounts && hasKeys;

  let passphrase = '';

  const children: HTMLElement[] = [
    el('div', {
      cls: 'parsec-onboarding__hero',
      children: [
        el('div', { cls: 'parsec-logo', text: 'PARSEC' }),
        el('p', { cls: 'parsec-onboarding__tagline', text: 'Sovereign Algorand Wallet' }),
        el('p', { cls: 'parsec-onboarding__sub', text: 'Your keys. Your coins. No compromises.' }),
      ],
    }),
  ];

  if (isReturning) {
    // Returning participant — unlock with passphrase
    const passInput = input({
      type: 'password',
      placeholder: 'Enter passphrase to unlock',
      cls: 'bp5-input bp5-large parsec-passphrase-input',
      onInput: (v) => { passphrase = v; },
      onEnter: () => doUnlock(),
    });

    children.push(el('div', {
      cls: 'parsec-onboarding__actions',
      children: [
        passInput,
        btn('Unlock Wallet', {
          intent: 'primary',
          large: true,
          icon: 'unlock',
          onClick: doUnlock,
        }),
        el('div', { cls: 'parsec-onboarding__divider', text: 'or' }),
        btn('Create New Wallet', {
          large: true,
          outlined: true,
          icon: 'plus',
          onClick: () => store.navigate('create-wallet'),
        }),
        btn('Import Existing Wallet', {
          large: true,
          outlined: true,
          icon: 'import',
          onClick: () => store.navigate('import-wallet'),
        }),
      ],
    }));

    // Focus the passphrase input
    setTimeout(() => passInput.focus(), 100);
  } else {
    // New participant — create or import
    children.push(el('div', {
      cls: 'parsec-onboarding__actions',
      children: [
        btn('Create New Wallet', {
          intent: 'primary',
          large: true,
          icon: 'plus',
          onClick: () => store.navigate('create-wallet'),
        }),
        btn('Import Existing Wallet', {
          large: true,
          outlined: true,
          icon: 'import',
          onClick: () => store.navigate('import-wallet'),
        }),
      ],
    }));
  }

  children.push(el('p', {
    cls: 'parsec-onboarding__footer',
    children: [
      'Keys are generated and encrypted locally. They never leave your device. ',
      el('a', {
        text: 'Read the docs',
        attrs: { href: '#' },
        onClick: (e) => { e.preventDefault(); store.navigate('docs'); },
      }),
    ],
  }));

  async function doUnlock() {
    if (!passphrase || passphrase.length < 8) {
      toast('Enter your passphrase', 'danger');
      return;
    }
    store.set({ isLoading: true });
    const ok = await keystoreUnlock(passphrase);
    store.set({ isLoading: false });
    if (ok) {
      store.setPassphrase(passphrase);
      passphrase = '';
      store.navigate('dashboard');
    } else {
      toast('Wrong passphrase', 'danger');
      passphrase = '';
    }
  }

  return el('div', { cls: 'parsec-view parsec-onboarding', children });
}
