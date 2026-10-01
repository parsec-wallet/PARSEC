// Create an Arweave (HD) account for the active Parsec wallet.
// Used as: (1) the address that owns the `pythai` ANT after claim, and
// (2) the signer for ANS-104 DataItems / AO process messages.
//
// Address first, then the backup: the private key (an RSA-4096 JWK — a file,
// offered as a download as well as text) and the 24-word BIP-39 phrase it is
// derived from. Then save.
//
// Adds the derived address to the active account's `chains['arweave-hd']`
// so dashboard wiring and the injected window.arweaveWallet can find it.
//
// RSA-4096 derivation runs in a Web Worker (see lib/arweave/seed.ts) so the UI
// stays responsive — progress shows in the address panel, save waits for it.

import * as bip39 from 'bip39';
import { el, btn } from '../lib/dom';
import { store, setAccountAddress } from '../lib/store';
import { keystoreStore } from '../lib/keystore';
import { deriveJwkInWorker } from '../lib/arweave/seed';
import { addressFromJwk } from '../lib/arweave/jwk';
import { addressPanel, backupWarning, phrasePanel, secretPanel, stepStrip } from '../lib/ui/keyreveal';

export function arweaveCreateView(): HTMLElement {
  const mnemonic = bip39.generateMnemonic(256);
  let derivedAddress = '';
  let derivedJwkJson = '';
  let saving = false;

  const address = addressPanel('Arweave');
  const privateKey = secretPanel({
    title: 'Private key',
    hint: 'An Arweave key is a JSON Web Key file. ArConnect, Wander and arweave.app import it as a file.',
    format: 'JWK · RSA-4096 · about 3 KB of JSON',
    download: { filename: 'arweave-key.json', mime: 'application/json' },
    large: true,
  });
  const status = el('p', { cls: 'parsec-keyflow__status', attrs: { 'aria-live': 'polite' } });

  const saveBtn = btn('I\'ve backed it up — save to vault', {
    intent: 'primary', large: true, icon: 'tick', cls: 'parsec-create__continue', disabled: true,
    onClick: () => { void save(); },
  }) as HTMLButtonElement;

  const retryBtn = btn('Retry key generation', {
    outlined: true, icon: 'refresh',
    onClick: () => { void runDerivation(); },
  }) as HTMLButtonElement;
  retryBtn.hidden = true;

  async function runDerivation(): Promise<void> {
    retryBtn.hidden = true;
    saveBtn.disabled = true;
    address.pending('Generating an RSA-4096 key in the background. This can take up to a minute.');
    try {
      const jwk = await deriveJwkInWorker(mnemonic);
      derivedJwkJson = JSON.stringify(jwk);
      derivedAddress = await addressFromJwk(jwk);
      address.set(derivedAddress);
      privateKey.set(JSON.stringify(jwk, null, 2));
      saveBtn.disabled = false;
    } catch (err) {
      address.fail(err instanceof Error ? err.message : 'Arweave key generation failed');
      retryBtn.hidden = false;
    }
  }

  function fail(message: string): void {
    status.textContent = message;
    status.classList.add('parsec-keyflow__status--error');
  }

  async function save(): Promise<void> {
    if (saving || !derivedAddress || !derivedJwkJson) return;
    saving = true;
    saveBtn.disabled = true;
    status.classList.remove('parsec-keyflow__status--error');
    status.textContent = 'Saving to the vault…';
    let saved = false;
    try {
      const state = store.get();
      const account = state.accounts[state.activeAccountIndex];
      if (!account) { fail('No active account — create or unlock a wallet first.'); return; }
      const passphrase = store.getPassphrase();
      if (!passphrase) { fail('The wallet is locked — unlock it, then add Arweave again.'); return; }
      // The vault stores the JWK directly (signTxFromVault expects it as JSON).
      await keystoreStore(derivedAddress, derivedJwkJson, passphrase, 'Arweave HD', 'arweave-hd');
      const updated = setAccountAddress(account, 'arweave-hd', derivedAddress);
      const accounts = [...state.accounts];
      accounts[state.activeAccountIndex] = updated;
      store.set({ accounts });
      saved = true;
      status.textContent = 'Saved.';
      store.navigate('create-select');
    } catch (err) {
      fail(err instanceof Error ? err.message : 'Save failed');
    } finally {
      saving = false;
      if (!saved) saveBtn.disabled = !derivedAddress;
    }
  }

  void runDerivation();

  return el('div', {
    cls: 'parsec-view parsec-create parsec-keyflow',
    children: [
      el('div', {
        cls: 'parsec-view__header',
        children: [
          btn('Back', { minimal: true, icon: 'arrow-left', onClick: () => store.navigate('create-select') }),
        ],
      }),
      stepStrip(['Address', 'Back up', 'Save'], 0),
      el('h2', { cls: 'parsec-view__title', text: 'Your Arweave wallet' }),
      address.el,
      retryBtn,
      backupWarning(),
      privateKey.el,
      phrasePanel(mnemonic.split(' '), 'Write the 24 words down in order. They re-derive this exact key in Parsec; most other Arweave wallets restore from the key file above.'),
      saveBtn,
      status,
    ],
  });
}
