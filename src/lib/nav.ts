// PARSEC Wallet — Route Registry & Navigation Model
//
// Groups every view into the four tiers of the product architecture
// (see ../../PARSEC.png, and the table in CLAUDE.md):
//
//   Chain Modules  →  Wallet Pouch  →  Vault Identity  →  AgenticPlace
//
// Navigation that mirrors the architecture teaches it. The alternative — an
// alphabetical list of 64 screens — teaches nothing.
//
// This registry is descriptive metadata only. It does not own view factories
// (that stays with lib/router.ts) and it never gates behaviour: a route absent
// from the registry still renders, it simply doesn't appear in the rail.

/** The four tiers of the PARSEC stack, in dependency order. */
export type NavTier = 'modules' | 'pouch' | 'identity' | 'agenticplace';

/** Progressive disclosure level. `simple` is the newcomer's wallet; `pro`
 *  exposes every operator and auditor surface. Persisted per device. */
export type Disclosure = 'simple' | 'more' | 'pro';

export interface NavRoute {
  /** View id, matching the key registered with lib/router.ts. */
  readonly id: string;
  /** Human label for the rail, palette and breadcrumb. */
  readonly title: string;
  readonly tier: NavTier;
  /** Lowest disclosure level at which this route is offered. */
  readonly disclosure: Disclosure;
  /** Show in the left rail. Detail/child routes stay reachable but unlisted. */
  readonly inRail?: boolean;
  /** Approval and confirmation surfaces. Kept off the back stack so a back
   *  gesture can never silently cancel a signing decision. */
  readonly modal?: boolean;
  /** Extra search terms for the command palette. */
  readonly keywords?: readonly string[];
  /** Rail section, when it is not the tier's own (see GROUP_ORDER). */
  readonly group?: NavGroup;
}

export const TIER_LABEL: Record<NavTier, string> = {
  modules: 'Chain Modules',
  pouch: 'Wallet Pouch',
  identity: 'Vault Identity',
  agenticplace: 'AgenticPlace',
};

export const TIER_ORDER: readonly NavTier[] = ['modules', 'pouch', 'identity', 'agenticplace'];

// ── Rail sections (the accordion) ──────────────────────────────
// The rail groups routes into collapsible sections. The four tiers are four of
// them; two surfaces large enough to be their own place — .algo names and the
// permaweb — get a section each instead of sitting inside AgenticPlace.

export type NavGroup = NavTier | 'algo' | 'permaweb';

export const GROUP_LABEL: Record<NavGroup, string> = {
  modules: 'Chain Modules',
  pouch: 'Wallet Pouch',
  identity: 'Vault Identity',
  agenticplace: 'AgenticPlace',
  algo: '.algo',
  permaweb: 'Permaweb',
};

export const GROUP_ORDER: readonly NavGroup[] = ['modules', 'pouch', 'identity', 'agenticplace', 'algo', 'permaweb'];

/** The rail section a route sits in: its own `group`, else by id, else its tier. */
export function groupOf(route: NavRoute): NavGroup {
  if (route.group) return route.group;
  if (route.id.startsWith('nfdominter')) return 'algo';
  if (route.id.startsWith('permaweb') || route.id.startsWith('ario') || route.id.startsWith('arweave-ario')) return 'permaweb';
  return route.tier;
}

/** Routes for one rail section at a disclosure level, in rail order. */
export function groupRoutes(group: NavGroup, level: Disclosure): NavRoute[] {
  return TIER_ORDER.flatMap((t) => railRoutes(t, level)).filter((r) => groupOf(r) === group);
}

const DISCLOSURE_RANK: Record<Disclosure, number> = { simple: 0, more: 1, pro: 2 };

const REGISTRY = new Map<string, NavRoute>();

export function registerRoute(route: NavRoute): void {
  REGISTRY.set(route.id, route);
}

export function registerRoutes(routes: readonly NavRoute[]): void {
  for (const r of routes) registerRoute(r);
}

export function getRoute(id: string): NavRoute | undefined {
  return REGISTRY.get(id);
}

export function allRoutes(): NavRoute[] {
  return Array.from(REGISTRY.values());
}

/** Is this route an approval surface that must not be backed out of? */
export function isModalRoute(id: string): boolean {
  return REGISTRY.get(id)?.modal === true;
}

/** Routes for one tier's rail section, filtered to the current disclosure. */
export function railRoutes(tier: NavTier, level: Disclosure): NavRoute[] {
  return allRoutes().filter(
    (r) => r.tier === tier && r.inRail && DISCLOSURE_RANK[r.disclosure] <= DISCLOSURE_RANK[level],
  );
}

/** Every route offered at this disclosure level — the palette's corpus. */
export function visibleRoutes(level: Disclosure): NavRoute[] {
  return allRoutes().filter(
    (r) => !r.modal && DISCLOSURE_RANK[r.disclosure] <= DISCLOSURE_RANK[level],
  );
}

// ── Disclosure level, persisted per device ────────────────────
// Not a secret and not account state, so localStorage is appropriate here.

const DISCLOSURE_KEY = 'parsec:disclosure';

export function getDisclosure(): Disclosure {
  try {
    const v = localStorage.getItem(DISCLOSURE_KEY);
    if (v === 'simple' || v === 'more' || v === 'pro') return v;
  } catch {
    /* private mode / blocked storage — fall through to the default */
  }
  return 'simple';
}

export function setDisclosure(level: Disclosure): void {
  try {
    localStorage.setItem(DISCLOSURE_KEY, level);
  } catch {
    /* best-effort persistence */
  }
}

// ── The built-in routes ───────────────────────────────────────
// Ordered within each tier as they should appear in the rail. Views that a
// module will later own move out of this table as W3 migrates them.

registerRoutes([
  // ── Chain Modules ───────────────────────────────────────────
  { id: 'create-select',   title: 'Add a Chain',          tier: 'modules', disclosure: 'simple', inRail: true, keywords: ['create', 'wallet', 'new', 'chain', 'algorand', 'bitcoin', 'solana', 'arweave', 'evm'] },
  { id: 'arc52-create',    title: 'Algorand HD (ARC-52)', tier: 'modules', disclosure: 'pro',    inRail: true, keywords: ['bip32', 'ed25519', 'hd'] },
  { id: 'xchain-connect',  title: 'EVM → Algorand',       tier: 'modules', disclosure: 'pro',    inRail: true, keywords: ['metamask', 'logicsig', 'xchain'] },
  { id: 'solana-create',   title: 'Create Solana',        tier: 'modules', disclosure: 'more',   inRail: true, keywords: ['sol', 'phantom', 'slip-0010'] },
  { id: 'solana-import',   title: 'Import Solana',        tier: 'modules', disclosure: 'more',   inRail: true, keywords: ['sol'] },
  { id: 'arweave-create',  title: 'Create Arweave',       tier: 'modules', disclosure: 'more',   inRail: true, keywords: ['ar', 'rsa', 'jwk'] },

  // ── Wallet Pouch ────────────────────────────────────────────
  { id: 'dashboard',       title: 'Dashboard',       tier: 'pouch', disclosure: 'simple', inRail: true, keywords: ['home', 'balance', 'assets'] },
  { id: 'linkage',         title: 'Linkage',         tier: 'pouch', disclosure: 'simple', inRail: true, keywords: ['architecture', 'map', 'modules', 'stack', 'diagram', 'health'] },
  { id: 'send',            title: 'Send',            tier: 'pouch', disclosure: 'simple', inRail: true, keywords: ['transfer', 'pay'] },
  { id: 'receive',         title: 'Receive',         tier: 'pouch', disclosure: 'simple', inRail: true, keywords: ['address', 'qr', 'arc-26'] },
  { id: 'swap',            title: 'Swap',            tier: 'pouch', disclosure: 'simple', inRail: true, keywords: ['spintrade', 'dex', 'tinyman', 'pact'] },
  { id: 'add-asset',       title: 'Add Asset',       tier: 'pouch', disclosure: 'more',   inRail: true, keywords: ['asa', 'opt-in', 'token'] },
  { id: 'onramp',          title: 'Buy',             tier: 'pouch', disclosure: 'more',   inRail: true, keywords: ['onramp', 'fiat'] },
  { id: 'confirm-send',    title: 'Confirm Send',    tier: 'pouch', disclosure: 'simple', modal: true },
  { id: 'solana-send',     title: 'Send SOL',        tier: 'pouch', disclosure: 'more' },
  { id: 'arweave-send',    title: 'Send AR',         tier: 'pouch', disclosure: 'more' },
  { id: 'ario-transfer',   title: 'Transfer ARIO',   tier: 'pouch', disclosure: 'more' },

  // ── Vault Identity ──────────────────────────────────────────
  { id: 'identity',        title: 'Identity',        tier: 'identity', disclosure: 'more',   inRail: true, keywords: ['erc-8004', 'idnft', 'bankon', 'tier'] },
  { id: 'mausoleum',       title: 'Mausoleum',       tier: 'identity', disclosure: 'pro',    inRail: true, keywords: ['vault', 'tomb', 'luks', 'cold storage'] },
  { id: 'admin-keygen',    title: 'Key Ceremony',    tier: 'identity', disclosure: 'pro',    inRail: true, keywords: ['airgap', 'admin', 'ceremony'] },
  { id: 'diagnostics',     title: 'Diagnostics',     tier: 'identity', disclosure: 'more',   inRail: true, keywords: ['network', 'health', 'shield'] },
  { id: 'settings',        title: 'Settings',        tier: 'identity', disclosure: 'simple', inRail: true, keywords: ['network', 'account', 'lock', 'preferences'] },

  // ── AgenticPlace ────────────────────────────────────────────
  { id: 'name-hub',        title: 'Names',           tier: 'agenticplace', disclosure: 'simple', inRail: true, keywords: ['arns', 'bankon', 'ans', 'domain'] },
  { id: 'market-hub',      title: 'Marketspace',     tier: 'agenticplace', disclosure: 'more',   inRail: true, keywords: ['listing', 'auction', 'buy', 'sell'] },
  { id: 'agents',          title: 'Agents',          tier: 'agenticplace', disclosure: 'more',   inRail: true, keywords: ['agenticplace', 'x402', 'discovery'] },
  { id: 'nfdominter',      title: '.algo Names',     tier: 'agenticplace', disclosure: 'simple', inRail: true, keywords: ['.algo', 'nfd', 'name', 'domain', 'register'] },
  // Both spend: an approval surface never joins the back stack (see confirm-send).
  { id: 'nfdominter-confirm', title: 'Register .algo', tier: 'agenticplace', disclosure: 'simple', modal: true },
  { id: 'nfdominter-buy',  title: 'Buy .algo',       tier: 'agenticplace', disclosure: 'simple', modal: true },
  { id: 'pmvpn',           title: 'pmVPN',           tier: 'agenticplace', disclosure: 'pro',    inRail: true, keywords: ['ssh', 'terminal', 'remote'] },
  { id: 'docs',            title: 'Docs',            tier: 'agenticplace', disclosure: 'simple', inRail: true, keywords: ['help', 'faq', 'quickstart', 'security'] },

  // Approval surfaces — reachable, never listed, never on the back stack.
  { id: 'connect-approve',      title: 'Approve Signature',   tier: 'agenticplace', disclosure: 'simple', modal: true },
  { id: 'connect-name-approve', title: 'Approve Name Action', tier: 'agenticplace', disclosure: 'simple', modal: true },
  { id: 'arweave-approve',      title: 'Approve Connection',  tier: 'agenticplace', disclosure: 'simple', modal: true },
]);
