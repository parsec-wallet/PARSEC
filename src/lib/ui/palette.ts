// Parsec Wallet — Command Palette
//
// Ctrl/Cmd-K fuzzy search over the route registry. With 64 views this is the
// difference between "I know it's in here somewhere" and "I'm there".
//
// Zero dependencies: subsequence matching, a scored sort, and plain DOM.

import { el } from '../dom';
import { store } from '../store';
import { TIER_LABEL, getDisclosure, visibleRoutes } from '../nav';
import type { NavRoute } from '../nav';
import { fuzzy } from './fuzzy';

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
  field.placeholder = 'Go to…';
  field.setAttribute('aria-label', 'Search views');
  field.autocomplete = 'off';
  field.spellcheck = false;

  const list = el('ul', { cls: 'parsec-palette__list' });
  list.setAttribute('role', 'listbox');

  const panel = el('div', { cls: 'parsec-palette__panel', children: [field, list] });
  overlay.appendChild(panel);
  document.body.appendChild(overlay);

  let results: Scored[] = [];
  let active = 0;

  function render(): void {
    const query = field.value.trim();
    const corpus = visibleRoutes(getDisclosure());

    results = query
      ? corpus
          .map((r) => scoreRoute(query, r))
          .filter((s): s is Scored => s !== null)
          .sort((a, b) => b.score - a.score)
          .slice(0, 12)
      : corpus.slice(0, 12).map((route) => ({ route, score: 0, hits: [] }));

    active = 0;
    list.innerHTML = '';

    if (results.length === 0) {
      list.appendChild(el('li', { cls: 'parsec-palette__empty', text: `Nothing matches “${query}”` }));
      return;
    }

    results.forEach((s, i) => {
      const row = el('li', { cls: 'parsec-palette__item' });
      row.setAttribute('role', 'option');

      const label = el('span', { cls: 'parsec-palette__label' });
      label.appendChild(highlight(s.route.title, s.hits));
      // Name the keyword that pulled this row in, so the match is never opaque.
      if (s.via) label.appendChild(el('span', { cls: 'parsec-palette__via', text: s.via }));
      row.appendChild(label);

      row.appendChild(el('span', { cls: 'parsec-palette__tier', text: TIER_LABEL[s.route.tier] }));
      row.addEventListener('mouseenter', () => { active = i; paint(); });
      row.addEventListener('click', () => choose(i));
      list.appendChild(row);
    });
    paint();
  }

  function paint(): void {
    Array.from(list.children).forEach((node, i) => {
      const on = i === active;
      node.classList.toggle('parsec-palette__item--active', on);
      node.setAttribute('aria-selected', String(on));
      if (on) (node as HTMLElement).scrollIntoView({ block: 'nearest' });
    });
  }

  function choose(i: number): void {
    const hit = results[i];
    if (!hit) return;
    close();
    store.navigate(hit.route.id as Parameters<typeof store.navigate>[0]);
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
  }

  openPalette = open;

  overlay.addEventListener('mousedown', (e) => {
    if (e.target === overlay) close();
  });

  field.addEventListener('input', render);

  field.addEventListener('keydown', (e) => {
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); active = Math.min(active + 1, results.length - 1); paint(); break;
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
