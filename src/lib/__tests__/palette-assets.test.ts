// 0.3.3: Algorand assets in the command palette — Algorand only, classified, verified first.
import { describe, it, expect, vi } from 'vitest';

vi.mock('../algorand/assets', () => ({
  searchAssets: vi.fn(async () => [
    { assetId: 31566704, unitName: 'USDC', name: 'USDC', decimals: 6, hasFreezeAddr: true, hasClawbackAddr: false },
    { assetId: 777, unitName: 'PRSC', name: 'Parsec Points', decimals: 0, hasFreezeAddr: false, hasClawbackAddr: false },
    { assetId: 666, unitName: 'UЅDС', name: 'USD Coin', decimals: 6, hasFreezeAddr: false, hasClawbackAddr: false },
  ]),
}));

const { isAssetQuery, instantAssetHits, indexerAssetHits, describeHit, setAssetFocus, takeAssetFocus } = await import('../ui/palette-assets');

describe('Algorand assets in the palette', () => {
  it('searches on an ASA id or two characters', () => {
    expect(isAssetQuery('31566704')).toBe(true);
    expect(isAssetQuery('us')).toBe(true);
    expect(isAssetQuery('u')).toBe(false);
  });

  it('shows verified matches at once, labelled Algorand', () => {
    const hits = instantAssetHits('circle', 'mainnet');
    expect(hits.map((h) => h.assetId)).toEqual([31566704]);
    expect(describeHit(hits[0])).toMatchObject({ badge: '✓ Verified · Circle', tone: 'ok' });
    expect(describeHit(hits[0]).detail).toBe('Algorand mainnet · ASA 31566704');
  });

  it('classifies the indexer’s results, lookalikes before strangers, minus what is shown', async () => {
    const hits = await indexerAssetHits('usdc', 'mainnet', new Set([31566704]));
    expect(hits.map((h) => [h.assetId, h.cls.kind])).toEqual([[666, 'lookalike'], [777, 'unverified']]);
    const d = describeHit(hits[0]);
    expect(d.tone).toBe('danger');
    expect(d.badge).toBe('⚠ Not USDC');
    expect(d.detail.startsWith('Algorand mainnet · ASA 666')).toBe(true);
  });

  it('every result is an Algorand asset on the searched network', async () => {
    const hits = [...instantAssetHits('usd', 'mainnet'), ...(await indexerAssetHits('usd', 'mainnet', new Set()))];
    for (const h of hits) {
      expect(h.network).toBe('mainnet');
      expect(describeHit(h).detail).toMatch(/^Algorand mainnet · ASA \d+/);
    }
  });

  it('hands the chosen asset to ADD ASSETS exactly once', () => {
    setAssetFocus(42);
    expect(takeAssetFocus()).toBe(42);
    expect(takeAssetFocus()).toBeNull();
  });
});
