// PARSEC Wallet — Import Wallet View
// Accepts: 25-word mnemonic, base64 private key, or watch-only address.
// Live input classification with validation feedback.

import { el, btn, toast } from '../lib/dom';
import { store } from '../lib/store';
import { classifyInput } from '../lib/algorand/validate';
import type { ClassifiedInput } from '../lib/algorand/validate';
import { keystoreStore } from '../lib/keystore';
import { vaultPass } from '../lib/ui/vault-pass';
import algosdk from 'algosdk';

export function importWalletView(): HTMLElement {
  let secret = '';
  let lastClassification: ClassifiedInput = { kind: 'unknown', confidence: 0, reason: '', valid: false };

  const secretArea = document.createElement('textarea');
  secretArea.className = 'bp5-input parsec-import__textarea';
  secretArea.placeholder = 'Paste your 25-word recovery phrase, private key, or Algorand address';
  secretArea.rows = 4;
  secretArea.spellcheck = false;
  secretArea.autocomplete = 'off';
  secretArea.setAttribute('data-lpignore', 'true');

  const detectionHint = el('div', { cls: 'parsec-import__hint' });
  const addressPreview = el('div', { cls: 'parsec-import__address-preview' });

  secretArea.addEventListener('input', () => {
    secret = secretArea.value;
    lastClassification = classifyInput(secret);
    renderClassification(lastClassification, detectionHint, addressPreview);
    // A watch-only address stores no key, so no vault passphrase is asked.
    passphraseSection.style.display = lastClassification.kind === 'algorand_address' ? 'none' : '';
  });

  // Which vault the key goes into, and its passphrase — lib/ui/vault-pass.ts.
  // Not needed for a watch-only address, which stores no key.
  const vault = vaultPass();
  const passphraseSection = el('div', { cls: 'parsec-import__passphrase-section', children: [vault.element] });

  return el('div', {
    cls: 'parsec-view parsec-import',
    children: [
      el('div', {
        cls: 'parsec-view__header',
        children: [
          btn('Back', {
            minimal: true, icon: 'arrow-left',
            onClick: () => store.navigate(store.get().accounts.length > 0 ? 'unlock' : 'onboarding'),
          }),
        ],
      }),
      el('h2', { cls: 'parsec-view__title', text: 'Import Wallet' }),
      el('p', { cls: 'parsec-view__desc', text: 'Paste your recovery phrase, private key, or address from any Algorand wallet.' }),
      el('div', {
        cls: 'parsec-callout bp5-callout bp5-intent-warning',
        children: [el('p', { text: 'Your secret is encrypted locally and never sent anywhere.' })],
      }),
      secretArea,
      detectionHint,
      addressPreview,
      passphraseSection,
      btn('Import', { intent: 'primary', large: true, cls: 'parsec-import__submit', onClick: doImport }),
    ],
  });

  async function doImport() {
    if (!lastClassification.valid) {
      toast(lastClassification.reason || 'Invalid input', 'danger');
      return;
    }

    const state = store.get();
    const isWatchOnly = lastClassification.kind === 'algorand_address';
    const address = lastClassification.address!;

    // Duplicate check
    if (state.accounts.some(a => a.address === address)) {
      toast('This account is already imported.', 'warning');
      return;
    }

    if (isWatchOnly) {
      // Watch-only: no passphrase needed, no key stored
      store.set({
        accounts: [...state.accounts, { address, name: `Account ${state.accounts.length + 1} (watch)`, createdAt: Date.now(), watchOnly: true }],
      });
      store.setPassphrase('__watch_only__');
      toast('Watch-only account added', 'success');
      store.navigate('dashboard');
      return;
    }

    // Recover mnemonic
    let mnemonic = '';
    if (lastClassification.kind === 'algorand_mnemonic') {
      mnemonic = secret.trim();
    } else if (lastClassification.kind === 'algorand_private_key') {
      const keyBytes = Uint8Array.from(atob(secret.trim()), c => c.charCodeAt(0));
      mnemonic = algosdk.secretKeyToMnemonic(keyBytes);
    }

    store.set({ isLoading: true });
    try {
      const passphrase = await vault.ready();
      // Read the list again: "Create a new vault" may have switched profile.
      const accounts = store.get().accounts;
      await keystoreStore(address, mnemonic, passphrase, `Account ${accounts.length + 1}`);
      store.set({
        accounts: [...accounts, { address, name: `Account ${accounts.length + 1}`, createdAt: Date.now() }],
        isLoading: false,
      });
      store.setPassphrase(passphrase);
      secretArea.value = ''; secret = '';
      toast('Wallet imported', 'success');
      store.navigate('dashboard');
    } catch (err) {
      store.set({ isLoading: false });
      toast(err instanceof Error ? err.message : 'Failed to encrypt keys', 'danger', 8000);
    }
  }
}

function renderClassification(c: ClassifiedInput, hint: HTMLElement, preview: HTMLElement): void {
  if (c.kind === 'unknown' && c.confidence === 0) {
    hint.textContent = '';
    hint.className = 'parsec-import__hint';
    preview.textContent = '';
    return;
  }

  hint.textContent = c.reason;
  if (c.valid) {
    hint.className = 'parsec-import__hint parsec-import__hint--ok';
  } else if (c.confidence >= 0.3) {
    hint.className = 'parsec-import__hint parsec-import__hint--warn';
  } else {
    hint.className = 'parsec-import__hint parsec-import__hint--warn';
  }

  if (c.address) {
    preview.textContent = `Address: ${c.address}`;
    preview.className = 'parsec-import__address-preview parsec-import__address-preview--visible';
  } else {
    preview.textContent = '';
    preview.className = 'parsec-import__address-preview';
  }
}
