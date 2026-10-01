// PARSEC Wallet — Verify Mnemonic & Set Passphrase

import { exactTextField } from '../lib/phrase-input';
import { el, btn, input, toast } from '../lib/dom';
import { store } from '../lib/store';
import { keystoreStore } from '../lib/keystore';
import { vaultPass, vaultAction } from '../lib/ui/vault-pass';
import { stepStrip } from '../lib/ui/keyreveal';

export function verifyMnemonicView(): HTMLElement {
  const mnemonic = store.getTempMnemonic();
  if (!mnemonic) { store.navigate('onboarding'); return el('div'); }

  const state = store.get();
  const words = mnemonic.split(' ');
  const indices = pickRandom(3, words.length);
  const verifyInputs: HTMLInputElement[] = [];

  const accountIndex = state.accounts.length - 1;
  const account = state.accounts[accountIndex];

  // Create, unlock or reuse the open profile's vault — see lib/ui/vault-pass.ts.
  const vault = vaultPass({ carry: () => account.address, onEnter: () => action.submit() });

  /** Why the words block saving, or '' when all three match. */
  function wordsBlocker(): string {
    const filled = verifyInputs.every((inp) => inp.value.trim());
    if (!filled) return 'Enter the three words from your recovery phrase.';
    const ok = indices.every((idx, i) => verifyInputs[i].value.trim().toLowerCase() === words[idx].toLowerCase());
    return ok ? '' : 'Those words don’t match your recovery phrase. Check the numbers.';
  }

  const action = vaultAction(vault, async () => {
    store.set({ isLoading: true });
    try {
      const pass = await vault.ready();
      await keystoreStore(account.address, mnemonic!, pass, account.name);
      store.setTempMnemonic(null);
      store.setPassphrase(pass);
      vault.wipe();
      // The account just created is the one the participant is working with now.
      // It may have moved to a new vault's profile; find it where it is now.
      const at = store.get().accounts.findIndex((a) => a.address === account.address);
      store.set({ activeAccountIndex: at >= 0 ? at : accountIndex });
      toast('Wallet saved to the vault', 'success');
      // Back to the chain picker: Algorand is done, and adding Solana or
      // Arweave is the next thing a new wallet usually wants.
      store.navigate('create-select');
    } finally {
      store.set({ isLoading: false });
    }
  }, { extra: wordsBlocker });

  return el('div', {
    cls: 'parsec-view parsec-verify parsec-keyflow parsec-vaultflow',
    children: [
      el('div', {
        cls: 'parsec-view__header',
        children: [
          btn('Back', { minimal: true, icon: 'arrow-left', onClick: () => store.navigate('create-wallet') }),
        ],
      }),
      stepStrip(['Address', 'Back up', 'Verify & save'], 2),
      el('h2', { cls: 'parsec-view__title', text: 'Verify Recovery Phrase' }),
      el('p', { cls: 'parsec-view__desc', text: 'Enter the requested words to confirm you saved them.' }),
      el('div', {
        cls: 'parsec-verify__words',
        children: indices.map((idx) => {
          const inp = input({ placeholder: `Word #${idx + 1}`, cls: 'bp5-input parsec-verify__input', onInput: () => action.refresh() });
          exactTextField(inp);
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
      vault.element,
      action.el,
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
