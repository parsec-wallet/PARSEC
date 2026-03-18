// Parsec Wallet — Onboarding View
import { el, btn } from '../lib/dom';
import { store } from '../lib/store';

export function onboardingView(): HTMLElement {
  return el('div', {
    cls: 'parsec-view parsec-onboarding',
    children: [
      el('div', {
        cls: 'parsec-onboarding__hero',
        children: [
          el('div', {
            cls: 'parsec-logo',
            text: 'PARSEC',
          }),
          el('p', {
            cls: 'parsec-onboarding__tagline',
            text: 'Sovereign Algorand Wallet',
          }),
          el('p', {
            cls: 'parsec-onboarding__sub',
            text: 'Your keys. Your coins. No compromises.',
          }),
        ],
      }),
      el('div', {
        cls: 'parsec-onboarding__actions',
        children: [
          btn('Create New Wallet', {
            intent: 'primary',
            large: true,
            icon: 'plus',
            onClick: () => store.navigate('create-wallet'),
          }),
          btn('Import Existing Wallet', {
            large: true,
            outlined: true,
            icon: 'import',
            onClick: () => store.navigate('import-wallet'),
          }),
        ],
      }),
      el('p', {
        cls: 'parsec-onboarding__footer',
        children: [
          'Keys are generated and encrypted locally. They never leave your device. ',
          el('a', {
            text: 'Read the docs',
            attrs: { href: '#' },
            onClick: (e) => { e.preventDefault(); store.navigate('docs'); },
          }),
        ],
      }),
    ],
  });
}
