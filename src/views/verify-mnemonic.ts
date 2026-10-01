// PARSEC Wallet — Verify Mnemonic & Set Passphrase

import { el, btn, input, toast } from '../lib/dom';
import { store } from '../lib/store';
import { keystoreStore } from '../lib/keystore';
import { vaultPass } from '../lib/ui/vault-pass';
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
  const vault = vaultPass({ carry: () => account.address });
  const passBox = vault.element;
  const status = el('p', { cls: 'parsec-keyflow__status', attrs: { 'aria-live': 'polite' } });

  function fail(message: string): void {
    status.textContent = message;
    status.classList.add('parsec-keyflow__status--error');
  }

  async function complete(): Promise<void> {
    status.textContent = '';
    status.classList.remove('parsec-keyflow__status--error');
    const verified = indices.every((idx, i) => verifyInputs[i].value.trim().toLowerCase() === words[idx].toLowerCase());
    if (!verified) { fail('Those words don\'t match. Check your recovery phrase.'); return; }

    store.set({ isLoading: true });
    status.textContent = 'Saving to the vault…';
    try {
      const pass = await vault.ready();
      await keystoreStore(account.address, mnemonic!, pass, account.name);
      store.setTempMnemonic(null);
      store.setPassphrase(pass);
      // The account just created is the one the participant is working with now.
      // The account may have moved to a new vault's profile; find it where it is now.
      const at = store.get().accounts.findIndex((a) => a.address === account.address);
      store.set({ isLoading: false, activeAccountIndex: at >= 0 ? at : accountIndex });
      toast('Wallet created', 'success');
      // Back to the chain picker: Algorand is done, and adding Solana or
      // Arweave is the next thing a new wallet usually wants.
      store.navigate('create-select');
    } catch (e) {
      store.set({ isLoading: false });
      fail(e instanceof Error ? e.message : String(e));
    }
  }

  return el('div', {
    cls: 'parsec-view parsec-verify parsec-keyflow',
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
      passBox,
      btn('Complete Setup', {
        intent: 'success', large: true, cls: 'parsec-verify__submit',
        onClick: () => { void complete(); },
      }),
      status,
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
