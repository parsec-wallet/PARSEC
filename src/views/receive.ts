// PARSEC Wallet — Receive
//
// One screen, two halves: on the left the QR code to scan; on the right who is
// receiving (account, chain, .algo name), the address to copy, and — on
// Algorand — a payment request (asset and amount) that the QR code carries as
// an ARC-26 algorand:// URI, which Pera, Defly and other wallets read to
// pre-fill a payment.
//
// The address shown is the account's address on its ACTIVE chain, not always
// the Algorand one. Amounts are exact: parsed with money.ts into base units,
// never through a float.

import { el, btn, copyText } from '../lib/dom';
import { store, getAccountAddress } from '../lib/store';
import { encodeArc26 } from '../lib/algorand/arc26';
import { resolveAddress } from '../lib/nfd';
import { getChainDescriptor } from '../lib/chains';
import { KNOWN_ASSETS } from '../lib/algorand/assets';
import { parseDecimal } from '../lib/money';
import { encodeQr, qrSvg } from '../lib/qr';
import type { ChainId } from '../lib/pouch/types';

interface AssetChoice { key: string; label: string; assetId?: number; decimals: number | null }

export function receiveView(): HTMLElement {
  const state = store.get();
  const account = state.accounts[state.activeAccountIndex];
  if (!account) {
    store.navigate('onboarding');
    return el('div');
  }

  const chain = (account.activeChain ?? 'algorand') as ChainId;
  const desc = getChainDescriptor(chain);
  const address = getAccountAddress(account, chain) ?? account.address;
  const isAlgorand = chain === 'algorand';
  const network = state.settings.network;

  // ── The QR code ───────────────────────────────────────────────────────────
  const qrBox = el('div', { cls: 'parsec-receive2__qr' });
  const qrCaption = el('p', { cls: 'parsec-receive2__qr-caption' });

  // ── Payment request (Algorand) ──────────────────────────────────────────
  const assets: AssetChoice[] = [
    { key: 'algo', label: 'ALGO', decimals: 6 },
    ...KNOWN_ASSETS.filter((a) => a.network === network).map((a) => ({
      key: String(a.assetId), label: `${a.unitName} · ${a.assetId}`, assetId: a.assetId, decimals: a.decimals,
    })),
    { key: 'other', label: 'Other asset (ASA id)…', decimals: null },
  ];
  let choice = assets[0];
  let amountText = '';
  let otherId = '';

  const assetSelect = document.createElement('select');
  assetSelect.className = 'parsec-receive2__select';
  for (const a of assets) {
    const o = document.createElement('option');
    o.value = a.key;
    o.textContent = a.label;
    assetSelect.appendChild(o);
  }
  const otherInput = el('input', {
    cls: 'parsec-receive2__input',
    attrs: { type: 'text', inputmode: 'numeric', placeholder: 'ASA id', hidden: 'true', 'aria-label': 'Asset id' },
  }) as HTMLInputElement;
  const amountInput = el('input', {
    cls: 'parsec-receive2__input',
    attrs: { type: 'text', inputmode: 'decimal', placeholder: 'Amount (optional)', 'aria-label': 'Amount' },
  }) as HTMLInputElement;
  const unitTag = el('span', { cls: 'parsec-receive2__unit', text: 'ALGO' });
  const requestNote = el('p', { cls: 'parsec-receive2__hint' });
  const uriLine = el('code', { cls: 'parsec-receive2__uri' });

  /** The text the QR carries: the plain address, or the ARC-26 request. */
  let qrText = address;

  function rebuild(): void {
    let uri = '';
    requestNote.dataset.tone = '';
    if (isAlgorand) {
      try {
        let assetId: number | undefined = choice.assetId;
        if (choice.key === 'other') {
          if (otherId.trim() && !/^\d+$/.test(otherId.trim())) throw new Error('An ASA id is a whole number.');
          assetId = otherId.trim() ? Number(otherId.trim()) : undefined;
        }
        let amount: bigint | undefined;
        if (amountText.trim()) {
          // Other ASAs: decimals unknown here, so the amount is in base units.
          amount = parseDecimal(amountText, choice.decimals ?? 0);
          if (amount <= 0n) throw new Error('The amount must be more than zero.');
        }
        const wantsRequest = amount !== undefined || assetId !== undefined;
        uri = wantsRequest ? encodeArc26({ address, amount, assetId }) : '';
        requestNote.textContent = choice.key === 'other'
          ? 'Amount in the asset’s base units (its decimals are not looked up here).'
          : wantsRequest ? 'The QR code now carries this request: scanning it pre-fills the payment.' : 'Optional: add an asset and amount to request a specific payment.';
      } catch (e) {
        requestNote.textContent = e instanceof RangeError ? `${choice.label.split(' ')[0]} has ${choice.decimals} decimal places.` : (e instanceof Error ? e.message : String(e));
        requestNote.dataset.tone = 'error';
        uri = '';
      }
    }
    uriLine.textContent = uri;
    uriLine.hidden = !uri;
    copyRequest.hidden = !uri;
    qrText = uri || address;
    drawQr();
  }

  function drawQr(): void {
    try {
      qrBox.replaceChildren(qrSvg(encodeQr(qrText), { label: `QR code for ${qrText}` }));
      qrCaption.textContent = qrText === address ? `Scan to send to this ${desc.label} address` : 'Scan to pay this request';
    } catch (e) {
      qrBox.replaceChildren(el('p', { cls: 'parsec-receive2__hint', text: e instanceof Error ? e.message : String(e) }));
    }
  }

  assetSelect.addEventListener('change', () => {
    choice = assets.find((a) => a.key === assetSelect.value) ?? assets[0];
    otherInput.hidden = choice.key !== 'other';
    unitTag.textContent = choice.key === 'algo' ? 'ALGO' : choice.key === 'other' ? 'units' : choice.label.split(' ')[0];
    rebuild();
  });
  otherInput.addEventListener('input', () => { otherId = otherInput.value; rebuild(); });
  amountInput.addEventListener('input', () => { amountText = amountInput.value; rebuild(); });

  const copyAddress = btn('Copy address', {
    intent: 'primary', large: true, cls: 'parsec-receive2__copy',
    onClick: () => { void copyText(address, `${desc.label} address copied`); },
  });
  const copyRequest = btn('Copy request link', {
    outlined: true, cls: 'parsec-receive2__copy-request',
    onClick: () => { void copyText(uriLine.textContent ?? '', 'Payment request copied'); },
  });

  // ── Who is receiving ──────────────────────────────────────────────────────
  const nfdChip = el('span', { cls: 'parsec-receive2__nfd', attrs: { hidden: 'true' } });
  if (isAlgorand) {
    void resolveAddress(network, address)
      .then((nfd) => {
        if (!nfd?.name) return;
        nfdChip.textContent = nfd.name;
        nfdChip.removeAttribute('hidden');
      })
      .catch(() => { /* no name, or offline */ });
  }

  // The address in groups of four, so it can be read aloud and checked.
  const grouped = el('div', { cls: 'parsec-receive2__address', attrs: { title: address } });
  for (let i = 0; i < address.length; i += 4) grouped.appendChild(el('span', { text: address.slice(i, i + 4) }));

  const identity = el('div', { cls: 'parsec-receive2__who', children: [
    el('div', { cls: 'parsec-receive2__name-row', children: [
      el('span', { cls: 'parsec-receive2__name', text: account.name }),
      el('a', {
        cls: 'parsec-receive2__rename', text: 'Rename', attrs: { href: '#', title: 'Rename this account in the wallet switcher or Settings' },
        onClick: (e) => { e.preventDefault(); store.navigate('settings'); },
      }),
    ] }),
    el('div', { cls: 'parsec-receive2__chips', children: [
      el('span', { cls: 'parsec-receive2__chain', text: desc.label }),
      nfdChip,
      ...(network !== 'mainnet' && isAlgorand ? [el('span', { cls: 'parsec-receive2__net', text: network })] : []),
    ] }),
  ] });

  const request = isAlgorand
    ? el('section', { cls: 'parsec-receive2__request', children: [
      el('h3', { text: 'Request a payment' }),
      el('div', { cls: 'parsec-receive2__row', children: [assetSelect, otherInput] }),
      el('div', { cls: 'parsec-receive2__row parsec-receive2__amount', children: [amountInput, unitTag] }),
      requestNote,
      uriLine,
      copyRequest,
    ] })
    : el('p', { cls: 'parsec-receive2__hint', text: `Payment requests are built for Algorand. Share the ${desc.label} address or its QR code.` });

  rebuild();

  return el('div', {
    cls: 'parsec-view parsec-receive2',
    children: [
      el('div', {
        cls: 'parsec-view__header',
        children: [
          btn('Back', { minimal: true, icon: 'arrow-left', onClick: () => { if (!store.back()) store.navigate('dashboard'); } }),
          el('h2', { cls: 'parsec-view__title', text: `Receive on ${desc.label}` }),
        ],
      }),
      el('div', { cls: 'parsec-receive2__grid', children: [
        el('figure', { cls: 'parsec-receive2__card parsec-receive2__qr-card', children: [qrBox, qrCaption] }),
        el('div', { cls: 'parsec-receive2__card parsec-receive2__details', children: [
          identity,
          el('div', { cls: 'parsec-receive2__label', text: `Your ${desc.label} address` }),
          grouped,
          copyAddress,
          request,
          el('p', { cls: 'parsec-receive2__warn', text: isAlgorand
            ? 'Send only Algorand (ALGO) and Algorand Standard Assets here. An ASA arrives only if this account has opted in to it.'
            : `Send only ${desc.label} assets to this address. Sending another chain’s asset can lose it.` }),
        ] }),
      ] }),
    ],
  });
}
