import { describe, it, expect, vi } from 'vitest';
vi.mock('../platform', () => ({ isTauri: false, invoke: vi.fn() }));
const { openSteps } = await import('../ui/x402-ready');

describe('x402 readiness', () => {
  it('a fresh account needs ALGO, the opt-in and USDC', () => {
    expect(openSteps({ algoSpendable: 0, optedIn: false, usdc: 0n })).toEqual(['algo', 'optin', 'usdc']);
  });
  it('funded with ALGO, it needs the opt-in and USDC', () => {
    expect(openSteps({ algoSpendable: 99_900_000, optedIn: false, usdc: 0n })).toEqual(['optin', 'usdc']);
  });
  it('opted in and holding USDC, it is ready', () => {
    expect(openSteps({ algoSpendable: 0, optedIn: true, usdc: 1_000_000n })).toEqual([]);
  });
});
