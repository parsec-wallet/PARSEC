import { describe, it, expect } from 'vitest';
import { provenanceLine, REACH_WORD } from '../provenance';

describe('provenance line', () => {
  it('names origin, freshness and reach', () => {
    const line = provenanceLine({ source: 'live', origin: 'coingecko.com', readAt: 0, reach: 'external' });
    expect(line).toContain('coingecko.com');
    expect(line).toContain('live');
    expect(line).toContain('external service');
  });

  it('marks a local reading as staying on the device', () => {
    const line = provenanceLine({ source: 'cached', origin: 'local wallet state', reach: 'internal' });
    expect(line).toContain('this device');
    expect(line).not.toContain('external');
  });

  it('defaults to external when reach is unstated', () => {
    // Assuming a reading stayed local when it did not is the mistake with
    // consequences, so the unmarked case must take the cautious side.
    expect(provenanceLine({ source: 'live', origin: 'x' })).toContain('external service');
  });

  it('distinguishes freshness from reach — they are independent', () => {
    // A cached value can still have come from a third party.
    const cachedExternal = provenanceLine({ source: 'cached', reach: 'external' });
    expect(cachedExternal).toContain('cached');
    expect(cachedExternal).toContain('external service');
    // And a live value can be computed entirely on device.
    const liveInternal = provenanceLine({ source: 'live', reach: 'internal' });
    expect(liveInternal).toContain('live');
    expect(liveInternal).toContain('this device');
  });

  it('says it is still reading when there is no read time', () => {
    expect(provenanceLine({ source: 'live' })).toContain('reading…');
  });

  it('exposes both reach words', () => {
    expect(REACH_WORD.internal).toBe('this device');
    expect(REACH_WORD.external).toBe('external service');
  });
});
