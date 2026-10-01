// Account avatars — every wallet account gets an emoji avatar, the way
// Phantom personalizes accounts. The default is picked deterministically
// from the account address so it is stable across reloads and devices.

export const ACCOUNT_AVATARS = [
  '🦊', '🐙', '🦉', '🐬', '🦅', '🐲',
  '🦁', '🐺', '🦄', '🐝', '🦋', '🐢',
] as const;

/** Deterministic avatar for an account, derived from a stable seed string
 *  (its address) so existing accounts get a consistent emoji. */
export function defaultAvatarFor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  return ACCOUNT_AVATARS[Math.abs(hash) % ACCOUNT_AVATARS.length];
}
