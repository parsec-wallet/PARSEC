import { describe, it, expect } from 'vitest';
import {
  TIER_ORDER,
  allRoutes,
  getRoute,
  isModalRoute,
  railRoutes,
  registerRoute,
  visibleRoutes,
} from '../nav';
import { fuzzy } from '../ui/fuzzy';

// x402 declares its routes through registerModule() rather than the static table,
// so the registry only holds them once the manifest has been imported.
import '../x402/module';

describe('nav registry', () => {
  it('places every built-in route in one of the four architecture tiers', () => {
    for (const route of allRoutes()) {
      expect(TIER_ORDER).toContain(route.tier);
    }
  });

  it('never lists an approval surface in the rail or the palette', () => {
    // A modal route reachable from the palette would let a user navigate into
    // a half-built signing context.
    for (const route of allRoutes().filter((r) => r.modal)) {
      expect(route.inRail).toBeFalsy();
      expect(visibleRoutes('pro').map((r) => r.id)).not.toContain(route.id);
    }
  });

  it('flags the signing surfaces as modal so they stay off the back stack', () => {
    for (const id of ['confirm-send', 'connect-approve', 'connect-name-approve', 'x402-confirm']) {
      expect(isModalRoute(id), `${id} must be modal`).toBe(true);
    }
    expect(isModalRoute('dashboard')).toBe(false);
    expect(isModalRoute('does-not-exist')).toBe(false);
  });

  it('widens progressively: simple ⊆ more ⊆ pro', () => {
    const simple = new Set(visibleRoutes('simple').map((r) => r.id));
    const more = new Set(visibleRoutes('more').map((r) => r.id));
    const pro = new Set(visibleRoutes('pro').map((r) => r.id));

    for (const id of simple) expect(more.has(id)).toBe(true);
    for (const id of more) expect(pro.has(id)).toBe(true);
    expect(pro.size).toBeGreaterThan(simple.size);
  });

  it('keeps the everyday wallet reachable at the simple level', () => {
    const simple = visibleRoutes('simple').map((r) => r.id);
    for (const id of ['dashboard', 'send', 'receive', 'settings']) {
      expect(simple).toContain(id);
    }
  });

  it('does not surface operator tooling to a newcomer', () => {
    const simple = visibleRoutes('simple').map((r) => r.id);
    for (const id of ['admin-keygen', 'mausoleum', 'pmvpn']) {
      expect(simple).not.toContain(id);
    }
  });

  it('builds rail sections per tier', () => {
    const pouch = railRoutes('pouch', 'simple').map((r) => r.id);
    expect(pouch).toContain('dashboard');
    expect(pouch).not.toContain('solana-send'); // detail route, not railed
  });

  it('accepts late registrations, so modules can add their own routes', () => {
    registerRoute({ id: 'test-only', title: 'Test Only', tier: 'pouch', disclosure: 'pro', inRail: true });
    expect(getRoute('test-only')?.title).toBe('Test Only');
    expect(railRoutes('pouch', 'pro').map((r) => r.id)).toContain('test-only');
    expect(railRoutes('pouch', 'simple').map((r) => r.id)).not.toContain('test-only');
  });
});

describe('fuzzy matcher', () => {
  it('rejects a non-subsequence', () => {
    expect(fuzzy('zzz', 'Dashboard')).toBeNull();
  });

  it('matches a subsequence and reports hit positions', () => {
    const m = fuzzy('dsh', 'Dashboard');
    expect(m).not.toBeNull();
    expect(m!.hits).toEqual([0, 2, 3]); // D-a-s-h
  });

  it('ranks a prefix above a scattered match', () => {
    const prefix = fuzzy('sen', 'Send')!;
    const scattered = fuzzy('sen', 'Settings Network')!;
    expect(prefix.score).toBeGreaterThan(scattered.score);
  });

  it('ranks an exact short title above a longer one containing it', () => {
    const short = fuzzy('send', 'Send')!;
    const long = fuzzy('send', 'Confirm Send Transaction')!;
    expect(short.score).toBeGreaterThan(long.score);
  });

  it('rewards word-start matches across words', () => {
    const acronym = fuzzy('ks', 'Key Ceremony Setup');
    expect(acronym).not.toBeNull();
  });

  it('treats an empty query as a neutral match', () => {
    expect(fuzzy('', 'anything')).toEqual({ score: 0, hits: [] });
  });

  it('is case-insensitive', () => {
    expect(fuzzy('DASH', 'Dashboard')).not.toBeNull();
  });
});

describe('linkage map route', () => {
  it('is reachable from the newcomer level — it is the map of the product', () => {
    expect(visibleRoutes('simple').map((r) => r.id)).toContain('linkage');
  });

  it('sits in the pouch tier, where the diagram puts the collection', () => {
    expect(getRoute('linkage')?.tier).toBe('pouch');
  });

  it('is findable by what people would actually type', () => {
    for (const q of ['linkage', 'map', 'architecture', 'diagram']) {
      const hit = visibleRoutes('simple').some(
        (r) => r.id === 'linkage' && (fuzzy(q, r.title) || (r.keywords ?? []).some((k) => fuzzy(q, k))),
      );
      expect(hit, `"${q}" should find the linkage map`).toBe(true);
    }
  });
});

describe('wallet creation entry', () => {
  it('offers the chain picker at the newcomer level', () => {
    // "Create New Wallet" from the red pill lands here, so it must be
    // reachable without first raising the disclosure level.
    expect(visibleRoutes('simple').map((r) => r.id)).toContain('create-select');
  });

  it('places chain setup in the modules tier', () => {
    expect(getRoute('create-select')?.tier).toBe('modules');
  });

  it('is findable by every chain it can create', () => {
    const route = getRoute('create-select');
    expect(route).toBeDefined();
    for (const q of ['algorand', 'bitcoin', 'solana', 'arweave', 'evm', 'create']) {
      const found = (route!.keywords ?? []).some((k) => fuzzy(q, k));
      expect(found, `"${q}" should reach the chain picker`).toBe(true);
    }
  });
});
