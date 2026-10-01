// Unified claim flow. Adapter handles namespace-specific details
// (ANT spawn for ArNS, single message for BANKON). Linear state machine:
//   search → configure → execute → done | failed.

import { el, btn, input, toast } from '../lib/dom';
import { store, getAccountAddress } from '../lib/store';
import { quoteNameClaim, proveNameClaimPayment, proofStillCovers, type NameClaimProof, type NameClaimQuote } from '../lib/bankon-names/pay';
import { parsecAvmSigner } from '../lib/x402/adapters/parsec';
import { explorerTxUrl } from '../lib/x402/networks';
import {
  activeNamespaceId,
  getNamespace,
  type NamespaceAdapter,
  type PurchaseType,
} from '../lib/namespaces';

type Phase = 'search' | 'configure' | 'executing' | 'done' | 'failed';

interface State {
  phase: Phase;
  address?: string;
  name: string;
  available?: boolean;
  costAmount?: bigint;
  costUnit?: string;
  purchaseType: PurchaseType;
  years: number;
  paymentMethod: string;
  paymentProof: string;
  paymentAmount?: bigint;
  /** The treasury, the price, and any settlement already on file that covers it. */
  claimQuote?: NameClaimQuote;
  quoteError?: string;
  paying?: boolean;
  /** The proof this wallet produced, if any. A pasted one is not tracked here. */
  walletProof?: NameClaimProof;
  messageId?: string;
  childProcessId?: string;
  error?: string;
  log: string[];
}

export function nameClaimView(): HTMLElement {
  const ns = getNamespace(activeNamespaceId());
  const prefill = sessionStorage.getItem('parsec:name-claim-prefill') ?? '';
  sessionStorage.removeItem('parsec:name-claim-prefill');

  const state: State = {
    phase: 'search',
    name: prefill,
    purchaseType: 'lease',
    years: 1,
    paymentMethod: ns?.capabilities.acceptedPaymentMethods[0] ?? 'free',
    paymentProof: '',
    log: [],
  };

  const root = el('div', { cls: 'parsec-view parsec-confirm' });

  function logLine(m: string): void {
    state.log.push(`[${new Date().toLocaleTimeString()}] ${m}`);
    render();
  }

  function render(): void {
    root.innerHTML = '';
    root.appendChild(el('div', {
      cls: 'parsec-view__header',
      children: [
        btn('Back', { minimal: true, icon: 'arrow-left', onClick: () => store.navigate('name-hub') }),
        el('h2', { cls: 'parsec-view__title', text: ns ? `Claim · ${ns.displayName}` : 'Claim a name' }),
      ],
    }));

    if (!ns) {
      root.appendChild(el('p', { cls: 'parsec-empty', text: 'No namespace adapter registered.' }));
      return;
    }

    const s = store.get();
    const account = s.accounts[s.activeAccountIndex];
    state.address = account ? (getAccountAddress(account, 'arweave-hd') ?? getAccountAddress(account, 'arweave')) : undefined;
    if (!state.address) {
      root.appendChild(el('div', {
        cls: 'parsec-callout bp5-callout bp5-intent-warning',
        children: [
          el('p', { text: 'No Arweave address.' }),
          btn('Create Arweave', { intent: 'primary', onClick: () => store.navigate('arweave-create') }),
        ],
      }));
      return;
    }

    if (state.phase === 'search') root.appendChild(buildSearch(ns));
    if (state.phase === 'configure') root.appendChild(buildConfigure(ns));
    if (state.phase === 'executing') root.appendChild(busyPanel('Working — do not navigate away.'));
    if (state.phase === 'done') root.appendChild(buildDone(ns));
    if (state.phase === 'failed') root.appendChild(buildFailed());

    if (state.log.length > 0) {
      root.appendChild(el('pre', {
        cls: 'parsec-confirm__details',
        attrs: { style: 'white-space: pre-wrap; max-height: 200px; overflow: auto;' },
        text: state.log.join('\n'),
      }));
    }
  }

  function buildSearch(ns: NamespaceAdapter): HTMLElement {
    const inp = input({
      placeholder: 'name (lowercase a-z 0-9 -)',
      cls: 'bp5-input bp5-large bp5-fill',
      value: state.name,
      onInput: (v) => { state.name = v.toLowerCase().trim(); },
      onEnter: () => void runSearch(ns),
    });
    return el('div', {
      children: [
        el('p', { cls: 'parsec-view__desc', text: `Check availability on ${ns.displayName}.` }),
        inp,
        el('div', {
          cls: 'parsec-confirm__actions',
          children: [btn('Check', { intent: 'primary', large: true, onClick: () => void runSearch(ns) })],
        }),
      ],
    });
  }

  async function runSearch(ns: NamespaceAdapter): Promise<void> {
    if (!state.name || !/^[a-z0-9-]{1,51}$/.test(state.name) || state.name.startsWith('-') || state.name.endsWith('-')) {
      toast('Name must match a-z 0-9 - (no leading/trailing hyphen)', 'warning');
      return;
    }
    try {
      logLine('Checking availability...');
      const [record, reserved] = await Promise.all([
        ns.getRecord(state.name),
        ns.isReserved(state.name),
      ]);
      if (record) { state.error = `"${state.name}" is already registered.`; state.phase = 'failed'; render(); return; }
      if (reserved) { state.error = `"${state.name}" is reserved.`; state.phase = 'failed'; render(); return; }
      state.available = true;
      state.phase = 'configure';
      await refreshCost(ns);
      void refreshClaimQuote(ns);
      render();
    } catch (e) {
      state.error = e instanceof Error ? e.message : String(e);
      state.phase = 'failed';
      render();
    }
  }

  function buildConfigure(ns: NamespaceAdapter): HTMLElement {
    const purchaseSelect = el('select', {
      cls: 'bp5-input',
      children: ['lease', 'permabuy'].map((v) =>
        el('option', { attrs: { value: v, ...(v === state.purchaseType ? { selected: 'selected' } : {}) }, text: v }),
      ),
    }) as HTMLSelectElement;
    purchaseSelect.addEventListener('change', () => {
      state.purchaseType = purchaseSelect.value as PurchaseType;
      void refreshCost(ns);
      void refreshClaimQuote(ns);
      render();
    });

    const yearsSelect = el('select', {
      cls: 'bp5-input',
      children: [1, 2, 3, 4, 5].map((v) =>
        el('option', { attrs: { value: String(v), ...(v === state.years ? { selected: 'selected' } : {}) }, text: `${v} year${v === 1 ? '' : 's'}` }),
      ),
    }) as HTMLSelectElement;
    yearsSelect.addEventListener('change', () => {
      state.years = parseInt(yearsSelect.value, 10);
      void refreshCost(ns);
      void refreshClaimQuote(ns);
      render();
    });

    const methodSelect = el('select', {
      cls: 'bp5-input',
      children: ns.capabilities.acceptedPaymentMethods.map((m) =>
        el('option', { attrs: { value: m, ...(m === state.paymentMethod ? { selected: 'selected' } : {}) }, text: m }),
      ),
    }) as HTMLSelectElement;
    methodSelect.addEventListener('change', () => {
      state.paymentMethod = methodSelect.value;
      state.paymentProof = '';
      state.claimQuote = undefined;
      state.quoteError = undefined;
      void refreshCost(ns);
      void refreshClaimQuote(ns);
      render();
    });

    const proofInput = (state.paymentMethod !== 'free')
      ? input({
          placeholder: 'Payment proof (tx id; method-specific)',
          cls: 'bp5-input bp5-fill',
          value: state.paymentProof,
          onInput: (v) => { state.paymentProof = v.trim(); state.walletProof = undefined; },
        })
      : null;

    // The wallet can produce the proof rather than asking for it to be pasted:
    // the registry quotes a price and a treasury, and paying it *is* the proof.
    // The box stays, because a payment may have been made outside this wallet.
    const payPanel = state.paymentMethod === 'algorand' ? treasuryPanel(ns) : null;

    return el('div', {
      children: [
        el('div', {
          cls: 'parsec-callout bp5-callout bp5-intent-success',
          children: [el('p', { text: `"${state.name}" is available.` })],
        }),
        el('div', {
          cls: 'parsec-confirm__details',
          children: [
            row('Purchase type', purchaseSelect),
            state.purchaseType === 'lease' ? row('Years', yearsSelect) : el('span', {}),
            ns.capabilities.acceptedPaymentMethods.length > 1
              ? row('Payment method', methodSelect)
              : el('span', {}),
            row('Cost', state.costAmount === undefined ? 'Loading...' : `${state.costAmount.toString()} ${state.costUnit ?? ''}`),
            proofInput ? el('label', { text: 'Payment proof' }) : el('span', {}),
            proofInput ? proofInput : el('span', {}),
          ].filter(node => (node as HTMLElement).childNodes.length > 0) as HTMLElement[],
        }),
        payPanel ?? el('span', {}),
        el('div', {
          cls: 'parsec-confirm__actions',
          children: [
            btn('Cancel', { outlined: true, large: true, onClick: () => store.navigate('name-hub') }),
            btn('Sign & Submit', {
              intent: 'primary',
              large: true,
              onClick: () => void execute(ns),
            }),
          ],
        }),
      ],
    });
  }

  /**
   * Read the registry's own treasury and price, and whether a settlement already on
   * file covers it. Never throws into the render path — a registry that cannot be
   * reached leaves the manual proof box, which still works.
   */
  let quoteSeq = 0;

  async function refreshClaimQuote(ns: NamespaceAdapter): Promise<void> {
    if (state.paymentMethod !== 'algorand' || ns.id !== 'bankon') return;
    // The term and the years change the price, so a quote can be superseded while it
    // is in flight. Only the newest one is allowed to land.
    const seq = ++quoteSeq;
    state.claimQuote = undefined;
    state.quoteError = undefined;
    render();
    try {
      const quote = await quoteNameClaim(
        'Buy-Name',
        state.name,
        { paymentMethod: 'algorand', purchaseType: state.purchaseType, years: state.years },
        store.get().settings.network,
      );
      if (seq !== quoteSeq) return;
      state.claimQuote = quote;

      if (quote.existing) {
        // A settlement already on file covers this quote; nothing further is owed.
        state.paymentProof = quote.existing.txId;
        state.paymentAmount = quote.existing.amount;
        state.walletProof = quote.existing;
      } else if (state.walletProof && !proofStillCovers(state.walletProof, quote)) {
        // We paid, then the price moved — a longer lease, a different term. The old
        // transaction is real but no longer covers what is being claimed, and
        // submitting it would underpay. Drop it rather than let it ride.
        state.paymentProof = '';
        state.paymentAmount = undefined;
        state.walletProof = undefined;
        logLine('The price changed; the earlier payment no longer covers it.');
      }
    } catch (e) {
      if (seq !== quoteSeq) return;
      state.quoteError = e instanceof Error ? e.message : String(e);
    }
    render();
  }

  /** Pay the treasury, or show the settlement that already did. */
  function treasuryPanel(ns: NamespaceAdapter): HTMLElement {
    if (state.quoteError) {
      return el('div', {
        cls: 'parsec-callout bp5-callout bp5-intent-warning',
        children: [
          el('p', { text: `Could not read the registry's treasury: ${state.quoteError}` }),
          el('p', { cls: 'parsec-muted', text: 'Paste a transaction id above if you have already paid.' }),
        ],
      });
    }

    const quote = state.claimQuote;
    if (!quote) {
      return el('div', {
        cls: 'parsec-callout bp5-callout',
        children: [el('p', { cls: 'parsec-muted', text: 'Reading the registry treasury…' })],
      });
    }

    const existing = quote.existing;
    if (existing) {
      const link = explorerTxUrl(
        store.get().settings.network === 'mainnet' ? 'algorand-mainnet' : 'algorand-testnet',
        existing.txId,
      );
      return el('div', {
        cls: 'parsec-callout bp5-callout bp5-intent-success',
        children: [
          el('p', { text: 'Already paid — a settlement to this treasury covers the quote.' }),
          link
            ? el('a', { text: existing.txId, cls: 'parsec-asset-link', attrs: { href: link, target: '_blank', rel: 'noreferrer' } })
            : el('p', { cls: 'parsec-muted', text: existing.txId }),
        ],
      });
    }

    return el('div', {
      cls: 'parsec-callout bp5-callout bp5-intent-primary',
      children: [
        el('p', { text: `${quote.amount.toString()} ${quote.unit} to the registry treasury on ${quote.networkLabel}.` }),
        el('p', { cls: 'parsec-muted', text: `Treasury ${quote.treasury.slice(0, 8)}…${quote.treasury.slice(-6)} — read live from the registry, not stored here.` }),
        btn(state.paying ? 'Paying…' : 'Pay the treasury', {
          intent: 'primary',
          disabled: state.paying || !state.address,
          onClick: () => void payTreasuryNow(ns),
        }),
      ],
    });
  }

  /**
   * Pay, and put the transaction id in the proof box.
   *
   * The payment and the claim stay two steps on purpose: the payment is final the
   * moment it is in a block, and a claim that failed afterwards must not look like a
   * reason to pay again.
   */
  async function payTreasuryNow(ns: NamespaceAdapter): Promise<void> {
    const quote = state.claimQuote;
    if (!quote || !state.address) return;
    state.paying = true;
    render();
    try {
      logLine(`Paying ${quote.amount} ${quote.unit} to ${quote.treasury}...`);
      const proof = await proveNameClaimPayment(
        parsecAvmSigner(state.address),
        quote,
        state.name,
        store.get().settings.network,
      );
      state.paymentProof = proof.txId;
      state.paymentAmount = proof.amount;
      state.walletProof = proof;
      logLine(`Paid — ${proof.txId} (${proof.source}).`);
      toast('Payment settled. Sign the claim to finish.', 'success');
      await refreshClaimQuote(ns);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      logLine(`Payment failed: ${message}`);
      toast(message, 'danger');
    } finally {
      state.paying = false;
      render();
    }
  }

  async function refreshCost(ns: NamespaceAdapter): Promise<void> {
    try {
      const r = await ns.getCost({
        intent: 'Buy-Name',
        name: state.name,
        years: state.years,
        purchaseType: state.purchaseType,
        paymentMethod: state.paymentMethod,
      });
      state.costAmount = r.amount;
      state.costUnit = r.unit;
      // Surface declared amount for non-free methods so the adapter has it
      // ready to sign into the Payment-Amount tag.
      if (state.paymentMethod !== 'free') {
        state.paymentAmount = r.amount;
      }
      render();
    } catch { /* leave previous */ }
  }

  async function execute(ns: NamespaceAdapter): Promise<void> {
    const passphrase = store.getPassphrase();
    if (!passphrase) {
      toast('Wallet is locked', 'danger');
      store.navigate('unlock');
      return;
    }
    if (state.paymentMethod !== 'free' && state.paymentProof.length < 32) {
      toast('Enter a Payment-Proof tx id', 'warning');
      return;
    }
    state.phase = 'executing';
    render();
    try {
      logLine(`Claiming ${state.name} on ${ns.displayName}...`);
      const result = await ns.claim({
        address: state.address!,
        passphrase,
        name: state.name,
        purchaseType: state.purchaseType,
        years: state.purchaseType === 'lease' ? state.years : undefined,
        paymentMethod: state.paymentMethod,
        paymentProof: state.paymentProof || undefined,
        paymentAmount: state.paymentAmount,
      });
      state.messageId = result.id;
      state.childProcessId = result.childProcessId;
      logLine(`Claim signed (id=${result.id}).`);
      if (result.childProcessId) logLine(`Child process spawned: ${result.childProcessId}`);
      state.phase = 'done';
      render();
    } catch (e) {
      state.error = e instanceof Error ? e.message : String(e);
      state.phase = 'failed';
      render();
    }
  }

  function busyPanel(text: string): HTMLElement {
    return el('div', { cls: 'parsec-callout bp5-callout bp5-intent-primary', children: [el('p', { text })] });
  }

  function buildDone(ns: NamespaceAdapter): HTMLElement {
    return el('div', {
      children: [
        el('div', {
          cls: 'parsec-callout bp5-callout bp5-intent-success',
          children: [el('p', { text: `"${state.name}" claimed on ${ns.displayName}.` })],
        }),
        el('div', {
          cls: 'parsec-confirm__details',
          children: [
            row('Message id', state.messageId ?? '—'),
            state.childProcessId ? row('Child process', state.childProcessId) : el('span', {}),
            row('Type', state.purchaseType + (state.purchaseType === 'lease' ? ` · ${state.years}y` : '')),
          ].filter((node) => (node as HTMLElement).childNodes.length > 0) as HTMLElement[],
        }),
        el('div', {
          cls: 'parsec-confirm__actions',
          children: [
            btn('Manage', {
              intent: 'primary',
              large: true,
              onClick: () => {
                sessionStorage.setItem('parsec:active-name', state.name);
                store.navigate('name-manage');
              },
            }),
            btn('Back to hub', { outlined: true, onClick: () => store.navigate('name-hub') }),
          ],
        }),
      ],
    });
  }

  function buildFailed(): HTMLElement {
    return el('div', {
      children: [
        el('div', {
          cls: 'parsec-callout bp5-callout bp5-intent-danger',
          children: [el('p', { text: state.error ?? 'Unknown failure' })],
        }),
        state.childProcessId
          ? el('p', { cls: 'parsec-view__desc', text: `Orphan child process id: ${state.childProcessId}.` })
          : el('span', {}),
        btn('Back to hub', { intent: 'primary', onClick: () => store.navigate('name-hub') }),
      ],
    });
  }

  render();
  return root;
}

function row(label: string, value: string | HTMLElement): HTMLElement {
  const valueNode = typeof value === 'string'
    ? el('span', { cls: 'parsec-confirm__value', text: value })
    : value;
  return el('div', {
    cls: 'parsec-confirm__row',
    children: [el('span', { cls: 'parsec-confirm__label', text: label }), valueNode],
  });
}
