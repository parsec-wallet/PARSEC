// PARSEC Wallet — Create Wallet View (Algorand)
//
// Address first, then the backup: the private key and the 25-word recovery phrase,
// each hidden until revealed and each copyable. Verification and the vault
// passphrase follow on the next screen (verify-mnemonic).

import algosdk from 'algosdk';
import { el, btn } from '../lib/dom';
import { store } from '../lib/store';
import { generateAccount } from '../lib/algorand/account';
import { addressPanel, backupWarning, phrasePanel, secretPanel, stepStrip } from '../lib/ui/keyreveal';

/** Algorand's private key as wallets export it: the 64-byte secret key, base64. */
function privateKeyOf(mnemonic: string): string {
  const { sk } = algosdk.mnemonicToSecretKey(mnemonic);
  let bin = '';
  for (const b of sk) bin += String.fromCharCode(b);
  const out = btoa(bin);
  sk.fill(0);
  return out;
}

export function createWalletView(): HTMLElement {
  const state = store.get();

  if (!store.getTempMnemonic()) {
    const { mnemonic, address } = generateAccount();
    store.setTempMnemonic(mnemonic);
    store.set({
      accounts: [
        ...state.accounts,
        { address, name: `Account ${state.accounts.length + 1}`, createdAt: Date.now() },
      ],
    });
  }

  const mnemonic = store.getTempMnemonic()!;
  const address = algosdk.mnemonicToSecretKey(mnemonic).addr.toString();

  const privateKey = secretPanel({
    title: 'Private key',
    hint: 'The raw key behind the address. Most Algorand wallets restore from the phrase below; keep this for tools that import a key.',
    format: 'Base64 · 64-byte Ed25519 secret key',
  });
  privateKey.set(privateKeyOf(mnemonic));

  return el('div', {
    cls: 'parsec-view parsec-create parsec-keyflow',
    children: [
      el('div', {
        cls: 'parsec-view__header',
        children: [
          btn('Back', {
            minimal: true, icon: 'arrow-left',
            onClick: () => {
              const s = store.get();
              store.set({ accounts: s.accounts.slice(0, -1) });
              store.setTempMnemonic(null);
              store.navigate('create-select');
            },
          }),
        ],
      }),
      stepStrip(['Address', 'Back up', 'Verify & save'], 0),
      el('h2', { cls: 'parsec-view__title', text: 'Your Algorand wallet' }),
      addressPanel('Algorand', address).el,
      backupWarning(),
      privateKey.el,
      phrasePanel(mnemonic.split(' '), 'Write the 25 words down in order. This is Algorand\'s own 25-word format, not BIP-39; it restores this wallet in PARSEC, Pera, Defly and any Algorand wallet.'),
      btn('I\'ve backed it up — verify', {
        intent: 'primary', large: true, cls: 'parsec-create__continue',
        onClick: () => store.navigate('verify-mnemonic'),
      }),
    ],
  });
}
