// Parsec Wallet — Verify Mnemonic & Set Passphrase

import { el, btn, input, toast } from '../lib/dom';
import { store } from '../lib/store';
import { keystoreCreate, keystoreStatus, keystoreStore, keystoreUnlock } from '../lib/keystore';
import { stepStrip } from '../lib/ui/keyreveal';

export function verifyMnemonicView(): HTMLElement {
  const mnemonic = store.getTempMnemonic();
  if (!mnemonic) { store.navigate('onboarding'); return el('div'); }

  const state = store.get();
  const words = mnemonic.split(' ');
  const indices = pickRandom(3, words.length);
  const verifyInputs: HTMLInputElement[] = [];
  let passphrase = '', passphraseConfirm = '';

  const accountIndex = state.accounts.length - 1;
  const account = state.accounts[accountIndex];

  // Where the key goes depends on the vault this device already has:
  //   none              → set a new passphrase, create the vault, store the key;
  //   exists, unlocked  → store the key in it; no passphrase asked;
  //   exists, locked    → unlock it with its passphrase, then store the key.
  // Creating a second vault over an existing one is refused by the vault
  // ("vault already exists"), which is what made adding a second Algorand
  // account fail at the very last step.
  type VaultMode = 'checking' | 'new' | 'unlocked' | 'locked';
  let mode: VaultMode = store.getPassphrase() ? 'unlocked' : 'checking';

  const passBox = el('div', { cls: 'parsec-verify__pass' });
  const status = el('p', { cls: 'parsec-keyflow__status', attrs: { 'aria-live': 'polite' } });

  function renderPass(): void {
    passBox.innerHTML = '';
    if (mode === 'checking') {
      passBox.appendChild(el('p', { cls: 'parsec-view__desc', text: 'Checking this device\'s vault…' }));
    } else if (mode === 'unlocked') {
      passBox.append(
        el('h3', { cls: 'parsec-view__subtitle', text: 'Vault' }),
        el('p', { cls: 'parsec-view__desc', text: 'Your vault is unlocked. The new account is added to it under your existing passphrase.' }),
      );
    } else if (mode === 'locked') {
      passBox.append(
        el('h3', { cls: 'parsec-view__subtitle', text: 'Unlock your vault' }),
        el('p', { cls: 'parsec-view__desc', text: 'This device already has a vault. Enter its passphrase; the new account is added to it.' }),
        input({ type: 'password', placeholder: 'Vault passphrase', cls: 'bp5-input bp5-large parsec-passphrase-input', onInput: (v) => { passphrase = v; } }),
      );
    } else {
      passBox.append(
        el('h3', { cls: 'parsec-view__subtitle', text: 'Set Passphrase' }),
        el('p', { cls: 'parsec-view__desc', text: 'This passphrase encrypts your keys on this device. If you lose it, re-import using your recovery phrase.' }),
        input({ type: 'password', placeholder: 'Enter a strong passphrase', cls: 'bp5-input bp5-large parsec-passphrase-input', onInput: (v) => { passphrase = v; } }),
        input({ type: 'password', placeholder: 'Confirm passphrase', cls: 'bp5-input bp5-large parsec-passphrase-input', onInput: (v) => { passphraseConfirm = v; } }),
      );
    }
  }
  renderPass();
  if (mode === 'checking') {
    keystoreStatus()
      .then((st) => { mode = st.exists ? (st.unlocked && store.getPassphrase() ? 'unlocked' : 'locked') : 'new'; renderPass(); })
      .catch(() => { mode = 'new'; renderPass(); });
  }

  function fail(message: string): void {
    status.textContent = message;
    status.classList.add('parsec-keyflow__status--error');
  }

  async function complete(): Promise<void> {
    status.textContent = '';
    status.classList.remove('parsec-keyflow__status--error');
    const verified = indices.every((idx, i) => verifyInputs[i].value.trim().toLowerCase() === words[idx].toLowerCase());
    if (!verified) { fail('Those words don\'t match. Check your recovery phrase.'); return; }
    if (mode === 'checking') { fail('Still checking the vault — try again in a moment.'); return; }

    let pass = '';
    if (mode === 'unlocked') {
      pass = store.getPassphrase() ?? '';
    } else if (mode === 'locked') {
      if (!passphrase) { fail('Enter your vault passphrase.'); return; }
      pass = passphrase;
    } else {
      if (passphrase.length < 8) { fail('Passphrase must be at least 8 characters.'); return; }
      if (passphrase !== passphraseConfirm) { fail('Passphrases don\'t match.'); return; }
      pass = passphrase;
    }

    store.set({ isLoading: true });
    status.textContent = 'Saving to the vault…';
    try {
      if (mode === 'new') {
        await keystoreCreate(pass);
      } else if (mode === 'locked') {
        if (!(await keystoreUnlock(pass))) { store.set({ isLoading: false }); fail('That passphrase did not unlock the vault.'); return; }
      }
      await keystoreStore(account.address, mnemonic!, pass, account.name);
      store.setTempMnemonic(null);
      store.setPassphrase(pass);
      // The account just created is the one the participant is working with now.
      store.set({ isLoading: false, activeAccountIndex: accountIndex });
      toast('Wallet created', 'success');
      // Back to the chain picker: Algorand is done, and adding Solana or
      // Arweave is the next thing a new wallet usually wants.
      store.navigate('create-select');
    } catch (e) {
      store.set({ isLoading: false });
      fail(`Could not save the key: ${e instanceof Error ? e.message : String(e)}`);
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
