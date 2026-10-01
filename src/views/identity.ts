// PARSEC Wallet — IDENTITY.
//
// Who this account is, across chains: its name, its .algo name, the vault
// profile that holds its keys (in the PARSEC Keycore), every chain address it
// has — and the credentials attached to those addresses:
//
//   .algo name     reverse lookup on the NFD registry
//   BANKON         holding of ASA 203977300 (the indexer), priced by the oracle
//   ERC-8004       registered agents whose owner is this account's EVM address,
//                  from the AgenticPlace directory (exact owner match)
//   Access tier    the DAIO ladder: Citizen with a registered agent; higher
//                  tiers are BONA FIDE reputation, earned, not bought
//
// Each card loads on its own and says plainly when there is nothing, or when a
// service could not be reached. Outside text is cleaned before it is shown.

import { el, btn, copyText } from '../lib/dom';
import { store, getAccountAddress } from '../lib/store';
import { getChainDescriptor } from '../lib/chains';
import { resolveAddress } from '../lib/nfd';
import { checkBankonHolder } from '../lib/x402/discount';
import { PriceOracle } from '../lib/x402/oracle';
import { BANKON_ASA_ID, BANKON_SUPPLY, ERC8004_MAINNET, TIER_NAMES, TIER_THRESHOLDS, type AccessTier } from '../lib/x402';
import { agentsOwnedBy, chainName } from '../lib/agenticplace/directory';
import { defaultAvatarFor } from '../lib/avatars';
import type { ChainId } from '../lib/pouch/types';

const oracle = new PriceOracle();

/** Names for chain keys that have no display descriptor registered. */
const CHAIN_LABELS: Record<string, string> = { ethereum: 'EVM / Base', bitcoin: 'Bitcoin', litecoin: 'Litecoin', 'algorand-hd': 'Algorand (HD)' };

function copyable(value: string, what: string): HTMLElement {
  return btn('Copy', {
    minimal: true, icon: 'duplicate', cls: 'parsec-id__copy bp5-small',
    onClick: () => { void copyText(value, `${what} copied`); },
  });
}

function credCard(title: string, kicker: string): { el: HTMLElement; body: HTMLElement; setTone(t: 'ok' | 'none' | 'error' | ''): void } {
  const body = el('div', { cls: 'parsec-id__cred-body', children: [el('p', { cls: 'parsec-id__muted', text: 'Checking…' })] });
  const card = el('article', { cls: 'parsec-id__cred', children: [
    el('p', { cls: 'parsec-id__cred-kicker', text: kicker }),
    el('h3', { cls: 'parsec-id__cred-title', text: title }),
    body,
  ] });
  return { el: card, body, setTone: (t) => { card.dataset.tone = t; } };
}

export function identityView(): HTMLElement {
  const state = store.get();
  const account = state.accounts[state.activeAccountIndex];
  if (!account) { store.navigate('dashboard'); return el('div'); }

  const network = state.settings.network;
  const algo = getAccountAddress(account, 'algorand') ?? account.address;
  const evm = getAccountAddress(account, 'ethereum');
  const chains = [...new Set<string>(['algorand', ...Object.keys(account.chains ?? {})])] as ChainId[];

  // ── Profile header ────────────────────────────────────────────────────────
  const algoName = el('span', { cls: 'parsec-id__nfd', attrs: { hidden: 'true' } });
  const header = el('section', { cls: 'parsec-id__hero', children: [
    el('span', { cls: 'parsec-id__avatar', text: account.avatar ?? defaultAvatarFor(account.address), attrs: { 'aria-hidden': 'true' } }),
    el('div', { cls: 'parsec-id__who', children: [
      el('p', { cls: 'parsec-id__kicker', text: `Vault identity · profile ${store.profile}` }),
      el('h2', { cls: 'parsec-id__name', children: [
        account.name,
        el('a', { cls: 'parsec-id__rename', text: 'Rename', attrs: { href: '#' }, onClick: (e) => { e.preventDefault(); store.navigate('settings'); } }),
      ] }),
      el('div', { cls: 'parsec-id__chips', children: [
        algoName,
        el('span', { cls: 'parsec-id__chip', text: `${chains.length} chain${chains.length === 1 ? '' : 's'}` }),
        el('span', { cls: 'parsec-id__chip', text: account.watchOnly ? 'Watch-only' : 'Keys in the PARSEC Keycore' }),
      ] }),
    ] }),
  ] });

  // ── Addresses ─────────────────────────────────────────────────────────────
  const addresses = el('section', { cls: 'parsec-id__section', children: [
    el('h3', { cls: 'parsec-id__h3', text: 'Addresses' }),
    el('div', { cls: 'parsec-id__addresses', children: chains.map((c) => {
      const a = getAccountAddress(account, c);
      if (!a) return el('div');
      const d = getChainDescriptor(c);
      const label = d.label === c ? (CHAIN_LABELS[c] ?? c) : d.label;
      return el('div', { cls: 'parsec-id__addr-row', children: [
        el('span', { cls: 'parsec-id__addr-chain', text: label }),
        el('code', { cls: 'parsec-id__addr', text: a, attrs: { title: a } }),
        copyable(a, `${label} address`),
      ] });
    }) }),
  ] });

  // ── Credentials ───────────────────────────────────────────────────────────
  const nfd = credCard('.algo name', 'Algorand naming');
  const bankon = credCard('BANKON', `ASA ${BANKON_ASA_ID}`);
  const agents = credCard('Agent identities', 'ERC-8004 registry');
  const tier = credCard('Access tier', 'DAIO ladder');

  const tierLadder = (current: AccessTier) => el('ol', { cls: 'parsec-id__ladder', children: ([0, 1, 2, 3, 4, 5] as AccessTier[]).map((t) => el('li', {
    cls: t === current ? 'parsec-id__rung parsec-id__rung--current' : 'parsec-id__rung',
    children: [
      el('span', { cls: 'parsec-id__rung-name', text: TIER_NAMES[t] }),
      el('span', { cls: 'parsec-id__rung-req', text: t === 0 ? 'Open to all' : t === 1 ? 'A registered agent (IDNFT)' : `${TIER_THRESHOLDS[t].toString()} BONA FIDE` }),
    ],
  })) });
  tier.body.replaceChildren(tierLadder(0), el('p', { cls: 'parsec-id__muted', text: 'BONA FIDE is reputation earned in the DAIO, not bought.' }));

  // .algo
  void resolveAddress(network, algo).then((r) => {
    if (r?.name) {
      algoName.textContent = r.name;
      algoName.removeAttribute('hidden');
      nfd.setTone('ok');
      nfd.body.replaceChildren(el('p', { cls: 'parsec-id__big', text: r.name }), el('p', { cls: 'parsec-id__muted', text: 'Resolves to this account’s Algorand address.' }));
    } else {
      nfd.setTone('none');
      nfd.body.replaceChildren(
        el('p', { cls: 'parsec-id__muted', text: 'No .algo name points to this account yet. A name makes the address easy to share and to type.' }),
        btn('Register a .algo name', { intent: 'primary', onClick: () => store.navigate('nfdominter') }),
      );
    }
  }).catch(() => { nfd.setTone('error'); nfd.body.replaceChildren(el('p', { cls: 'parsec-id__muted', text: 'The NFD registry could not be reached.' })); });

  // BANKON
  void checkBankonHolder(algo).then(async (s) => {
    if (s.isHolder) {
      bankon.setTone('ok');
      const rows = [el('p', { cls: 'parsec-id__big', text: `${s.balance.toLocaleString()} BANKON` })];
      try {
        const p = await oracle.getBankonPrice();
        rows.push(el('p', { cls: 'parsec-id__muted', text: p.usd > 0 ? `≈ $${p.usd.toPrecision(3)} each on the market` : 'No market price yet (no liquidity pool).' }));
      } catch { /* price is optional */ }
      rows.push(el('p', { cls: 'parsec-id__muted', text: 'Sellers that honour BANKON may price lower for holders; you always see the live quote before paying.' }));
      bankon.body.replaceChildren(...rows);
    } else {
      bankon.setTone('none');
      bankon.body.replaceChildren(
        el('p', { cls: 'parsec-id__muted', text: `This account holds no BANKON. To receive it, opt in to ASA ${BANKON_ASA_ID} (BANKON, ${BANKON_SUPPLY.toLocaleString()} supply, whole units, no clawback).` }),
        btn('Add assets', { outlined: true, onClick: () => store.navigate('add-asset') }),
      );
    }
  }).catch(() => { bankon.setTone('error'); bankon.body.replaceChildren(el('p', { cls: 'parsec-id__muted', text: 'The Algorand indexer could not be reached.' })); });

  // ERC-8004 agents owned by this account's EVM address
  if (!evm) {
    agents.setTone('none');
    agents.body.replaceChildren(el('p', { cls: 'parsec-id__muted', text: 'ERC-8004 identities belong to an EVM address, and this account has none yet. Add EVM / Base to this account to hold one.' }));
  } else {
    agents.body.replaceChildren(el('p', { cls: 'parsec-id__muted', text: 'Searching the AgenticPlace directory for agents this address owns. This can take up to a minute.' }));
    void agentsOwnedBy(evm).then((mine) => {
      if (mine.length === 0) {
        agents.setTone('none');
        agents.body.replaceChildren(
          el('p', { cls: 'parsec-id__muted', text: `No registered agents are owned by ${evm.slice(0, 6)}…${evm.slice(-4)}.` }),
          btn('Browse agents', { outlined: true, onClick: () => store.navigate('agents') }),
        );
        return;
      }
      agents.setTone('ok');
      tier.setTone('ok');
      tier.body.replaceChildren(tierLadder(1), el('p', { cls: 'parsec-id__muted', text: 'Citizen through a registered agent. BONA FIDE is reputation earned in the DAIO, not bought.' }));
      agents.body.replaceChildren(
        el('p', { cls: 'parsec-id__big', text: `${mine.length} agent${mine.length === 1 ? '' : 's'}` }),
        el('ul', { cls: 'parsec-id__agents', children: mine.slice(0, 6).map((a) => el('li', { children: [
          el('strong', { text: a.name }),
          el('span', { text: ` · ${chainName(a.chainId)} · #${a.tokenId}` }),
        ] })) }),
        ...(mine.length > 6 ? [el('p', { cls: 'parsec-id__muted', text: `and ${mine.length - 6} more` })] : []),
      );
    }).catch(() => { agents.setTone('error'); agents.body.replaceChildren(el('p', { cls: 'parsec-id__muted', text: 'The AgenticPlace directory could not be reached.' })); });
  }

  // ── Reference ─────────────────────────────────────────────────────────────
  const refRow = (label: string, value: string, copy = false) => el('div', { cls: 'parsec-id__ref-row', children: [
    el('span', { cls: 'parsec-id__ref-label', text: label }),
    el('code', { cls: 'parsec-id__ref-value', text: value }),
    ...(copy ? [copyable(value, label)] : []),
  ] });
  const reference = el('details', { cls: 'parsec-id__reference', children: [
    el('summary', { text: 'Reference: registries and the BANKON token' }),
    refRow('ERC-8004 identity registry', ERC8004_MAINNET.identityRegistry, true),
    refRow('ERC-8004 reputation registry', ERC8004_MAINNET.reputationRegistry, true),
    refRow('Deployment', 'Same address on every EVM chain (CREATE2)'),
    refRow('BANKON', `ASA ${BANKON_ASA_ID} · ${BANKON_SUPPLY.toLocaleString()} supply · 0 decimals · no clawback`),
  ] });

  return el('div', {
    cls: 'parsec-view parsec-id',
    children: [
      el('div', { cls: 'parsec-view__header', children: [
        btn('Back', { minimal: true, icon: 'arrow-left', onClick: () => { if (!store.back()) store.navigate('dashboard'); } }),
      ] }),
      header,
      addresses,
      el('section', { cls: 'parsec-id__section', children: [
        el('h3', { cls: 'parsec-id__h3', text: 'Credentials' }),
        el('div', { cls: 'parsec-id__creds', children: [nfd.el, bankon.el, agents.el, tier.el] }),
      ] }),
      reference,
    ],
  });
}
