import { describe, it, expect } from 'vitest';
import { standardAssets, standardAsset, lookalikeOf, searchStandard, displayName } from '../algorand/asset-whitelist';
import snapshot from '../algorand/asset-whitelist.snapshot.json';

type Snap = Record<string, { unitName: string; name: string; decimals: number; creator: string; freeze: string | null; clawback: string | null; deleted: boolean; peraTier?: string | null }>;

describe('the verified asset list', () => {
  it('lists USDC by Circle on mainnet with its creator pinned', () => {
    const usdc = standardAsset('mainnet', 31566704)!;
    expect(usdc).toMatchObject({ unitName: 'USDC', name: 'USDC', issuer: 'Circle', decimals: 6, freeze: true, clawback: false });
    expect(displayName(usdc)).toBe('USD Coin');
    expect(usdc.creator).toBe('2UEQTE5QDNXPI7M3TU44G6SYKLFWLPQO7EBZM7K7MHMQQMFI4QJPLHQFHM');
  });

  it('has unique ids, 58-character creators and at least one source per entry', () => {
    for (const net of ['mainnet', 'testnet'] as const) {
      const list = standardAssets(net);
      expect(new Set(list.map((a) => a.assetId)).size).toBe(list.length);
      for (const a of list) {
        expect(a.creator).toMatch(/^[A-Z2-7]{58}$/);
        expect(a.sources.length).toBeGreaterThan(0);
      }
    }
  });

  it('matches its committed snapshot field for field (re-derive with scripts/asa-whitelist-check.mjs)', () => {
    for (const net of ['mainnet', 'testnet'] as const) {
      const snap = (snapshot as unknown as Record<string, Snap>)[net];
      const list = standardAssets(net);
      expect(Object.keys(snap).map(Number).sort((x, y) => x - y)).toEqual(list.map((a) => a.assetId).sort((x, y) => x - y));
      for (const a of list) {
        const s = snap[String(a.assetId)];
        expect({ unitName: s.unitName, name: s.name, decimals: s.decimals, creator: s.creator, freeze: !!s.freeze, clawback: !!s.clawback, deleted: s.deleted })
          .toEqual({ unitName: a.unitName, name: a.name, decimals: a.decimals, creator: a.creator, freeze: a.freeze, clawback: a.clawback, deleted: false });
        if (net === 'mainnet') expect(['verified', 'trusted']).toContain(s.peraTier);
      }
    }
  });

  it('tells apart listed assets that share a ticker, by issuer and label', () => {
    const usdcs = standardAssets('mainnet').filter((a) => a.unitName === 'USDC');
    expect(usdcs.map((a) => a.assetId).sort((x, y) => x - y)).toEqual([31566704, 887407002]);
    expect(new Set(usdcs.map((a) => a.issuer)).size).toBe(usdcs.length);
    expect(new Set(usdcs.map(displayName)).size).toBe(usdcs.length);
  });

  it('offers testnet USDC on testnet and nothing on betanet', () => {
    expect(standardAssets('testnet').map((a) => a.assetId)).toEqual([10458941]);
    expect(standardAssets('betanet')).toEqual([]);
  });
});

describe('lookalikes', () => {
  it('flags an unlisted asset that borrows a listed ticker', () => {
    expect(lookalikeOf('mainnet', 999, 'USDC', 'Totally USDC')?.unitName).toBe('USDC');
    expect(lookalikeOf('mainnet', 1007352535, 'USDC', 'USD Coin')).toBeDefined();
  });

  it('never calls a listed asset a lookalike, even one sharing a ticker', () => {
    expect(lookalikeOf('mainnet', 31566704, 'USDC', 'USDC')).toBeUndefined();
    expect(lookalikeOf('mainnet', 887407002, 'USDC', 'USD Coin')).toBeUndefined();
    expect(lookalikeOf('mainnet', 1071084947, 'DAI', 'Dai Stablecoin')).toBeUndefined();
  });
});

describe('searchStandard', () => {
  it('finds verified assets by ticker, name, label, issuer or id', () => {
    expect(searchStandard('mainnet', 'circle').map((a) => a.assetId)).toEqual([31566704]);
    expect(searchStandard('mainnet', 'wormhole').map((a) => a.assetId).sort((x, y) => x - y)).toEqual([887406851, 887407002, 1058926737, 3495558025, 3495722210]);
    expect(searchStandard('mainnet', '386192725').map((a) => a.unitName)).toEqual(['goBTC']);
    expect(searchStandard('mainnet', 'eur').map((a) => a.unitName)).toEqual(['EURS']);
    expect(searchStandard('mainnet', '')).toEqual([]);
  });
});
