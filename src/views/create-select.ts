// Parsec Wallet — Choose Chains
//
// The first step of creating a wallet. Algorand is not optional: it is the
// account Parsec is built on, and the reason is quantum compliance rather
// than preference — Algorand's Falcon-1024 native accounts (Q3 2026) are
// derivable from the same 25-word seed and preserve the 58-char address
// format, so today's Algorand account is the one that migrates to Tier-Q
// without a re-key. See QUANTUM.md.
//
// The other chains are utility: hold, send, and sign on networks Parsec
// speaks, added to the same account.
//
// Status is derived from which addresses the account actually holds — never
// from a stored "done" flag (TIMELESS rule 1).

import { el, btn, toast } from '../lib/dom';
import { store, getAccountAddress, setAccountAddress } from '../lib/store';
import { keystoreStore } from '../lib/keystore';
import { isTauri } from '../lib/platform';
import type { ChainId } from '../lib/pouch/types';
import type { WalletAccount } from '../types/wallet';

interface ChainOffer {
  readonly id: ChainId;
  readonly label: string;
  readonly unit: string;
  /** Why this chain is on the list. */
  readonly reason: string;
  readonly detail: string;
  /** Algorand — the account Parsec requires. */
  readonly required?: boolean;
  /** Route to a dedicated creation view, when one exists. */
  readonly view?: string;
  /** Otherwise create in place through the chain module. */
  readonly inline?: boolean;
  /** Desktop-only (needs the Rust chain pack). */
  readonly tauriOnly?: boolean;
}

const OFFERS: readonly ChainOffer[] = [
  {
    id: 'algorand',
    label: 'Algorand',
    unit: 'ALGO',
    reason: 'Required — quantum compliance',
    detail:
      '25-word account seed. Falcon-1024 native accounts derive from this same '
      + 'seed and keep the 58-char address, so this account migrates to Tier-Q '
      + 'without a re-key.',
    required: true,
    view: 'create-wallet',
  },
  {
    id: 'bitcoin',
    label: 'Bitcoin',
    unit: 'BTC',
    reason: 'Utility',
    detail: 'BIP-39 seed, native SegWit addresses, PSBT signing via the Rust chain pack.',
    inline: true,
    tauriOnly: true,
  },
  {
    id: 'solana',
    label: 'Solana',
    unit: 'SOL',
    reason: 'Utility',
    detail: '24-word BIP-39 seed, SLIP-0010 ed25519 derivation (Phantom-compatible).',
    view: 'solana-create',
  },
  {
    id: 'arweave',
    label: 'Arweave',
    unit: 'AR',
    reason: 'Utility',
    detail: 'RSA-4096 JWK generated from a 24-word seed. Signs ANS-104 data items and AO messages.',
    view: 'arweave-create',
  },
  {
    id: 'ethereum',
    label: 'EVM',
    unit: 'ETH',
    reason: 'Utility',
    detail: 'secp256k1 key with an EIP-55 checksummed address. Base and 2500+ EVM chains.',
    inline: true,
  },
];

function held(account: WalletAccount | undefined, id: ChainId): string | undefined {
  if (!account) return undefined;
  // Arweave is saved under its derivation's key, 'arweave-hd' (arweave-create.ts),
  // so the plain 'arweave' lookup alone never saw it and the row never read as done.
  if (id === 'arweave') return getAccountAddress(account, 'arweave-hd') ?? getAccountAddress(account, 'arweave');
  return getAccountAddress(account, id === 'ethereum' ? 'ethereum' : id);
}

export function createSelectView(): HTMLElement {
  const state = store.get();
  const account = state.accounts[state.activeAccountIndex];
  const hasAlgorand = Boolean(account && held(account, 'algorand'));

  const view = el('div', { cls: 'parsec-view parsec-chainpick' });

  view.appendChild(el('header', {
    cls: 'parsec-view__header',
    children: [
      btn('Back', { minimal: true, onClick: () => { if (!store.back()) store.navigate('matrix'); } }),
      el('h2', { text: 'Choose your chains' }),
    ],
  }));

  view.appendChild(el('p', {
    cls: 'parsec-chainpick__lede',
    text: hasAlgorand
      ? 'Your Algorand account is set up. Add any utility chains you want on the same account — you can come back to this at any time.'
      : 'Parsec starts with an Algorand account, then adds whatever else you need onto it. One identity, many chains.',
  }));

  const list = el('div', { cls: 'parsec-chainpick__list' });

  for (const offer of OFFERS) {
    const address = held(account, offer.id);
    const done = Boolean(address);
    const blocked = offer.tauriOnly && !isTauri;
    // Utility chains need the Algorand account to hang off.
    const locked = !offer.required && !hasAlgorand;

    const state_ = done ? 'done' : blocked ? 'blocked' : locked ? 'locked' : 'ready';
    const row = el('article', { cls: `parsec-chainpick__row parsec-chainpick__row--${state_}` });

    const head = el('div', { cls: 'parsec-chainpick__row-head' });
    head.appendChild(el('h3', { cls: 'parsec-chainpick__name', text: offer.label }));
    head.appendChild(el('span', { cls: 'parsec-chainpick__unit', text: offer.unit }));
    head.appendChild(el('span', {
      cls: `parsec-chainpick__tag parsec-chainpick__tag--${offer.required ? 'required' : 'utility'}`,
      text: offer.reason,
    }));
    row.appendChild(head);

    row.appendChild(el('p', { cls: 'parsec-chainpick__detail', text: offer.detail }));

    if (done && offer.required) {
      // Algorand is the root of a wallet, and a person can hold several: the
      // row shows the current account and still opens a new one. (Without
      // this, a device that already had one Algorand account could never
      // create another from here — the row was a dead end.)
      row.appendChild(el('p', { cls: 'parsec-chainpick__addr', text: address! }));
      const another = () => { store.setTempMnemonic(null); store.navigate('create-wallet'); };
      const action = btn('Create another Algorand account', {
        outlined: true,
        onClick: (e) => { e.stopPropagation(); another(); },
      });
      action.classList.add('parsec-chainpick__action');
      row.appendChild(action);
      row.classList.add('parsec-chainpick__row--clickable');
      row.setAttribute('role', 'button');
      row.setAttribute('tabindex', '0');
      row.setAttribute('aria-label', 'Create another Algorand account');
      row.addEventListener('click', another);
      row.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); another(); }
      });
    } else if (done) {
      row.appendChild(el('p', { cls: 'parsec-chainpick__addr', text: address! }));
    } else if (blocked) {
      row.appendChild(el('p', { cls: 'parsec-chainpick__note', text: 'Desktop only — this chain pack lives in the Rust backend.' }));
    } else if (locked) {
      row.appendChild(el('p', { cls: 'parsec-chainpick__note', text: 'Create your Algorand account first.' }));
    } else {
      const open = () => {
        if (offer.view) {
          store.navigate(offer.view as Parameters<typeof store.navigate>[0]);
        } else if (offer.inline && !action.disabled) {
          void createInline(offer, action);
        }
      };
      const action = btn(offer.required ? 'Create Algorand account' : `Add ${offer.label}`, {
        intent: offer.required ? 'primary' : undefined,
        outlined: !offer.required,
        onClick: (e) => { e.stopPropagation(); open(); },
      });
      action.classList.add('parsec-chainpick__action');
      row.appendChild(action);
      // The whole row is the choice: clicking the wallet you want opens its
      // creation screen, not just the button inside it.
      row.classList.add('parsec-chainpick__row--clickable');
      row.setAttribute('role', 'button');
      row.setAttribute('tabindex', '0');
      row.setAttribute('aria-label', offer.required ? 'Create Algorand account' : `Add ${offer.label}`);
      row.addEventListener('click', open);
      row.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
      });
    }

    list.appendChild(row);
  }

  view.appendChild(list);

  if (hasAlgorand) {
    const done = btn('Go to wallet', { intent: 'primary', large: true, onClick: () => store.navigate('dashboard') });
    done.classList.add('parsec-chainpick__done');
    view.appendChild(done);
  }

  view.appendChild(el('p', {
    cls: 'parsec-chainpick__foot',
    text: 'Keys are generated and encrypted on this device. They never leave it.',
  }));

  return view;
}

/**
 * Create a chain that has no dedicated view (Bitcoin, EVM): mint through the
 * chain module, store the secret in the vault, and record the address on the
 * active account.
 */
async function createInline(offer: ChainOffer, trigger: HTMLButtonElement): Promise<void> {
  const state = store.get();
  const account = state.accounts[state.activeAccountIndex];
  const passphrase = store.getPassphrase();

  if (!account) { toast('Create your Algorand account first', 'danger'); return; }
  if (!passphrase) { toast('Session expired — unlock again', 'danger'); store.navigate('unlock'); return; }

  // Imported here rather than at module scope: lib/pouch/chains pulls in every
  // chain pack (RSA-4096, libsodium with top-level await, …), which must not
  // land on the first-paint path.
  const { getChainModule } = await import('../lib/pouch/chains');
  const mod = getChainModule(offer.id);
  if (!mod || !mod.enabled) {
    toast(`${offer.label} module is not available in this build`, 'warning');
    return;
  }

  trigger.disabled = true;
  store.set({ isLoading: true });
  try {
    const created = await mod.createWallet();
    const secret = created.recoveryMaterial;
    if (!secret) throw new Error('module returned no recovery material');

    await keystoreStore(created.address, secret, passphrase, `${offer.label} account`, offer.id);

    const updated = setAccountAddress(account, offer.id, created.address);
    const accounts = [...state.accounts];
    accounts[state.activeAccountIndex] = updated;
    store.set({ accounts });

    toast(`${offer.label} address created`, 'success');
    // Re-render so the row flips to its derived "done" state.
    store.navigate('create-select');
  } catch (err) {
    toast(`Could not create ${offer.label}: ${err instanceof Error ? err.message : String(err)}`, 'danger');
    trigger.disabled = false;
  } finally {
    store.set({ isLoading: false });
  }
}
