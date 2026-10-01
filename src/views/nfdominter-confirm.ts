// .algo Names — review and pay.
//
// One screen, one decision. Registering a name is two payments to two parties,
// shown side by side and never summed (different currencies):
//
//   · the registration service fee — USDC, over x402, to the name service;
//   · the NFD registry's price     — ALGO, in the mint group itself.
//
// "Pay & register" pays the service fee first, then mints. The fee is quoted here
// before anything is signed, and paid only if the offer at pay time is the one
// shown (service-fee.ts refuses a changed price). The result screen carries the
// name, its NFD application id and the service-fee settlement, each linked on the
// right network.

import { el, btn, toast } from '../lib/dom';
import { store } from '../lib/store';
import { x402Ready } from '../lib/ui/x402-ready';
import {
  mintNfdWithFee,
  type Nfd,
  type NfdMintCostBreakdown,
  type MintProgress,
} from '../lib/nfd';
import { quoteServiceFee, payServiceFee, type ServiceFeeQuote } from '../lib/nfd/service-fee';
import { signersForAccount } from '../lib/x402/adapters/parsec';
import { explorerTxUrl } from '../lib/x402/networks';
import { fetchAccountInfo } from '../lib/algorand/account';
import { formatDecimal } from '../lib/money';
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
  const owner = p.reservedFor ?? p.buyer;
  const root = el('div', { cls: 'parsec-view parsec-nfdominter__confirm parsec-nfdominter--wide' });

  const progress = el('div', { cls: 'parsec-nfdominter__progress', attrs: { 'aria-live': 'polite' }, text: '' });
  // Persistent error panel — a failed payment must NOT vanish in a toast.
  const errorBox = el('div', { cls: 'parsec-nfdominter__error', attrs: { hidden: 'true' } });

  let feeQuote: ServiceFeeQuote | null = null;
  let feeReady = false;
  let algoReady = false;
  const gate = () => { payBtn.disabled = !(feeReady && algoReady); };

  const payBtn = btn('Pay & register', {
    intent: 'primary',
    large: true,
    icon: 'confirm',
    disabled: true,
    cls: 'parsec-nfdominter__sign-btn',
    onClick: () => { void run(); },
  }) as HTMLButtonElement;

  const backBtn = btn('Back', {
    minimal: true,
    icon: 'arrow-left',
    onClick: () => { pending = null; store.navigate('nfdominter'); },
  }) as HTMLButtonElement;

  // ── The service fee (USDC, x402) ─────────────────────────────────────────
  const feeBox = el('div', {
    cls: 'parsec-nfdominter__quote-box',
    children: [el('div', { cls: 'parsec-nfdominter__hint', text: 'Fetching the service fee…' })],
  });
  quoteServiceFee(p.name, owner, p.network)
    .then((q) => {
      feeQuote = q;
      feeBox.innerHTML = '';
      if (!q) {
        feeBox.appendChild(el('div', { cls: 'parsec-nfdominter__hint', text: 'No BANKONx402 fee is charged for this name.' }));
      } else {
        feeBox.append(
          el('div', { cls: 'parsec-nfdominter__quote-row', children: [
            el('span', { text: 'BANKONx402 fee' }),
            el('span', { text: `${q.quote.amountDisplay} ${q.quote.assetSymbol}${q.quote.usdDisplay ? ` (${q.quote.usdDisplay})` : ''}` }),
          ]}),
          el('div', { cls: 'parsec-nfdominter__hint', text: `Collected by BANKON for PARSEC — the only fee here that is ours. Paid over x402 on ${q.quote.networkLabel}; the facilitator pays this transfer's network fee.` }),
        );
      }
      feeReady = true;
      gate();
    })
    .catch((e) => {
      feeBox.innerHTML = '';
      feeBox.appendChild(el('div', {
        cls: 'parsec-callout bp5-callout bp5-intent-danger',
        text: `Could not fetch the BANKONx402 fee: ${e instanceof Error ? e.message : String(e)}`,
      }));
    });

  // ── The NFD price (ALGO), gated on a live balance ────────────────────────
  const balanceBox = el('div', {
    cls: 'parsec-nfdominter__balance',
    children: [el('div', { cls: 'parsec-nfdominter__hint', text: 'Checking wallet balance…' })],
  });
  const total = p.cost.totalMicroAlgos;
  fetchAccountInfo(p.buyer, p.network)
    .then((info: AccountInfo) => {
      const amount = BigInt(Math.trunc(info.amount));
      const minBalance = BigInt(Math.trunc(info.minBalance));
      const spendable = amount > minBalance ? amount - minBalance : 0n;
      const ok = spendable >= total;
      balanceBox.innerHTML = '';
      balanceBox.append(
        row('ALGO balance', algo(amount)),
        row('Spendable', algo(spendable)),
      );
      if (!ok) {
        balanceBox.appendChild(el('div', {
          cls: 'parsec-callout bp5-callout bp5-intent-danger',
          text: `Not enough ALGO. The NFD price is ${algo(total)}; ${algo(spendable)} is spendable after the ${algo(minBalance)} minimum balance.`,
        }));
      }
      algoReady = ok;
      gate();
    })
    .catch(() => {
      balanceBox.innerHTML = '';
      balanceBox.appendChild(el('div', {
        cls: 'parsec-callout bp5-callout bp5-intent-warning',
        text: 'Could not read the wallet balance. Check the network connection, then go back and try again.',
      }));
    });

  // ── Network — prominent, because mainnet spends real money ───────────────
  const networkRow = el('div', {
    cls: 'parsec-nfdominter__confirm-network',
    children: [
      el('span', { cls: `parsec-network-badge parsec-network-badge--${p.network}`, text: p.network.toUpperCase() }),
      p.network === 'mainnet'
        ? el('span', { cls: 'parsec-nfdominter__hint parsec-nfdominter__hint--error', text: 'Real USDC and ALGO. This cannot be undone.' })
        : el('span', { cls: 'parsec-nfdominter__hint', text: 'Test network — no real value at stake.' }),
    ],
  });

  async function run() {
    const pass = store.getPassphrase();
    if (!pass) { showError(new Error('The wallet is locked. Unlock it, then come back to this name.'), 'Locked'); return; }
    const state = store.get();
    const account = state.accounts[state.activeAccountIndex];
    if (!account) { showError(new Error('No active account.'), 'No account'); return; }
    payBtn.disabled = true;
    backBtn.disabled = true;
    errorBox.setAttribute('hidden', 'true');
    errorBox.innerHTML = '';

    let feeTxId = '';
    try {
      if (feeQuote) {
        progress.textContent = 'Paying the BANKONx402 fee…';
        const paid = await payServiceFee({ name: p.name, owner, signers: signersForAccount(account), reviewed: feeQuote });
        feeTxId = paid.txId;
      }
    } catch (e) {
      progress.textContent = '';
      showError(e, 'BANKONx402 fee not paid — nothing was charged');
      payBtn.disabled = false;
      backBtn.disabled = false;
      return;
    }

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
      toast(`Registered ${nfd.name}.`, 'success');
      pending = null;
      renderSuccess(nfd, feeTxId);
    } catch (e) {
      progress.textContent = '';
      // The fee settled but the mint did not: say so plainly, with the proof.
      showError(e, feeTxId ? 'BANKONx402 fee paid, but the name was not minted' : 'Mint failed', feeTxId);
      payBtn.disabled = false;
      backBtn.disabled = false;
      if (feeTxId) {
        // Never charge twice: from here, retrying only mints.
        feeQuote = null;
        payBtn.textContent = 'Retry the mint';
      }
    }
  }

  function showError(e: unknown, title: string, feeTxId = ''): void {
    const message = e instanceof Error ? e.message : String(e);
    const stack = e instanceof Error && e.stack ? e.stack : message;
    console.error('[algo-names]', title, e);
    errorBox.innerHTML = '';
    errorBox.append(
      el('div', { cls: 'parsec-callout bp5-callout bp5-intent-danger', children: [
        el('div', { cls: 'parsec-nfdominter__error-title', text: title }),
        ...(feeTxId ? [txLine('BANKONx402 fee settlement', feeTxId, feeQuote?.network ?? '')] : []),
        el('pre', { cls: 'parsec-nfdominter__error-message', text: message }),
        btn('Copy error', {
          minimal: true,
          icon: 'duplicate',
          onClick: () => {
            void navigator.clipboard.writeText(stack).then(
              () => toast('Error copied.', 'success'),
              () => toast('Copy failed — select the text manually.', 'warning'),
            );
          },
        }),
      ]}),
    );
    errorBox.removeAttribute('hidden');
    errorBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function txLine(label: string, txId: string, network: string): HTMLElement {
    const href = network ? explorerTxUrl(network, txId) : '';
    return el('div', { cls: 'parsec-nfdominter__summary-row', children: [
      el('span', { cls: 'parsec-nfdominter__summary-label', text: label }),
      href
        ? el('a', { cls: 'parsec-nfdominter__summary-value parsec-mono', text: short(txId), attrs: { href, target: '_blank', rel: 'noopener', title: txId } })
        : el('span', { cls: 'parsec-nfdominter__summary-value parsec-mono', text: txId }),
    ]});
  }

  function renderSuccess(nfd: Nfd, feeTxId: string): void {
    const mainnet = p.network === 'mainnet';
    const appHref = nfd.appID ? `https://${mainnet ? '' : 'testnet.'}allo.info/application/${nfd.appID}` : '';
    const profileHref = `https://app.${mainnet ? '' : 'testnet.'}nf.domains/name/${nfd.name}`;
    root.innerHTML = '';
    root.append(
      el('div', { cls: 'parsec-view__header', children: [
        el('h2', { cls: 'parsec-view__title', text: 'Registered' }),
      ]}),
      el('div', { cls: 'parsec-nfdominter__success', children: [
        el('div', { cls: 'parsec-nfdominter__success-mark', text: '✓' }),
        el('h3', { cls: 'parsec-nfdominter__success-name', text: `You own ${nfd.name}` }),
        el('div', { cls: 'parsec-nfdominter__confirm-summary', children: [
          row('Network', p.network),
          row('Owner', owner),
          ...(nfd.appID ? [row('NFD application', String(nfd.appID))] : []),
          ...(feeTxId ? [txLine('BANKONx402 fee settlement', feeTxId, feeQuote?.network ?? (mainnet ? 'algorand-mainnet' : 'algorand-testnet'))] : []),
        ]}),
        el('div', { cls: 'parsec-nfdominter__success-links', children: [
          ...(appHref ? [el('a', { cls: 'parsec-asset-link', text: 'NFD application on allo.info', attrs: { href: appHref, target: '_blank', rel: 'noopener' } })] : []),
          el('a', { cls: 'parsec-asset-link', text: 'Name profile', attrs: { href: profileHref, target: '_blank', rel: 'noopener' } }),
        ]}),
        el('div', { cls: 'parsec-keyflow__actions', children: [
          btn('Register another', { onClick: () => store.navigate('nfdominter') }),
          btn('Done', { intent: 'primary', large: true, onClick: () => store.navigate('dashboard') }),
        ]}),
      ]}),
    );
  }

  root.append(
    el('div', { cls: 'parsec-view__header', children: [
      backBtn,
      el('h2', { cls: 'parsec-view__title', text: `Register ${p.name}` }),
    ]}),
    networkRow,
    el('div', { cls: 'parsec-nfdominter__review', children: [
      // Left: what is being registered, and by whom.
      el('section', { cls: 'parsec-nfdominter__review-col', children: [
        el('p', { cls: 'parsec-nfdominter__review-kicker', text: 'Your name' }),
        el('div', { cls: 'parsec-nfdominter__review-name', text: p.name }),
        el('div', { cls: 'parsec-nfdominter__confirm-summary', children: [
          row('Years', String(p.years)),
          row('Paid by', p.buyer),
          ...(p.reservedFor ? [row('Owned by', p.reservedFor)] : []),
        ]}),
        balanceBox,
        // The BANKONx402 fee is paid in USDC over x402: the same readiness, compact.
        x402Ready({ compact: true }),
      ]}),
      // Right: what it costs, to whom, and the one action.
      el('section', { cls: 'parsec-nfdominter__review-col', children: [
        el('p', { cls: 'parsec-nfdominter__review-kicker', text: 'What it costs' }),
        el('h3', { cls: 'parsec-keyflow__heading', text: 'Necessary to register' }),
        el('p', { cls: 'parsec-nfdominter__muted', text: 'Paid to the NFD registry and the Algorand network. Any wallet that registers this name pays these.' }),
        el('div', { cls: 'parsec-nfdominter__quote-box', children: [
          quoteRow('Name price', p.cost.basePrice),
          quoteRow('Contract funding', p.cost.carryCost),
          quoteRow('Network fee', p.cost.extraFee),
          el('div', { cls: 'parsec-nfdominter__quote-total', children: [
            el('span', { text: 'NFD total' }),
            el('span', { text: algo(total) }),
          ]}),
        ]}),
        el('h3', { cls: 'parsec-keyflow__heading', text: 'BANKONx402 fee' }),
        feeBox,
        el('p', { cls: 'parsec-nfdominter__muted', text: 'The two are in different currencies and go to different parties, so they are shown separately, not added. The BANKONx402 fee is paid first; the NFD mint group is simulated before it is submitted, so a name the registry would reject is caught before any ALGO moves.' }),
        errorBox,
        progress,
        payBtn,
      ]}),
    ]}),
  );

  return root;
}

function row(label: string, value: string): HTMLElement {
  return el('div', { cls: 'parsec-nfdominter__summary-row', children: [
    el('span', { cls: 'parsec-nfdominter__summary-label', text: label }),
    el('span', { cls: 'parsec-nfdominter__summary-value', text: value }),
  ]});
}

function quoteRow(label: string, microAlgos: bigint): HTMLElement {
  return el('div', {
    cls: 'parsec-nfdominter__quote-row',
    children: [el('span', { text: label }), el('span', { text: algo(microAlgos) })],
  });
}

/** Exact: micro-ALGO as a bigint, formatted without a float. */
function algo(microAlgos: bigint): string {
  return `${formatDecimal(microAlgos, 6, { trim: true })} ALGO`;
}

function short(id: string): string {
  return id.length > 18 ? `${id.slice(0, 10)}…${id.slice(-6)}` : id;
}

function describeStage(p: MintProgress): string {
  switch (p.stage) {
    case 'idle': return '';
    case 'validating': return 'Validating the name…';
    case 'checking-availability': return 'Checking availability…';
    case 'quoting': return 'Fetching the NFD price…';
    case 'paying-bankon-fee': return 'Paying fee…';
    case 'paying-service-fee': return 'Paying the BANKONx402 fee…';
    case 'awaiting-signature': return 'Signing the NFD mint…';
    case 'submitting': return 'Submitting the mint…';
    case 'confirmed': return p.appId ? `Confirmed — NFD application ${p.appId}.` : 'Confirmed.';
    case 'error': return p.error ?? 'Error.';
  }
}
