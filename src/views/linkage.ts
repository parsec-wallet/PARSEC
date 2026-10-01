// PARSEC Wallet — Linkage Map
//
// A live rendering of the product architecture (PARSEC.png): the chain
// modules feeding the Wallet Pouch, feeding Vault Identity, feeding
// AgenticPlace.
//
// The point is that it is not a picture. Every node reports its real state
// and every connector lights only when the linkage below it is actually
// carrying something — so the same screen is both the architecture diagram
// and the wallet's own diagnostics.
//
// Status is tri-state throughout (lib/ui/status.ts): a module with no address
// yet is `unknown`, not "broken".

import { el, btn } from '../lib/dom';
import { store } from '../lib/store';
import { getAllChains } from '../lib/pouch/chains';
import { getChainDescriptor } from '../lib/chains';
import { isTauri } from '../lib/platform';
import { statusOf, weakest } from '../lib/ui/status';
import { provenanceLine } from '../lib/ui/provenance';
import type { Status } from '../lib/ui/status';
import type { WalletAccount } from '../types/wallet';

/** The chain modules the diagram names, in its own left-to-right order. */
const DIAGRAM_ORDER = ['bitcoin', 'ethereum', 'algorand', 'arweave', 'solana'];

/** The capability bullets each module card carries in the diagram. */
const CAPABILITIES: Record<string, readonly string[]> = {
  bitcoin: ['Descriptors & xpubs', 'Core node access', 'PSBT signing'],
  ethereum: ['EOA accounts', 'Tx signing', 'ERC-20 support'],
  algorand: ['ASA commands', 'Note payloads', '0.001 ALGO'],
  arweave: ['RSA-4096 JWK', 'ANS-104 data items', 'AO messages'],
  solana: ['SLIP-0010 ed25519', 'SPL tokens', 'Metaplex ANTs'],
};

interface NodeState {
  status: Status;
  detail: string;
}

function chainAddress(account: WalletAccount | undefined, chainId: string): string | undefined {
  if (!account) return undefined;
  // 'arweave-hd' and 'arweave' share one address slot on the account.
  const key = chainId === 'arweave-hd' ? 'arweave' : chainId;
  return account.chains?.[key as keyof typeof account.chains];
}

/** A module is ok when it is enabled AND the active account holds an address
 *  for it; enabled-but-unused is `unknown`; a disabled stub is `deficient`. */
function moduleState(chainId: string, enabled: boolean, account: WalletAccount | undefined): NodeState {
  if (!enabled) return { status: 'deficient', detail: 'module not implemented' };
  const address = chainAddress(account, chainId);
  if (!address) return { status: 'unknown', detail: 'no address on this account' };
  const desc = getChainDescriptor(chainId);
  return { status: 'ok', detail: desc.truncate(address) };
}

function statusChip(status: Status): HTMLElement {
  const chip = el('span', { cls: `parsec-linkage__chip parsec-linkage__chip--${status}` });
  chip.setAttribute('aria-label', `status: ${status}`);
  chip.title = status;
  return chip;
}

function connector(status: Status, label: string): HTMLElement {
  const wrap = el('div', { cls: `parsec-linkage__flow parsec-linkage__flow--${status}` });
  wrap.appendChild(el('span', { cls: 'parsec-linkage__arrow', text: '▼' }));
  wrap.appendChild(el('span', { cls: 'parsec-linkage__flow-label', text: label }));
  return wrap;
}

function tierPanel(opts: {
  title: string;
  status: Status;
  bullets: readonly string[];
  detail: string;
  variant?: string;
  onOpen?: () => void;
}): HTMLElement {
  const head = el('div', { cls: 'parsec-linkage__panel-head', children: [
    el('h3', { cls: 'parsec-linkage__panel-title', text: opts.title }),
    statusChip(opts.status),
  ]});

  const body = el('div', { cls: 'parsec-linkage__panel-body' });
  const list = el('ul', { cls: 'parsec-linkage__bullets' });
  for (const b of opts.bullets) list.appendChild(el('li', { text: b }));
  body.appendChild(list);
  body.appendChild(el('p', { cls: 'parsec-linkage__detail', text: opts.detail }));

  if (opts.onOpen) {
    const open = btn('Open', { minimal: true, onClick: opts.onOpen });
    open.classList.add('parsec-linkage__open');
    body.appendChild(open);
  }

  const cls = `parsec-linkage__panel${opts.variant ? ` parsec-linkage__panel--${opts.variant}` : ''}`;
  return el('section', { cls, children: [head, body] });
}

export function linkageView(): HTMLElement {
  const state = store.get();
  const account = state.accounts[state.activeAccountIndex];
  const readAt = Date.now();

  const view = el('div', { cls: 'parsec-view parsec-linkage' });

  view.appendChild(el('header', { cls: 'parsec-view__header', children: [
    btn('Back', { minimal: true, onClick: () => { if (!store.back()) store.navigate('dashboard'); } }),
    el('h2', { text: 'Linkage' }),
  ]}));

  view.appendChild(el('p', { cls: 'parsec-linkage__lede', text:
    'Chain modules feed the pouch; the pouch backs one identity; the identity '
    + 'is what AgenticPlace trusts. A connector lights only when the tier above '
    + 'it is actually carrying something.' }));

  // ── Tier 1: chain modules ───────────────────────────────────
  const all = getAllChains();
  const grid = el('div', { cls: 'parsec-linkage__modules' });
  const moduleStatuses: Status[] = [];

  for (const chainId of DIAGRAM_ORDER) {
    const mod = all.find((m) => m.chainId === chainId);
    if (!mod) continue;
    const st = moduleState(chainId, mod.enabled, account);
    moduleStatuses.push(st.status);

    const card = el('article', { cls: `parsec-linkage__module parsec-linkage__module--${st.status}` });
    card.appendChild(el('div', { cls: 'parsec-linkage__module-head', children: [
      el('h4', { cls: 'parsec-linkage__module-name', text: `${mod.name} Module` }),
      statusChip(st.status),
    ]}));

    const caps = el('ul', { cls: 'parsec-linkage__bullets' });
    for (const c of CAPABILITIES[chainId] ?? []) caps.appendChild(el('li', { text: c }));
    card.appendChild(caps);
    card.appendChild(el('p', { cls: 'parsec-linkage__detail', text: st.detail }));
    grid.appendChild(card);
  }
  view.appendChild(grid);

  // ── Tier 2: the Wallet Pouch ────────────────────────────────
  const held = DIAGRAM_ORDER.filter((c) => chainAddress(account, c)).length;
  const pouchStatus: Status = account ? (held > 0 ? 'ok' : 'unknown') : 'unknown';
  view.appendChild(connector(weakest(moduleStatuses), `${held} of ${DIAGRAM_ORDER.length} modules hold an address`));
  view.appendChild(tierPanel({
    title: 'Wallet Pouch',
    status: pouchStatus,
    variant: 'pouch',
    bullets: ['Multi-chain wallet collection', 'Private compartments', 'Public addresses', 'Encrypted backups'],
    detail: account
      ? `${state.accounts.length} account${state.accounts.length === 1 ? '' : 's'} · ${held} chain address${held === 1 ? '' : 'es'} on “${account.name ?? 'this account'}”`
      : 'no account yet',
    onOpen: () => store.navigate('dashboard'),
  }));

  // ── Tier 3: Vault Identity ──────────────────────────────────
  const unlocked = store.getPassphrase() !== null;
  const identityStatus: Status = account ? statusOf(unlocked) : 'unknown';
  view.appendChild(connector(pouchStatus, unlocked ? 'session unlocked' : 'vault locked'));
  view.appendChild(tierPanel({
    title: 'Vault Identity',
    status: identityStatus,
    variant: 'identity',
    bullets: ['Selective disclosure', 'Intent signatures', 'Cross-chain proofs'],
    detail: `${isTauri ? 'bankon_vault (Argon2id + AES-256-GCM)' : 'Web Crypto keystore'} · ${unlocked ? 'unlocked' : 'locked'}`,
    onOpen: () => store.navigate('identity'),
  }));

  // ── Tier 4: AgenticPlace ────────────────────────────────────
  // The connect bridge is Tauri-only; on the permaweb build it is genuinely
  // absent rather than broken, so it stays `unknown`.
  const agenticStatus: Status = !isTauri ? 'unknown' : statusOf(unlocked);
  view.appendChild(connector(identityStatus, unlocked ? 'identity available to dApps' : 'no identity to offer'));
  view.appendChild(tierPanel({
    title: 'AgenticPlace',
    status: agenticStatus,
    variant: 'agentic',
    bullets: ['Agent discovery', 'x402 payments', 'dApp signing bridge', 'Marketspace'],
    detail: isTauri
      ? 'PARSEC Connect on 127.0.0.1:9876'
      : 'connect bridge is desktop-only — not available in the web build',
    onOpen: () => store.navigate('agents'),
  }));

  view.appendChild(el('p', { cls: 'parsec-linkage__provenance', text: provenanceLine({
    source: 'live',
    origin: 'local wallet state',
    readAt,
  })}));

  return view;
}
