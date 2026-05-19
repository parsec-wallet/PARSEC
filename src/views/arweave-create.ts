// Create an Arweave (HD) account for the active Parsec wallet.
// Used as: (1) the address that owns the `pythai` ANT after claim, and
// (2) the signer for ANS-104 DataItems / AO process messages.
//
// Adds the derived address to the active account's `chains['arweave-hd']`
// so dashboard wiring and the injected window.arweaveWallet can find it.

import * as bip39 from 'bip39';
import { el, btn, toast } from '../lib/dom';
import { store, setAccountAddress } from '../lib/store';
import { keystoreStore } from '../lib/keystore';
import { deriveJwkFromMnemonic } from '../lib/arweave/seed';
import { addressFromJwk } from '../lib/arweave/jwk';

export function arweaveCreateView(): HTMLElement {
  const mnemonic = bip39.generateMnemonic(256);
  let derivedAddress = '';
  let derivedJwkJson = '';
  let derivingPromise: Promise<void> | null = null;
  let confirmed = false;

  const wordGrid = el('div', { cls: 'parsec-mnemonic-grid' });
  const addressEl = el('div', { cls: 'parsec-arc52__primary-address', text: 'Generating RSA-4096 key — ~10-20 seconds...' });

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

  // Display the 24 words immediately; RSA-4096 derivation runs in the
  // background and unblocks the save button when complete.
  renderWords();
  derivingPromise = (async () => {
    const jwk = await deriveJwkFromMnemonic(mnemonic);
    derivedJwkJson = JSON.stringify(jwk);
    derivedAddress = await addressFromJwk(jwk);
    addressEl.textContent = derivedAddress;
  })().catch((err) => {
    addressEl.textContent = 'Derivation failed';
    toast(err instanceof Error ? err.message : 'Arweave key derivation failed', 'danger');
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
      el('h2', { cls: 'parsec-view__title', text: 'Arweave (HD) Account' }),
      el('p', {
        cls: 'parsec-view__desc',
        text: 'Generate a 24-word BIP-39 mnemonic → RSA-4096 JWK → 43-char Arweave address. The full JWK lives inside the BANKON vault; the 24 words are the only thing to write down. Used by Parsec to sign ANS-104 DataItems, AO process messages, and ArNS actions (including the pythai claim).',
      }),
      el('div', {
        cls: 'parsec-callout bp5-callout bp5-intent-warning',
        text: 'RSA-4096 generation takes ~10-20 seconds. Write down these 24 words in order once they appear. This is the ONLY way to recover this Arweave key.',
      }),
      wordGrid,
      el('div', { cls: 'parsec-arc52__primary-label', text: 'Arweave address:' }),
      addressEl,
      btn("I've backed it up — save & continue", {
        intent: 'primary',
        large: true,
        icon: 'tick',
        onClick: async () => {
          if (confirmed) return;
          if (derivingPromise) await derivingPromise;
          if (!derivedAddress || !derivedJwkJson) {
            toast('Derivation incomplete — try again in a moment', 'warning');
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
            // The vault stores the JWK directly (signTxFromVault expects it
            // as JSON). The mnemonic stays cold-backup only.
            await keystoreStore(derivedAddress, derivedJwkJson, passphrase, 'Arweave HD', 'arweave-hd');
            const updated = setAccountAddress(account, 'arweave-hd', derivedAddress);
            const accounts = [...state.accounts];
            accounts[state.activeAccountIndex] = updated;
            store.set({ accounts });
            toast('Arweave address saved to vault', 'success');
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
