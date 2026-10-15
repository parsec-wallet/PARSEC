import { describe, expect, it } from 'vitest';
import { costMicroUsd, formatUsd, markupCeiling, markupMicroUsd, quoteSmartDomain, smartDomainQuery, type SmartDomainDeps } from '../smart-domain';

const COST = 17_437_772_000n; // thrusttnt permabuy, mARIO (live 2026-10-15)
const RATE = 1_547n;          // micro-USD per ARIO ($0.001547)

describe('smartDomainQuery — a name in what was typed', () => {
  it('reads names, ar:// links and gateway hosts', () => {
    expect(smartDomainQuery('thrusttnt')).toBe('thrusttnt');
    expect(smartDomainQuery(' ThrustTNT.ar.io ')).toBe('thrusttnt');
    expect(smartDomainQuery('ar://thrusttnt')).toBe('thrusttnt');
    expect(smartDomainQuery('https://thrusttnt.ar.io/')).toBe('thrusttnt');
    expect(smartDomainQuery('pythai-gw')).toBe('pythai-gw');
  });
  it('refuses extensions, other domains, bad shapes and 43-char ids', () => {
    for (const q of ['tnt_spintrade', 'example.com', '-x', 'x-', 'a b', '', 'x'.repeat(43), 'x'.repeat(52)]) expect(smartDomainQuery(q)).toBeNull();
  });
});

describe('the set.price', () => {
  it('markup is φ% of the cost, exact, never rounded up — the server computes the same', () => {
    const m = markupMicroUsd(COST, RATE);
    // 17,437.772 ARIO × $0.001547 × 0.01618033988749894848 = $0.43648…, truncated at the micro-USD
    expect(m * 10n ** 26n <= COST * RATE * 1618033988749894848n).toBe(true);
    expect((m + 1n) * 10n ** 26n > COST * RATE * 1618033988749894848n).toBe(true);
    expect(costMicroUsd(COST, RATE)).toBe(26_976_234n);
  });
  it('the ceiling allows prices moving a little, not a different fee', () => {
    expect(markupCeiling(436_485n)).toBe(436_485n + 21_824n + 1_000n);
  });
  it('formats up to the cent', () => {
    expect(formatUsd(26_976_234n + 436_485n)).toBe('$27.42');
    expect(formatUsd(1n)).toBe('$0.01');
  });
});

describe('quoteSmartDomain', () => {
  const deps = (over: Partial<SmartDomainDeps> = {}): SmartDomainDeps => ({
    getRecord: async () => null, isReserved: async () => false, permabuyCost: async () => COST, arioUsdMicro: async () => RATE, ...over,
  });
  it('free → one set.price = cost + markup', async () => {
    const q = await quoteSmartDomain('thrusttnt', deps());
    expect(q.available).toBe(true);
    expect(q.setPriceMicroUsd).toBe(costMicroUsd(COST, RATE) + markupMicroUsd(COST, RATE));
  });
  it('taken or reserved is not for sale', async () => {
    expect((await quoteSmartDomain('ardrive', deps({ getRecord: async () => ({}) }))).available).toBe(false);
    expect((await quoteSmartDomain('www', deps({ isReserved: async () => true }))).reserved).toBe(true);
  });
  it('no ARIO price → no USD price shown, nothing invented', async () => {
    const q = await quoteSmartDomain('thrusttnt', deps({ arioUsdMicro: async () => null }));
    expect(q.setPriceMicroUsd).toBeNull();
    expect(q.costMario).toBe(COST);
  });
});
