import { describe, it, expect } from 'vitest';

import { NFD_API_BASE, NFD_SITE, nfdApiBase } from '../constants';

describe('NFD endpoints', () => {
  it('mainnet and testnet have separate registries; betanet shares testnet', () => {
    expect(NFD_API_BASE.mainnet).toBe('https://api.nf.domains');
    expect(NFD_API_BASE.testnet).toBe('https://api.testnet.nf.domains');
    expect(NFD_API_BASE.betanet).toBe(NFD_API_BASE.testnet);
    expect(NFD_SITE).toBe('https://app.nf.domains');
  });

  it('nfdApiBase falls back to mainnet for an unknown network', () => {
    expect(nfdApiBase('testnet')).toBe(NFD_API_BASE.testnet);
    expect(nfdApiBase('nope' as 'mainnet')).toBe(NFD_API_BASE.mainnet);
  });
});
