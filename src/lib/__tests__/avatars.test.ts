// Account avatars — the deterministic default picker is what store.ts's
// migrateAccount() calls to backfill an avatar on every persisted account.

import { describe, it, expect } from 'vitest';
import { ACCOUNT_AVATARS, defaultAvatarFor } from '../avatars';

describe('defaultAvatarFor', () => {
  it('returns an emoji from the palette', () => {
    expect(ACCOUNT_AVATARS).toContain(defaultAvatarFor('ALGORANDADDRESSEXAMPLE'));
  });

  it('is deterministic for the same seed', () => {
    expect(defaultAvatarFor('ABC123XYZ')).toBe(defaultAvatarFor('ABC123XYZ'));
  });

  it('spreads across the palette for different seeds', () => {
    const seeds = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];
    const picked = new Set(seeds.map(defaultAvatarFor));
    expect(picked.size).toBeGreaterThan(1);
  });

  it('handles an empty seed without throwing', () => {
    expect(ACCOUNT_AVATARS).toContain(defaultAvatarFor(''));
  });
});
