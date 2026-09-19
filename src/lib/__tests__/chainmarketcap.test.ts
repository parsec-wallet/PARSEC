import { describe, it, expect } from 'vitest';
import { parseChain, parseRegistry, sanitizeRpcs, searchChains, type EvmChain } from '../chainmarketcap';

const ETHEREUM = {
  name: 'Ethereum Mainnet',
  chainId: 1,
  shortName: 'eth',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpc: ['https://eth.llamarpc.com', 'wss://eth.drpc.org', 'https://mainnet.infura.io/v3/${INFURA_API_KEY}'],
  explorers: [{ name: 'etherscan', url: 'https://etherscan.io' }],
};

describe('chain registry parsing', () => {
  it('parses a well-formed entry', () => {
    const c = parseChain(ETHEREUM)!;
    expect(c.chainId).toBe(1);
    expect(c.symbol).toBe('ETH');
    expect(c.decimals).toBe(18);
    expect(c.explorer).toBe('https://etherscan.io');
  });

  it('drops RPCs that would not work or would leak a placeholder', () => {
    // Showing a participant a URL containing ${INFURA_API_KEY} is worse than
    // showing none, and websockets are not what this reference offers.
    const rpcs = sanitizeRpcs(ETHEREUM.rpc);
    expect(rpcs).toEqual(['https://eth.llamarpc.com']);
    expect(rpcs.some((r) => r.includes('${'))).toBe(false);
    expect(rpcs.some((r) => r.startsWith('wss'))).toBe(false);
  });

  it('caps how many RPCs it will offer', () => {
    const many = Array.from({ length: 20 }, (_, i) => `https://rpc${i}.example`);
    expect(sanitizeRpcs(many)).toHaveLength(4);
  });

  it('rejects entries that are not usable', () => {
    expect(parseChain(null)).toBeNull();
    expect(parseChain({})).toBeNull();
    expect(parseChain({ chainId: 1 })).toBeNull();          // no name
    expect(parseChain({ name: 'X' })).toBeNull();            // no chainId
    expect(parseChain({ name: 'X', chainId: 0 })).toBeNull(); // chainId 0
    expect(parseChain({ name: 'X', chainId: 'abc' })).toBeNull();
  });

  it('discards bad entries rather than failing the whole registry', () => {
    // One malformed row in 2,500 must not cost the participant the other 2,499.
    const chains = parseRegistry([ETHEREUM, null, {}, { name: 'Y', chainId: 5 }]);
    expect(chains.map((c) => c.chainId)).toEqual([1, 5]);
  });

  it('returns empty for a non-array payload', () => {
    expect(parseRegistry(null)).toEqual([]);
    expect(parseRegistry({ chains: [] })).toEqual([]);
  });

  it('defaults decimals sensibly when absent', () => {
    expect(parseChain({ name: 'X', chainId: 9 })!.decimals).toBe(18);
  });

  it('only accepts https explorers', () => {
    const c = parseChain({ ...ETHEREUM, explorers: [{ url: 'http://insecure.example' }] })!;
    expect(c.explorer).toBeUndefined();
  });
});

describe('search', () => {
  const chains: EvmChain[] = [
    { chainId: 1, name: 'Ethereum Mainnet', shortName: 'eth', symbol: 'ETH', decimals: 18, rpc: [] },
    { chainId: 8453, name: 'Base', shortName: 'base', symbol: 'ETH', decimals: 18, rpc: [] },
    { chainId: 137, name: 'Polygon Mainnet', shortName: 'matic', symbol: 'POL', decimals: 18, rpc: [] },
  ];

  it('matches on name, short name, symbol and exact chain id', () => {
    expect(searchChains(chains, 'base').map((c) => c.chainId)).toEqual([8453]);
    expect(searchChains(chains, 'matic').map((c) => c.chainId)).toEqual([137]);
    expect(searchChains(chains, 'POL').map((c) => c.chainId)).toEqual([137]);
    expect(searchChains(chains, '8453').map((c) => c.chainId)).toEqual([8453]);
  });

  it('matches a symbol shared by several chains', () => {
    expect(searchChains(chains, 'eth')).toHaveLength(2);
  });

  it('returns everything for an empty query', () => {
    expect(searchChains(chains, '   ')).toHaveLength(3);
  });
});
