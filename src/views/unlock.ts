// PARSEC Wallet — Unlock View
//
// Opens the open profile's vault. Names the profile, offers the way to a new
// vault when the passphrase is lost, and always offers the way back to the
// Matrix (link or Escape).

import { el, btn, toast } from '../lib/dom';
import { passphraseField } from '../lib/passphrase-field';
import { store } from '../lib/store';
import { keystoreUnlock } from '../lib/keystore';
import { profileChooser } from '../lib/ui/profile-chooser';
import { matrixEscape } from '../lib/ui/matrix-escape';

export function unlockView(): HTMLElement {
  let passphrase = '';

  const field = passphraseField({
    placeholder: 'Vault passphrase',
    current: true,
    autofocus: true,
    onInput: (v) => { passphrase = v; },
    onEnter: () => doUnlock(),
  });

  function clear(): void {
    passphrase = '\0'.repeat(passphrase.length);
    passphrase = '';
    field.clear();
  }

  async function doUnlock() {
    if (!passphrase) { toast('Enter your passphrase', 'danger'); return; }
    store.set({ isLoading: true });
    const ok = await keystoreUnlock(passphrase);
    store.set({ isLoading: false });
    if (ok) {
      store.setPassphrase(passphrase);
      clear();
      store.navigate('dashboard');
    } else {
      clear();
      toast('Wrong passphrase', 'danger');
    }
  }

  // The forgotten-passphrase path: a new vault beside this one (lib/profiles.ts).
  const forgotBox = el('div', { cls: 'parsec-onboarding__actions' });
  const forgot = el('a', {
    text: 'Forgot the passphrase? Create a new vault',
    attrs: { href: '#' },
    onClick: (e) => {
      e.preventDefault();
      clear();
      forgotBox.replaceChildren(
        el('p', { cls: 'parsec-view__desc', text: 'A vault passphrase cannot be recovered or reset. Create a new vault, then restore '
          + `your wallets into it from their recovery phrases. Profile “${store.profile}” stays on this device untouched.` }),
        profileChooser({ compact: true, startCreating: true, onChanged: () => store.navigate('matrix') }),
      );
    },
  });


  return el('div', {
    cls: 'parsec-view parsec-onboarding parsec-vaultflow',
    children: [
      el('div', {
        cls: 'parsec-onboarding__hero',
        children: [
          el('div', { cls: 'parsec-logo', text: 'PARSEC' }),
          el('p', { cls: 'parsec-onboarding__tagline', text: 'Welcome back' }),
          el('p', { cls: 'parsec-matrix__profile', children: ['Profile', el('strong', { text: store.profile })] }),
        ],
      }),
      el('div', {
        cls: 'parsec-onboarding__actions',
        children: [
          field.el,
          btn('Unlock', { intent: 'primary', large: true, icon: 'unlock', onClick: doUnlock }),
        ],
      }),
      el('p', { cls: 'parsec-matrix__profile', children: [forgot] }),
      forgotBox,
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
      matrixEscape(clear),
    ],
  });
}
