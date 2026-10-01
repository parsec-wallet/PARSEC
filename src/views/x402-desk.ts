// PARSEC Wallet — x402 Desk.
//
// Everything about the payment rail that is not a payment: which rails are registered,
// what the facilitator says it can settle and who sponsors fees there, the device's own
// preferences, the USDC opt-in that Algorand requires before a single cent can move,
// and the receipt ledger — the record that a payment happened, with the transaction id
// that proves it.
//
// SPDX-FileCopyrightText: 2026 BANKON
// SPDX-License-Identifier: Apache-2.0

import { el, btn, input, toast } from '../lib/dom';
import { onCleanup } from '../lib/lifecycle';
import { store } from '../lib/store';
import { describeChoices } from '../lib/module-choices';
import { X402_CHOICES } from '../lib/x402/choices';
import { listRails } from '../lib/x402/rails';
import { probeFacilitator, type FacilitatorHealth } from '../lib/x402/facilitator';
import { getX402Settings, setX402Settings, DEFAULT_FACILITATOR } from '../lib/x402/settings';
import {
  ALGORAND_MAINNET,
  ALGORAND_TESTNET,
  describeAsset,
  describeNetwork,
  usdcFor,
} from '../lib/x402/networks';
import { isOptedIn, optInToAsset } from '../lib/x402/rails/avm';
import { listReceipts, clearReceipts, receiptExplorerUrl, onReceipts, type X402Receipt } from '../lib/x402/receipts';
import { discoverRequirements } from '../lib/x402/client';
import { signersForAccount } from '../lib/x402/adapters/parsec';
import { quote } from '../lib/x402/quote';
import { preparePayment } from '../lib/x402/client';
import { approveThroughView } from './x402-confirm';
import { formatDecimal } from '../lib/money';
import { explorerTxUrl, sameNetwork, USDC_ASA_MAINNET, USDC_ASA_TESTNET } from '../lib/x402/networks';

/** A request handed over from elsewhere (the Bazaar's "Open in desk"), applied once. */
let deskPrefill: { url: string; method: 'GET' | 'POST' } | null = null;
export function prefillDesk(p: { url: string; method: 'GET' | 'POST' }): void { deskPrefill = p; }

export function x402DeskView(): HTMLElement {
  const settings = getX402Settings();
  const account = store.get().accounts[store.get().activeAccountIndex];
  // One address per rail: which one pays is decided by the offer the server makes.
  const signers = account ? signersForAccount(account) : {};
  const payer = signers.avm?.address ?? '';

  const facilitatorBox = el('div', { cls: 'parsec-card', children: [el('p', { cls: 'parsec-muted', text: 'Probing facilitator…' })] });
  const optInBox = el('div', { cls: 'parsec-card' });
  const receiptsBox = el('div', { cls: 'parsec-card' });
  const probeBox = el('div');
  const resultBox = el('div');

  const urlField = input({ placeholder: 'https://example.x402.goplausible.xyz/', cls: 'bp5-input parsec-input--wide' });
  // Many paid resources are POST with a JSON body (a name order, a query), so the
  // desk sends whatever the resource expects. The same request is resent with the
  // payment attached; nothing about it changes between the probe and the pay.
  const methodSelect = el('select', { cls: 'bp5-input', attrs: { 'aria-label': 'Request method' } }) as HTMLSelectElement;
  for (const m of ['GET', 'POST']) {
    const opt = document.createElement('option');
    opt.value = m;
    opt.textContent = m;
    methodSelect.appendChild(opt);
  }
  const bodyField = el('textarea', {
    cls: 'bp5-input parsec-input--wide',
    attrs: { rows: '3', placeholder: '{"name": "…"}  — JSON body, sent with POST', 'aria-label': 'Request body (JSON)' },
  }) as HTMLTextAreaElement;
  const syncBody = () => { bodyField.style.display = methodSelect.value === 'POST' ? '' : 'none'; };
  if (deskPrefill) {
    urlField.value = deskPrefill.url;
    methodSelect.value = deskPrefill.method;
    deskPrefill = null;
  }
  methodSelect.addEventListener('change', syncBody);
  syncBody();

  /** The request as the resource expects it, or an error message. */
  const requestInit = (): RequestInit | string => {
    if (methodSelect.value !== 'POST') return { method: 'GET' };
    const raw = bodyField.value.trim();
    if (raw) {
      try { JSON.parse(raw); } catch { return 'The body is not valid JSON.'; }
    }
    return { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: raw || '{}' };
  };

  // ── Facilitator ────────────────────────────────────────────────

  const renderFacilitator = (health: FacilitatorHealth) => {
    facilitatorBox.replaceChildren(
      el('h3', { text: 'Facilitator' }),
      row('URL', settings.facilitatorUrl),
      row('Status', health.reachable ? `${health.name ?? 'reachable'} ${health.version ?? ''}`.trim() : `unreachable — ${health.error}`),
      row('Extensions', health.extensions.length ? health.extensions.join(', ') : 'none declared'),
      ...(health.kinds.length
        ? [
            el('p', { cls: 'parsec-muted', text: 'Settles:' }),
            ...health.kinds.map((k) => {
              const feePayer = (k.extra as { feePayer?: string } | undefined)?.feePayer;
              return row(
                `${describeNetwork(k.network).label} · ${k.scheme} · v${k.x402Version}`,
                feePayer ? `fees sponsored by ${trunc(feePayer)}` : 'fees paid by the payer',
              );
            }),
          ]
        : []),
    );
  };

  void probeFacilitator().then(renderFacilitator);

  // ── USDC opt-in ────────────────────────────────────────────────
  // Algorand will not let an account hold an asset it has not opted in to. A payment
  // in USDC from an account with no USDC holding does not fail for want of funds —
  // it is rejected by the protocol. Worth clearing here rather than at the till.

  const renderOptIn = async () => {
    const network = describeNetwork(settings.preferNetwork);
    const usdc = usdcFor(settings.preferNetwork);
    if (!payer || !usdc) {
      optInBox.replaceChildren(
        el('h3', { text: 'USDC' }),
        el('p', { cls: 'parsec-muted', text: payer ? `No USDC asset known for ${network.label}.` : 'No Algorand account selected.' }),
      );
      return;
    }
    const opted = await isOptedIn(payer, Number(usdc), settings.preferNetwork);
    optInBox.replaceChildren(
      el('h3', { text: 'USDC' }),
      ...(network.testnet
        ? [el('div', { cls: 'parsec-callout bp5-callout bp5-intent-warning', children: [el('p', {
          text: `Testnet: test USDC (ASA ${usdc}) has no value and settles nothing real. Choose Algorand mainnet · USDC ${USDC_ASA_MAINNET} under Settings below for a real payment.`,
        })] })]
        : []),
      row('Network', network.label),
      row('ASA', usdc),
      row('Opted in', opted ? 'yes' : 'no'),
      ...(opted
        ? []
        : [
            el('p', {
              cls: 'parsec-muted',
              text: 'Opting in locks 0.1 ALGO into this account’s minimum balance for as long as the holding exists.',
            }),
            btn(`Opt in to ASA ${usdc}`, {
              intent: 'primary',
              onClick: async (e) => {
                const b = e.currentTarget as HTMLButtonElement;
                b.disabled = true;
                try {
                  const { txId } = await optInToAsset(signers.avm!, Number(usdc), settings.preferNetwork);
                  toast(`Opted in · ${trunc(txId)}`, 'success');
                  void renderOptIn();
                } catch (err) {
                  toast(err instanceof Error ? err.message : String(err), 'danger');
                  b.disabled = false;
                }
              },
            }),
          ]),
    );
  };
  void renderOptIn();

  // ── Receipts ───────────────────────────────────────────────────

  const renderReceipts = (receipts: X402Receipt[]) => {
    receiptsBox.replaceChildren(
      el('div', {
        cls: 'parsec-view__header',
        children: [
          el('h3', { text: `Receipts (${receipts.length})` }),
          ...(receipts.length
            ? [clearButton()]
            : []),
        ],
      }),
      ...(receipts.length
        ? receipts.slice(0, 25).map(receiptRow)
        : [el('p', { cls: 'parsec-muted', text: 'No settled payments yet. A receipt is written the moment a settlement is read back, and carries the transaction id a name claim or an audit needs.' })]),
    );
  };
  renderReceipts(listReceipts());
  // Unsubscribed with the view; the dropped unsubscribe left one listener per visit.
  onCleanup(onReceipts(renderReceipts));

  // ── Probe / pay a URL ──────────────────────────────────────────

  /** What the resource returned once paid, beside the settled transaction id. */
  const showPaidResponse = async (
    result: { success: boolean; txId?: string; response?: Response; error?: string },
    network: string,
  ) => {
    if (!result.response && !result.txId && !result.error) return;
    let text = '';
    try { text = result.response ? await result.response.clone().text() : ''; } catch { /* body already read */ }
    let shown = text;
    try { shown = JSON.stringify(JSON.parse(text), null, 2); } catch { /* not JSON; show as is */ }
    const link = result.txId ? explorerTxUrl(network, result.txId) : '';
    resultBox.replaceChildren(el('div', {
      cls: 'parsec-card',
      children: [
        el('h3', { text: result.success ? 'Paid ✓' : 'Not delivered' }),
        ...(result.txId
          ? [el('div', {
              cls: 'parsec-row',
              children: [
                el('span', { cls: 'parsec-confirm__label', text: 'Settlement' }),
                link
                  ? el('a', { cls: 'parsec-mono', text: trunc(result.txId), attrs: { href: link, target: '_blank', rel: 'noreferrer' } })
                  : el('span', { cls: 'parsec-mono', text: trunc(result.txId) }),
                btn('Copy', { minimal: true, icon: 'duplicate', onClick: () => void navigator.clipboard.writeText(result.txId!).then(() => toast('Transaction id copied', 'success')) }),
              ],
            })]
          : []),
        ...(result.response ? [row('HTTP', String(result.response.status))] : []),
        ...(result.error ? [el('p', { cls: 'parsec-error', text: result.error })] : []),
        ...(shown ? [el('pre', { cls: 'parsec-mono parsec-desk__response', text: shown.slice(0, 4000) })] : []),
      ],
    }));
  };

  const showRequirements = async () => {
    const url = urlField.value.trim();
    if (!url) return;
    const init = requestInit();
    if (typeof init === 'string') {
      probeBox.replaceChildren(el('p', { cls: 'parsec-error', text: init }));
      return;
    }
    probeBox.replaceChildren(el('p', { cls: 'parsec-muted', text: 'Probing…' }));
    resultBox.replaceChildren();
    try {
      const challenge = await discoverRequirements(url, init);
      if (!challenge) {
        probeBox.replaceChildren(el('p', { text: 'Not paywalled — the resource answered without asking for payment.' }));
        return;
      }
      const quotes = await Promise.all(challenge.accepts.map(quote));
      // Which rail pays is the participant's choice, made here in plain sight: a
      // challenge commonly offers mainnet AND testnet, and a stored preference is
      // too quiet a place for the difference between real money and none.
      const railSelect = el('select', { cls: 'bp5-input', attrs: { 'aria-label': 'Pay on' } }) as HTMLSelectElement;
      quotes.forEach((q, i) => {
        const net = q.requirement.network;
        const family = describeNetwork(net).family;
        const signable = (family === 'avm' || family === 'evm' || family === 'svm') && Boolean(signers[family]);
        const opt = document.createElement('option');
        opt.value = String(i);
        opt.disabled = !signable;
        opt.textContent = `${q.networkLabel} · ${q.amountDisplay} ${q.assetSymbol}${q.usdDisplay ? ` (${q.usdDisplay})` : ''}${signable ? '' : ' · no key here'}${describeNetwork(net).testnet ? ' · test' : ''}`;
        railSelect.appendChild(opt);
      });
      const preferred = quotes.findIndex((q, i) => !railSelect.options[i].disabled && sameNetwork(q.requirement.network, settings.preferNetwork));
      const firstPayable = quotes.findIndex((_, i) => !railSelect.options[i].disabled);
      railSelect.value = String(preferred >= 0 ? preferred : Math.max(0, firstPayable));
      const payBtn = btn('Pay', {
        intent: 'primary',
        large: true,
        disabled: firstPayable < 0,
        onClick: async () => {
          const q = quotes[Number(railSelect.value)];
          if (!q) return;
          try {
            const pending = await preparePayment(url, challenge, { signers, preferNetwork: q.requirement.network }, init);
            const result = await approveThroughView(pending);
            if (!result.success && result.error) toast(result.error, 'danger');
            await showPaidResponse(result, q.requirement.network);
          } catch (err) {
            toast(err instanceof Error ? err.message : String(err), 'danger');
          }
        },
      });
      probeBox.replaceChildren(el('div', {
        cls: 'parsec-card',
        children: [
          el('h3', { text: challenge.resource.description || 'Payment required' }),
          el('p', { cls: 'parsec-muted', text: `x402 v${challenge.x402Version} · ${quotes.length} rail${quotes.length === 1 ? '' : 's'} offered` }),
          labelled('Pay on', railSelect),
          ...(firstPayable < 0 ? [el('p', { cls: 'parsec-error', text: 'No offered rail has a key in this wallet.' })] : []),
          payBtn,
        ],
      }));
    } catch (err) {
      probeBox.replaceChildren(el('p', { cls: 'parsec-error', text: err instanceof Error ? err.message : String(err) }));
    }
  };

  // ── Settings ───────────────────────────────────────────────────

  const networkSelect = el('select', { cls: 'bp5-input' }) as HTMLSelectElement;
  for (const n of [ALGORAND_MAINNET, ALGORAND_TESTNET]) {
    const opt = document.createElement('option');
    opt.value = n;
    opt.textContent = n === ALGORAND_MAINNET
      ? `${describeNetwork(n).label} · USDC ${USDC_ASA_MAINNET} (recommended)`
      : `${describeNetwork(n).label} · test USDC ${USDC_ASA_TESTNET}`;
    if (settings.preferNetwork === n) opt.selected = true;
    networkSelect.appendChild(opt);
  }

  const facilitatorField = input({ value: settings.facilitatorUrl, placeholder: DEFAULT_FACILITATOR, cls: 'bp5-input parsec-input--wide' });
  const capField = input({ value: String(settings.autoApproveMicroUsd), type: 'number', cls: 'bp5-input' });

  return el('div', {
    cls: 'parsec-view parsec-x402desk',
    children: [
      el('div', {
        cls: 'parsec-view__header',
        children: [
          btn('Back', { minimal: true, onClick: () => store.navigate('dashboard') }),
          el('h2', { cls: 'parsec-view__title', text: 'x402 Desk' }),
        ],
      }),
      el('p', { cls: 'parsec-muted', text: describeChoices(X402_CHOICES).join(' · ') }),

      el('div', {
        cls: 'parsec-card',
        children: [
          el('h3', { text: 'Pay a resource' }),
          el('div', { cls: 'parsec-row', children: [methodSelect, urlField] }),
          bodyField,
          el('div', {
            cls: 'parsec-confirm__actions',
            children: [btn('Probe', { intent: 'primary', onClick: () => void showRequirements() })],
          }),
        ],
      }),
      probeBox,
      resultBox,

      optInBox,
      receiptsBox,

      el('div', {
        cls: 'parsec-card',
        children: [
          el('h3', { text: 'Settings' }),
          labelled('Preferred network', networkSelect),
          labelled('Facilitator', facilitatorField),
          labelled('Auto-approve under (micro-USD, 0 = always ask)', capField),
          el('div', {
            cls: 'parsec-confirm__actions',
            children: [
              btn('Save', {
                intent: 'primary',
                onClick: () => {
                  setX402Settings({
                    preferNetwork: networkSelect.value as typeof settings.preferNetwork,
                    facilitatorUrl: facilitatorField.value.trim() || DEFAULT_FACILITATOR,
                    autoApproveMicroUsd: Math.max(0, Math.floor(Number(capField.value) || 0)),
                  });
                  Object.assign(settings, getX402Settings());
                  toast('Saved.', 'success');
                  void renderOptIn();
                  void probeFacilitator().then(renderFacilitator);
                },
              }),
            ],
          }),
          el('p', {
            cls: 'parsec-muted',
            text: 'The facilitator here is asked what it can settle and for the Bazaar catalogue. A payment settles through whichever facilitator the resource’s own requirement names as fee payer.',
          }),
        ],
      }),

      facilitatorBox,
      el('div', {
        cls: 'parsec-card',
        children: [
          el('h3', { text: 'Rails' }),
          ...listRails().map((r) =>
            row(r.label, `${r.schemes.join(', ')} · ${(r.networks ?? []).map((n) => describeNetwork(n).label).join(', ') || 'any network in family'}`),
          ),
          el('p', { cls: 'parsec-muted', text: 'A rail is registered per CAIP-2 namespace. A challenge offering a network with no registered rail is reported, never silently skipped.' }),
        ],
      }),
    ],
  });
}

// ── Helpers ──────────────────────────────────────────────────────

/** Clear, but only on a second press within a few seconds — receipts are the proof of payment. */
function clearButton(): HTMLElement {
  let armed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const b = btn('Clear', {
    minimal: true,
    onClick: () => {
      if (!armed) {
        armed = true;
        b.textContent = 'Press again to clear all receipts';
        b.classList.add('bp5-intent-danger');
        timer = setTimeout(() => { armed = false; b.textContent = 'Clear'; b.classList.remove('bp5-intent-danger'); }, 4000);
        return;
      }
      if (timer) clearTimeout(timer);
      clearReceipts();
    },
  });
  return b;
}

function trunc(a: string): string {
  return a.length > 16 ? `${a.slice(0, 8)}…${a.slice(-6)}` : a;
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

function labelled(label: string, control: HTMLElement): HTMLElement {
  return el('label', {
    cls: 'parsec-field',
    children: [el('span', { cls: 'parsec-confirm__label', text: label }), control],
  });
}

function receiptRow(r: X402Receipt): HTMLElement {
  const asset = describeAsset(r.network, r.asset);
  // Exact: the atomic amount scaled as a bigint, never through a float.
  let atomic = 0n;
  try { atomic = BigInt(r.amount); } catch { /* unreadable amount shows as 0 */ }
  const amount = `${formatDecimal(atomic, r.decimals, { trim: true })} ${r.assetSymbol || asset.symbol}`;
  const link = receiptExplorerUrl(r);
  return el('div', {
    cls: 'parsec-confirm__row',
    children: [
      el('span', {
        cls: 'parsec-confirm__label',
        text: `${new Date(r.settledAt).toLocaleString()} · ${amount}${r.delivered ? '' : ' · not delivered'}`,
      }),
      link
        ? el('a', { cls: 'parsec-confirm__value', text: trunc(r.txId), attrs: { href: link, target: '_blank', rel: 'noreferrer' } })
        : el('span', { cls: 'parsec-confirm__value', text: trunc(r.txId) }),
    ],
  });
}
