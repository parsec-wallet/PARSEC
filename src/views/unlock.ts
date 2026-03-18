// Parsec Wallet — Unlock View

import { el, btn, input, toast } from '../lib/dom';
import { store } from '../lib/store';
import { keystoreUnlock } from '../lib/keystore';

export function unlockView(): HTMLElement {
  let passphrase = '';

  const passphraseInput = input({
    type: 'password',
    placeholder: 'Enter your passphrase',
    cls: 'bp5-input bp5-large parsec-passphrase-input',
    onInput: (v) => { passphrase = v; },
    onEnter: () => doUnlock(),
  });

  async function doUnlock() {
    if (!passphrase) { toast('Enter your passphrase', 'danger'); return; }
    store.set({ isLoading: true });
    const ok = await keystoreUnlock(passphrase);
    store.set({ isLoading: false });
    if (ok) {
      store.setPassphrase(passphrase);
      store.navigate('dashboard');
    } else {
      toast('Wrong passphrase', 'danger');
    }
  }

  return el('div', {
    cls: 'parsec-view parsec-onboarding',
    children: [
      el('div', {
        cls: 'parsec-onboarding__hero',
        children: [
          el('div', { cls: 'parsec-logo', text: 'PARSEC' }),
          el('p', { cls: 'parsec-onboarding__tagline', text: 'Welcome back' }),
        ],
      }),
      el('div', {
        cls: 'parsec-onboarding__actions',
        children: [
          passphraseInput,
          btn('Unlock', { intent: 'primary', large: true, icon: 'unlock', onClick: doUnlock }),
        ],
      }),
      el('p', {
        cls: 'parsec-onboarding__footer',
        children: [
          el('a', {
            text: 'Import a different wallet',
            attrs: { href: '#' },
            onClick: (e) => { e.preventDefault(); store.navigate('import-wallet'); },
          }),
        ],
      }),
    ],
  });
}
