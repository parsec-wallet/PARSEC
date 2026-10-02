// PARSEC Wallet — Command Palette
//
// Ctrl/Cmd-K fuzzy search over the route registry. With 64 views this is the
// difference between "I know it's in here somewhere" and "I'm there".
//
// It also finds Algorand assets (palette-assets.ts): a separate, Algorand-only section —
// verified matches at once, then the indexer's — and choosing one opens ADD ASSETS on it.
// EVM chains are not searched here; they are the RAGEbar's, in the Matrix.
//
// Zero dependencies: subsequence matching, a scored sort, and plain DOM.

import { el } from '../dom';
import { store } from '../store';
import { GROUP_LABEL, groupOf, getDisclosure, visibleRoutes } from '../nav';
import type { NavRoute } from '../nav';
import { fuzzy } from './fuzzy';
import {
  assetNetwork, isAssetQuery, instantAssetHits, indexerAssetHits, describeHit, setAssetFocus, type AssetHit,
} from './palette-assets';

type Row = { kind: 'route'; s: Scored } | { kind: 'asset'; h: AssetHit };

interface Scored {
  route: NavRoute;
  score: number;
  /** Indices of `route.title` that matched, for highlighting. */
  hits: number[];
  /** Set when the match came from a keyword rather than the title, so the row
   *  can say why it is here — otherwise "Send" appearing for "pay" reads as a
   *  bug. */
  via?: string;
}

/** Best score across the title and the route's keywords. */
function scoreRoute(query: string, route: NavRoute): Scored | null {
  const byTitle = fuzzy(query, route.title);
  let best: Scored | null = byTitle ? { route, score: byTitle.score, hits: byTitle.hits } : null;

  for (const kw of route.keywords ?? []) {
    const m = fuzzy(query, kw);
    // Keyword matches are real but shouldn't outrank a title match.
    if (m && (!best || m.score - 4 > best.score)) {
      best = { route, score: m.score - 4, hits: [], via: kw };
    }
  }
  return best;
}

function highlight(title: string, hits: number[]): HTMLElement {
  const wrap = el('span', { cls: 'parsec-palette__title' });
  const set = new Set(hits);
  let run = '';
  let runMatched = false;

  const flush = (): void => {
    if (!run) return;
    const node: Node = runMatched
      ? el('mark', { cls: 'parsec-palette__hit', text: run })
      : document.createTextNode(run);
    wrap.appendChild(node);
    run = '';
  };

  for (let i = 0; i < title.length; i++) {
    const matched = set.has(i);
    if (matched !== runMatched) { flush(); runMatched = matched; }
    run += title[i];
  }
  flush();
  return wrap;
}

let openPalette: (() => void) | null = null;

/** Open the palette programmatically (e.g. from a header button). */
export function showPalette(): void {
  openPalette?.();
}

/**
 * Install the palette once, at app start. Returns a disposer.
 */
export function mountPalette(): () => void {
  const overlay = el('div', { cls: 'parsec-palette' });
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Command palette');
  overlay.hidden = true;

  const field = el('input', { cls: 'parsec-palette__input' }) as HTMLInputElement;
  field.type = 'text';
  field.placeholder = 'Go to… or find an Algorand asset by name, ticker or id';
  field.setAttribute('aria-label', 'Search views and Algorand assets');
  field.autocomplete = 'off';
  field.spellcheck = false;

  const list = el('ul', { cls: 'parsec-palette__list' });
  list.setAttribute('role', 'listbox');

  const panel = el('div', { cls: 'parsec-palette__panel', children: [field, list] });
  overlay.appendChild(panel);
  document.body.appendChild(overlay);

  let rows: Row[] = [];
  let nodes: HTMLElement[] = [];
  let active = 0;
  let seq = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function section(text: string): void {
    const h = el('li', { cls: 'parsec-palette__section', text });
    h.setAttribute('role', 'presentation');
    list.appendChild(h);
  }

  function addRow(row: Row): void {
    const i = rows.length;
    rows.push(row);
    const li = el('li', { cls: 'parsec-palette__item' });
    li.setAttribute('role', 'option');
    if (row.kind === 'route') {
      const label = el('span', { cls: 'parsec-palette__label' });
      label.appendChild(highlight(row.s.route.title, row.s.hits));
      // Name the keyword that pulled this row in, so the match is never opaque.
      if (row.s.via) label.appendChild(el('span', { cls: 'parsec-palette__via', text: row.s.via }));
      li.appendChild(label);
      li.appendChild(el('span', { cls: 'parsec-palette__tier', text: GROUP_LABEL[groupOf(row.s.route)] }));
    } else {
      const d = describeHit(row.h);
      li.classList.add('parsec-palette__item--asset');
      const label = el('span', { cls: 'parsec-palette__label', children: [
        el('span', { cls: 'parsec-palette__title', text: `${row.h.unitName || '—'} · ${row.h.name || 'Unnamed asset'}` }),
        el('span', { cls: 'parsec-palette__via', text: d.detail }),
      ] });
      li.appendChild(label);
      li.appendChild(el('span', { cls: `parsec-palette__badge parsec-palette__badge--${d.tone}`, text: d.badge }));
    }
    li.addEventListener('mouseenter', () => { active = i; paint(); });
    li.addEventListener('click', () => choose(i));
    list.appendChild(li);
    nodes.push(li);
  }

  function render(): void {
    const query = field.value.trim();
    const corpus = visibleRoutes(getDisclosure());
    const my = ++seq;
    if (timer) { clearTimeout(timer); timer = null; }

    const routes = query
      ? corpus
          .map((r) => scoreRoute(query, r))
          .filter((x): x is Scored => x !== null)
          .sort((a, b) => b.score - a.score)
          .slice(0, 8)
      : corpus.slice(0, 12).map((route) => ({ route, score: 0, hits: [] }));

    rows = [];
    nodes = [];
    active = 0;
    list.innerHTML = '';

    const network = query && isAssetQuery(query) ? assetNetwork() : null;
    const instant = network ? instantAssetHits(query, network) : [];

    if (routes.length) {
      if (network) section('Views');
      for (const r of routes) addRow({ kind: 'route', s: r });
    }
    let assetHead = false;
    if (network) {
      section(`Algorand assets · ${network}`);
      assetHead = true;
      for (const h of instant) addRow({ kind: 'asset', h });
      const pending = el('li', { cls: 'parsec-palette__empty', text: 'Searching the Algorand indexer…' });
      list.appendChild(pending);
      const shown = new Set(instant.map((h) => h.assetId));
      timer = setTimeout(() => {
        indexerAssetHits(query, network, shown)
          .then((more) => {
            if (my !== seq || overlay.hidden) return;
            pending.remove();
            for (const h of more) addRow({ kind: 'asset', h });
            if (!instant.length && !more.length) list.appendChild(el('li', { cls: 'parsec-palette__empty', text: 'No Algorand asset matches.' }));
            paint();
          })
          .catch((e) => {
            if (my !== seq) return;
            pending.textContent = `Indexer search failed: ${e instanceof Error ? e.message : String(e)}`;
          });
      }, 300);
    }

    if (!rows.length && !assetHead) {
      list.appendChild(el('li', { cls: 'parsec-palette__empty', text: `Nothing matches “${query}”` }));
      return;
    }
    paint();
  }

  function paint(): void {
    nodes.forEach((node, i) => {
      const on = i === active;
      node.classList.toggle('parsec-palette__item--active', on);
      node.setAttribute('aria-selected', String(on));
      if (on) node.scrollIntoView({ block: 'nearest' });
    });
  }

  function choose(i: number): void {
    const row = rows[i];
    if (!row) return;
    close();
    if (row.kind === 'route') {
      store.navigate(row.s.route.id as Parameters<typeof store.navigate>[0]);
    } else {
      setAssetFocus(row.h.assetId);
      store.navigate('add-asset');
    }
  }

  function open(): void {
    if (!overlay.hidden) return;
    overlay.hidden = false;
    field.value = '';
    render();
    field.focus();
  }

  function close(): void {
    overlay.hidden = true;
    seq++;
    if (timer) { clearTimeout(timer); timer = null; }
  }

  openPalette = open;

  overlay.addEventListener('mousedown', (e) => {
    if (e.target === overlay) close();
  });

  field.addEventListener('input', render);

  field.addEventListener('keydown', (e) => {
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); active = Math.min(active + 1, rows.length - 1); paint(); break;
      case 'ArrowUp':   e.preventDefault(); active = Math.max(active - 1, 0); paint(); break;
      case 'Enter':     e.preventDefault(); choose(active); break;
      case 'Escape':    e.preventDefault(); close(); break;
      default: break;
    }
  });

  function onGlobalKey(e: KeyboardEvent): void {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      overlay.hidden ? open() : close();
    }
  }
  document.addEventListener('keydown', onGlobalKey);

  return () => {
    document.removeEventListener('keydown', onGlobalKey);
    overlay.remove();
    openPalette = null;
  };
}
