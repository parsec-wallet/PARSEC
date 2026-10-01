// PARSEC Wallet — Import Wallet View
// Accepts: 25-word mnemonic, base64 private key, or watch-only address.
// Live input classification with validation feedback.

import { exactTextField, normalizePhrase } from '../lib/phrase-input';
import { el, btn, input, toast } from '../lib/dom';
import { store } from '../lib/store';
import { classifyInput } from '../lib/algorand/validate';
import type { ClassifiedInput } from '../lib/algorand/validate';
import { keystoreStore } from '../lib/keystore';
import { vaultPass, vaultAction } from '../lib/ui/vault-pass';
import algosdk from 'algosdk';

export function importWalletView(): HTMLElement {
  let secret = '';
  let lastClassification: ClassifiedInput = { kind: 'unknown', confidence: 0, reason: '', valid: false };

  const secretArea = document.createElement('textarea');
  secretArea.className = 'bp5-input parsec-import__textarea';
  secretArea.placeholder = 'Paste your 25-word recovery phrase, private key, or Algorand address';
  secretArea.rows = 4;
  exactTextField(secretArea);
  secretArea.setAttribute('data-lpignore', 'true');

  const detectionHint = el('div', { cls: 'parsec-import__hint' });
  const addressPreview = el('div', { cls: 'parsec-import__address-preview' });

  secretArea.addEventListener('input', () => {
    secret = normalizePhrase(secretArea.value);
    lastClassification = classifyInput(secret);
    renderClassification(lastClassification, detectionHint, addressPreview);
    // A watch-only address stores no key, so no vault passphrase is asked.
    passphraseSection.style.display = lastClassification.kind === 'algorand_address' ? 'none' : '';
    action.refresh();
  });

  // The account's name, chosen now rather than "Account N" (renamable later too).
  let accountName = '';
  const nameInput = input({
    placeholder: 'Account name (optional), e.g. Treasury or Agent payer',
    cls: 'bp5-input bp5-large parsec-import__name',
    onInput: (v) => { accountName = v; },
  });
  nameInput.maxLength = 40;

  // Which vault the key goes into, and its passphrase — lib/ui/vault-pass.ts.
  // Not needed for a watch-only address, which stores no key.
  const vault = vaultPass({ onEnter: () => action.submit() });
  const passphraseSection = el('div', { cls: 'parsec-import__passphrase-section', children: [vault.element] });

  const action = vaultAction(vault, doImport, {
    extra: secretBlocker,
    skip: isWatchOnly,
    label: (base) => (isWatchOnly() ? 'Add watch-only account' : base.replace('Save to vault', 'Import to vault').replace(/ save$/, ' import')),
  });

  return el('div', {
    cls: 'parsec-view parsec-import parsec-vaultflow',
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
      nameInput,
      passphraseSection,
      action.el,
    ],
  });

  function isWatchOnly(): boolean { return lastClassification.kind === 'algorand_address'; }

  function secretBlocker(): string {
    if (!secret.trim()) return 'Paste a recovery phrase, private key or address.';
    if (!lastClassification.valid) return lastClassification.reason || 'That is not a recovery phrase, key or address PARSEC can import.';
    if (store.get().accounts.some((a) => a.address === lastClassification.address)) return 'This account is already in this profile.';
    return '';
  }

  async function doImport(): Promise<void> {
    const address = lastClassification.address!;
    const nameFor = (n: number, watch = false) => accountName.trim() || `Account ${n}${watch ? ' (watch)' : ''}`;

    if (isWatchOnly()) {
      // Watch-only: no passphrase needed, no key stored
      const accounts = store.get().accounts;
      store.set({ accounts: [...accounts, { address, name: nameFor(accounts.length + 1, true), createdAt: Date.now(), watchOnly: true }] });
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
      const name = nameFor(accounts.length + 1);
      await keystoreStore(address, mnemonic, passphrase, name);
      store.set({
        accounts: [...accounts, { address, name, createdAt: Date.now() }],
        activeAccountIndex: accounts.length,
      });
      store.setPassphrase(passphrase);
      vault.wipe();
      secretArea.value = ''; secret = '';
      toast('Wallet imported', 'success');
      store.navigate('dashboard');
    } finally {
      store.set({ isLoading: false });
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
