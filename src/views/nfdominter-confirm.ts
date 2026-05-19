// Review + sign the mint. Mirrors confirm-send.ts: show everything the
// user is about to pay and why, then hand the operation to the SDK.

import { el, btn, toast } from '../lib/dom';
import { store } from '../lib/store';
import { mintNfdWithFee, BANKON_FEE_ADDRESS, type NfdMintCostBreakdown, type MintProgress } from '../lib/nfd';
import type { NetworkId } from '../types/wallet';

interface PendingMint {
  name: string;
  buyer: string;
  years: number;
  cost: NfdMintCostBreakdown;
  network: NetworkId;
}

let pending: PendingMint | null = null;

export function setNfdPendingMint(p: PendingMint): void { pending = p; }

export function nfdominterConfirmView(): HTMLElement {
  if (!pending) {
    store.navigate('nfdominter');
    return el('div');
  }
  const p = pending;

  const progress = el('div', { cls: 'parsec-nfdominter__progress', text: 'Ready to mint.' });

  const signBtn = btn('Sign and mint', {
    intent: 'primary',
    large: true,
    icon: 'confirm',
    onClick: () => { void run(); },
  });

  const backBtn = btn('Back', {
    minimal: true,
    icon: 'arrow-left',
    onClick: () => { pending = null; store.navigate('nfdominter'); },
  });

  async function run() {
    const pass = store.getPassphrase();
    if (!pass) { toast('Session locked. Unlock first.', 'warning'); return; }
    signBtn.disabled = true;
    backBtn.disabled = true;
    try {
      const nfd = await mintNfdWithFee({
        network: p.network,
        name: p.name,
        buyer: p.buyer,
        years: p.years,
        passphrase: pass,
        onProgress: (prog) => { progress.textContent = describeStage(prog); },
      });
      toast(`Minted ${nfd.name} (app ${nfd.appID}).`, 'success');
      pending = null;
      store.navigate('nfdominter');
    } catch (e) {
      progress.textContent = '';
      toast(`Mint failed: ${(e as Error).message}`, 'danger');
      signBtn.disabled = false;
      backBtn.disabled = false;
    }
  }

  return el('div', {
    cls: 'parsec-view parsec-nfdominter__confirm',
    children: [
      el('div', { cls: 'parsec-view__header', children: [
        backBtn,
        el('h2', { cls: 'parsec-view__title', text: `Mint ${p.name}` }),
      ]}),

      el('div', { cls: 'parsec-nfdominter__confirm-summary', children: [
        row('Name', p.name),
        row('Years', String(p.years)),
        row('Buyer', `${p.buyer.slice(0, 8)}…${p.buyer.slice(-6)}`),
        row('Network', p.network),
      ]}),

      el('div', { cls: 'parsec-nfdominter__quote-box', children: [
        quoteRow('NFD price', p.cost.basePrice),
        quoteRow('Contract funding', p.cost.carryCost),
        quoteRow('Network fee', p.cost.extraFee),
        quoteRow('BANKON fee', p.cost.bankonFee, true),
        el('div', { cls: 'parsec-nfdominter__quote-total', children: [
          el('span', { text: 'Total' }),
          el('span', { text: formatAlgo(p.cost.totalMicroAlgos) }),
        ]}),
      ]}),

      el('div', { cls: 'parsec-nfdominter__confirm-note', children: [
        el('p', { text: `The first transaction pays BANKON's fee (${formatAlgo(p.cost.bankonFee)}).` }),
        el('p', { cls: 'parsec-nfdominter__muted', text: `BANKON receives: ${BANKON_FEE_ADDRESS}` }),
        el('p', { text: 'The second transaction is the NFD mint group (multiple internal transactions). Both must succeed for your name to land.' }),
      ]}),

      progress,
      signBtn,
    ],
  });
}

function row(label: string, value: string): HTMLElement {
  return el('div', { cls: 'parsec-nfdominter__summary-row', children: [
    el('span', { cls: 'parsec-nfdominter__summary-label', text: label }),
    el('span', { cls: 'parsec-nfdominter__summary-value', text: value }),
  ]});
}

function quoteRow(label: string, microAlgos: bigint, highlight = false): HTMLElement {
  return el('div', {
    cls: `parsec-nfdominter__quote-row ${highlight ? 'parsec-nfdominter__quote-row--bankon' : ''}`,
    children: [
      el('span', { text: label }),
      el('span', { text: formatAlgo(microAlgos) }),
    ],
  });
}

function formatAlgo(microAlgos: bigint): string {
  const algos = Number(microAlgos) / 1_000_000;
  return `${algos.toLocaleString(undefined, { maximumFractionDigits: 6 })} ALGO`;
}

function describeStage(p: MintProgress): string {
  switch (p.stage) {
    case 'idle': return 'Idle.';
    case 'validating': return 'Validating name…';
    case 'checking-availability': return 'Checking availability…';
    case 'quoting': return 'Fetching quote…';
    case 'paying-bankon-fee': return 'Paying BANKON fee — awaiting signature…';
    case 'awaiting-signature': return 'Awaiting signature for NFD mint…';
    case 'submitting': return 'Submitting mint group…';
    case 'confirmed': return p.appId ? `Confirmed! app id ${p.appId}.` : 'Confirmed.';
    case 'error': return p.error ?? 'Error.';
  }
}
