// Marketspace hub — landing for the BANKON Marketspace Registry.
//
// Public-facing brand: "BANKON Marketspace". Mirrored at
// https://agenticplace.pythai.net/marketspace (the web-side companion
// dApp; the in-wallet view here is the sovereign client).
//   * My listings (sold + active)
//   * My offers
//   * Browse-all with filter by namespace / status
//   * "Create listing" CTA (forwards to market-create)
//   * Name stores — .algo subdomains and ArNS undernames sold by their owners
//     over x402, BANKONx402 facilitation fee 10 % (views/nfdominter-stores.ts)

import { el, btn, toast } from '../lib/dom';
import { store, getAccountAddress } from '../lib/store';
import {
  getMyListings,
  getMyOffers,
  isBmrConfigured,
  listListings,
  type Listing,
  type ListingStatus,
  type Namespace,
} from '../lib/marketplace';
import { getBmrProcessId } from '../lib/marketplace/process-id';
import { buildMarketspaceStores } from './nfdominter-stores';

export function marketHubView(): HTMLElement {
  const root = el('div', { cls: 'parsec-view parsec-confirm' });
  let statusFilter: ListingStatus | undefined;
  let namespaceFilter: Namespace | undefined;

  const s = store.get();
  const account = s.accounts[s.activeAccountIndex];
  const address = account
    ? (getAccountAddress(account, 'arweave-hd') ?? getAccountAddress(account, 'arweave'))
    : undefined;

  root.appendChild(el('div', {
    cls: 'parsec-view__header',
    children: [
      btn('Back', { minimal: true, icon: 'arrow-left', onClick: () => store.navigate('dashboard') }),
      el('h2', { cls: 'parsec-view__title', text: 'BANKON Marketspace' }),
    ],
  }));

  // Mirror dApp on the web — useful for non-PARSEC users or for quick
  // sharing of a listing URL. Always shown, regardless of BMR state.
  root.appendChild(el('div', {
    cls: 'parsec-callout',
    children: [
      el('p', {
        children: [
          'Web mirror: ',
          el('a', {
            attrs: {
              href: 'https://agenticplace.pythai.net/marketspace',
              target: '_blank',
              rel: 'noopener',
            },
            text: 'agenticplace.pythai.net/marketspace',
          }),
        ],
      }),
    ],
  }));

  // Name stores need no AO registry: they live in the store registry and settle over x402.
  root.appendChild(buildMarketspaceStores());

  if (!isBmrConfigured()) {
    root.appendChild(el('div', {
      cls: 'parsec-callout bp5-callout bp5-intent-warning',
      children: [
        el('p', { text: 'Marketspace Registry not spawned yet. Run scripts/spawn-bmr.mjs (CLI) or use the BANKON admin → Marketspace tab.' }),
        btn('Open admin', { intent: 'primary', onClick: () => store.navigate('bankon-admin') }),
      ],
    }));
    return root;
  }

  root.appendChild(el('p', {
    cls: 'parsec-view__desc',
    text: `Trade names from the BANKON and ArNS namespaces. Registry: ${truncAddr(getBmrProcessId())}.`,
  }));

  if (!address) {
    root.appendChild(el('div', {
      cls: 'parsec-callout bp5-callout bp5-intent-warning',
      children: [el('p', { text: 'No Arweave address on this account — read-only mode.' })],
    }));
  }

  // ── My listings ────────────────────────────────────────
  const mySection = el('div', { cls: 'parsec-confirm__details', children: [el('h4', { text: 'My listings' }), el('p', { text: 'Loading...' })] });
  root.appendChild(mySection);
  if (address) void renderMyListings(address, mySection);

  // ── My offers ──────────────────────────────────────────
  const offersSection = el('div', { cls: 'parsec-confirm__details', children: [el('h4', { text: 'My offers' }), el('p', { text: 'Loading...' })] });
  root.appendChild(offersSection);
  if (address) void renderMyOffers(address, offersSection);

  // ── Filters + browse ───────────────────────────────────
  const namespaceSelect = el('select', {
    cls: 'bp5-input',
    children: [
      el('option', { attrs: { value: '' }, text: 'any namespace' }),
      el('option', { attrs: { value: 'bankon' }, text: 'BANKON' }),
      el('option', { attrs: { value: 'arns' }, text: 'ArNS' }),
    ],
  }) as HTMLSelectElement;
  const statusSelect = el('select', {
    cls: 'bp5-input',
    children: [
      el('option', { attrs: { value: '' }, text: 'any status' }),
      el('option', { attrs: { value: 'open' }, text: 'open' }),
      el('option', { attrs: { value: 'escrowed' }, text: 'escrowed' }),
      el('option', { attrs: { value: 'sold' }, text: 'sold' }),
      el('option', { attrs: { value: 'cancelled' }, text: 'cancelled' }),
    ],
  }) as HTMLSelectElement;
  const browseSection = el('div', { cls: 'parsec-confirm__details', children: [el('h4', { text: 'Browse listings' }), el('p', { text: 'Loading...' })] });
  function refreshBrowse(): void {
    statusFilter = (statusSelect.value || undefined) as ListingStatus | undefined;
    namespaceFilter = (namespaceSelect.value || undefined) as Namespace | undefined;
    browseSection.innerHTML = '';
    browseSection.appendChild(el('h4', { text: 'Browse listings' }));
    browseSection.appendChild(el('div', { children: [namespaceSelect, statusSelect] }));
    browseSection.appendChild(el('p', { text: 'Loading...' }));
    void renderBrowse(browseSection);
  }
  namespaceSelect.addEventListener('change', refreshBrowse);
  statusSelect.addEventListener('change', refreshBrowse);
  browseSection.appendChild(el('div', { children: [namespaceSelect, statusSelect] }));
  root.appendChild(browseSection);
  void renderBrowse(browseSection);

  // ── Actions ────────────────────────────────────────────
  root.appendChild(el('div', {
    cls: 'parsec-confirm__actions',
    children: [
      btn('Create listing', {
        intent: 'primary',
        large: true,
        icon: 'add',
        onClick: () => store.navigate('market-create'),
      }),
      btn('Refresh', {
        minimal: true,
        icon: 'refresh',
        onClick: () => {
          if (address) {
            mySection.innerHTML = '';
            mySection.appendChild(el('h4', { text: 'My listings' }));
            mySection.appendChild(el('p', { text: 'Loading...' }));
            void renderMyListings(address, mySection);
            offersSection.innerHTML = '';
            offersSection.appendChild(el('h4', { text: 'My offers' }));
            offersSection.appendChild(el('p', { text: 'Loading...' }));
            void renderMyOffers(address, offersSection);
          }
          refreshBrowse();
        },
      }),
    ],
  }));

  async function renderBrowse(into: HTMLElement): Promise<void> {
    try {
      const items = await listListings({ status: statusFilter, namespace: namespaceFilter });
      into.innerHTML = '';
      into.appendChild(el('h4', { text: `Browse listings (${items.length})` }));
      into.appendChild(el('div', { children: [namespaceSelect, statusSelect] }));
      if (items.length === 0) {
        into.appendChild(el('p', { cls: 'parsec-empty', text: 'No listings match the filter.' }));
        return;
      }
      for (const listing of items) into.appendChild(listingRow(listing));
    } catch (e) {
      into.innerHTML = '';
      into.appendChild(el('h4', { text: 'Browse listings' }));
      into.appendChild(el('p', { cls: 'parsec-empty', text: `Could not load: ${e instanceof Error ? e.message : String(e)}` }));
    }
  }

  return root;
}

async function renderMyListings(address: string, section: HTMLElement): Promise<void> {
  try {
    const items = await getMyListings(address);
    section.innerHTML = '';
    section.appendChild(el('h4', { text: `My listings (${items.length})` }));
    if (items.length === 0) {
      section.appendChild(el('p', { cls: 'parsec-empty', text: 'No listings yet.' }));
      return;
    }
    for (const l of items) section.appendChild(listingRow(l));
  } catch (e) {
    section.innerHTML = '';
    section.appendChild(el('h4', { text: 'My listings' }));
    section.appendChild(el('p', { cls: 'parsec-empty', text: `Could not load: ${e instanceof Error ? e.message : String(e)}` }));
  }
}

async function renderMyOffers(address: string, section: HTMLElement): Promise<void> {
  try {
    const items = await getMyOffers(address);
    section.innerHTML = '';
    section.appendChild(el('h4', { text: `My offers (${items.length})` }));
    if (items.length === 0) {
      section.appendChild(el('p', { cls: 'parsec-empty', text: 'No offers yet.' }));
      return;
    }
    for (const o of items) {
      section.appendChild(el('div', {
        cls: 'parsec-confirm__row',
        children: [
          el('span', { cls: 'parsec-confirm__label', text: truncAddr(o.listingId) }),
          el('span', { cls: 'parsec-confirm__value', text: `${o.offerPrice} mARIO · ${o.status}` }),
        ],
      }));
    }
  } catch (e) {
    section.innerHTML = '';
    section.appendChild(el('h4', { text: 'My offers' }));
    section.appendChild(el('p', { cls: 'parsec-empty', text: `Could not load: ${e instanceof Error ? e.message : String(e)}` }));
  }
}

function listingRow(l: Listing): HTMLElement {
  const summary = `${l.namespace.toUpperCase()} · ${l.name} · ${l.askPrice} ${l.currency} · ${l.status}${l.isAuction ? ' · auction' : ''}`;
  return el('div', {
    cls: 'parsec-confirm__row',
    children: [
      el('span', { cls: 'parsec-confirm__label', text: l.name }),
      el('span', { cls: 'parsec-confirm__value', text: summary }),
      btn('Open', {
        minimal: true,
        onClick: () => {
          sessionStorage.setItem('parsec:market-listing-id', l.id);
          store.navigate(l.isAuction ? 'market-auction' : 'market-listing');
        },
      }),
      btn('Copy id', {
        minimal: true,
        onClick: () => {
          void navigator.clipboard.writeText(l.id);
          toast('Listing id copied', 'success');
        },
      }),
    ],
  });
}

function truncAddr(a: string): string {
  if (!a) return '—';
  if (a.length <= 16) return a;
  return `${a.slice(0, 8)}...${a.slice(-6)}`;
}
