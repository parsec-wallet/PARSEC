// Parsec Wallet — Verify Mnemonic & Set Passphrase

import { el, btn, input, toast } from '../lib/dom';
import { store } from '../lib/store';
import { keystoreCreate, keystoreStore } from '../lib/keystore';

export function verifyMnemonicView(): HTMLElement {
  const mnemonic = store.getTempMnemonic();
  if (!mnemonic) { store.navigate('onboarding'); return el('div'); }

  const state = store.get();
  const words = mnemonic.split(' ');
  const indices = pickRandom(3, words.length);
  const verifyInputs: HTMLInputElement[] = [];
  let passphrase = '', passphraseConfirm = '';

  const account = state.accounts[state.accounts.length - 1];

  return el('div', {
    cls: 'parsec-view parsec-verify',
    children: [
      el('div', {
        cls: 'parsec-view__header',
        children: [
          btn('Back', { minimal: true, icon: 'arrow-left', onClick: () => store.navigate('create-wallet') }),
        ],
      }),
      el('h2', { cls: 'parsec-view__title', text: 'Verify Recovery Phrase' }),
      el('p', { cls: 'parsec-view__desc', text: 'Enter the requested words to confirm you saved them.' }),
      el('div', {
        cls: 'parsec-verify__words',
        children: indices.map((idx) => {
          const inp = input({ placeholder: `Word #${idx + 1}`, cls: 'bp5-input parsec-verify__input' });
          verifyInputs.push(inp);
          return el('div', {
            cls: 'parsec-verify__word-row',
            children: [
              el('span', { cls: 'parsec-verify__word-num', text: `${idx + 1}.` }),
              inp,
            ],
          });
        }),
      }),
      el('h3', { cls: 'parsec-view__subtitle', text: 'Set Passphrase' }),
      el('p', { cls: 'parsec-view__desc', text: 'This passphrase encrypts your keys on this device. If you lose it, re-import using your recovery phrase.' }),
      input({ type: 'password', placeholder: 'Enter a strong passphrase', cls: 'bp5-input bp5-large parsec-passphrase-input', onInput: (v) => { passphrase = v; } }),
      input({ type: 'password', placeholder: 'Confirm passphrase', cls: 'bp5-input bp5-large parsec-passphrase-input', onInput: (v) => { passphraseConfirm = v; } }),
      btn('Complete Setup', {
        intent: 'success', large: true, cls: 'parsec-verify__submit',
        onClick: async () => {
          const verified = indices.every((idx, i) => verifyInputs[i].value.trim().toLowerCase() === words[idx].toLowerCase());
          if (!verified) { toast('Words don\'t match. Check your recovery phrase.', 'danger'); return; }
          if (passphrase.length < 8) { toast('Passphrase must be at least 8 characters.', 'danger'); return; }
          if (passphrase !== passphraseConfirm) { toast('Passphrases don\'t match.', 'danger'); return; }

          store.set({ isLoading: true });
          try {
            await keystoreCreate(passphrase);
            await keystoreStore(account.address, mnemonic, passphrase, account.name);
            store.setTempMnemonic(null);
            store.setPassphrase(passphrase);
            store.set({ isLoading: false });
            toast('Wallet created successfully', 'success');
            // Back to the chain picker: Algorand is done, and adding Solana or
            // Arweave is the next thing a new wallet usually wants.
            store.navigate('create-select');
          } catch {
            store.set({ isLoading: false });
            toast('Failed to encrypt keys. Try again.', 'danger');
          }
        },
      }),
    ],
  });
}

function pickRandom(count: number, max: number): number[] {
  const result: number[] = [];
  while (result.length < count) {
    const n = Math.floor(Math.random() * max);
    if (!result.includes(n)) result.push(n);
  }
  return result.sort((a, b) => a - b);
}
