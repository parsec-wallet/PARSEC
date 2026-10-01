// PARSEC Wallet — Receive View
// Shows the address plus an ARC-26 algorand:// URI with optional amount.
// The URI can be scanned by Pera/Defly mobile to pre-fill a payment.

import { el, btn, toast } from '../lib/dom';
import { store } from '../lib/store';
import { encodeArc26 } from '../lib/algorand/arc26';
import { resolveAddress } from '../lib/nfd';

export function receiveView(): HTMLElement {
  const state = store.get();
  const account = state.accounts[state.activeAccountIndex];

  if (!account) {
    store.navigate('onboarding');
    return el('div');
  }

  // Mutable amount + asset state for the URI builder.
  let amountAlgo = '';
  let assetIdStr = '';

  const uriBox = el('div', { cls: 'parsec-receive__uri', text: '' });
  const uriHint = el('div', { cls: 'parsec-receive__uri-hint', text: 'ARC-26 transaction request URI — scan with any compatible Algorand wallet.' });

  function rebuildUri(): void {
    const amountFloat = parseFloat(amountAlgo);
    const microAlgos = Number.isFinite(amountFloat) && amountFloat > 0
      ? Math.floor(amountFloat * 1_000_000)
      : undefined;
    const assetId = assetIdStr.trim() ? Number(assetIdStr.trim()) : undefined;

    try {
      const uri = encodeArc26({
        address: account.address,
        amount: microAlgos,
        assetId: Number.isInteger(assetId) && assetId! >= 0 ? assetId : undefined,
      });
      uriBox.textContent = uri;
    } catch (err) {
      uriBox.textContent = err instanceof Error ? err.message : 'Invalid request';
    }
  }
  rebuildUri();

  // Primary .algo name — PARSEC recognizes an NFD as part of the receive
  // identity. Reverse-lookup is cached; render the chip only on a hit.
  const nfdChip = el('div', { cls: 'parsec-receive__nfd', attrs: { hidden: 'true' } });
  void resolveAddress(state.settings.network, account.address)
    .then((nfd) => {
      if (!nfd?.name) return;
      nfdChip.innerHTML = '';
      nfdChip.append(
        el('span', { cls: 'parsec-receive__nfd-tag', text: '.algo' }),
        el('span', { cls: 'parsec-receive__nfd-name', text: nfd.name }),
      );
      nfdChip.removeAttribute('hidden');
    })
    .catch(() => { /* no NFD / offline — leave the chip hidden */ });

  const amountInput = el('input', {
    cls: 'parsec-input',
    attrs: { type: 'number', step: '0.000001', min: '0', placeholder: 'Amount in ALGO (optional)' },
  }) as HTMLInputElement;
  amountInput.addEventListener('input', () => { amountAlgo = amountInput.value; rebuildUri(); });

  const assetInput = el('input', {
    cls: 'parsec-input',
    attrs: { type: 'number', step: '1', min: '0', placeholder: 'ASA id (optional, e.g. 31566704 for USDC)' },
  }) as HTMLInputElement;
  assetInput.addEventListener('input', () => { assetIdStr = assetInput.value; rebuildUri(); });

  return el('div', {
    cls: 'parsec-view parsec-receive',
    children: [
      el('div', {
        cls: 'parsec-view__header',
        children: [
          btn('Back', { minimal: true, icon: 'arrow-left', onClick: () => store.navigate('dashboard') }),
          el('h2', { cls: 'parsec-view__title', text: 'Receive ALGO' }),
        ],
      }),
      el('p', {
        cls: 'parsec-view__desc',
        text: 'Share your public address — or a structured payment request — to receive ALGO or ASAs.',
      }),
      el('div', {
        cls: 'parsec-receive__address-box',
        children: [
          el('div', { cls: 'parsec-receive__label', text: 'Your Algorand Address' }),
          nfdChip,
          el('div', { cls: 'parsec-receive__address', text: account.address }),
        ],
      }),
      btn('Copy Address', {
        intent: 'primary', large: true, icon: 'clipboard',
        onClick: () => { navigator.clipboard.writeText(account.address); toast('Address copied to clipboard', 'success'); },
      }),
      el('div', {
        cls: 'parsec-receive__request',
        children: [
          el('h3', { cls: 'parsec-section-title', text: 'Payment Request (ARC-26)' }),
          amountInput,
          assetInput,
          uriBox,
          uriHint,
          btn('Copy Request URI', {
            outlined: true, icon: 'duplicate',
            onClick: () => { navigator.clipboard.writeText(uriBox.textContent || ''); toast('ARC-26 URI copied', 'success'); },
          }),
        ],
      }),
      el('p', {
        cls: 'parsec-view__desc parsec-receive__note',
        text: 'Only send Algorand (ALGO) and Algorand Standard Assets (ASAs) to this address.',
      }),
    ],
  });
}
