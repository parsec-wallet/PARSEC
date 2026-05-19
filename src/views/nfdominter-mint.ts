// Mint tab — search-as-you-type name input, live tier/availability/price
// feedback, BANKON fee line, and a Mint button that kicks off the review
// flow via the connect-style confirm view.

import { el, input, btn, toast } from '../lib/dom';
import { store } from '../lib/store';
import {
  classifyTier,
  getMintQuoteWithBankonFee,
  isFeeConfigured,
  normalizeName,
  nameError,
  rootLength,
  resolveName,
  type Nfd,
  type NfdMintCostBreakdown,
  type NfdTier,
} from '../lib/nfd';
import type { NetworkId } from '../types/wallet';
import { setNfdPendingMint } from './nfdominter-confirm';

interface LookupState {
  name: string;
  error: string | null;
  existing: Nfd | null;
  quote: NfdMintCostBreakdown | null;
  loading: boolean;
}

const DEBOUNCE_MS = 350;

export function buildMintTab(buyer: string, network: NetworkId): HTMLElement {
  const state: LookupState = { name: '', error: null, existing: null, quote: null, loading: false };
  let debounce: ReturnType<typeof setTimeout> | null = null;

  const nameInput = input({
    placeholder: 'yourname',
    cls: 'parsec-nfdominter__name-input bp5-input bp5-large',
    onInput: (raw) => {
      state.name = raw;
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => { void refresh(); }, DEBOUNCE_MS);
      render();
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

  const mintButton = btn('Mint', {
    intent: 'primary',
    large: true,
    icon: 'confirm',
    disabled: true,
    onClick: () => startMint(),
  });

  async function refresh() {
    const full = normalizeName(state.name);
    state.error = nameError(state.name);
    state.existing = null;
    state.quote = null;
    if (state.error || !full) {
      render();
      return;
    }
    state.loading = true;
    render();
    try {
      const [existing, yearsRaw] = [await resolveName(network, full), Number(yearsInput.value) || 1];
      state.existing = existing;
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
    if (!isFeeConfigured()) {
      toast('BANKON fee address not configured at build time. Mint skipped.', 'warning');
      return;
    }
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

  return el('div', {
    cls: 'parsec-nfdominter__mint',
    children: [nameRow, yearsRow, feedback, quoteBox, mintButton],
  });
}

function renderQuote(q: NfdMintCostBreakdown): HTMLElement {
  const rows: (HTMLElement | string)[] = [
    rowFor('NFD price', q.basePrice),
    rowFor('Contract funding', q.carryCost),
    rowFor('Network fee', q.extraFee),
    rowFor('BANKON fee', q.bankonFee, true),
  ];
  rows.push(el('div', { cls: 'parsec-nfdominter__quote-total', children: [
    el('span', { text: 'You pay' }),
    el('span', { text: formatAlgo(q.totalMicroAlgos) }),
  ]}));
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

function formatAlgo(microAlgos: bigint): string {
  const algos = Number(microAlgos) / 1_000_000;
  return `${algos.toLocaleString(undefined, { maximumFractionDigits: 6 })} ALGO`;
}
