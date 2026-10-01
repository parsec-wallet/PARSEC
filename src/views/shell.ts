// PARSEC Wallet — Application Shell
//
// A persistent frame around the router's content host: brand, tier rail,
// disclosure control, and a back affordance. Because the router now renders
// into the shell's content host rather than the document root, the shell
// survives navigation — which is what removes the full-page innerHTML wipe.
//
// The rail is built from lib/nav.ts, so it mirrors the four tiers of the
// product architecture (PARSEC.png) and grows automatically as modules
// register routes.

import { el, btn, brandLogo } from '../lib/dom';
import { store } from '../lib/store';
import {
  GROUP_LABEL,
  GROUP_ORDER,
  groupOf,
  groupRoutes,
  type NavGroup,
  getDisclosure,
  getRoute,
  isModalRoute,
  setDisclosure,
} from '../lib/nav';
import type { Disclosure } from '../lib/nav';
import { showPalette } from '../lib/ui/palette';
import { getMode, onModeChange, type Mode } from '../lib/mode';

/** Views that own the whole viewport — the shell stays out of their way. */
const CHROMELESS = new Set([
  'matrix',
  'onboarding',
  'unlock',
  'create-wallet',
  'verify-mnemonic',
  // The rest of the creation flow owns the viewport too, so Red Pill → pick a chain
  // → create → back to the picker is one continuous full-screen flow instead of
  // switching between the shell and full-screen at every step.
  'create-select',
  'solana-create',
  'arweave-create',
  'import-wallet',
]);

const DISCLOSURE_STEPS: ReadonlyArray<{ id: Disclosure; label: string; hint: string }> = [
  { id: 'simple', label: 'Simple', hint: 'The everyday wallet' },
  { id: 'more', label: 'More', hint: 'Operator surfaces' },
  { id: 'pro', label: 'Professional', hint: 'Every module and audit view' },
];

export interface Shell {
  /** The element to mount into the document. */
  readonly element: HTMLElement;
  /** Where the router renders each view. */
  readonly content: HTMLElement;
}

export function createShell(): Shell {
  const content = el('div', { cls: 'parsec-shell__content' });
  content.id = 'parsec-view-host';

  const rail = el('nav', { cls: 'parsec-shell__rail' });
  rail.setAttribute('aria-label', 'Sections');

  const crumb = el('span', { cls: 'parsec-shell__crumb' });
  // Which pill the app is in, on every screen: viewing (Blue Pill, no keys) or
  // armed (Red Pill, can sign). lib/mode.ts enforces it; this states it.
  const modeBadge = el('span', { cls: 'parsec-modebadge' });
  const paintMode = (m: Mode) => {
    modeBadge.textContent = m === 'armed' ? 'ARMED' : 'VIEWING';
    modeBadge.className = `parsec-modebadge parsec-modebadge--${m === 'armed' ? 'armed' : 'viewing'}`;
    modeBadge.title = m === 'armed'
      ? 'Red Pill: a live wallet that can sign. Log out to disarm.'
      : 'Blue Pill: view-only. Nothing here can reach a key or sign.';
  };
  paintMode(getMode());
  onModeChange(paintMode);

  const backBtn = btn('Back', { minimal: true, onClick: () => { if (!store.back()) store.navigate('dashboard'); } });
  backBtn.classList.add('parsec-shell__back');

  const paletteBtn = btn('Search', { minimal: true, onClick: () => showPalette() });
  paletteBtn.classList.add('parsec-shell__search');
  paletteBtn.title = 'Search views (Ctrl/Cmd-K)';

  const brand = brandLogo({ small: true });
  brand.classList.add('parsec-shell__brand');
  brand.addEventListener('click', () => store.navigate('dashboard'));

  const header = el('header', {
    cls: 'parsec-shell__header',
    children: [brand, backBtn, crumb, el('div', { cls: 'parsec-shell__spacer' }), modeBadge, paletteBtn],
  });

  const disclosure = el('div', { cls: 'parsec-shell__disclosure' });
  disclosure.setAttribute('role', 'group');
  disclosure.setAttribute('aria-label', 'Detail level');

  const root = el('div', {
    cls: 'parsec-shell',
    children: [header, el('div', { cls: 'parsec-shell__body', children: [
      el('div', { cls: 'parsec-shell__sidebar', children: [rail, disclosure] }),
      content,
    ]})],
  });

  function renderDisclosure(): void {
    const level = getDisclosure();
    disclosure.innerHTML = '';
    for (const step of DISCLOSURE_STEPS) {
      const b = el('button', { cls: 'parsec-shell__level', text: step.label });
      b.setAttribute('aria-pressed', String(step.id === level));
      b.title = step.hint;
      b.addEventListener('click', () => {
        setDisclosure(step.id);
        renderDisclosure();
        renderRail();
      });
      disclosure.appendChild(b);
    }
  }

  // Accordion: one section open at a time. Opening a section closes the
  // others; its header closes it again. Navigating to a view opens the section
  // that holds it (once, on arrival — not on every redraw, which made that
  // section impossible to close). The open section is remembered.
  const OPEN_KEY = 'parsec:rail-open';
  const readOpen = (): Set<string> => {
    try { return new Set(JSON.parse(localStorage.getItem(OPEN_KEY) ?? '[]') as string[]); } catch { return new Set(); }
  };
  const writeOpen = (open: Set<string>): void => {
    try { localStorage.setItem(OPEN_KEY, JSON.stringify([...open])); } catch { /* best effort */ }
  };

  let railView: string | null = null;

  function renderRail(): void {
    const level = getDisclosure();
    const current = store.get().view;
    const currentRoute = getRoute(current);
    const currentGroup: NavGroup | null = currentRoute ? groupOf(currentRoute) : null;
    let open = readOpen();
    if (current !== railView) {
      railView = current;
      if (currentGroup && !open.has(currentGroup)) {
        open = new Set([currentGroup]);
        writeOpen(open);
      }
    }
    rail.innerHTML = '';

    for (const group of GROUP_ORDER) {
      const routes = groupRoutes(group, level);
      if (routes.length === 0) continue;

      const expanded = open.has(group);
      const section = el('div', { cls: `parsec-shell__section${expanded ? ' parsec-shell__section--open' : ''}` });
      const bodyId = `parsec-rail-${group}`;
      const head = el('button', {
        cls: 'parsec-shell__tier parsec-shell__accordion',
        attrs: { type: 'button', 'aria-expanded': String(expanded), 'aria-controls': bodyId },
        children: [
          el('span', { cls: 'parsec-shell__accordion-label', text: GROUP_LABEL[group] }),
          el('span', { cls: 'parsec-shell__accordion-count', text: String(routes.length) }),
          el('span', { cls: 'parsec-shell__accordion-chevron', attrs: { 'aria-hidden': 'true' }, text: '›' }),
        ],
      });
      head.addEventListener('click', () => {
        writeOpen(expanded ? new Set() : new Set([group]));
        renderRail();
      });
      section.appendChild(head);

      const body = el('div', { cls: 'parsec-shell__section-body', attrs: { id: bodyId } });
      if (!expanded) body.hidden = true;
      for (const route of routes) {
        const item = el('button', { cls: 'parsec-shell__link', text: route.title });
        if (route.id === current) {
          item.classList.add('parsec-shell__link--active');
          item.setAttribute('aria-current', 'page');
        }
        item.addEventListener('click', () => store.navigate(route.id as Parameters<typeof store.navigate>[0]));
        body.appendChild(item);
      }
      section.appendChild(body);
      rail.appendChild(section);
    }
  }

  function syncChrome(view: string): void {
    // Chromeless views (the matrix gate, onboarding) render edge to edge.
    const bare = CHROMELESS.has(view) || isModalRoute(view);
    root.classList.toggle('parsec-shell--bare', bare);

    const route = getRoute(view);
    crumb.textContent = route ? `${GROUP_LABEL[groupOf(route)]} · ${route.title}` : '';
    backBtn.hidden = !store.canGoBack();
  }

  store.subscribe((state) => {
    syncChrome(state.view);
    renderRail();
  });

  renderDisclosure();
  renderRail();
  syncChrome(store.get().view);

  return { element: root, content };
}
