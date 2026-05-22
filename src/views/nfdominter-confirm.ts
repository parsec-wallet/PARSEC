// Review + sign the mint. Mirrors confirm-send.ts: show everything the user
// is about to pay and why, gate the spend on a live balance check, then hand
// the operation to the SDK and show a success screen.

import { el, btn, toast } from '../lib/dom';
import { store } from '../lib/store';
import {
  mintNfdWithFee,
  getBankonFeeAddress,
  type Nfd,
  type NfdMintCostBreakdown,
  type MintProgress,
} from '../lib/nfd';
import { fetchAccountInfo, microAlgosToAlgo } from '../lib/algorand/account';
import type { AccountInfo, NetworkId } from '../types/wallet';

interface PendingMint {
  name: string;
  buyer: string;
  years: number;
  cost: NfdMintCostBreakdown;
  network: NetworkId;
  /** When set, the name is minted on behalf of this wallet (it owns it). */
  reservedFor?: string;
}

let pending: PendingMint | null = null;

export function setNfdPendingMint(p: PendingMint): void { pending = p; }

export function nfdominterConfirmView(): HTMLElement {
  if (!pending) {
    store.navigate('nfdominter');
    return el('div');
  }
  const p = pending;
  const root = el('div', { cls: 'parsec-view parsec-nfdominter__confirm' });

  const progress = el('div', { cls: 'parsec-nfdominter__progress', text: 'Ready to mint.' });

  // Persistent error panel — a failed mint must NOT vanish in a toast.
  const errorBox = el('div', { cls: 'parsec-nfdominter__error', attrs: { hidden: 'true' } });

  const signBtn = btn('Sign and claim', {
    intent: 'primary',
    large: true,
    icon: 'confirm',
    disabled: true, // unlocked once the balance check passes
    cls: 'parsec-nfdominter__sign-btn',
    onClick: () => { void run(); },
  });

  const backBtn = btn('Back', {
    minimal: true,
    icon: 'arrow-left',
    onClick: () => { pending = null; store.navigate('nfdominter'); },
  });

  // ── Balance check — gate the spend on the buyer actually having the ALGO.
  const balanceBox = el('div', {
    cls: 'parsec-nfdominter__balance',
    children: [el('div', { cls: 'parsec-nfdominter__hint', text: 'Checking wallet balance…' })],
  });
  const total = Number(p.cost.totalMicroAlgos);

  fetchAccountInfo(p.buyer, p.network)
    .then((info: AccountInfo) => {
      const spendable = info.amount - info.minBalance;
      const ok = spendable >= total;
      balanceBox.innerHTML = '';
      balanceBox.append(
        row('Wallet balance', `${microAlgosToAlgo(info.amount)} ALGO`),
        row('Total cost', formatAlgo(p.cost.totalMicroAlgos)),
        row('Remaining after', `${microAlgosToAlgo(Math.max(0, info.amount - total))} ALGO`),
      );
      if (!ok) {
        balanceBox.appendChild(el('div', {
          cls: 'parsec-callout bp5-callout bp5-intent-danger',
          text: `Insufficient ALGO. This mint needs ${formatAlgo(p.cost.totalMicroAlgos)}, but only ${microAlgosToAlgo(spendable)} ALGO is spendable after the ${microAlgosToAlgo(info.minBalance)} ALGO minimum balance.`,
        }));
      }
      signBtn.disabled = !ok;
    })
    .catch(() => {
      balanceBox.innerHTML = '';
      balanceBox.appendChild(el('div', {
        cls: 'parsec-callout bp5-callout bp5-intent-warning',
        text: 'Could not load the wallet balance — make sure the account is funded before signing.',
      }));
      signBtn.disabled = false; // allow, but the user was warned
    });

  // ── Network — prominent, because a mainnet mint spends real ALGO.
  const networkBadge = el('span', {
    cls: `parsec-network-badge parsec-network-badge--${p.network}`,
    text: p.network.toUpperCase(),
  });
  const networkRow = el('div', {
    cls: 'parsec-nfdominter__confirm-network',
    children: [
      networkBadge,
      p.network === 'mainnet'
        ? el('span', { cls: 'parsec-nfdominter__hint parsec-nfdominter__hint--error', text: 'This spends real ALGO and cannot be undone.' })
        : el('span', { cls: 'parsec-nfdominter__hint', text: 'Test network — no real value at stake.' }),
    ],
  });

  const treasury = getBankonFeeAddress();
  const treasuryNote = p.buyer === treasury
    ? 'NFDminter fee returns to this account (it is the treasury).'
    : `NFDminter fee receives: ${treasury}`;

  async function run() {
    const pass = store.getPassphrase();
    if (!pass) { toast('Session locked. Unlock first.', 'warning'); return; }
    signBtn.disabled = true;
    backBtn.disabled = true;
    errorBox.setAttribute('hidden', 'true');
    errorBox.innerHTML = '';
    try {
      const nfd = await mintNfdWithFee({
        network: p.network,
        name: p.name,
        buyer: p.buyer,
        years: p.years,
        passphrase: pass,
        reservedFor: p.reservedFor,
        onProgress: (prog) => { progress.textContent = describeStage(prog); },
      });
      toast(`Claimed ${nfd.name}.`, 'success');
      pending = null;
      renderSuccess(nfd);
    } catch (e) {
      progress.textContent = '';
      showError(e);
      signBtn.disabled = false;
      backBtn.disabled = false;
    }
  }

  // Render the full failure into a persistent panel: a headline, the raw
  // message (selectable), and a Copy button. Nothing here auto-dismisses.
  function showError(e: unknown): void {
    const message = e instanceof Error ? e.message : String(e);
    const stack = e instanceof Error && e.stack ? e.stack : message;
    console.error('[nfdominter] mint failed:', e);

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
    errorBox.append(
      el('div', { cls: 'parsec-callout bp5-callout bp5-intent-danger', children: [
        el('div', { cls: 'parsec-nfdominter__error-title', text: 'Mint failed' }),
        el('pre', { cls: 'parsec-nfdominter__error-message', text: message }),
        copyBtn,
      ]}),
    );
    errorBox.removeAttribute('hidden');
    errorBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function renderSuccess(nfd: Nfd): void {
    root.innerHTML = '';
    root.append(
      el('div', { cls: 'parsec-view__header', children: [
        el('h2', { cls: 'parsec-view__title', text: 'Claimed' }),
      ]}),
      el('div', { cls: 'parsec-nfdominter__success', children: [
        el('div', { cls: 'parsec-nfdominter__success-mark', text: '✓' }),
        el('h3', { cls: 'parsec-nfdominter__success-name', text: `You own ${nfd.name}` }),
        el('p', {
          cls: 'parsec-view__desc',
          text: nfd.appID ? `NFD application ${nfd.appID} — minted on ${p.network}.` : `Mint confirmed on ${p.network}.`,
        }),
        el('div', { cls: 'parsec-nfdominter__success-links', children: [
          nfd.appID
            ? el('a', {
                cls: 'parsec-asset-link',
                text: 'View on allo.info',
                attrs: { href: `https://allo.info/application/${nfd.appID}`, target: '_blank', rel: 'noopener' },
              })
            : el('span'),
          el('a', {
            cls: 'parsec-asset-link',
            text: 'NFD profile',
            attrs: { href: `https://app.nf.domains/name/${nfd.name}`, target: '_blank', rel: 'noopener' },
          }),
        ]}),
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
      el('h2', { cls: 'parsec-view__title', text: `Mint ${p.name}` }),
    ]}),

    networkRow,

    el('div', { cls: 'parsec-nfdominter__confirm-summary', children: [
      row('Name', p.name),
      row('Years', String(p.years)),
      row('Paid by', `${p.buyer.slice(0, 8)}…${p.buyer.slice(-6)}`),
      ...(p.reservedFor
        ? [row('Owned by', `${p.reservedFor.slice(0, 8)}…${p.reservedFor.slice(-6)}`)]
        : []),
    ]}),

    el('div', { cls: 'parsec-nfdominter__quote-box', children: [
      quoteRow('NFD price', p.cost.basePrice),
      quoteRow('Contract funding', p.cost.carryCost),
      quoteRow('Network fee', p.cost.extraFee),
      quoteRow('NFDminter fee', p.cost.bankonFee, true),
      el('div', { cls: 'parsec-nfdominter__quote-total', children: [
        el('span', { text: 'Total' }),
        el('span', { text: formatAlgo(p.cost.totalMicroAlgos) }),
      ]}),
    ]}),

    balanceBox,

    el('div', { cls: 'parsec-nfdominter__confirm-note', children: [
      el('p', { text: 'The NFD mint group runs first. The NFD SDK simulates it before submitting — if the registry rejects the name, nothing is signed or charged.' }),
      el('p', { text: `Once the name is claimed, a ${formatAlgo(p.cost.bankonFee)} NFDminter fee is paid in a second transaction.` }),
      el('p', { cls: 'parsec-nfdominter__muted', text: treasuryNote }),
    ]}),

    errorBox,
    progress,
    signBtn,
  );

  return root;
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
    case 'paying-bankon-fee': return 'Paying NFDminter fee — awaiting signature…';
    case 'awaiting-signature': return 'Awaiting signature for NFD mint…';
    case 'submitting': return 'Submitting mint group…';
    case 'confirmed': return p.appId ? `Confirmed! app id ${p.appId}.` : 'Confirmed.';
    case 'error': return p.error ?? 'Error.';
  }
}
