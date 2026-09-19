// Parsec Wallet — x402 Desk.
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
import { isOptedIn, optInToAsset, walletNetworkFor } from '../lib/x402/rails/avm';
import { listReceipts, clearReceipts, receiptExplorerUrl, onReceipts, type X402Receipt } from '../lib/x402/receipts';
import { discoverRequirements, payersFromAccount } from '../lib/x402/client';
import { quote } from '../lib/x402/quote';
import { preparePayment } from '../lib/x402/client';
import { approveThroughView } from './x402-confirm';

export function x402DeskView(): HTMLElement {
  const settings = getX402Settings();
  const account = store.get().accounts[store.get().activeAccountIndex];
  // One address per rail: which one pays is decided by the offer the server makes.
  const payers = account ? payersFromAccount(account) : {};
  const payer = payers.avm ?? '';

  const facilitatorBox = el('div', { cls: 'parsec-card', children: [el('p', { cls: 'parsec-muted', text: 'Probing facilitator…' })] });
  const optInBox = el('div', { cls: 'parsec-card' });
  const receiptsBox = el('div', { cls: 'parsec-card' });
  const probeBox = el('div', { cls: 'parsec-card' });

  const urlField = input({ placeholder: 'https://example.x402.goplausible.xyz/', cls: 'bp5-input parsec-input--wide' });

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
    const walletNetwork = walletNetworkFor(settings.preferNetwork);
    const usdc = usdcFor(settings.preferNetwork);
    if (!payer || !usdc) {
      optInBox.replaceChildren(
        el('h3', { text: 'USDC' }),
        el('p', { cls: 'parsec-muted', text: payer ? `No USDC asset known for ${network.label}.` : 'No Algorand account selected.' }),
      );
      return;
    }
    const opted = await isOptedIn(payer, Number(usdc), walletNetwork);
    optInBox.replaceChildren(
      el('h3', { text: 'USDC' }),
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
                  const { txId } = await optInToAsset(payer, Number(usdc), walletNetwork);
                  toast(`Opted in — ${txId}`, 'success');
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
            ? [btn('Clear', { minimal: true, onClick: () => { clearReceipts(); } })]
            : []),
        ],
      }),
      ...(receipts.length
        ? receipts.slice(0, 25).map(receiptRow)
        : [el('p', { cls: 'parsec-muted', text: 'No settled payments yet. A receipt is written the moment a settlement is read back, and carries the transaction id a name claim or an audit needs.' })]),
    );
  };
  renderReceipts(listReceipts());
  onReceipts(renderReceipts);

  // ── Probe / pay a URL ──────────────────────────────────────────

  const showRequirements = async () => {
    const url = urlField.value.trim();
    if (!url) return;
    probeBox.replaceChildren(el('p', { cls: 'parsec-muted', text: 'Probing…' }));
    try {
      const challenge = await discoverRequirements(url);
      if (!challenge) {
        probeBox.replaceChildren(el('p', { text: 'Not paywalled — the resource answered without asking for payment.' }));
        return;
      }
      const quotes = await Promise.all(challenge.accepts.map(quote));
      probeBox.replaceChildren(
        el('h3', { text: challenge.resource.description || 'Payment required' }),
        row('x402 version', String(challenge.x402Version)),
        ...quotes.map((q) =>
          row(
            `${q.networkLabel} · ${q.requirement.scheme}`,
            `${q.amountDisplay} ${q.assetSymbol}${q.usdDisplay ? ` (${q.usdDisplay})` : ''}`,
          ),
        ),
        btn('Pay this', {
          intent: 'primary',
          disabled: !Object.keys(payers).length,
          onClick: async () => {
            try {
              const pending = await preparePayment(url, challenge, { payers });
              const result = await approveThroughView(pending);
              if (!result.success && result.error) toast(result.error, 'danger');
            } catch (err) {
              toast(err instanceof Error ? err.message : String(err), 'danger');
            }
          },
        }),
      );
    } catch (err) {
      probeBox.replaceChildren(el('p', { cls: 'parsec-error', text: err instanceof Error ? err.message : String(err) }));
    }
  };

  // ── Settings ───────────────────────────────────────────────────

  const networkSelect = el('select', { cls: 'bp5-input' }) as HTMLSelectElement;
  for (const n of [ALGORAND_TESTNET, ALGORAND_MAINNET]) {
    const opt = document.createElement('option');
    opt.value = n;
    opt.textContent = describeNetwork(n).label;
    if (settings.preferNetwork === n) opt.selected = true;
    networkSelect.appendChild(opt);
  }
  networkSelect.addEventListener('change', () => {
    setX402Settings({ preferNetwork: networkSelect.value as typeof settings.preferNetwork });
    toast(`Preferred network: ${describeNetwork(networkSelect.value).label}`, 'success');
    void renderOptIn();
  });

  const facilitatorField = input({ value: settings.facilitatorUrl, placeholder: DEFAULT_FACILITATOR, cls: 'bp5-input parsec-input--wide' });
  const capField = input({ value: String(settings.autoApproveMicroUsd), type: 'number', cls: 'bp5-input' });

  return el('div', {
    cls: 'parsec-view',
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
          el('h3', { text: 'Rails' }),
          ...listRails().map((r) =>
            row(r.label, `${r.schemes.join(', ')} · ${(r.networks ?? []).map((n) => describeNetwork(n).label).join(', ') || 'any network in family'}`),
          ),
          el('p', { cls: 'parsec-muted', text: 'A rail is registered per CAIP-2 namespace. A challenge offering a network with no registered rail is reported, never silently skipped.' }),
        ],
      }),

      facilitatorBox,
      optInBox,

      el('div', {
        cls: 'parsec-card',
        children: [
          el('h3', { text: 'Pay a resource' }),
          urlField,
          el('div', {
            cls: 'parsec-confirm__actions',
            children: [btn('Probe', { onClick: () => void showRequirements() })],
          }),
          probeBox,
        ],
      }),

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
                    facilitatorUrl: facilitatorField.value.trim() || DEFAULT_FACILITATOR,
                    autoApproveMicroUsd: Math.max(0, Math.floor(Number(capField.value) || 0)),
                  });
                  toast('Saved.', 'success');
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

      receiptsBox,
    ],
  });
}

// ── Helpers ──────────────────────────────────────────────────────

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
  const amount = `${Number(BigInt(r.amount)) / 10 ** r.decimals} ${r.assetSymbol || asset.symbol}`;
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
