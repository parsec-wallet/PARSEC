// Create a Solana destination address for the active Parsec account.
// Used as the receiving address for the ARIO BASE→Solana migration.
//
// Adds the new Solana address to the active WalletAccount's `chains` map
// rather than creating a separate account row — one human identity, many
// chain addresses (the BANKON-vault thesis).

import * as bip39 from 'bip39';
import { el, btn, toast } from '../lib/dom';
import { store, setAccountAddress } from '../lib/store';
import { keystoreStore } from '../lib/keystore';
import { deriveSolanaFromMnemonic } from '../lib/solana/seed';

export function solanaCreateView(): HTMLElement {
  let mnemonic = bip39.generateMnemonic(256);
  let derivedAddress = '';
  let confirmed = false;

  const wordGrid = el('div', { cls: 'parsec-mnemonic-grid' });
  const addressEl = el('div', { cls: 'parsec-arc52__primary-address', text: '...' });

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

  // Derive the address for display. The createWallet() path mints a fresh
  // mnemonic; we use deriveSolanaFromMnemonic on our locally-generated one
  // so the displayed words match what gets persisted.
  deriveSolanaFromMnemonic(mnemonic).then((kp) => {
    derivedAddress = kp.address;
    addressEl.textContent = derivedAddress;
  }).catch((err) => {
    toast(err instanceof Error ? err.message : 'Derivation failed', 'danger');
  });

  return el('div', {
    cls: 'parsec-view parsec-create parsec-arc52',
    children: [
      el('div', {
        cls: 'parsec-view__header',
        children: [
          btn('Back', {
            minimal: true,
            icon: 'arrow-left',
            onClick: () => store.navigate('dashboard'),
          }),
        ],
      }),
      el('h2', { cls: 'parsec-view__title', text: 'Solana Destination Address' }),
      el('p', {
        cls: 'parsec-view__desc',
        text: 'Generate a Solana address inside the BANKON vault. This is the destination for the ARIO Solana migration — sol.ar.io will map your BASE ARIO to this Solana address.',
      }),
      el('div', {
        cls: 'parsec-callout bp5-callout bp5-intent-warning',
        text: 'Write down these 24 words in order. Same BIP-39 standard as Phantom / Solflare (path m/44\'/501\'/0\'/0\'). This is the ONLY way to recover this Solana address.',
      }),
      wordGrid,
      el('div', { cls: 'parsec-arc52__primary-label', text: 'Solana address:' }),
      addressEl,
      btn("I've backed it up — save & continue", {
        intent: 'primary',
        large: true,
        icon: 'tick',
        onClick: async () => {
          if (confirmed) return;
          if (!derivedAddress) {
            toast('Still deriving — try again in a moment', 'warning');
            return;
          }
          confirmed = true;
          try {
            const state = store.get();
            const account = state.accounts[state.activeAccountIndex];
            if (!account) {
              toast('No active account — create or unlock a wallet first', 'danger');
              confirmed = false;
              return;
            }
            const passphrase = store.getPassphrase();
            if (!passphrase) {
              toast('Wallet is locked', 'danger');
              store.navigate('unlock');
              return;
            }
            await keystoreStore(derivedAddress, mnemonic, passphrase, 'Solana destination', 'solana');
            const updated = setAccountAddress(account, 'solana', derivedAddress);
            const accounts = [...state.accounts];
            accounts[state.activeAccountIndex] = updated;
            store.set({ accounts });
            toast('Solana address saved to vault', 'success');
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
