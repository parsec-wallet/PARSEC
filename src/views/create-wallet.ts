// PARSEC Wallet — Create Wallet View (Algorand)
//
// Desktop: the vault first (create, unlock or reuse), then the PARSEC Keycore generates
// the account inside Rust and seals it, then the 25-word phrase is revealed once for the
// backup (`vaultRevealNew`), then verify-mnemonic checks three words. The key is never
// generated in the app.
//
// Browser build (no Keycore): address first, then the backup — the private key and the
// 25-word phrase, each hidden until revealed — and the vault passphrase on the next screen.

import algosdk from 'algosdk';
import { el, btn } from '../lib/dom';
import { store } from '../lib/store';
import { generateAccount } from '../lib/algorand/account';
import { addressPanel, backupWarning, phrasePanel, secretPanel, stepStrip } from '../lib/ui/keyreveal';
import { isTauri } from '../lib/platform';
import { algoCreateAccount } from '../lib/chain-algo';
import { vaultRevealNew } from '../lib/vault';
import { vaultPass, vaultAction } from '../lib/ui/vault-pass';

const PHRASE_HINT = 'Write the 25 words down in order. This is Algorand\'s own 25-word format, not BIP-39; it restores this wallet in PARSEC, Pera, Defly and any Algorand wallet.';

/** Desktop: the Keycore creates; the app only ever sees the phrase, once, to back it up. */
function keycoreCreateView(): HTMLElement {
  const root = el('div', { cls: 'parsec-view parsec-create parsec-keyflow parsec-vaultflow' });
  const header = (back: () => void) => el('div', {
    cls: 'parsec-view__header',
    children: [btn('Back', { minimal: true, icon: 'arrow-left', onClick: back })],
  });

  function showBackup(address: string, phrase: string): void {
    root.replaceChildren(
      header(() => { store.setTempMnemonic(null); store.navigate('create-select'); }),
      stepStrip(['Vault', 'Back up', 'Verify'], 1),
      el('h2', { cls: 'parsec-view__title', text: 'Your Algorand wallet' }),
      addressPanel('Algorand', address).el,
      backupWarning(),
      phrasePanel(phrase.split(' '), PHRASE_HINT),
      el('p', { cls: 'parsec-muted', text: 'Created and sealed by the PARSEC Keycore. This is the only time the phrase is shown without asking for your passphrase again.' }),
      btn('I\'ve backed it up — verify', {
        intent: 'primary', large: true, cls: 'parsec-create__continue',
        onClick: () => store.navigate('verify-mnemonic'),
      }),
    );
  }

  // Back from verify: the phrase is still held for that step.
  const held = store.getTempMnemonic();
  const all = store.get().accounts;
  const last = all[all.length - 1];
  if (held && last) { showBackup(last.address, held); return root; }

  const vault = vaultPass({ carry: () => null, onEnter: () => action.submit() });
  const action = vaultAction(vault, async () => {
    const pass = await vault.ready();
    store.setPassphrase(pass);
    vault.wipe();
    const state = store.get();
    const name = `Account ${state.accounts.length + 1}`;
    const { address } = await algoCreateAccount(name);
    const { secret } = await vaultRevealNew(address);
    store.setTempMnemonic(secret);
    const accounts = [...store.get().accounts, { address, name, createdAt: Date.now() }];
    store.set({ accounts, activeAccountIndex: accounts.length - 1 });
    showBackup(address, secret);
  }, { label: (base) => base.replace(/save$/i, 'create wallet').replace(/^Save to vault$/i, 'Create wallet') });

  root.replaceChildren(
    header(() => store.navigate('create-select')),
    stepStrip(['Vault', 'Back up', 'Verify'], 0),
    el('h2', { cls: 'parsec-view__title', text: 'Your Algorand wallet' }),
    el('p', { cls: 'parsec-view__desc', text: 'The PARSEC Keycore generates the key inside your vault. Open the vault first; the recovery phrase comes next.' }),
    vault.element,
    action.el,
  );
  return root;
}

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
  if (isTauri) return keycoreCreateView();
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
