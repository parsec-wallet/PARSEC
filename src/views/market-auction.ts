// Auction listing — countdown + bid form + history.

import { el, btn, input, toast } from '../lib/dom';
import { store, getAccountAddress } from '../lib/store';
import {
  buildBidInput,
  buildSettleAuctionInput,
  getListing,
  type Listing,
} from '../lib/marketplace';
import { signDataItemFromVault } from '../lib/arweave/ans104';
import { aoMessage } from '../lib/arweave/ao';
import { formatArio, parseArio } from '../lib/arweave/ario';

export function marketAuctionView(): HTMLElement {
  const root = el('div', { cls: 'parsec-view parsec-confirm' });
  const id = sessionStorage.getItem('parsec:market-listing-id') ?? '';

  root.appendChild(el('div', {
    cls: 'parsec-view__header',
    children: [
      btn('Back', { minimal: true, icon: 'arrow-left', onClick: () => store.navigate('market-hub') }),
      el('h2', { cls: 'parsec-view__title', text: 'Auction' }),
    ],
  }));

  if (!id) {
    root.appendChild(el('p', { cls: 'parsec-empty', text: 'No listing selected.' }));
    return root;
  }

  const body = el('div', { children: [el('p', { text: 'Loading...' })] });
  root.appendChild(body);

  void render(id, body);
  return root;
}

async function render(id: string, body: HTMLElement): Promise<void> {
  let listing: Listing | null;
  try {
    listing = await getListing(id);
  } catch (e) {
    body.innerHTML = '';
    body.appendChild(el('p', { cls: 'parsec-empty', text: `Could not load: ${e instanceof Error ? e.message : String(e)}` }));
    return;
  }
  if (!listing || !listing.isAuction || !listing.auction) {
    body.innerHTML = '';
    body.appendChild(el('p', { cls: 'parsec-empty', text: 'Not an auction listing.' }));
    return;
  }

  const s = store.get();
  const account = s.accounts[s.activeAccountIndex];
  const address = account ? (getAccountAddress(account, 'arweave-hd') ?? getAccountAddress(account, 'arweave')) : undefined;
  const isSeller = address && listing.seller === address;

  const now = Date.now();
  const remainingMs = listing.auction.endTime - now;
  const remainingText = remainingMs > 0
    ? `${Math.floor(remainingMs / 3600000)}h ${Math.floor((remainingMs % 3600000) / 60000)}m`
    : 'ended';

  body.innerHTML = '';
  body.appendChild(el('div', {
    cls: 'parsec-confirm__details',
    children: [
      row('Name', `${listing.namespace.toUpperCase()} · ${listing.name}`),
      row('Status', listing.status),
      row('Opening price', `${formatArio(BigInt(listing.askPrice))} ${listing.currency}`),
      row('Current bid', listing.auction.currentBid ? `${formatArio(BigInt(listing.auction.currentBid))} ${listing.currency} by ${truncAddr(listing.auction.currentBidder ?? '')}` : '—'),
      row('Min increment', `${formatArio(BigInt(listing.auction.minIncrement))} ${listing.currency}`),
      row('Ends in', remainingText),
      row('Seller', truncAddr(listing.seller)),
    ],
  }));

  if (listing.status === 'sold' || listing.status === 'cancelled') {
    body.appendChild(el('p', { cls: 'parsec-empty', text: `Auction is ${listing.status}.` }));
    return;
  }

  // Bid (anyone with an Arweave key).
  if (address && remainingMs > 0) {
    const bidInput = input({ placeholder: 'bid (ARIO)', cls: 'bp5-input bp5-fill' });
    body.appendChild(el('div', {
      cls: 'parsec-confirm__details',
      children: [
        el('h4', { text: 'Place bid' }),
        bidInput,
        btn('Submit bid', {
          intent: 'primary',
          onClick: async () => {
            let micro: bigint;
            try { micro = parseArio(bidInput.value.trim()); } catch (e) { toast(e instanceof Error ? e.message : 'Invalid', 'warning'); return; }
            const passphrase = store.getPassphrase();
            if (!passphrase) { toast('Wallet is locked', 'danger'); return; }
            const signed = await signDataItemFromVault(
              address,
              passphrase,
              buildBidInput({ listingId: id, amount: micro }),
            );
            await aoMessage(signed);
            toast('Bid submitted', 'success');
            await render(id, body);
          },
        }),
      ],
    }));
  }

  // Settle (anyone after end-time).
  if (remainingMs <= 0) {
    body.appendChild(el('div', {
      cls: 'parsec-confirm__details',
      children: [
        el('h4', { text: 'Settle' }),
        el('p', { text: 'Auction ended. Anyone can trigger settlement; the winning bidder gets the name once the BMR confirms.' }),
        btn('Settle auction', {
          intent: 'primary',
          onClick: async () => {
            if (!address) { toast('Wallet locked', 'danger'); return; }
            const passphrase = store.getPassphrase();
            if (!passphrase) { toast('Wallet is locked', 'danger'); return; }
            const signed = await signDataItemFromVault(
              address,
              passphrase,
              buildSettleAuctionInput({ listingId: id }),
            );
            await aoMessage(signed);
            toast('Settle requested', 'success');
            await render(id, body);
          },
        }),
      ],
    }));
  }

  if (isSeller) {
    body.appendChild(el('p', { cls: 'parsec-view__desc', text: 'You are the seller. Auctions with active bids cannot be cancelled.' }));
  }
}

function row(label: string, value: string): HTMLElement {
  return el('div', {
    cls: 'parsec-confirm__row',
    children: [
      el('span', { cls: 'parsec-confirm__label', text: label }),
      el('span', { cls: 'parsec-confirm__value', text: value }),
    ],
  });
}

function truncAddr(a: string): string {
  if (!a) return '—';
  if (a.length <= 16) return a;
  return `${a.slice(0, 8)}...${a.slice(-6)}`;
}
