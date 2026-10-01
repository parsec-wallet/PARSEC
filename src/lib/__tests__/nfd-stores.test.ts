import { describe, it, expect, vi } from 'vitest';
vi.mock('../platform', () => ({ isTauri: false, invoke: vi.fn() }));
const { tierFor, bankonFeeMicro, canonicalListing, cleanLabels, usd, stepTerms, fullName, labelValid } = await import('../nfd/stores');

describe('.algo stores — the same rules as the registry', () => {
  it('tiers by length', () => {
    expect(tierFor('ai')).toBe('premium');
    expect(tierFor('abc')).toBe('premium');
    expect(tierFor('abcd')).toBe('valuable');
    expect(tierFor('alice')).toBe('standard');
  });

  it('BANKON facilitation fee: 10 % with a $0.05 floor — the same figures as the registry', () => {
    expect(bankonFeeMicro(50_000_000)).toBe(5_000_000);   // $50 → $5
    expect(bankonFeeMicro(15_000_000)).toBe(1_500_000);   // $15 → $1.50
    expect(bankonFeeMicro(3_000_000)).toBe(300_000);      // $3 → $0.30
    expect(bankonFeeMicro(500_000)).toBe(50_000);         // the floor
    expect(bankonFeeMicro(0)).toBe(50_000);
    // Integer micro-USD throughout: no fraction of a cent is ever invented.
    expect(bankonFeeMicro(3_333_333)).toBe(333_333);
  });

  it('ArNS stores: undername names, labels, and payment on Algorand mainnet', () => {
    expect(fullName('arns', 'bankon', 'alice')).toBe('alice_bankon');
    expect(fullName('mainnet', 'mindx.algo', 'alice')).toBe('alice.mindx.algo');
    expect(labelValid('arns', 'my-shop')).toBe(true);
    expect(labelValid('arns', '-x')).toBe(false);
    expect(labelValid('mainnet', 'my-shop')).toBe(false);
    expect(cleanLabels('Shop, my-shop admin', 'arns')).toEqual(['shop', 'my-shop', 'admin']);
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
      bankon_fee_micro_usd: 300_000, total_micro_usd: 3_300_000, state: 'quoted' as const,
      fee_settlement: null, settlement: null, mint_tx: null, held_until: null, created_at: '', updated_at: '',
    };
    const fee = stepTerms(order, 'fee');
    const price = stepTerms(order, 'pay');
    expect(fee).toMatchObject({ asset: '31566704', amount: '300000', payTo: null });
    expect(price).toMatchObject({ asset: '31566704', amount: '3000000', payTo: 'P'.repeat(58) });
    expect(fee.network).toMatch(/^algorand:wGHE2/);
    expect(stepTerms({ ...order, network: 'testnet' }, 'pay').asset).toBe('10458941');
    expect(stepTerms({ ...order, network: 'arns' }, 'pay')).toMatchObject({ asset: '31566704', payTo: 'P'.repeat(58) });
  });
});
