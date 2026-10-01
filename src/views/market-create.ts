// Create a marketplace listing from an owned name.
// Reads name + namespace from sessionStorage (set by ario-name / bankon-name)
// or via a select if the user navigates here directly.

import { el, btn, input, toast } from '../lib/dom';
import { store, getAccountAddress } from '../lib/store';
import {
  buildCreateListingInput,
  escrowArnsName,
  escrowBankonName,
  isBmrConfigured,
  type Namespace,
} from '../lib/marketplace';
import { signDataItemFromVault } from '../lib/arweave/ans104';
import { aoMessage } from '../lib/arweave/ao';
import { formatArio, parseArio } from '../lib/arweave/ario';
import { getArnsRecord } from '../lib/arweave/ario';

type Phase = 'configure' | 'creating' | 'escrowing' | 'done' | 'failed';

interface State {
  phase: Phase;
  address?: string;
  namespace: Namespace;
  name: string;
  askPriceArio: string;
  durationDays: number;
  isAuction: boolean;
  minIncrementArio: string;
  auctionHours: number;
  listingId?: string;
  escrowMessageId?: string;
  error?: string;
  log: string[];
}

export function marketCreateView(): HTMLElement {
  const root = el('div', { cls: 'parsec-view parsec-confirm' });

  const state: State = {
    phase: 'configure',
    namespace: (sessionStorage.getItem('parsec:market-list-namespace') as Namespace) || 'bankon',
    name: sessionStorage.getItem('parsec:market-list-name') ?? '',
    askPriceArio: '',
    durationDays: 7,
    isAuction: false,
    minIncrementArio: '0.1',
    auctionHours: 24,
    log: [],
  };
  sessionStorage.removeItem('parsec:market-list-namespace');
  sessionStorage.removeItem('parsec:market-list-name');

  function log(m: string): void {
    state.log.push(`[${new Date().toLocaleTimeString()}] ${m}`);
    render();
  }

  function render(): void {
    root.innerHTML = '';
    root.appendChild(el('div', {
      cls: 'parsec-view__header',
      children: [
        btn('Back', { minimal: true, icon: 'arrow-left', onClick: () => store.navigate('market-hub') }),
        el('h2', { cls: 'parsec-view__title', text: 'List a name for sale' }),
      ],
    }));

    if (!isBmrConfigured()) {
      root.appendChild(el('div', {
        cls: 'parsec-callout bp5-callout bp5-intent-warning',
        children: [el('p', { text: 'Marketplace Registry not spawned yet.' })],
      }));
      return;
    }

    const s = store.get();
    const account = s.accounts[s.activeAccountIndex];
    state.address = account
      ? (getAccountAddress(account, 'arweave-hd') ?? getAccountAddress(account, 'arweave'))
      : undefined;
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

    if (state.phase === 'configure') root.appendChild(buildConfigure());
    if (state.phase === 'creating') root.appendChild(busyPanel('Creating listing on the BMR...'));
    if (state.phase === 'escrowing') root.appendChild(busyPanel('Transferring name to BMR escrow...'));
    if (state.phase === 'done') root.appendChild(buildDone());
    if (state.phase === 'failed') root.appendChild(buildFailed());

    if (state.log.length > 0) {
      root.appendChild(el('pre', {
        cls: 'parsec-confirm__details',
        attrs: { style: 'white-space: pre-wrap; max-height: 200px; overflow: auto;' },
        text: state.log.join('\n'),
      }));
    }
  }

  function buildConfigure(): HTMLElement {
    const nsSelect = el('select', {
      cls: 'bp5-input',
      children: [
        el('option', { attrs: { value: 'bankon', ...(state.namespace === 'bankon' ? { selected: 'selected' } : {}) }, text: 'BANKON' }),
        el('option', { attrs: { value: 'arns', ...(state.namespace === 'arns' ? { selected: 'selected' } : {}) }, text: 'ArNS' }),
      ],
    }) as HTMLSelectElement;
    nsSelect.addEventListener('change', () => { state.namespace = nsSelect.value as Namespace; });

    const nameInput = input({
      placeholder: 'name (must be one you own)',
      cls: 'bp5-input bp5-fill',
      value: state.name,
      onInput: (v) => { state.name = v.trim().toLowerCase(); },
    });
    const priceInput = input({
      placeholder: 'ask price (ARIO)',
      cls: 'bp5-input bp5-fill',
      value: state.askPriceArio,
      onInput: (v) => { state.askPriceArio = v.trim(); },
    });
    const durationInput = input({
      placeholder: 'duration (days)',
      cls: 'bp5-input',
      value: String(state.durationDays),
      onInput: (v) => { state.durationDays = Math.max(1, parseInt(v, 10) || 7); },
    });

    const auctionToggle = input({ type: 'checkbox', cls: '' });
    auctionToggle.checked = state.isAuction;
    auctionToggle.addEventListener('change', () => {
      state.isAuction = auctionToggle.checked;
      render();
    });

    const auctionFields: HTMLElement[] = state.isAuction
      ? [
          el('label', { text: 'Min increment (ARIO)' }),
          input({
            placeholder: '0.1',
            cls: 'bp5-input',
            value: state.minIncrementArio,
            onInput: (v) => { state.minIncrementArio = v.trim(); },
          }),
          el('label', { text: 'Auction duration (hours)' }),
          input({
            placeholder: '24',
            cls: 'bp5-input',
            value: String(state.auctionHours),
            onInput: (v) => { state.auctionHours = Math.max(1, parseInt(v, 10) || 24); },
          }),
        ]
      : [];

    return el('div', {
      children: [
        el('div', {
          cls: 'parsec-confirm__details',
          children: [
            el('label', { text: 'Namespace' }),
            nsSelect,
            el('label', { text: 'Name' }),
            nameInput,
            el('label', { text: 'Ask price' }),
            priceInput,
            el('label', { text: 'Duration (days)' }),
            durationInput,
            el('label', { children: [auctionToggle, ' List as auction'] }),
            ...auctionFields,
          ],
        }),
        el('div', {
          cls: 'parsec-confirm__actions',
          children: [
            btn('Cancel', { outlined: true, large: true, onClick: () => store.navigate('market-hub') }),
            btn('Create + escrow', {
              intent: 'primary',
              large: true,
              icon: 'shop',
              onClick: () => void createAndEscrow(),
            }),
          ],
        }),
      ],
    });
  }

  async function createAndEscrow(): Promise<void> {
    if (!state.name) { toast('Name required', 'warning'); return; }
    let askPrice: bigint;
    try {
      askPrice = parseArio(state.askPriceArio || '0');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Invalid ask price', 'warning');
      return;
    }
    if (askPrice <= 0n) { toast('Ask price must be > 0', 'warning'); return; }

    const passphrase = store.getPassphrase();
    if (!passphrase) {
      toast('Wallet is locked', 'danger');
      store.navigate('unlock');
      return;
    }

    // For ArNS we need the ANT process id to escrow. Fetch it up front so
    // we can fail loudly before the listing is created.
    let antProcessId: string | undefined;
    if (state.namespace === 'arns') {
      const record = await getArnsRecord(state.name);
      if (!record) {
        state.error = `ArNS record for "${state.name}" not found`;
        state.phase = 'failed';
        render();
        return;
      }
      antProcessId = record.processId;
    }

    state.phase = 'creating';
    render();
    log(`Creating listing for ${state.namespace}:${state.name} at ${formatArio(askPrice)} ARIO...`);
    try {
      const now = Date.now();
      const expiresAtMs = now + state.durationDays * 24 * 60 * 60 * 1000;
      const auction = state.isAuction
        ? {
            minIncrement: parseArio(state.minIncrementArio || '0'),
            endTimeMs: now + state.auctionHours * 60 * 60 * 1000,
          }
        : undefined;
      const listingInput = buildCreateListingInput({
        namespace: state.namespace,
        name: state.name,
        askPrice,
        expiresAtMs,
        auction,
      });
      const signed = await signDataItemFromVault(state.address!, passphrase, listingInput);
      state.listingId = signed.id;
      await aoMessage(signed);
      log(`Listing created (id=${signed.id}).`);
    } catch (e) {
      state.error = e instanceof Error ? e.message : String(e);
      state.phase = 'failed';
      render();
      return;
    }

    state.phase = 'escrowing';
    render();
    log('Transferring asset to BMR escrow...');
    try {
      if (state.namespace === 'bankon') {
        const r = await escrowBankonName({ address: state.address!, passphrase, name: state.name });
        state.escrowMessageId = r.id;
      } else if (antProcessId) {
        const r = await escrowArnsName({ address: state.address!, passphrase, antProcessId });
        state.escrowMessageId = r.id;
      }
      log(`Escrow message posted (id=${state.escrowMessageId ?? '—'}). BMR will mark the listing escrowed on receive.`);
      state.phase = 'done';
      render();
    } catch (e) {
      state.error = `Escrow failed: ${e instanceof Error ? e.message : String(e)}`;
      state.phase = 'failed';
      render();
    }
  }

  function busyPanel(text: string): HTMLElement {
    return el('div', { cls: 'parsec-callout bp5-callout bp5-intent-primary', children: [el('p', { text })] });
  }

  function buildDone(): HTMLElement {
    return el('div', {
      children: [
        el('div', {
          cls: 'parsec-callout bp5-callout bp5-intent-success',
          children: [el('p', { text: `Listing live. ${state.namespace}:${state.name} is in BMR escrow.` })],
        }),
        el('div', {
          cls: 'parsec-confirm__details',
          children: [
            row('Listing id', state.listingId ?? '—'),
            row('Escrow message id', state.escrowMessageId ?? '—'),
          ],
        }),
        btn('Back to marketplace', {
          intent: 'primary',
          onClick: () => store.navigate('market-hub'),
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
        state.listingId ? el('p', { cls: 'parsec-view__desc', text: `Orphan listing id: ${state.listingId}. You can retry escrow from the marketplace hub.` }) : el('span', {}),
        btn('Back', { intent: 'primary', onClick: () => store.navigate('market-hub') }),
      ],
    });
  }

  render();
  return root;
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
