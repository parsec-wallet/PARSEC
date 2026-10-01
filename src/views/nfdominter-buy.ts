// Buy an already-registered .algo name through a marketplace provider.
//
// Reached from the NFDominter mint tab when a typed name turns out to be
// listed for sale: minting is impossible, but buying is not. This view
// fetches a firm quote, gates the spend on a live balance check, signs the
// purchase and shows a success screen — mirroring nfdominter-confirm.ts.

import { el, btn, toast } from '../lib/dom';
import { store, getAccountAddress } from '../lib/store';
import { getMarketplaceProvider, type MarketListing } from '../lib/marketplace';
import { fetchAccountInfo, microAlgosToAlgo } from '../lib/algorand/account';
import { invalidateNfdCaches } from '../lib/nfd';
import type { AccountInfo } from '../types/wallet';

let pending: MarketListing | null = null;

export function setNfdPendingBuy(listing: MarketListing): void { pending = listing; }

export function nfdominterBuyView(): HTMLElement {
  if (!pending) {
    store.navigate('nfdominter');
    return el('div');
  }
  const listing = pending;
  const root = el('div', { cls: 'parsec-view parsec-nfdominter__confirm' });

  const provider = getMarketplaceProvider(listing.providerId);
  const s = store.get();
  const account = s.accounts[s.activeAccountIndex];
  const buyer = account ? (getAccountAddress(account, 'algorand') ?? account.address) : '';

  const progress = el('div', { cls: 'parsec-nfdominter__progress', text: 'Fetching purchase quote…' });
  const errorBox = el('div', { cls: 'parsec-nfdominter__error', attrs: { hidden: 'true' } });
  const priceBox = el('div', { cls: 'parsec-nfdominter__quote-box' });
  const balanceBox = el('div', { cls: 'parsec-nfdominter__balance' });

  const buyBtn = btn('Sign and buy', {
    intent: 'primary',
    large: true,
    icon: 'shopping-cart',
    disabled: true, // unlocked once the quote + balance check pass
    cls: 'parsec-nfdominter__sign-btn',
    onClick: () => { void run(); },
  });
  const backBtn = btn('Back', {
    minimal: true,
    icon: 'arrow-left',
    onClick: () => { pending = null; store.navigate('nfdominter'); },
  });

  let totalMicroAlgos = 0n;

  // ── Quote → balance check ───────────────────────────────────────────────
  void (async () => {
    if (!provider?.quote) {
      showError(new Error(`Provider "${listing.providerId}" cannot quote a purchase.`));
      return;
    }
    try {
      const quote = await provider.quote(listing, buyer);
      totalMicroAlgos = quote.totalMinor;
      priceBox.innerHTML = '';
      priceBox.append(
        quoteRow('Marketplace', provider.displayName),
        quoteRow('Name', listing.title),
        quoteRow('Seller', listing.seller ? short(listing.seller) : 'unknown'),
        el('div', { cls: 'parsec-nfdominter__quote-total', children: [
          el('span', { text: 'Purchase price' }),
          el('span', { text: `${microAlgosToAlgo(Number(totalMicroAlgos))} ${quote.currency}` }),
        ]}),
      );
      if (!quote.canBuy) {
        progress.textContent = '';
        balanceBox.appendChild(el('div', {
          cls: 'parsec-callout bp5-callout bp5-intent-danger',
          text: quote.reason ?? 'This name cannot be bought right now.',
        }));
        return;
      }
      progress.textContent = 'Checking wallet balance…';
      await checkBalance();
    } catch (e) {
      showError(e);
    }
  })();

  async function checkBalance(): Promise<void> {
    try {
      const info: AccountInfo = await fetchAccountInfo(buyer, listing.network);
      const total = Number(totalMicroAlgos);
      const spendable = info.amount - info.minBalance;
      balanceBox.innerHTML = '';
      balanceBox.append(
        row('Wallet balance', `${microAlgosToAlgo(info.amount)} ALGO`),
        row('Remaining after', `${microAlgosToAlgo(Math.max(0, info.amount - total))} ALGO`),
      );
      const ok = spendable >= total;
      if (!ok) {
        balanceBox.appendChild(el('div', {
          cls: 'parsec-callout bp5-callout bp5-intent-danger',
          text: `Insufficient ALGO. This purchase needs ${microAlgosToAlgo(total)} ALGO spendable.`,
        }));
      }
      progress.textContent = ok ? 'Ready to buy.' : '';
      buyBtn.disabled = !ok;
    } catch {
      balanceBox.appendChild(el('div', {
        cls: 'parsec-callout bp5-callout bp5-intent-warning',
        text: 'Could not load the wallet balance — make sure the account is funded before signing.',
      }));
      progress.textContent = 'Ready to buy.';
      buyBtn.disabled = false; // allow, but warned
    }
  }

  async function run(): Promise<void> {
    const pass = store.getPassphrase();
    if (!pass) { toast('Session locked. Unlock first.', 'warning'); return; }
    if (!provider) { showError(new Error('Marketplace provider unavailable.')); return; }
    buyBtn.disabled = true;
    backBtn.disabled = true;
    errorBox.setAttribute('hidden', 'true');
    errorBox.innerHTML = '';
    progress.textContent = 'Submitting purchase — awaiting confirmation…';
    try {
      const result = await provider.buy({ listing, buyer, passphrase: pass });
      if (result.settled) {
        invalidateNfdCaches();
        toast(`Bought ${listing.title}.`, 'success');
        pending = null;
        renderSuccess(result.txid);
      } else if (result.route) {
        store.navigate(result.route as Parameters<typeof store.navigate>[0]);
      } else if (result.externalUrl) {
        window.open(result.externalUrl, '_blank', 'noopener');
        progress.textContent = 'Complete the purchase in the opened marketplace tab.';
      }
    } catch (e) {
      progress.textContent = '';
      showError(e);
      buyBtn.disabled = false;
      backBtn.disabled = false;
    }
  }

  function showError(e: unknown): void {
    const message = e instanceof Error ? e.message : String(e);
    const stack = e instanceof Error && e.stack ? e.stack : message;
    console.error('[nfdominter-buy] purchase failed:', e);
    const copyBtn = btn('Copy error', {
      minimal: true,
      icon: 'duplicate',
      onClick: () => {
        void navigator.clipboard.writeText(stack).then(
          () => toast('Error copied to clipboard.', 'success'),
          () => toast('Copy failed — select the text manually.', 'warning'),
        );
      },
    });
    errorBox.innerHTML = '';
    errorBox.append(el('div', { cls: 'parsec-callout bp5-callout bp5-intent-danger', children: [
      el('div', { cls: 'parsec-nfdominter__error-title', text: 'Purchase failed' }),
      el('pre', { cls: 'parsec-nfdominter__error-message', text: message }),
      copyBtn,
    ]}));
    errorBox.removeAttribute('hidden');
  }

  function renderSuccess(txid?: string): void {
    root.innerHTML = '';
    root.append(
      el('div', { cls: 'parsec-view__header', children: [
        el('h2', { cls: 'parsec-view__title', text: 'Purchased' }),
      ]}),
      el('div', { cls: 'parsec-nfdominter__success', children: [
        el('div', { cls: 'parsec-nfdominter__success-mark', text: '✓' }),
        el('h3', { cls: 'parsec-nfdominter__success-name', text: `You own ${listing.title}` }),
        el('p', { cls: 'parsec-view__desc', text: txid ? `NFD application ${txid}.` : 'Purchase confirmed.' }),
        btn('Done', {
          intent: 'primary',
          large: true,
          cls: 'parsec-nfdominter__sign-btn',
          onClick: () => store.navigate('dashboard'),
        }),
      ]}),
    );
  }

  root.append(
    el('div', { cls: 'parsec-view__header', children: [
      backBtn,
      el('h2', { cls: 'parsec-view__title', text: `Buy ${listing.title}` }),
    ]}),
    el('div', {
      cls: 'parsec-nfdominter__confirm-network',
      children: [
        el('span', {
          cls: `parsec-network-badge parsec-network-badge--${listing.network}`,
          text: listing.network.toUpperCase(),
        }),
        listing.network === 'mainnet'
          ? el('span', { cls: 'parsec-nfdominter__hint parsec-nfdominter__hint--error', text: 'This spends real ALGO and cannot be undone.' })
          : el('span', { cls: 'parsec-nfdominter__hint', text: 'Test network — no real value at stake.' }),
      ],
    }),
    priceBox,
    balanceBox,
    el('div', { cls: 'parsec-nfdominter__confirm-note', children: [
      el('p', { text: 'The marketplace provider builds and submits the purchase transaction. The name transfers to this account on confirmation.' }),
      listing.url
        ? el('p', { cls: 'parsec-nfdominter__muted', children: [
            'Listing: ',
            el('a', { cls: 'parsec-asset-link', text: listing.url, attrs: { href: listing.url, target: '_blank', rel: 'noopener' } }),
          ]})
        : el('span'),
    ]}),
    errorBox,
    progress,
    buyBtn,
  );

  return root;
}

function short(a: string): string {
  return a.length <= 14 ? a : `${a.slice(0, 8)}…${a.slice(-6)}`;
}

function row(label: string, value: string): HTMLElement {
  return el('div', { cls: 'parsec-nfdominter__summary-row', children: [
    el('span', { cls: 'parsec-nfdominter__summary-label', text: label }),
    el('span', { cls: 'parsec-nfdominter__summary-value', text: value }),
  ]});
}

function quoteRow(label: string, value: string): HTMLElement {
  return el('div', { cls: 'parsec-nfdominter__quote-row', children: [
    el('span', { text: label }),
    el('span', { text: value }),
  ]});
}
