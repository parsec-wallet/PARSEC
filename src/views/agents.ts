// PARSEC Wallet — Agents: the AgenticPlace directory, searched live.
//
// The search bar answers as you type (debounced, newest query wins), Enter
// searches at once, Escape clears. Results come from agenticplace.pythai.net
// through lib/agenticplace/directory.ts, which rebuilds every record from
// untrusted data; this view only ever writes text (no markup, no remote
// images, no link that opens itself). A listing is information, not an
// instruction: nothing here can sign, pay or navigate on an agent's behalf.

import { el, btn, toast } from '../lib/dom';
import { store } from '../lib/store';
import { onCleanup } from '../lib/lifecycle';
import { searchDirectory, chainName, DIRECTORY_URL, type DirectoryAgent } from '../lib/agenticplace/directory';

const PAGE = 24;

/** A stable hue per agent id, for the lettered avatar. */
function hueOf(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % 360;
}

function agentCard(a: DirectoryAgent): HTMLElement {
  const initial = [...a.name][0]?.toUpperCase() ?? '?';
  const avatar = el('span', { cls: 'parsec-agents2__avatar', text: initial, attrs: { 'aria-hidden': 'true' } });
  avatar.style.setProperty('--hue', String(hueOf(a.id)));

  const badges: HTMLElement[] = [el('span', { cls: 'parsec-agents2__chip', text: chainName(a.chainId) })];
  if (a.verified) badges.push(el('span', { cls: 'parsec-agents2__chip parsec-agents2__chip--ok', text: 'Verified' }));
  if (a.x402) badges.push(el('span', { cls: 'parsec-agents2__chip parsec-agents2__chip--x402', text: 'x402' }));

  const owner = a.owner
    ? el('button', {
      cls: 'parsec-agents2__owner',
      text: `${a.owner.slice(0, 6)}…${a.owner.slice(-4)}`,
      attrs: { type: 'button', title: `Owner ${a.owner} — click to copy` },
      onClick: () => { void navigator.clipboard.writeText(a.owner); toast('Owner address copied', 'success'); },
    })
    : el('span', { cls: 'parsec-agents2__owner', text: 'owner unknown' });

  return el('article', {
    cls: 'parsec-agents2__card',
    attrs: { tabindex: '0' },
    children: [
      el('header', { cls: 'parsec-agents2__head', children: [
        avatar,
        el('div', { cls: 'parsec-agents2__title', children: [
          el('h3', { cls: 'parsec-agents2__name', text: a.name }),
          el('div', { cls: 'parsec-agents2__chips', children: badges }),
        ] }),
      ] }),
      el('p', { cls: 'parsec-agents2__desc', text: a.description || 'No description.' }),
      ...(a.protocols.length
        ? [el('div', { cls: 'parsec-agents2__protocols', children: a.protocols.map((p) => el('span', { text: p })) })]
        : []),
      el('footer', { cls: 'parsec-agents2__foot', children: [
        owner,
        el('span', { cls: 'parsec-agents2__meta', text: [a.stars ? `★ ${a.stars}` : '', a.score ? `score ${a.score}` : '', a.createdAt].filter(Boolean).join(' · ') }),
      ] }),
    ],
  });
}

export function agentsView(): HTMLElement {
  let query = '';
  let page = 1;
  let busy: AbortController | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const input = el('input', {
    cls: 'parsec-agents2__input',
    attrs: { type: 'search', placeholder: 'Search agents by name, skill or protocol…', 'aria-label': 'Search agents', maxlength: '100', spellcheck: 'false', autocomplete: 'off' },
  }) as HTMLInputElement;
  const status = el('p', { cls: 'parsec-agents2__status', attrs: { 'aria-live': 'polite' } });
  const grid = el('div', { cls: 'parsec-agents2__grid' });
  const more = btn('Load more', { outlined: true, cls: 'parsec-agents2__more' });
  more.hidden = true;

  async function run(reset: boolean): Promise<void> {
    busy?.abort();
    const ctl = new AbortController();
    busy = ctl;
    if (reset) { page = 1; grid.replaceChildren(); }
    status.textContent = reset ? 'Searching…' : 'Loading more…';
    status.dataset.tone = '';
    try {
      const r = await searchDirectory(query, { page, limit: PAGE, signal: ctl.signal });
      if (busy !== ctl) return; // a newer search took over
      for (const a of r.agents) grid.appendChild(agentCard(a));
      const shown = grid.children.length;
      status.textContent = r.total === 0
        ? (query ? `No agents match “${query}”.` : 'The directory is empty.')
        : query ? `${r.total.toLocaleString()} agents match “${query}” · showing ${shown}` : `${r.total.toLocaleString()} agents in the directory · showing ${shown}`;
      more.hidden = !r.hasMore;
    } catch (e) {
      if (ctl.signal.aborted && busy !== ctl) return;
      status.textContent = `Could not reach AgenticPlace: ${e instanceof Error ? e.message : String(e)}`;
      status.dataset.tone = 'error';
      more.hidden = true;
    } finally {
      if (busy === ctl) busy = null;
    }
  }

  input.addEventListener('input', () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { query = input.value.trim(); void run(true); }, 300);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { if (timer) clearTimeout(timer); query = input.value.trim(); void run(true); }
    if (e.key === 'Escape' && input.value) { e.preventDefault(); input.value = ''; query = ''; void run(true); }
    if (e.key === 'ArrowDown') { e.preventDefault(); (grid.firstElementChild as HTMLElement | null)?.focus(); }
  });
  // Arrow keys move between results; Escape returns to the search bar.
  grid.addEventListener('keydown', (e) => {
    const card = (e.target as HTMLElement).closest('.parsec-agents2__card') as HTMLElement | null;
    if (!card) return;
    const next = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? card.nextElementSibling
      : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? card.previousElementSibling : null;
    if (next) { e.preventDefault(); (next as HTMLElement).focus(); }
    if (e.key === 'Escape') input.focus();
  });
  more.addEventListener('click', () => { page += 1; void run(false); });
  onCleanup(() => { busy?.abort(); if (timer) clearTimeout(timer); });

  void run(true);
  setTimeout(() => input.focus(), 50);

  return el('div', {
    cls: 'parsec-view parsec-agents2',
    children: [
      el('div', { cls: 'parsec-view__header', children: [
        btn('Back', { minimal: true, icon: 'arrow-left', onClick: () => { if (!store.back()) store.navigate('dashboard'); } }),
        el('h2', { cls: 'parsec-view__title', text: 'Agents' }),
      ] }),
      el('p', { cls: 'parsec-agents2__lede', text: 'Agents registered on chain, from the AgenticPlace directory. Listings are information, not endorsements: PARSEC shows them as text and never acts on them. Paying an agent always goes through your approval.' }),
      el('div', { cls: 'parsec-agents2__bar', children: [
        el('span', { cls: 'parsec-agents2__glass', text: '⌕', attrs: { 'aria-hidden': 'true' } }),
        input,
      ] }),
      status,
      grid,
      more,
      el('p', { cls: 'parsec-agents2__source', text: `Source: ${DIRECTORY_URL.replace('https://', '')} · images are not loaded` }),
    ],
  });
}
