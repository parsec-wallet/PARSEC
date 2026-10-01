// PARSEC Wallet — ADD ASSETS (ASA opt-in).
//
// On Algorand an account must opt in to an asset before it can receive it: a
// zero-amount transfer to itself, which raises the account's minimum balance
// by 0.1 ALGO (returned on opt-out) and costs the 0.001 ALGO network fee.
//
// Two ways in: the standard assets (a curated, indexer-checked list — USDC,
// USDt, EURS, goBTC, goETH, gALGO, FOLKS, TINY, VEST, GORA) one click each,
// and a search bar that answers as you type, by asset id, name or ticker.
// Search results are outside data: names are cleaned, every result is marked
// verified or not, and one that borrows a listed ticker under another id is
// called out as not the real one. An issuer that kept freeze or clawback
// rights is stated, and opting in to it asks for a second, explicit click.
//
// Signing goes through the PARSEC Keycore on desktop; no phrase enters
// JavaScript. (The browser build has no Keycore and signs in the tab.)

import { el, btn, toast } from '../lib/dom';
import { store } from '../lib/store';
import { onCleanup } from '../lib/lifecycle';
import { isTauri } from '../lib/platform';
import { searchAssets, optInWithKeycore, optInToAsset } from '../lib/algorand/assets';
import { microAlgosToAlgo } from '../lib/algorand/account';
import { keystoreRetrieve, keystoreUnlock } from '../lib/keystore';
import { standardAssets, standardAsset, lookalikeOf, type StandardAsset, type AssetGroup } from '../lib/algorand/asset-whitelist';
import { cleanText } from '../lib/agenticplace/directory';
import type { NetworkId } from '../types/wallet';

const MIN_FOR_OPTIN = 101_000; // 0.1 ALGO minimum-balance raise + 0.001 fee

interface Candidate {
  assetId: number;
  unitName: string;
  name: string;
  decimals: number;
  freeze: boolean;
  clawback: boolean;
  issuer?: string;
}

function hueOf(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 360;
}

export function addAssetView(): HTMLElement {
  const state = store.get();
  const account = state.accounts[state.activeAccountIndex];
  if (!account) { store.navigate('onboarding'); return el('div'); }

  const network = state.settings.network as NetworkId;
  const address = account.chains?.algorand ?? account.address;
  const info = state.accountInfo;
  const optedIn = new Set((info?.assets || []).map((a) => a.assetId));
  const available = info ? Math.max(0, info.amount - info.minBalance) : null;

  let seq = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  // ── Opting in ─────────────────────────────────────────────────────────────
  async function optIn(c: Candidate, button: HTMLButtonElement): Promise<void> {
    if (available !== null && available < MIN_FOR_OPTIN) {
      toast(`Opting in needs 0.101 ALGO available; this account has ${microAlgosToAlgo(available)} ALGO.`, 'danger', 8000);
      return;
    }
    const label = button.querySelector('.bp5-button-text');
    const restore = label?.textContent ?? '';
    button.disabled = true;
    if (label) label.textContent = 'Signing…';
    store.set({ isLoading: true });
    try {
      if (isTauri) {
        try {
          await optInWithKeycore(address, c.assetId, network);
        } catch (e) {
          // The Keycore session may have timed out: reopen it with the session passphrase, once.
          const pass = store.getPassphrase();
          if (!pass || !/locked/i.test(String(e)) || !(await keystoreUnlock(pass))) throw e;
          await optInWithKeycore(address, c.assetId, network);
        }
      } else {
        const pass = store.getPassphrase();
        if (!pass) { toast('Unlock the wallet first.', 'danger'); return; }
        let mnemonic = await keystoreRetrieve(address, pass);
        if (!mnemonic) throw new Error('Could not read this account’s key.');
        try { await optInToAsset(mnemonic, c.assetId, network); } finally { mnemonic = '\0'.repeat(mnemonic.length); mnemonic = null; }
      }
      optedIn.add(c.assetId);
      store.set({ accountInfo: null });
      toast(`${c.unitName || c.name} added. This account can now receive it.`, 'success');
      if (label) label.textContent = 'Added';
      button.classList.remove('bp5-intent-primary');
      return;
    } catch (e) {
      toast(`Opt-in failed: ${e instanceof Error ? e.message : String(e)}`, 'danger', 8000);
      if (label) label.textContent = restore;
      button.disabled = false;
    } finally {
      store.set({ isLoading: false });
    }
  }

  // ── One asset, as a card ──────────────────────────────────────────────────
  function card(c: Candidate, opts: { standard?: StandardAsset; lookalike?: StandardAsset }): HTMLElement {
    const unit = cleanText(c.unitName, 16) || '—';
    const name = cleanText(c.name, 48) || 'Unnamed asset';
    const tile = el('span', { cls: 'parsec-assets__tile', text: unit[0]?.toUpperCase() ?? '?', attrs: { 'aria-hidden': 'true' } });
    tile.style.setProperty('--hue', String(hueOf(unit + c.assetId)));

    const badges: HTMLElement[] = [];
    if (opts.standard) badges.push(el('span', { cls: 'parsec-assets__badge parsec-assets__badge--ok', text: `✓ Verified · ${opts.standard.issuer}` }));
    else badges.push(el('span', { cls: 'parsec-assets__badge parsec-assets__badge--warn', text: 'Unverified — check the id' }));
    if (c.freeze) badges.push(el('span', { cls: 'parsec-assets__badge', text: 'Issuer can freeze' }));
    if (c.clawback) badges.push(el('span', { cls: 'parsec-assets__badge', text: 'Issuer can claw back' }));

    const warn = opts.lookalike
      ? el('p', { cls: 'parsec-assets__lookalike', text: `Not the listed ${opts.lookalike.unitName}: that is asset ${opts.lookalike.assetId} by ${opts.lookalike.issuer}. This one only borrows the name.` })
      : null;

    const has = optedIn.has(c.assetId);
    const action = btn(has ? 'Added' : 'Add', { intent: has ? 'none' : 'primary', cls: 'parsec-assets__add', disabled: has });
    let armed = !(c.freeze || c.clawback || !opts.standard);
    const note = el('p', { cls: 'parsec-assets__confirm', attrs: { hidden: 'true' } });
    action.addEventListener('click', () => {
      if (!armed) {
        // Second click required: say plainly what is being accepted.
        const risks = [c.freeze ? 'freeze your balance' : '', c.clawback ? 'take tokens back' : ''].filter(Boolean);
        note.textContent = [
          !opts.standard ? 'This asset is not on PARSEC’s verified list. Check its id with the issuer.' : '',
          risks.length ? `Its issuer can ${risks.join(' and ')}.` : '',
          'Click again to add it.',
        ].filter(Boolean).join(' ');
        note.hidden = false;
        armed = true;
        action.querySelector('.bp5-button-text')!.textContent = 'Confirm add';
        return;
      }
      void optIn(c, action);
    });

    return el('article', { cls: `parsec-assets__card${opts.lookalike ? ' parsec-assets__card--lookalike' : ''}`, children: [
      el('header', { cls: 'parsec-assets__head', children: [
        tile,
        el('div', { cls: 'parsec-assets__titles', children: [
          el('h3', { cls: 'parsec-assets__unit', text: unit }),
          el('p', { cls: 'parsec-assets__name', text: name }),
        ] }),
        action,
      ] }),
      el('div', { cls: 'parsec-assets__meta', text: `ASA ${c.assetId} · ${c.decimals} decimals` }),
      el('div', { cls: 'parsec-assets__badges', children: badges }),
      ...(warn ? [warn] : []),
      note,
    ] });
  }

  // ── Standard assets, grouped ──────────────────────────────────────────────
  const listed = standardAssets(network);
  const groups: AssetGroup[] = ['Stablecoins', 'Bitcoin & Ether', 'Algorand ecosystem'];
  const standardSection = el('section', { cls: 'parsec-assets__standard', children: [
    el('h3', { cls: 'parsec-assets__section', text: 'Standard assets' }),
    ...(listed.length === 0 ? [el('p', { cls: 'parsec-assets__muted', text: `No standard list for ${network}. Search by asset id.` })] : []),
    ...groups.filter((g) => listed.some((a) => a.group === g)).map((g) => el('div', { cls: 'parsec-assets__group', children: [
      el('h4', { text: g }),
      el('div', { cls: 'parsec-assets__grid', children: listed.filter((a) => a.group === g).map((a) => card(
        { assetId: a.assetId, unitName: a.unitName, name: a.name, decimals: a.decimals, freeze: a.freeze, clawback: a.clawback, issuer: a.issuer },
        { standard: a },
      )) }),
    ] })),
  ] });

  // ── Search ────────────────────────────────────────────────────────────────
  const search = el('input', {
    cls: 'parsec-assets__input',
    attrs: { type: 'search', placeholder: 'Search by asset id, name or ticker — e.g. 31566704 or USDC', 'aria-label': 'Search assets', maxlength: '64', spellcheck: 'false', autocomplete: 'off' },
  }) as HTMLInputElement;
  const status = el('p', { cls: 'parsec-assets__status', attrs: { 'aria-live': 'polite' } });
  const results = el('div', { cls: 'parsec-assets__grid' });

  async function run(q: string): Promise<void> {
    const my = ++seq;
    results.replaceChildren();
    if (!q) { status.textContent = ''; return; }
    status.textContent = 'Searching the Algorand indexer…';
    try {
      const found = await searchAssets(q, network);
      if (my !== seq) return;
      // Verified first, then the rest.
      const rows = found
        .map((r) => ({ r, std: standardAsset(network, r.assetId) }))
        .sort((a, b) => Number(!!b.std) - Number(!!a.std));
      for (const { r, std } of rows) {
        const look = std ? undefined : lookalikeOf(network, r.assetId, r.unitName, r.name);
        results.appendChild(card({ assetId: r.assetId, unitName: r.unitName, name: r.name, decimals: r.decimals, freeze: std?.freeze ?? r.hasFreezeAddr, clawback: std?.clawback ?? r.hasClawbackAddr, issuer: std?.issuer }, { standard: std, lookalike: look }));
      }
      status.textContent = rows.length ? `${rows.length} result${rows.length === 1 ? '' : 's'} for “${cleanText(q, 64)}”` : `Nothing found for “${cleanText(q, 64)}”.`;
    } catch (e) {
      if (my !== seq) return;
      status.textContent = `Search failed: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  search.addEventListener('input', () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void run(search.value.trim()), 350);
  });
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { if (timer) clearTimeout(timer); void run(search.value.trim()); }
    if (e.key === 'Escape' && search.value) { e.preventDefault(); search.value = ''; void run(''); }
  });
  onCleanup(() => { seq++; if (timer) clearTimeout(timer); });
  setTimeout(() => search.focus(), 50);

  return el('div', {
    cls: 'parsec-view parsec-assets',
    children: [
      el('div', { cls: 'parsec-view__header', children: [
        btn('Back', { minimal: true, icon: 'arrow-left', onClick: () => { if (!store.back()) store.navigate('dashboard'); } }),
      ] }),
      el('section', { cls: 'parsec-assets__hero', children: [
        el('p', { cls: 'parsec-assets__kicker', text: `Algorand · ${network}` }),
        el('h2', { cls: 'parsec-assets__h', text: 'ADD ASSETS' }),
        el('p', { cls: 'parsec-assets__lede', text: 'An Algorand account receives an asset only after opting in to it. Each opt-in sets aside 0.1 ALGO of minimum balance (returned if you remove the asset) and costs a 0.001 ALGO fee.' }),
        el('p', { cls: 'parsec-assets__balance', text: available === null ? 'Balance loading…' : `Available to spend: ${microAlgosToAlgo(available)} ALGO` }),
      ] }),
      el('div', { cls: 'parsec-assets__bar', children: [
        el('span', { cls: 'parsec-assets__glass', text: '⌕', attrs: { 'aria-hidden': 'true' } }),
        search,
      ] }),
      status,
      results,
      standardSection,
      el('p', { cls: 'parsec-assets__note', text: 'Anyone can create an asset on Algorand with any name. The id is what identifies it: verified assets were checked against their issuers’ ids, and an asset that copies a verified name under another id is flagged.' }),
    ],
  });
}
