// Parsec Wallet — Create Wallet View

import { el, btn, toast } from '../lib/dom';
import { store } from '../lib/store';
import { generateAccount } from '../lib/algorand/account';

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
  const words = mnemonic.split(' ');

  const wordGrid = el('div', { cls: 'parsec-mnemonic-grid' });
  words.forEach((word, i) => {
    wordGrid.appendChild(
      el('div', {
        cls: 'parsec-mnemonic-word',
        children: [
          el('span', { cls: 'parsec-mnemonic-word__num', text: `${i + 1}` }),
          el('span', { cls: 'parsec-mnemonic-word__text', text: word }),
        ],
      })
    );
  });

  return el('div', {
    cls: 'parsec-view parsec-create',
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
              store.navigate('onboarding');
            },
          }),
        ],
      }),
      el('h2', { cls: 'parsec-view__title', text: 'Your Recovery Phrase' }),
      el('p', {
        cls: 'parsec-view__desc',
        text: 'Write down these 25 words in order. This is the ONLY way to recover your wallet. Never share it.',
      }),
      el('div', {
        cls: 'parsec-callout bp5-callout bp5-intent-warning',
        children: [el('p', { text: 'Anyone with these words can steal your funds. Store them offline.' })],
      }),
      wordGrid,
      btn('Copy to Clipboard', {
        minimal: true, icon: 'clipboard',
        onClick: () => {
          navigator.clipboard.writeText(mnemonic);
          toast('Copied — store it safely, then clear your clipboard', 'warning');
        },
      }),
      btn('I\'ve Written It Down', {
        intent: 'primary', large: true, cls: 'parsec-create__continue',
        onClick: () => store.navigate('verify-mnemonic'),
      }),
    ],
  });
}
