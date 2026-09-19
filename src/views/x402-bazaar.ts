// Parsec Wallet — Bazaar.
//
// The catalogue of paid resources that settle through the configured facilitator. This
// is the half of the agent economy that costs nothing: browsing, reading what an endpoint
// takes and returns, seeing how many payments it has actually settled — all free, all
// before any decision to pay.
//
// Prices shown here are the directory's memory. The price a payment is made against is
// read live from the resource's own 402, every time.
//
// SPDX-FileCopyrightText: 2026 BANKON
// SPDX-License-Identifier: Apache-2.0

import { el, btn, input, toast } from '../lib/dom';
import { store } from '../lib/store';
import { listResources, describePrice, type BazaarResource } from '../lib/x402/bazaar';
import { getX402Settings } from '../lib/x402/settings';
import { describeNetwork } from '../lib/x402/networks';
import { discoverRequirements, preparePayment } from '../lib/x402/client';
import { signersForAccount } from '../lib/x402/adapters/parsec';
import { approveThroughView } from './x402-confirm';

export function x402BazaarView(): HTMLElement {
  const settings = getX402Settings();
  const state = store.get();
  const account = state.accounts[state.activeAccountIndex];
  const signers = account ? signersForAccount(account) : {};
  const canPayAtAll = Object.keys(signers).length > 0;

  const results = el('div', { cls: 'parsec-list' });
  const searchField = input({
    placeholder: 'Search the catalogue — weather, oracle, mint, agent…',
    cls: 'bp5-input parsec-input--wide',
    onEnter: () => void run(),
  });

  let includeTestnets = describeNetwork(settings.preferNetwork).testnet;
  const testnetToggle = el('label', {
    cls: 'parsec-field',
    children: [],
  });
  const testnetCheckbox = document.createElement('input');
  testnetCheckbox.type = 'checkbox';
  testnetCheckbox.checked = includeTestnets;
  testnetCheckbox.addEventListener('change', () => {
    includeTestnets = testnetCheckbox.checked;
    void run();
  });
  testnetToggle.append(testnetCheckbox, document.createTextNode(' include testnets'));

  async function run(): Promise<void> {
    results.replaceChildren(el('p', { cls: 'parsec-muted', text: 'Loading…' }));
    try {
      const page = await listResources({
        search: searchField.value.trim() || undefined,
        includeTestnets,
        limit: 50,
      });
      if (!page.items.length) {
        results.replaceChildren(
          el('p', {
            cls: 'parsec-muted',
            text: 'Nothing matched that a registered rail can pay. Try including testnets, or widen the search.',
          }),
        );
        return;
      }
      results.replaceChildren(
        el('p', { cls: 'parsec-muted', text: `${page.items.length} of ${page.total} catalogued resources` }),
        ...page.items.map(card),
      );
    } catch (err) {
      results.replaceChildren(el('p', { cls: 'parsec-error', text: err instanceof Error ? err.message : String(err) }));
    }
  }

  function card(resource: BazaarResource): HTMLElement {
    return el('div', {
      cls: 'parsec-card',
      children: [
        el('h3', { text: resource.description || resource.resourceUrl }),
        el('p', { cls: 'parsec-muted', text: `${resource.method} ${resource.resourceUrl}` }),
        row('Price', describePrice(resource)),
        ...(resource.settleCount !== undefined ? [row('Settled', `${resource.settleCount.toLocaleString()} payments`)] : []),
        ...(resource.lastSeen ? [row('Last seen', new Date(resource.lastSeen).toLocaleDateString())] : []),
        ...(resource.info?.input
          ? [row('Takes', summariseInput(resource.info.input))]
          : []),
        el('div', {
          cls: 'parsec-confirm__actions',
          children: [
            btn('Pay', {
              intent: 'primary',
              disabled: !canPayAtAll || resource.method !== 'GET',
              onClick: () => void pay(resource),
            }),
          ],
        }),
        ...(resource.method !== 'GET'
          ? [el('p', { cls: 'parsec-muted', text: `${resource.method} endpoints need a request body — pay them from the desk or an agent, not from a catalogue row.` })]
          : []),
      ],
    });
  }

  async function pay(resource: BazaarResource): Promise<void> {
    if (!canPayAtAll) return;
    try {
      // The catalogue's price is a memory; the challenge is the quote.
      const challenge = await discoverRequirements(resource.resourceUrl);
      if (!challenge) {
        toast('That resource answered without asking for payment.', 'warning');
        return;
      }
      const pending = await preparePayment(resource.resourceUrl, challenge, { signers });
      const result = await approveThroughView(pending);
      if (!result.success && result.error) toast(result.error, 'danger');
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'danger');
    }
  }

  void run();

  return el('div', {
    cls: 'parsec-view',
    children: [
      el('div', {
        cls: 'parsec-view__header',
        children: [
          btn('Back', { minimal: true, onClick: () => store.navigate('dashboard') }),
          el('h2', { cls: 'parsec-view__title', text: 'Bazaar' }),
        ],
      }),
      el('p', {
        cls: 'parsec-muted',
        text: `Paid resources catalogued by ${settings.facilitatorUrl}. Browsing is free.`,
      }),
      el('div', {
        cls: 'parsec-card',
        children: [
          searchField,
          el('div', {
            cls: 'parsec-confirm__actions',
            children: [btn('Search', { onClick: () => void run() }), testnetToggle],
          }),
        ],
      }),
      results,
    ],
  });
}

function summariseInput(inputSpec: NonNullable<BazaarResource['info']>['input']): string {
  if (!inputSpec) return '';
  if (inputSpec.type === 'mcp') return `MCP tool ${inputSpec.name ?? ''}`.trim();
  const query = inputSpec.queryParams ? Object.keys(inputSpec.queryParams) : [];
  const body = inputSpec.body ? Object.keys(inputSpec.body) : [];
  if (query.length) return `query: ${query.join(', ')}`;
  if (body.length) return `${inputSpec.bodyType ?? 'json'} body: ${body.join(', ')}`;
  return inputSpec.method ?? '';
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
