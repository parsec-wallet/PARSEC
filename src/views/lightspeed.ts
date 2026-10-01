// Parsec Wallet — Lightspeed
//
// The template view for an observe-privilege module: states its choices in
// place, lets the participant pick a provider (local default, or a JSON-RPC
// node they name), and renders the light.js feeds — head block, chain id,
// sync, the active account's EVM balance — each with a tri-state chip and a
// provenance line. Every subscription is torn down through lib/lifecycle.

import { el, btn, input, toast } from '../lib/dom';
import { store } from '../lib/store';
import { onCleanup } from '../lib/lifecycle';
import { provenanceLine } from '../lib/ui/provenance';
import { describeChoices } from '../lib/module-choices';
import type { Observable, Reading } from '../lib/lightspeed/observable';
import {
  LIGHTSPEED_CHOICES,
  balanceOf$,
  blockNumber$,
  chainId$,
  syncStatus$,
  getProviderChoice,
  setProviderChoice,
} from '../lib/lightspeed';
import type { SyncStatus } from '../lib/lightspeed';

function fmtWei(wei: bigint): string {
  const whole = wei / 10n ** 18n;
  const frac = (wei % 10n ** 18n).toString().padStart(18, '0').slice(0, 6);
  return `${whole}.${frac} ETH`;
}

function fmtSync(s: SyncStatus): string {
  if (!s.syncing) return 'in sync';
  return s.current !== undefined && s.highest !== undefined ? `syncing ${s.current} / ${s.highest}` : 'syncing';
}

/** One reading row: chip · label · value, with the provenance line under it. */
function readingRow<T>(label: string, feed: () => Observable<Reading<T>>, show: (v: T) => string): HTMLElement {
  const chip = el('span', { cls: 'parsec-linkage__chip parsec-linkage__chip--unknown' });
  const value = el('span', { cls: 'parsec-confirm__value', text: '—' });
  const line = el('div', { cls: 'parsec-view__desc', text: 'reading…' });
  let unsubscribe: (() => void) | null = null;

  const attach = (): void => {
    unsubscribe?.();
    unsubscribe = feed().subscribe((r) => {
      chip.className = `parsec-linkage__chip parsec-linkage__chip--${r.status}`;
      value.textContent = r.value === null ? (r.error ?? 'unknown') : show(r.value);
      line.textContent = provenanceLine(r.provenance);
    });
  };
  attach();
  onCleanup(() => unsubscribe?.());

  const row = el('div', {
    cls: 'parsec-confirm__details',
    children: [
      el('div', { cls: 'parsec-confirm__row', children: [chip, el('span', { cls: 'parsec-confirm__label', text: label }), value] }),
      line,
    ],
  });
  // Re-subscribe when the provider changes so the origin in each line is true.
  row.addEventListener('lightspeed:provider', attach);
  return row;
}

export function lightspeedView(): HTMLElement {
  const state = store.get();
  const account = state.accounts[state.activeAccountIndex];
  const evmAddress = account?.chains?.['ethereum'];

  // ── Declaration ────────────────────────────────────────────
  const declaration = el('div', {
    cls: 'parsec-callout',
    children: [
      el('div', { cls: 'parsec-section-title', text: 'This module declares' }),
      ...describeChoices(LIGHTSPEED_CHOICES).map((line) => el('div', { cls: 'parsec-view__desc', text: line })),
    ],
  });

  // ── Provider ───────────────────────────────────────────────
  const choice = getProviderChoice();
  const url = input({ cls: 'bp5-input', placeholder: 'https://… JSON-RPC endpoint', value: choice.url });
  const providerLabel = el('div', { cls: 'parsec-view__desc' });

  const rows: HTMLElement[] = [];
  const announce = (): void => {
    const c = getProviderChoice();
    providerLabel.textContent = c.id === 'local'
      ? 'Local — no network. Every reading stays on this device and is unknown.'
      : `JSON-RPC — ${c.url}. The endpoint learns which addresses you ask about.`;
    for (const r of rows) r.dispatchEvent(new Event('lightspeed:provider'));
  };

  const useLocal = btn('Local', {
    outlined: true, icon: 'offline',
    onClick: () => { setProviderChoice({ id: 'local', url: url.value.trim() }); announce(); },
  });
  const useRpc = btn('Use JSON-RPC', {
    outlined: true, icon: 'globe-network',
    onClick: () => {
      const u = url.value.trim();
      try { new URL(u); } catch { toast('Enter a full http(s) URL', 'warning'); return; }
      setProviderChoice({ id: 'json-rpc', url: u });
      announce();
    },
  });

  const provider = el('div', {
    cls: 'parsec-settings__section',
    children: [
      el('div', { cls: 'parsec-section-title', text: 'Provider' }),
      providerLabel,
      url,
      el('div', { cls: 'parsec-confirm__actions', children: [useLocal, useRpc] }),
    ],
  });

  // ── Feeds ──────────────────────────────────────────────────
  rows.push(
    readingRow('Head block', blockNumber$, (n) => `#${n}`),
    readingRow('Chain id', chainId$, (n) => `eip155:${n}`),
    readingRow('Sync', syncStatus$, fmtSync),
  );
  if (evmAddress) rows.push(readingRow(`Balance · ${evmAddress.slice(0, 8)}…`, () => balanceOf$(evmAddress), fmtWei));

  const feeds = el('div', {
    cls: 'parsec-settings__section',
    children: [
      el('div', { cls: 'parsec-section-title', text: 'Readings' }),
      ...rows,
      ...(evmAddress ? [] : [el('div', { cls: 'parsec-empty', text: 'No EVM address on this account — add Base (EVM) to watch a balance.' })]),
    ],
  });

  announce();

  return el('div', {
    cls: 'parsec-view parsec-lightspeed',
    children: [
      el('div', {
        cls: 'parsec-view__header',
        children: [
          btn('Back', { minimal: true, icon: 'arrow-left', onClick: () => { if (!store.back()) store.navigate('dashboard'); } }),
          el('h2', { cls: 'parsec-view__title', text: 'Lightspeed' }),
        ],
      }),
      el('p', {
        cls: 'parsec-view__desc',
        text: 'Reactive chain reads over a provider you choose — the light.js idea, in-house, zero dependencies. This is also the template for a new Parsec module: see docs/lightspeed.md.',
      }),
      declaration,
      provider,
      feeds,
    ],
  });
}
