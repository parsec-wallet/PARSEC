// PARSEC Wallet — the asset picker: search plus the verified list, and opting in.
//
// One component wherever an Algorand account opts in to an asset: the ADD
// ASSETS screen (standalone), and the x402 desk (with USDC highlighted as the
// asset a payment needs). See views/add-asset.ts for why opting in exists and
// how the verified list and lookalike guard work.
//
//   search      answers as you type: verified matches first (instant, local),
//               then the Algorand indexer's, each marked verified or not; a
//               listed ticker under another id is flagged as a lookalike
//   verified    the curated list (lib/algorand/asset-whitelist.ts), grouped
//   opting in   lib/algorand/opt-in.ts — signed by the PARSEC Keycore
//
// What the account already holds is read from the chain, not a cache.

import { el, btn, toast } from '../dom';
import { store } from '../store';
import { onCleanup } from '../lifecycle';
import { searchAssets } from '../algorand/assets';
import { fetchAccountInfo, microAlgosToAlgo } from '../algorand/account';
import { optInAsset } from '../algorand/opt-in';
import { standardAssets, standardAsset, lookalikeOf, searchStandard, displayName, type StandardAsset, type AssetGroup } from '../algorand/asset-whitelist';
import { cleanText } from '../agenticplace/directory';
import type { NetworkId } from '../../types/wallet';

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

export interface AssetPickerOptions {
  /** An asset to show first, e.g. USDC on the x402 desk. */
  highlight?: number;
  /** Heading for the highlighted asset. */
  highlightLabel?: string;
  /** Embedded in another screen: tighter, and the search box is not focused. */
  compact?: boolean;
  onOptedIn?: (assetId: number) => void;
}

function hueOf(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 360;
}

export function assetPicker(opts: AssetPickerOptions = {}): HTMLElement {
  const state = store.get();
  const account = state.accounts[state.activeAccountIndex];
  const root = el('div', { cls: `parsec-assets__picker${opts.compact ? ' parsec-assets__picker--compact' : ''}` });
  if (!account) {
    root.appendChild(el('p', { cls: 'parsec-assets__muted', text: 'Create an Algorand account to add assets.' }));
    return root;
  }
  const network = state.settings.network as NetworkId;
  const address = account.chains?.algorand ?? account.address;
  const optedIn = new Set<number>();
  let available: number | null = null;
  const balanceLine = el('p', { cls: 'parsec-assets__balance', text: 'Reading this account…' });

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
      await optInAsset(address, c.assetId, network);
      optedIn.add(c.assetId);
      store.set({ accountInfo: null });
      opts.onOptedIn?.(c.assetId);
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
  function card(c: Candidate, mark: { standard?: StandardAsset; lookalike?: StandardAsset }): HTMLElement {
    const unit = cleanText(c.unitName, 16) || '—';
    const name = cleanText(c.name, 48) || 'Unnamed asset';
    const tile = el('span', { cls: 'parsec-assets__tile', text: unit[0]?.toUpperCase() ?? '?', attrs: { 'aria-hidden': 'true' } });
    tile.style.setProperty('--hue', String(hueOf(unit + c.assetId)));

    const badges: HTMLElement[] = [];
    if (mark.standard) badges.push(el('span', { cls: 'parsec-assets__badge parsec-assets__badge--ok', text: `✓ Verified · ${mark.standard.issuer}` }));
    else badges.push(el('span', { cls: 'parsec-assets__badge parsec-assets__badge--warn', text: 'Unverified — check the id' }));
    if (c.freeze) badges.push(el('span', { cls: 'parsec-assets__badge', text: 'Issuer can freeze' }));
    if (c.clawback) badges.push(el('span', { cls: 'parsec-assets__badge', text: 'Issuer can claw back' }));

    const warn = mark.lookalike
      ? el('p', { cls: 'parsec-assets__lookalike', text: `Not the listed ${mark.lookalike.unitName}: that is asset ${mark.lookalike.assetId} by ${mark.lookalike.issuer}. This one only borrows the name.` })
      : null;

    const has = optedIn.has(c.assetId);
    const action = btn(has ? 'Added' : 'Add', { intent: has ? 'none' : 'primary', cls: 'parsec-assets__add', disabled: has });
    let armed = !(c.freeze || c.clawback || !mark.standard);
    const note = el('p', { cls: 'parsec-assets__confirm', attrs: { hidden: 'true' } });
    action.addEventListener('click', () => {
      if (!armed) {
        // Second click required: say plainly what is being accepted.
        const risks = [c.freeze ? 'freeze your balance' : '', c.clawback ? 'take tokens back' : ''].filter(Boolean);
        note.textContent = [
          !mark.standard ? 'This asset is not on PARSEC’s verified list. Check its id with the issuer.' : '',
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

    return el('article', { cls: `parsec-assets__card${mark.lookalike ? ' parsec-assets__card--lookalike' : ''}`, children: [
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
    // Verified matches first, at once and locally; the indexer's answer follows.
    const verified = searchStandard(network, q);
    for (const a of verified) {
      results.appendChild(card({ assetId: a.assetId, unitName: a.unitName, name: displayName(a), decimals: a.decimals, freeze: a.freeze, clawback: a.clawback, issuer: a.issuer }, { standard: a }));
    }
    const shownIds = new Set(verified.map((a) => a.assetId));
    status.textContent = verified.length
      ? `${verified.length} verified · searching the Algorand indexer for more…`
      : 'Searching the Algorand indexer…';
    try {
      const found = (await searchAssets(q, network)).filter((r) => !shownIds.has(r.assetId));
      if (my !== seq) return;
      // Verified first, then the rest.
      const rows = found
        .map((r) => ({ r, std: standardAsset(network, r.assetId) }))
        .sort((a, b) => Number(!!b.std) - Number(!!a.std));
      for (const { r, std } of rows) {
        const look = std ? undefined : lookalikeOf(network, r.assetId, r.unitName, r.name);
        results.appendChild(card({ assetId: r.assetId, unitName: r.unitName, name: r.name, decimals: r.decimals, freeze: std?.freeze ?? r.hasFreezeAddr, clawback: std?.clawback ?? r.hasClawbackAddr, issuer: std?.issuer }, { standard: std, lookalike: look }));
      }
      const total = rows.length + verified.length;
      status.textContent = total
        ? `${total} result${total === 1 ? '' : 's'} for “${cleanText(q, 64)}” · ${verified.length + rows.filter((r) => r.std).length} verified`
        : `Nothing found for “${cleanText(q, 64)}”.`;
    } catch (e) {
      if (my !== seq) return;
      status.textContent = verified.length
        ? `${verified.length} verified shown; the indexer search failed: ${e instanceof Error ? e.message : String(e)}`
        : `Search failed: ${e instanceof Error ? e.message : String(e)}`;
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
  if (!opts.compact) setTimeout(() => search.focus(), 50);

  function build(): HTMLElement {
  // ── The asset this flow needs, first ─────────────────────────────────────
    const needed = opts.highlight !== undefined ? standardAsset(network, opts.highlight) : undefined;
    const neededSection = needed
      ? el('section', { cls: 'parsec-assets__needed', children: [
        el('h3', { cls: 'parsec-assets__section', text: opts.highlightLabel ?? 'Needed here' }),
        el('div', { cls: 'parsec-assets__grid', children: [card(
          { assetId: needed.assetId, unitName: needed.unitName, name: displayName(needed), decimals: needed.decimals, freeze: needed.freeze, clawback: needed.clawback, issuer: needed.issuer },
          { standard: needed },
        )] }),
      ] })
      : null;

    // ── Standard assets, grouped ──────────────────────────────────────────────
    const listed = standardAssets(network).filter((a) => a.assetId !== needed?.assetId);
    const groups: AssetGroup[] = ['Stablecoins', 'Bitcoin & Ether', 'Algorand ecosystem'];
    const standardSection = el('section', { cls: 'parsec-assets__standard', children: [
      el('h3', { cls: 'parsec-assets__section', text: needed ? 'Other verified assets' : 'Verified assets' }),
      ...(listed.length === 0 ? [el('p', { cls: 'parsec-assets__muted', text: `No standard list for ${network}. Search by asset id.` })] : []),
      ...groups.filter((g) => listed.some((a) => a.group === g)).map((g) => el('div', { cls: 'parsec-assets__group', children: [
        el('h4', { text: g }),
        el('div', { cls: 'parsec-assets__grid', children: listed.filter((a) => a.group === g).map((a) => card(
          { assetId: a.assetId, unitName: a.unitName, name: displayName(a), decimals: a.decimals, freeze: a.freeze, clawback: a.clawback, issuer: a.issuer },
          { standard: a },
        )) }),
      ] })),
    ] });
    return el('div', { cls: 'parsec-assets__picker-body', children: [
      el('div', { cls: 'parsec-assets__bar', children: [
        el('span', { cls: 'parsec-assets__glass', text: '⌕', attrs: { 'aria-hidden': 'true' } }),
        search,
      ] }),
      status,
      results,
      ...(neededSection ? [neededSection] : []),
      standardSection,
    ] });
  }

  // Read what the account holds, then draw the cards with the right state.
  root.append(balanceLine, el('p', { cls: 'parsec-assets__muted', text: 'Loading…' }));
  void fetchAccountInfo(address, network)
    .then((info) => {
      for (const a of info.assets) optedIn.add(a.assetId);
      available = Math.max(0, info.amount - info.minBalance);
      balanceLine.textContent = `Available to spend: ${microAlgosToAlgo(available)} ALGO · ${info.assets.length} asset${info.assets.length === 1 ? '' : 's'} held`;
    })
    .catch(() => { balanceLine.textContent = 'Could not read the account; opt-in state may be out of date.'; })
    .finally(() => { root.replaceChildren(balanceLine, build()); });

  return root;
}
