// PARSEC Wallet — Onramp View
// Non-custodial provider picker. Active address is passed as a URL parameter;
// providers handle KYC and payment on their own infrastructure. PARSEC never
// sees card numbers or fiat rails.

import { el, btn, toast } from '../lib/dom';
import { store } from '../lib/store';

interface Provider {
  name: string;
  tagline: string;
  buildUrl: (address: string) => string;
}

const PROVIDERS: Provider[] = [
  {
    name: 'MoonPay',
    tagline: 'Global coverage · card & bank transfer',
    buildUrl: (a) => `https://buy.moonpay.com/?currencyCode=algo&walletAddress=${encodeURIComponent(a)}`,
  },
  {
    name: 'Transak',
    tagline: '150+ countries · local payment methods',
    buildUrl: (a) => `https://global.transak.com/?cryptoCurrencyCode=ALGO&network=algorand&walletAddress=${encodeURIComponent(a)}`,
  },
  {
    name: 'Ramp Network',
    tagline: 'EU-friendly · SEPA, card, Apple Pay',
    buildUrl: (a) => `https://buy.ramp.network/?swapAsset=ALGO_ALGO&userAddress=${encodeURIComponent(a)}`,
  },
  {
    name: 'Banxa',
    tagline: 'AU & EU · bank transfer, card',
    buildUrl: (a) => `https://checkout.banxa.com/?coinType=ALGO&walletAddress=${encodeURIComponent(a)}`,
  },
];

export function onrampView(): HTMLElement {
  const state = store.get();
  const account = state.accounts[state.activeAccountIndex];

  if (!account) {
    store.navigate('onboarding');
    return el('div');
  }

  const addr = account.address;

  const cards = PROVIDERS.map(p => el('div', {
    cls: 'parsec-onramp__card',
    children: [
      el('div', { cls: 'parsec-onramp__card-header', children: [
        el('div', { cls: 'parsec-onramp__card-name', text: p.name }),
        el('div', { cls: 'parsec-onramp__card-tagline', text: p.tagline }),
      ]}),
      el('div', { cls: 'parsec-onramp__card-actions', children: [
        el('a', {
          cls: 'parsec-onramp__card-link',
          text: `Buy on ${p.name} →`,
          attrs: { href: p.buildUrl(addr), target: '_blank', rel: 'noopener noreferrer' },
        }),
      ]}),
    ],
  }));

  return el('div', {
    cls: 'parsec-view parsec-onramp',
    children: [
      el('div', {
        cls: 'parsec-view__header',
        children: [
          btn('Back', { minimal: true, icon: 'arrow-left', onClick: () => store.navigate('dashboard') }),
          el('h2', { cls: 'parsec-view__title', text: 'Buy ALGO' }),
        ],
      }),
      el('p', {
        cls: 'parsec-view__desc',
        text: 'Pick any provider. PARSEC passes your receive address only — KYC, payment, and fees happen on the provider\u2019s site.',
      }),

      el('div', {
        cls: 'parsec-onramp__address',
        children: [
          el('div', { cls: 'parsec-onramp__address-label', text: 'Funds will arrive at' }),
          el('div', { cls: 'parsec-onramp__address-value', text: addr }),
          btn('Copy Address', {
            minimal: true, icon: 'clipboard',
            onClick: () => { navigator.clipboard.writeText(addr); toast('Address copied', 'success'); },
          }),
        ],
      }),

      el('div', { cls: 'parsec-onramp__grid', children: cards }),

      el('p', {
        cls: 'parsec-view__desc parsec-onramp__note',
        text: 'Providers are external. Their availability and supported regions change. PARSEC does not receive card numbers, bank info, or fiat.',
      }),
    ],
  });
}
