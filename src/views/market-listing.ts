// Single-listing view: details + actions.
//   * Seller: cancel listing (only if no active bids).
//   * Buyer:  make offer OR settle-now (buy now) at the ask price.

import { el, btn, input, toast } from '../lib/dom';
import { store, getAccountAddress } from '../lib/store';
import {
  buildCancelListingInput,
  buildMakeOfferInput,
  buildSettleTradeInput,
  getListing,
  type Listing,
} from '../lib/marketplace';
import { signDataItemFromVault } from '../lib/arweave/ans104';
import { aoMessage } from '../lib/arweave/ao';
import { formatArio, parseArio } from '../lib/arweave/ario';

export function marketListingView(): HTMLElement {
  const root = el('div', { cls: 'parsec-view parsec-confirm' });
  const id = sessionStorage.getItem('parsec:market-listing-id') ?? '';

  root.appendChild(el('div', {
    cls: 'parsec-view__header',
    children: [
      btn('Back', { minimal: true, icon: 'arrow-left', onClick: () => store.navigate('market-hub') }),
      el('h2', { cls: 'parsec-view__title', text: 'Listing' }),
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
  if (!listing) {
    body.innerHTML = '';
    body.appendChild(el('p', { cls: 'parsec-empty', text: 'Listing not found.' }));
    return;
  }
  if (listing.isAuction) {
    body.innerHTML = '';
    body.appendChild(el('p', { cls: 'parsec-empty', text: 'This listing is an auction.' }));
    body.appendChild(btn('Open auction view', { intent: 'primary', onClick: () => store.navigate('market-auction') }));
    return;
  }

  const s = store.get();
  const account = s.accounts[s.activeAccountIndex];
  const address = account ? (getAccountAddress(account, 'arweave-hd') ?? getAccountAddress(account, 'arweave')) : undefined;
  const isSeller = address && listing.seller === address;

  body.innerHTML = '';
  body.appendChild(el('div', {
    cls: 'parsec-confirm__details',
    children: [
      row('Name', `${listing.namespace.toUpperCase()} · ${listing.name}`),
      row('Status', listing.status),
      row('Ask price', `${formatArio(BigInt(listing.askPrice))} ${listing.currency}`),
      row('Seller', truncAddr(listing.seller)),
      row('Created', new Date(listing.createdAt).toLocaleString()),
      row('Expires', listing.expiresAt ? new Date(listing.expiresAt).toLocaleString() : '—'),
    ],
  }));

  if (listing.status === 'sold' || listing.status === 'cancelled') {
    body.appendChild(el('p', { cls: 'parsec-empty', text: `Listing is ${listing.status}.` }));
    return;
  }

  if (isSeller && !listing.isAuction) {
    body.appendChild(el('div', {
      cls: 'parsec-confirm__details',
      children: [
        el('h4', { text: 'Seller actions' }),
        btn('Cancel listing', {
          intent: 'danger',
          onClick: async () => {
            if (!confirm('Cancel this listing?')) return;
            const passphrase = store.getPassphrase();
            if (!passphrase || !address) { toast('Wallet is locked', 'danger'); return; }
            const signed = await signDataItemFromVault(
              address,
              passphrase,
              buildCancelListingInput({ listingId: id }),
            );
            await aoMessage(signed);
            toast('Cancelled', 'success');
            await render(id, body);
          },
        }),
      ],
    }));
    return;
  }

  // Buyer actions.
  if (!address) {
    body.appendChild(el('p', { cls: 'parsec-empty', text: 'No Arweave address — read-only view.' }));
    return;
  }
  const offerPriceInput = input({ placeholder: 'offer price (ARIO)', cls: 'bp5-input bp5-fill' });
  const paymentProofInput = input({ placeholder: 'Payment proof (Arweave tx-id once paid)', cls: 'bp5-input bp5-fill' });

  body.appendChild(el('div', {
    cls: 'parsec-confirm__details',
    children: [
      el('h4', { text: 'Buy now (settle at ask)' }),
      paymentProofInput,
      btn('Settle now', {
        intent: 'primary',
        onClick: async () => {
          const proof = paymentProofInput.value.trim();
          if (proof.length !== 43) { toast('Payment-Proof must be a 43-char Arweave tx-id', 'warning'); return; }
          const passphrase = store.getPassphrase();
          if (!passphrase) { toast('Wallet is locked', 'danger'); return; }
          const signed = await signDataItemFromVault(
            address,
            passphrase,
            buildSettleTradeInput({
              listingId: id,
              paymentMethod: 'ario',
              paymentProof: proof,
              paymentAmount: BigInt(listing!.askPrice),
            }),
          );
          await aoMessage(signed);
          toast('Settle-Trade signed; BMR will transfer the name on confirmation', 'success');
          await render(id, body);
        },
      }),
      el('h4', { text: 'Make offer' }),
      offerPriceInput,
      btn('Submit offer', {
        onClick: async () => {
          const price = offerPriceInput.value.trim();
          let microArio: bigint;
          try { microArio = parseArio(price); } catch (e) { toast(e instanceof Error ? e.message : 'Invalid price', 'warning'); return; }
          if (microArio <= 0n) { toast('Offer must be > 0', 'warning'); return; }
          const passphrase = store.getPassphrase();
          if (!passphrase) { toast('Wallet is locked', 'danger'); return; }
          const signed = await signDataItemFromVault(
            address,
            passphrase,
            buildMakeOfferInput({ listingId: id, offerPrice: microArio }),
          );
          await aoMessage(signed);
          toast('Offer submitted', 'success');
        },
      }),
    ],
  }));
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
