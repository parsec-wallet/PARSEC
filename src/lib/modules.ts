// PARSEC Wallet — Module Manifest
//
// One registration for a whole feature. Today a new chain or dApp surface has
// to be threaded through four separate places: the AppView union, the
// registerView block in main.ts, a ChainDescriptor in lib/chains.ts, and a
// tile in lib/dashboard/index.ts. A ParsecModule declares its routes, its
// place in the navigation, and its dashboard row together, and
// registerModule() performs all three registrations.
//
// This generalises the pattern lib/dashboard-modules.ts already states as its
// intent: "adding a new chain or new dApp surface is one new module
// registration — no edits to the dashboard view itself."
//
// It composes the existing registries rather than replacing them, so modules
// can be migrated one at a time with nothing else moving.

import { registerView } from './router';
import { registerRoute } from './nav';
import { registerDashboardModule } from './dashboard-modules';
import type { Disclosure, NavTier } from './nav';
import type { DashboardModule } from './dashboard-modules';
import type { AppView } from '../types/wallet';
import { DEFAULT_CHOICES, assertPrivilege } from './module-choices';
import type { ModuleChoices, Privilege } from './module-choices';

export {
  DEFAULT_CHOICES,
  PRIVILEGE_RANK,
  PrivilegeError,
  assertPrivilege,
  describeChoices,
  hasPrivilege,
} from './module-choices';
export type { ModuleChoices, Persistence, Privilege, ProviderChoice } from './module-choices';

/** A lazily-imported view factory, matching lib/router.ts's contract. */
export type ViewLoader = () => Promise<() => HTMLElement>;

export interface ModuleRoute {
  /** Route id — also the AppView name the router registers. */
  readonly id: string;
  readonly title: string;
  /** Load the view. Called on first navigation, then cached by the bundler. */
  readonly load: ViewLoader;
  /** Lowest disclosure level that offers this route. Defaults to 'more'. */
  readonly disclosure?: Disclosure;
  /** Show in the left rail. Detail routes stay reachable but unlisted. */
  readonly inRail?: boolean;
  /** Approval surface — kept off the back stack and out of the palette. */
  readonly modal?: boolean;
  readonly keywords?: readonly string[];
  /** Run before the view loads — e.g. side-effect imports that register
   *  adapters the view expects to already exist. */
  readonly prepare?: () => Promise<unknown>;
}

export interface ParsecModule {
  readonly id: string;
  /** Which tier of the architecture this module belongs to (see PARSEC.png). */
  readonly tier: NavTier;
  /** Rail ordering within the tier; lower renders first. */
  readonly priority: number;
  /** Disabled modules register nothing at all. */
  readonly enabled: boolean;
  readonly routes: readonly ModuleRoute[];
  /** Old route ids that should resolve to a current one, replacing the
   *  back-compat forwarder views. */
  readonly aliases?: Readonly<Record<string, string>>;
  /** Optional dashboard row, using the existing DashboardModule interface. */
  readonly dashboard?: DashboardModule;
  /** What the module elects — privilege, reach, persistence, provider. Omitted
   *  means DEFAULT_CHOICES: observe-only, assumed external. See module-choices.ts. */
  readonly choices?: ModuleChoices;
}

const REGISTRY = new Map<string, ParsecModule>();
const ALIASES = new Map<string, string>();

/**
 * Wrap a loader in the synchronous-placeholder dance lib/router.ts requires:
 * return an element now, swap in the real view when the chunk resolves.
 */
function lazyFactory(route: ModuleRoute): () => HTMLElement {
  return () => {
    const placeholder = document.createElement('div');
    placeholder.className = 'parsec-view parsec-view--loading';
    placeholder.innerHTML = '<div class="parsec-view-loading__spinner" aria-hidden="true"></div>';

    const load = route.prepare
      ? route.prepare().then(() => route.load())
      : route.load();

    load
      .then((factory) => {
        // Navigated away before the chunk arrived: building the view now would
        // register its listeners and timers into the NEXT view's cleanup list
        // (or nowhere at all), and nothing would ever show it.
        if (!placeholder.isConnected) return;
        const real = factory();
        real.classList.add('parsec-view--enter');
        placeholder.replaceWith(real);
        requestAnimationFrame(() => {
          requestAnimationFrame(() => real.classList.remove('parsec-view--enter'));
        });
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        placeholder.innerHTML = `<div class="parsec-error">Failed to load view: ${message}</div>`;
      });

    return placeholder;
  };
}

/**
 * Register a module's routes with the router, its navigation metadata with
 * lib/nav.ts, and its dashboard row with lib/dashboard-modules.ts.
 */
export function registerModule(mod: ParsecModule): void {
  if (!mod.enabled) return;
  REGISTRY.set(mod.id, mod);

  for (const route of mod.routes) {
    registerView(route.id as AppView, lazyFactory(route));
    registerRoute({
      id: route.id,
      title: route.title,
      tier: mod.tier,
      disclosure: route.disclosure ?? 'more',
      inRail: route.inRail,
      modal: route.modal,
      keywords: route.keywords,
    });
  }

  for (const [from, to] of Object.entries(mod.aliases ?? {})) {
    ALIASES.set(from, to);
  }

  if (mod.dashboard) registerDashboardModule(mod.dashboard);
}

export function listModules(): ParsecModule[] {
  return Array.from(REGISTRY.values()).sort((a, b) => a.priority - b.priority);
}

export function getModule(id: string): ParsecModule | undefined {
  return REGISTRY.get(id);
}

/** A module's declaration, or the cautious defaults when it made none. */
export function choicesOf(mod: ParsecModule): ModuleChoices {
  return mod.choices ?? DEFAULT_CHOICES;
}

/**
 * Throw unless a registered module's declaration covers `needed`. Unregistered
 * ids are held to DEFAULT_CHOICES, so an unknown module can only observe.
 */
export function assertModulePrivilege(moduleId: string, needed: Privilege): void {
  const mod = REGISTRY.get(moduleId);
  assertPrivilege(moduleId, mod ? choicesOf(mod) : DEFAULT_CHOICES, needed);
}

/** Resolve a possibly-retired route id to the one that should render. */
export function resolveAlias(id: string): string {
  return ALIASES.get(id) ?? id;
}
