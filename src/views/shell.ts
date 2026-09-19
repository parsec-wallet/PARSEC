// Parsec Wallet — Application Shell
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
  TIER_LABEL,
  TIER_ORDER,
  getDisclosure,
  getRoute,
  isModalRoute,
  railRoutes,
  setDisclosure,
} from '../lib/nav';
import type { Disclosure } from '../lib/nav';
import { showPalette } from '../lib/ui/palette';

/** Views that own the whole viewport — the shell stays out of their way. */
const CHROMELESS = new Set([
  'matrix',
  'onboarding',
  'unlock',
  'create-wallet',
  'verify-mnemonic',
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

  const backBtn = btn('Back', { minimal: true, onClick: () => store.back() });
  backBtn.classList.add('parsec-shell__back');

  const paletteBtn = btn('Search', { minimal: true, onClick: () => showPalette() });
  paletteBtn.classList.add('parsec-shell__search');
  paletteBtn.title = 'Search views (Ctrl/Cmd-K)';

  const brand = brandLogo({ small: true });
  brand.classList.add('parsec-shell__brand');
  brand.addEventListener('click', () => store.navigate('dashboard'));

  const header = el('header', {
    cls: 'parsec-shell__header',
    children: [brand, backBtn, crumb, el('div', { cls: 'parsec-shell__spacer' }), paletteBtn],
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

  function renderRail(): void {
    const level = getDisclosure();
    const current = store.get().view;
    rail.innerHTML = '';

    for (const tier of TIER_ORDER) {
      const routes = railRoutes(tier, level);
      if (routes.length === 0) continue;

      const section = el('div', { cls: 'parsec-shell__section' });
      section.appendChild(el('h6', { cls: 'parsec-shell__tier', text: TIER_LABEL[tier] }));

      for (const route of routes) {
        const item = el('button', { cls: 'parsec-shell__link', text: route.title });
        if (route.id === current) {
          item.classList.add('parsec-shell__link--active');
          item.setAttribute('aria-current', 'page');
        }
        item.addEventListener('click', () => store.navigate(route.id as Parameters<typeof store.navigate>[0]));
        section.appendChild(item);
      }
      rail.appendChild(section);
    }
  }

  function syncChrome(view: string): void {
    // Chromeless views (the matrix gate, onboarding) render edge to edge.
    const bare = CHROMELESS.has(view) || isModalRoute(view);
    root.classList.toggle('parsec-shell--bare', bare);

    const route = getRoute(view);
    crumb.textContent = route ? `${TIER_LABEL[route.tier]} · ${route.title}` : '';
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
