// Claim tab — search-as-you-type name input, live tier/availability/price
// feedback, the NFD price in ALGO, and a Review & register button that opens the review
// flow via the connect-style confirm view.

import { formatDecimal } from '../lib/money';
import { el, input, btn } from '../lib/dom';
import { store } from '../lib/store';
import {
  classifyTier,
  getMintQuoteWithBankonFee,
  normalizeName,
  nameError,
  rootLength,
  lookupNfd,
  type Nfd,
  type NfdMintCostBreakdown,
  type NfdTier,
} from '../lib/nfd';
import type { NetworkId } from '../types/wallet';
import { findListingsAcrossProviders, getMarketplaceProvider, type MarketListing } from '../lib/marketplace';
import { setNfdPendingMint } from './nfdominter-confirm';
import { setNfdPendingBuy } from './nfdominter-buy';

interface LookupState {
  name: string;
  error: string | null;
  existing: Nfd | null;
  quote: NfdMintCostBreakdown | null;
  /** Marketplace listings for a taken name — an optional way to buy it. */
  listings: MarketListing[];
  loading: boolean;
}

const DEBOUNCE_MS = 350;

export function buildMintTab(buyer: string, network: NetworkId): HTMLElement {
  const state: LookupState = { name: '', error: null, existing: null, quote: null, listings: [], loading: false };
  let debounce: ReturnType<typeof setTimeout> | null = null;

  const nameInput = input({
    placeholder: 'search a name…',
    cls: 'parsec-nfdominter__name-input bp5-input bp5-large',
    onInput: (raw) => {
      state.name = raw;
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => { void refresh(); }, DEBOUNCE_MS);
      render();
    },
    // Enter searches immediately, without waiting out the debounce.
    onEnter: () => {
      if (debounce) { clearTimeout(debounce); debounce = null; }
      void refresh();
    },
  });

  const suffix = el('span', { cls: 'parsec-nfdominter__suffix', text: '.algo' });

  const yearsInput = input({
    type: 'number',
    placeholder: '1',
    cls: 'parsec-nfdominter__years-input bp5-input',
    value: '1',
    onInput: () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => { void refresh(); }, DEBOUNCE_MS);
    },
  });
  yearsInput.min = '1';
  yearsInput.max = '20';

  const feedback = el('div', { cls: 'parsec-nfdominter__feedback' });
  const quoteBox = el('div', { cls: 'parsec-nfdominter__quote' });

  const mintButton = btn('Review & register', {
    intent: 'primary',
    large: true,
    icon: 'confirm',
    disabled: true,
    cls: 'parsec-nfdominter__mint-btn',
    onClick: () => startMint(),
  });

  async function refresh() {
    const full = normalizeName(state.name);
    state.error = nameError(state.name);
    state.existing = null;
    state.quote = null;
    state.listings = [];
    if (state.error || !full) {
      render();
      return;
    }
    state.loading = true;
    render();
    try {
      const [existing, yearsRaw] = [await lookupNfd(network, full), Number(yearsInput.value) || 1];
      state.existing = existing;
      if (existing) {
        // Taken — but it may be listed for sale. Ask every marketplace.
        state.listings = await findListingsAcrossProviders(full, network, 'nfd-name')
          .catch(() => []);
      }
      if (!existing) {
        try {
          state.quote = await getMintQuoteWithBankonFee({
            network,
            name: full,
            buyer,
            years: Math.max(1, Math.min(20, yearsRaw)),
          });
        } catch (e) {
          state.error = (e as Error).message;
        }
      }
    } catch (e) {
      state.error = (e as Error).message;
    } finally {
      state.loading = false;
      render();
    }
  }

  function render() {
    feedback.innerHTML = '';
    quoteBox.innerHTML = '';
    const fullName = normalizeName(state.name);
    if (!state.name) {
      feedback.appendChild(el('span', { cls: 'parsec-nfdominter__hint', text: 'Start typing a name to see tier, availability, and price.' }));
      mintButton.disabled = true;
      return;
    }
    if (state.error) {
      feedback.appendChild(el('span', { cls: 'parsec-nfdominter__hint parsec-nfdominter__hint--error', text: state.error }));
      mintButton.disabled = true;
      return;
    }

    // Tier + length chips
    const len = rootLength(fullName);
    const tier: NfdTier = classifyTier(fullName, state.existing ?? undefined);
    feedback.appendChild(el('span', { cls: `parsec-nfdominter__chip parsec-nfdominter__chip--len-${Math.min(len, 10)}`, text: `${len} char${len === 1 ? '' : 's'}` }));
    feedback.appendChild(el('span', { cls: `parsec-nfdominter__chip parsec-nfdominter__chip--tier-${tier}`, text: tier.replace('-', ' ') }));

    // State chip
    if (state.loading) {
      feedback.appendChild(el('span', { cls: 'parsec-nfdominter__chip parsec-nfdominter__chip--loading', text: 'checking…' }));
      mintButton.disabled = true;
      return;
    }
    if (state.existing) {
      const mineByAddress = state.existing.owner === buyer;
      feedback.appendChild(el('span', {
        cls: `parsec-nfdominter__chip parsec-nfdominter__chip--state-${mineByAddress ? 'yours' : state.existing.state}`,
        text: mineByAddress ? 'yours' : state.existing.state,
      }));
      const owner = state.existing.owner ?? '';
      feedback.appendChild(el('span', {
        cls: 'parsec-nfdominter__hint',
        text: mineByAddress
          ? 'You already own this.'
          : owner
            ? `Taken by ${owner.slice(0, 6)}…${owner.slice(-4)}.`
            : 'Taken.',
      }));
      mintButton.disabled = true;
      // A taken name can't be minted — but if a marketplace lists it,
      // surface an optional way to buy.
      if (!mineByAddress) {
        for (const listing of state.listings) quoteBox.appendChild(renderBuyOption(listing));
      }
      return;
    }
    // Available
    feedback.appendChild(el('span', { cls: 'parsec-nfdominter__chip parsec-nfdominter__chip--state-available', text: 'available' }));

    if (state.quote) {
      quoteBox.appendChild(renderQuote(state.quote));
      mintButton.disabled = false;
    } else {
      mintButton.disabled = true;
    }
  }

  function startMint() {
    if (!state.quote) return;
    setNfdPendingMint({
      name: state.quote.nfdName,
      buyer,
      years: state.quote.years,
      cost: state.quote,
      network,
    });
    store.navigate('nfdominter-confirm');
  }

  const nameRow = el('div', {
    cls: 'parsec-nfdominter__name-row',
    children: [nameInput, suffix],
  });

  const yearsRow = el('div', {
    cls: 'parsec-nfdominter__years-row',
    children: [
      el('label', { cls: 'parsec-nfdominter__label', text: 'Years' }),
      yearsInput,
    ],
  });

  // Two columns on a wide screen: choose the name on the left, see its price
  // and act on the right.
  return el('div', {
    cls: 'parsec-nfdominter__mint',
    children: [
      el('div', { cls: 'parsec-nfdominter__mint-pick', children: [nameRow, yearsRow, feedback] }),
      el('div', { cls: 'parsec-nfdominter__mint-price', children: [quoteBox, mintButton] }),
    ],
  });
}

/** A "this name is for sale" row — the optional buy path for a taken name. */
function renderBuyOption(listing: MarketListing): HTMLElement {
  const provider = getMarketplaceProvider(listing.providerId);
  const price = listing.priceMinor !== undefined
    ? `${formatDecimal(BigInt(listing.priceMinor), 6, { trim: true })} ${listing.priceCurrency ?? 'ALGO'}`
    : 'price at checkout';
  return el('div', {
    cls: 'parsec-nfdominter__buy-option',
    children: [
      el('div', {
        cls: 'parsec-nfdominter__buy-info',
        children: [
          el('span', { cls: 'parsec-nfdominter__buy-tag', text: 'For sale' }),
          el('span', { cls: 'parsec-nfdominter__buy-price', text: price }),
          el('span', { cls: 'parsec-nfdominter__hint', text: `via ${provider?.displayName ?? listing.providerId}` }),
        ],
      }),
      btn('Buy', {
        intent: 'primary',
        icon: 'shopping-cart',
        onClick: () => { setNfdPendingBuy(listing); store.navigate('nfdominter-buy'); },
      }),
    ],
  });
}

function renderQuote(q: NfdMintCostBreakdown): HTMLElement {
  const rows: (HTMLElement | string)[] = [
    rowFor('Name price', q.basePrice),
    rowFor('Contract funding', q.carryCost),
    rowFor('Network fee', q.extraFee),
    ...(q.bankonFee > 0n ? [rowFor('Fee', q.bankonFee, true)] : []),
  ];
  rows.push(el('div', { cls: 'parsec-nfdominter__quote-total', children: [
    el('span', { text: 'NFD total' }),
    el('span', { text: formatAlgo(q.totalMicroAlgos) }),
  ]}));
  rows.push(el('div', { cls: 'parsec-nfdominter__hint', text: 'These are necessary: paid to the NFD registry and the network. The BANKONx402 fee for PARSEC (USDC, over x402) is shown separately on the next screen, before anything is paid.' }));
  return el('div', { cls: 'parsec-nfdominter__quote-box', children: rows });
}

function rowFor(label: string, microAlgos: bigint, highlight = false): HTMLElement {
  return el('div', {
    cls: `parsec-nfdominter__quote-row ${highlight ? 'parsec-nfdominter__quote-row--bankon' : ''}`,
    children: [
      el('span', { text: label }),
      el('span', { text: formatAlgo(microAlgos) }),
    ],
  });
}

/** Exact: micro-ALGO as a bigint, formatted without a float. */
function formatAlgo(microAlgos: bigint): string {
  return `${formatDecimal(microAlgos, 6, { trim: true })} ALGO`;
}
