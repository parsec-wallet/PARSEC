// PARSEC Wallet — what the store holds for an unlocked desktop session.
//
// On the desktop the passphrase opens the vault in the PARSEC Keycore and is not kept in
// JavaScript afterwards: every signature is made in Rust from the open session. The store
// keeps this marker instead, so "is the wallet unlocked?" checks still work. It is not a
// secret and never unlocks anything — `keystoreUnlock` refuses it before it reaches Rust,
// where a wrong passphrase would count against the attempt limiter.

export const KEYCORE_SESSION = '__keycore_session__';

/** True for the values the store holds in place of a passphrase. */
export function isSessionMarker(p: string | null | undefined): boolean {
  return p === KEYCORE_SESSION || p === '__watch_only__';
}
