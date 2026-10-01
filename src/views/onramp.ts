// PARSEC Wallet — BUY ALGO
//
// A store front for regulated on-ramp providers. PARSEC is not the seller:
// each provider runs its own checkout (identity checks, payment, fees) on its
// own site, which opens in the default browser. PARSEC passes one thing — the
// public address the ALGO is delivered to — and never sees a card, a bank
// account or fiat.

import { el, btn, toast, copyText } from '../lib/dom';
import { store, getAccountAddress } from '../lib/store';
import { openExternal } from '../lib/external';

interface Provider {
  name: string;
  host: string;
  tagline: string;
  methods: string[];
  regions: string;
  buildUrl: (address: string) => string;
}

const PROVIDERS: Provider[] = [
  {
    name: 'MoonPay',
    host: 'buy.moonpay.com',
    tagline: 'Broad global coverage and a fast card checkout.',
    methods: ['Card', 'Bank transfer', 'Apple Pay', 'Google Pay'],
    regions: '160+ countries',
    buildUrl: (a) => `https://buy.moonpay.com/?currencyCode=algo&walletAddress=${encodeURIComponent(a)}`,
  },
  {
    name: 'Transak',
    host: 'global.transak.com',
    tagline: 'Local payment methods in many markets.',
    methods: ['Card', 'Bank transfer', 'Local methods'],
    regions: '150+ countries',
    buildUrl: (a) => `https://global.transak.com/?cryptoCurrencyCode=ALGO&network=algorand&walletAddress=${encodeURIComponent(a)}`,
  },
  {
    name: 'Ramp Network',
    host: 'buy.ramp.network',
    tagline: 'Strong in Europe with low-fee bank transfers.',
    methods: ['SEPA', 'Card', 'Apple Pay'],
    regions: 'EU, UK and more',
    buildUrl: (a) => `https://buy.ramp.network/?swapAsset=ALGO_ALGO&userAddress=${encodeURIComponent(a)}`,
  },
  {
    name: 'Banxa',
    host: 'checkout.banxa.com',
    tagline: 'Bank-transfer friendly, especially in Australia.',
    methods: ['Bank transfer', 'Card'],
    regions: 'AU, EU and more',
    buildUrl: (a) => `https://checkout.banxa.com/?coinType=ALGO&walletAddress=${encodeURIComponent(a)}`,
  },
];

function hueOf(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 33 + s.charCodeAt(i)) >>> 0;
  return h % 360;
}

export function onrampView(): HTMLElement {
  const state = store.get();
  const account = state.accounts[state.activeAccountIndex];
  if (!account) {
    store.navigate('onboarding');
    return el('div');
  }
  const addr = getAccountAddress(account, 'algorand') ?? account.address;

  const providerCard = (p: Provider): HTMLElement => {
    const tile = el('span', { cls: 'parsec-store__tile', text: p.name[0], attrs: { 'aria-hidden': 'true' } });
    tile.style.setProperty('--hue', String(hueOf(p.name)));
    const go = btn(`Continue to ${p.name}`, {
      intent: 'primary', large: true, cls: 'parsec-store__go',
      onClick: () => {
        void openExternal(p.buildUrl(addr))
          .then((ok) => { if (!ok) toast('That link was refused.', 'danger'); })
          .catch((e) => toast(`Could not open ${p.host}: ${e instanceof Error ? e.message : String(e)}`, 'danger', 8000));
      },
    });
    return el('article', { cls: 'parsec-store__card', children: [
      el('header', { cls: 'parsec-store__card-head', children: [
        tile,
        el('div', { children: [
          el('h3', { cls: 'parsec-store__name', text: p.name }),
          el('p', { cls: 'parsec-store__tagline', text: p.tagline }),
        ] }),
      ] }),
      el('dl', { cls: 'parsec-store__facts', children: [
        el('dt', { text: 'Pay with' }),
        el('dd', { children: p.methods.map((m) => el('span', { cls: 'parsec-store__chip', text: m })) }),
        el('dt', { text: 'Available' }),
        el('dd', { text: p.regions }),
      ] }),
      go,
      el('p', { cls: 'parsec-store__host', text: `Opens ${p.host} in your browser` }),
    ] });
  };

  const trust = (title: string, body: string) =>
    el('div', { cls: 'parsec-store__trust-item', children: [
      el('strong', { text: title }),
      el('span', { text: body }),
    ] });

  const step = (n: number, title: string, body: string) =>
    el('li', { children: [
      el('span', { cls: 'parsec-store__step-n', text: String(n) }),
      el('div', { children: [el('strong', { text: title }), el('span', { text: body })] }),
    ] });

  return el('div', {
    cls: 'parsec-view parsec-store',
    children: [
      el('div', { cls: 'parsec-view__header', children: [
        btn('Back', { minimal: true, icon: 'arrow-left', onClick: () => { if (!store.back()) store.navigate('dashboard'); } }),
      ] }),

      el('section', { cls: 'parsec-store__hero', children: [
        el('p', { cls: 'parsec-store__kicker', text: 'Algorand · ALGO' }),
        el('h2', { cls: 'parsec-store__title', text: 'BUY ALGO' }),
        el('p', { cls: 'parsec-store__lede', text: 'Choose a regulated provider. You pay them directly; the ALGO is delivered straight to your own wallet.' }),
        el('div', { cls: 'parsec-store__trust', children: [
          trust('Straight to your wallet', 'Delivered to the address below. No account with PARSEC, nothing held for you.'),
          trust('Your payment details stay with them', 'PARSEC never sees your card, bank account or identity documents.'),
          trust('Compare freely', 'Each provider sets its own fees, limits and checks. Pick the one that suits you.'),
        ] }),
      ] }),

      el('section', { cls: 'parsec-store__deliver', children: [
        el('div', { children: [
          el('div', { cls: 'parsec-store__label', text: 'Delivered to' }),
          el('div', { cls: 'parsec-store__account', text: `${account.name} · Algorand` }),
        ] }),
        el('code', { cls: 'parsec-store__address', text: addr, attrs: { title: addr } }),
        btn('Copy', {
          outlined: true, icon: 'duplicate', cls: 'parsec-store__copy',
          onClick: () => { void copyText(addr, 'Address copied'); },
        }),
      ] }),

      el('section', { cls: 'parsec-store__grid', children: PROVIDERS.map(providerCard) }),

      el('section', { cls: 'parsec-store__how', children: [
        el('h3', { text: 'How it works' }),
        el('ol', { children: [
          step(1, 'Choose a provider', 'Its checkout opens in your browser with your address filled in.'),
          step(2, 'Verify and pay', 'Identity checks and payment happen with the provider, under their terms.'),
          step(3, 'Receive ALGO', 'It arrives at the address above, usually within minutes. Check it on the dashboard.'),
        ] }),
      ] }),

      el('p', { cls: 'parsec-store__note', text: 'Providers are independent companies; PARSEC is not party to the purchase and earns nothing from it. Availability, fees and supported regions change, and are shown on each provider’s site before you pay. Check that the address they show matches the one above.' }),
    ],
  });
}
