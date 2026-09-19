// Parsec Wallet — Algorand display formatting.
//
// Deliberately dependency-free. These two helpers are used in ~45 places, and
// while they lived in `account.ts` — which statically imports `algosdk` — every
// one of those call sites dragged ~492 kB of SDK into its chunk, including the
// first-paint path. Nothing here needs a chain library to divide by a million.

/** Format microAlgos as ALGO. */
export function microAlgosToAlgo(microAlgos: number, decimals = 6): string {
  return (microAlgos / 1_000_000).toFixed(decimals);
}

/** Shorten an address for display (first6…last4). */
export function truncateAddress(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

/** Format a raw ASA amount using its decimals. */
export function formatAssetAmount(amount: number, decimals?: number): string {
  const d = decimals ?? 6;
  if (d === 0) return String(amount);
  return (amount / Math.pow(10, d)).toFixed(Math.min(d, 6));
}
