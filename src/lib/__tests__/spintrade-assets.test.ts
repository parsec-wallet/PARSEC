// 0.3.4: SPINTRADE identifies assets by id; a lookalike is never shown as verified.
import { describe, it, expect } from 'vitest';
import { swapStatus, isTrusted, assetLabel, statusBadge, confirmationFor, poolRank } from '../dex/spintrade-assets';
import { standardAssets } from '../algorand/asset-whitelist';

const USDC = { assetId: 31566704, unitName: 'USDC', name: 'USDC' };
const FAKE = { assetId: 123, unitName: 'UЅDС', name: 'USD Coin' };
const STRANGER = { assetId: 456, unitName: 'PRSC', name: 'Parsec Points' };

describe('SPINTRADE asset authority', () => {
  it('names every asset by ticker and id; ALGO is native', () => {
    expect(assetLabel(USDC)).toBe('USDC (ASA 31566704)');
    expect(assetLabel({ assetId: 0, unitName: 'ALGO', name: 'Algorand' })).toBe('ALGO');
    expect(swapStatus('mainnet', { assetId: 0, unitName: 'ALGO', name: '' }).kind).toBe('native');
  });

  it('marks verified only by id; lookalikes and strangers need an acknowledgement', () => {
    expect(statusBadge(swapStatus('mainnet', USDC))).toEqual({ text: '✓ verified · Circle', tone: 'ok' });
    expect(confirmationFor(swapStatus('mainnet', USDC), USDC)).toBeNull();
    const f = swapStatus('mainnet', FAKE);
    expect(statusBadge(f)).toEqual({ text: '⚠ not USDC', tone: 'danger' });
    expect(confirmationFor(f, FAKE)).toContain('is NOT USD Coin (ASA 31566704, Circle)');
    expect(confirmationFor(swapStatus('mainnet', STRANGER), STRANGER)).toContain('not on PARSEC');
  });

  it('never presents a disguised listed asset as verified on any SPINTRADE surface', () => {
    for (const a of standardAssets('mainnet')) {
      const copy = { assetId: a.assetId + 1_000_000_000_000, unitName: a.unitName.toUpperCase().split('').join(' '), name: a.name };
      const s = swapStatus('mainnet', copy);
      expect(isTrusted(s), assetLabel(copy)).toBe(false);
      expect(statusBadge(s).tone).toBe('danger');
      expect(confirmationFor(s, copy)).not.toBeNull();
    }
  });

  it('orders pools: USDC, then verified, unverified, lookalikes', () => {
    const rank = (a: typeof USDC) => poolRank(swapStatus('mainnet', a), a.assetId, 31566704);
    const goBtc = { assetId: 386192725, unitName: 'goBTC', name: 'goBTC' };
    expect([FAKE, STRANGER, goBtc, USDC].sort((x, y) => rank(x) - rank(y)).map((a) => a.assetId)).toEqual([31566704, 386192725, 456, 123]);
  });
});
