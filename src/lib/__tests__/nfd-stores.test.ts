import { describe, it, expect, vi } from 'vitest';
vi.mock('../platform', () => ({ isTauri: false, invoke: vi.fn() }));
const { tierFor, bankonFeeMicro, canonicalListing, cleanLabels, usd, stepTerms } = await import('../nfd/stores');

describe('.algo stores — the same rules as the registry', () => {
  it('tiers by length', () => {
    expect(tierFor('ai')).toBe('premium');
    expect(tierFor('abc')).toBe('premium');
    expect(tierFor('abcd')).toBe('valuable');
    expect(tierFor('alice')).toBe('standard');
  });

  it('fee: 5 % with a $0.10 floor', () => {
    expect(bankonFeeMicro(50_000_000)).toBe(2_500_000);
    expect(bankonFeeMicro(3_000_000)).toBe(150_000);
    expect(bankonFeeMicro(1_000_000)).toBe(100_000);
  });

  it('canonical bytes match Python json.dumps(sort_keys=True, separators=(",", ":"))', () => {
    const bytes = canonicalListing({
      network: 'mainnet', parent: 'mindx.algo', owner: 'A', payout: 'B',
      tiers: { standard: 3_000_000, premium: 50_000_000, valuable: 15_000_000 },
      reserved: ['admin'], featured: [], issued_at: '2026-10-01T00:00:00Z',
    });
    // Produced by the registry's canonical_listing() for the same listing.
    expect(new TextDecoder().decode(bytes)).toBe('PARSEC store listing v1\n{"featured":[],"issued_at":"2026-10-01T00:00:00Z","network":"mainnet","owner":"A","parent":"mindx.algo","payout":"B","reserved":["admin"],"tiers":{"premium":50000000,"standard":3000000,"valuable":15000000}}');
  });

  it('cleans label lists and formats USD', () => {
    expect(cleanLabels('Admin, root  bad label! x')).toEqual(['admin', 'root', 'bad', 'x']);
    expect(usd(3_000_000)).toBe('$3');
    expect(usd(150_000)).toBe('$0.15');
  });

  it('binds each payment of an order to its figures', () => {
    const order = {
      ref: 'abcdefghijklmnopqrstuvwx', network: 'mainnet' as const, name: 'alice.mindx.algo', parent: 'mindx.algo',
      label: 'alice', buyer: 'B'.repeat(58), payout: 'P'.repeat(58), price_micro_usd: 3_000_000,
      bankon_fee_micro_usd: 150_000, total_micro_usd: 3_150_000, state: 'quoted' as const,
      fee_settlement: null, settlement: null, mint_tx: null, held_until: null, created_at: '', updated_at: '',
    };
    const fee = stepTerms(order, 'fee');
    const price = stepTerms(order, 'pay');
    expect(fee).toMatchObject({ asset: '31566704', amount: '150000', payTo: null });
    expect(price).toMatchObject({ asset: '31566704', amount: '3000000', payTo: 'P'.repeat(58) });
    expect(fee.network).toMatch(/^algorand:wGHE2/);
    expect(stepTerms({ ...order, network: 'testnet' }, 'pay').asset).toBe('10458941');
  });
});
