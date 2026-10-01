// Create a Solana address for the active Parsec account.
//
// Address first, then the backup: the private key (base58, the 64-byte keypair
// Phantom and Solflare import) and the 24-word BIP-39 phrase (path
// m/44'/501'/0'/0'), each hidden until revealed and each copyable. Then save.
//
// Adds the new Solana address to the active WalletAccount's `chains` map rather
// than creating a separate account row — one human identity, many chain addresses.

import * as bip39 from 'bip39';
import { el, btn } from '../lib/dom';
import { store, setAccountAddress } from '../lib/store';
import { keystoreStore } from '../lib/keystore';
import { deriveSolanaFromMnemonic } from '../lib/solana/seed';
import { base58Encode } from '../lib/solana/address';
import { addressPanel, backupWarning, phrasePanel, secretPanel, stepStrip } from '../lib/ui/keyreveal';

export function solanaCreateView(): HTMLElement {
  const mnemonic = bip39.generateMnemonic(256);
  let derivedAddress = '';
  let saving = false;

  const address = addressPanel('Solana');
  const privateKey = secretPanel({
    title: 'Private key',
    hint: 'The keypair behind the address, in the format Phantom and Solflare import.',
    format: 'Base58 · 64 bytes (secret seed + public key)',
  });
  const status = el('p', { cls: 'parsec-keyflow__status', attrs: { 'aria-live': 'polite' } });

  const saveBtn = btn('I\'ve backed it up — save to vault', {
    intent: 'primary', large: true, icon: 'tick', cls: 'parsec-create__continue', disabled: true,
    onClick: () => { void save(); },
  }) as HTMLButtonElement;

  deriveSolanaFromMnemonic(mnemonic).then((kp) => {
    derivedAddress = kp.address;
    address.set(kp.address);
    const full = new Uint8Array(64);
    full.set(kp.secretSeed, 0);
    full.set(kp.publicKey, 32);
    privateKey.set(base58Encode(full));
    full.fill(0);
    saveBtn.disabled = false;
  }).catch((err) => {
    address.fail(err instanceof Error ? err.message : 'Derivation failed');
  });

  function fail(message: string): void {
    status.textContent = message;
    status.classList.add('parsec-keyflow__status--error');
  }

  async function save(): Promise<void> {
    if (saving || !derivedAddress) return;
    saving = true;
    saveBtn.disabled = true;
    status.classList.remove('parsec-keyflow__status--error');
    status.textContent = 'Saving to the vault…';
    try {
      const state = store.get();
      const account = state.accounts[state.activeAccountIndex];
      if (!account) { fail('No active account — create or unlock a wallet first.'); return; }
      const passphrase = store.getPassphrase();
      if (!passphrase) { fail('The wallet is locked — unlock it, then add Solana again.'); return; }
      await keystoreStore(derivedAddress, mnemonic, passphrase, 'Solana', 'solana');
      const updated = setAccountAddress(account, 'solana', derivedAddress);
      const accounts = [...state.accounts];
      accounts[state.activeAccountIndex] = updated;
      store.set({ accounts });
      status.textContent = 'Saved.';
      store.navigate('create-select');
    } catch (err) {
      fail(err instanceof Error ? err.message : 'Save failed');
    } finally {
      saving = false;
      if (!status.textContent?.startsWith('Saved')) saveBtn.disabled = !derivedAddress;
    }
  }

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
      el('h2', { cls: 'parsec-view__title', text: 'Your Solana wallet' }),
      address.el,
      backupWarning(),
      privateKey.el,
      phrasePanel(mnemonic.split(' '), 'Write the 24 words down in order. Standard BIP-39, path m/44\'/501\'/0\'/0\' — it restores this address in Phantom, Solflare and Parsec.'),
      saveBtn,
      status,
    ],
  });
}
