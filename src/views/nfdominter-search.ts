// Search tab — faceted browser over NFDs. First pass keeps the facets
// simple (substring + state). Richer filters (length, tier, traits) can
// land in a follow-up without changing the layout.

import { el, input, btn, toast } from '../lib/dom';
import { searchNfds, type Nfd, type SearchResponse } from '../lib/nfd';
import type { NetworkId } from '../types/wallet';

export function buildSearchTab(network: NetworkId): HTMLElement {
  const results = el('div', { cls: 'parsec-nfdominter__results' });
  const status = el('div', { cls: 'parsec-nfdominter__search-status' });

  let currentQuery = '';
  let debounce: ReturnType<typeof setTimeout> | null = null;

  const searchInput = input({
    placeholder: 'substring (min 3 chars)',
    cls: 'bp5-input bp5-large parsec-nfdominter__search-input',
    onInput: (val) => {
      currentQuery = val.trim();
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => { void run(); }, 400);
    },
  });

  async function run() {
    results.innerHTML = '';
    status.textContent = '';
    if (currentQuery.length < 3) {
      status.textContent = 'Type at least 3 characters.';
      return;
    }
    status.textContent = 'searching…';
    try {
      const resp: SearchResponse = await searchNfds(network, {
        substring: currentQuery,
        limit: 40,
        sort: 'nameAsc',
        view: 'brief',
      });
      status.textContent = `${resp.total.toLocaleString()} match${resp.total === 1 ? '' : 'es'}`;
      for (const nfd of resp.nfds) results.appendChild(renderCard(nfd));
    } catch (e) {
      status.textContent = '';
      toast(`Search failed: ${(e as Error).message}`, 'danger');
    }
  }

  const controls = el('div', {
    cls: 'parsec-nfdominter__search-controls',
    children: [
      searchInput,
      btn('Search', { intent: 'primary', icon: 'search', onClick: () => { void run(); } }),
    ],
  });

  return el('div', {
    cls: 'parsec-nfdominter__search',
    children: [controls, status, results],
  });
}

function renderCard(nfd: Nfd): HTMLElement {
  const owner = nfd.owner;
  return el('div', {
    cls: `parsec-nfdominter__card parsec-nfdominter__card--state-${nfd.state}`,
    children: [
      el('div', { cls: 'parsec-nfdominter__card-name', text: nfd.name }),
      el('div', { cls: 'parsec-nfdominter__card-meta', children: [
        el('span', { cls: 'parsec-nfdominter__card-state', text: nfd.state }),
        el('span', { cls: 'parsec-nfdominter__card-category', text: nfd.category }),
        el('span', { cls: 'parsec-nfdominter__card-owner', text: owner ? `${owner.slice(0, 6)}…${owner.slice(-4)}` : '—' }),
      ]}),
      ...(nfd.saleType
        ? [el('div', { cls: 'parsec-nfdominter__card-sale', text: `${nfd.saleType}${nfd.sellAmount ? ` · ${nfd.sellAmount / 1_000_000} ALGO` : ''}` })]
        : []),
    ],
  });
}
