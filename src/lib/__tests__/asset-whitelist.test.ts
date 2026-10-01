import { describe, it, expect } from 'vitest';
import { standardAssets, standardAsset, lookalikeOf } from '../algorand/asset-whitelist';

describe('standard Algorand assets', () => {
  it('lists USDC by Circle on mainnet with its creator pinned', () => {
    const usdc = standardAsset('mainnet', 31566704)!;
    expect(usdc).toMatchObject({ unitName: 'USDC', issuer: 'Circle', decimals: 6 });
    expect(usdc.creator).toHaveLength(58);
  });

  it('has unique ids and 58-character creators on mainnet', () => {
    const list = standardAssets('mainnet');
    expect(new Set(list.map((a) => a.assetId)).size).toBe(list.length);
    for (const a of list) expect(a.creator).toMatch(/^[A-Z2-7]{58}$/);
  });

  it('flags an asset that borrows a listed ticker under another id', () => {
    expect(lookalikeOf('mainnet', 999, 'USDC', 'Totally USDC')?.assetId).toBe(31566704);
    expect(lookalikeOf('mainnet', 31566704, 'USDC', 'USD Coin')).toBeUndefined();
    expect(lookalikeOf('mainnet', 1071084947, 'DAI', 'Dai Stablecoin')).toBeUndefined();
  });

  it('offers testnet USDC on testnet and nothing on betanet', () => {
    expect(standardAssets('testnet').map((a) => a.assetId)).toEqual([10458941]);
    expect(standardAssets('betanet')).toEqual([]);
  });
});

describe('searchStandard', () => {
  it('finds verified assets by ticker, name, issuer or id', async () => {
    const { searchStandard } = await import('../algorand/asset-whitelist');
    expect(searchStandard('mainnet', 'usd').map((a) => a.unitName)).toEqual(['USDC', 'USDt']);
    expect(searchStandard('mainnet', 'circle').map((a) => a.assetId)).toEqual([31566704]);
    expect(searchStandard('mainnet', '386192725').map((a) => a.unitName)).toEqual(['goBTC']);
    expect(searchStandard('mainnet', 'eur').map((a) => a.unitName)).toEqual(['EURS']);
    expect(searchStandard('mainnet', '')).toEqual([]);
  });
});
