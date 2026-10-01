// Create an HD ARC-52 wallet (24-word BIP-39).
// Sibling to create-wallet.ts (25-word algosdk path) — the two flows are
// kept separate so a 25-word phrase can never accidentally feed the
// 24-word HD derivation, and vice versa.

import { el, btn, toast } from '../lib/dom';
import { store } from '../lib/store';
import { generateBip39Mnemonic, validateBip39Mnemonic } from '../lib/algorand-hd/seed';
import { algorandHdModule, persistHdWallet } from '../lib/algorand-hd/module';

export function arc52CreateView(): HTMLElement {
  let mnemonic = generateBip39Mnemonic();
  let derivedAddress = '';
  let confirmed = false;

  const wordGrid = el('div', { cls: 'parsec-mnemonic-grid' });

  function renderWords(): void {
    wordGrid.innerHTML = '';
    mnemonic.split(' ').forEach((word, i) => {
      wordGrid.appendChild(
        el('div', {
          cls: 'parsec-mnemonic-word',
          children: [
            el('span', { cls: 'parsec-mnemonic-word__num', text: `${i + 1}` }),
            el('span', { cls: 'parsec-mnemonic-word__text', text: word }),
          ],
        }),
      );
    });
  }
  renderWords();

  // Pre-derive the primary address so we can show it. The mnemonic itself is
  // also displayed below for backup.
  algorandHdModule.createWallet().then((created) => {
    // Use this stored mnemonic going forward — keeps derivation consistent
    // with what was actually persisted.
    mnemonic = created.recoveryMaterial;
    derivedAddress = created.address;
    addressEl.textContent = derivedAddress;
    renderWords();
  }).catch((err) => {
    toast(err instanceof Error ? err.message : 'Failed to derive address', 'danger');
  });

  const addressEl = el('div', { cls: 'parsec-arc52__primary-address', text: '...' });

  return el('div', {
    cls: 'parsec-view parsec-create parsec-arc52',
    children: [
      el('div', {
        cls: 'parsec-view__header',
        children: [
          btn('Back', { minimal: true, icon: 'arrow-left', onClick: () => store.navigate('onboarding') }),
        ],
      }),
      el('h2', { cls: 'parsec-view__title', text: 'HD Wallet (ARC-52)' }),
      el('p', {
        cls: 'parsec-view__desc',
        text: 'A single BIP-39 seed → many Algorand sub-accounts (BIP-44 path m/44/283/account/0/index). Plus an Identity context for DID / W3C-VC use cases. Note: this is NOT the 25-word algosdk format — those are mutually incompatible.',
      }),
      el('div', {
        cls: 'parsec-callout bp5-callout bp5-intent-warning',
        text: 'Write down these 24 words in order. This is the ONLY way to recover this wallet. Never share it.',
      }),
      wordGrid,
      el('div', { cls: 'parsec-arc52__primary-label', text: 'Primary address (m/44/283/0/0/0):' }),
      addressEl,
      btn("I've backed it up — save & continue", {
        intent: 'primary', large: true, icon: 'tick',
        onClick: async () => {
          if (confirmed) return;
          if (!derivedAddress) { toast('Still deriving — try again in a moment', 'warning'); return; }
          if (!validateBip39Mnemonic(mnemonic)) { toast('Mnemonic invalid', 'danger'); return; }
          confirmed = true;
          try {
            await persistHdWallet(derivedAddress, mnemonic, 'HD ARC-52 wallet');
            // Register in the wallet account list so it shows up in the dashboard switcher.
            const state = store.get();
            store.set({
              accounts: [
                ...state.accounts,
                { address: derivedAddress, name: `HD ${state.accounts.length + 1}`, createdAt: Date.now() },
              ],
              activeAccountIndex: state.accounts.length,
            });
            toast('HD wallet saved to vault', 'success');
            store.navigate('dashboard');
          } catch (err) {
            toast(err instanceof Error ? err.message : 'Save failed', 'danger');
            confirmed = false;
          }
        },
      }),
    ],
  });
}
