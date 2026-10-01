// Minimal ABI encoding for the Base ARIO bridge — the token's `burn(uint256 amount, string destination)`
// and `balanceOf(address)`. Pure functions, no EVM library: parsec carries no viem/ethers.

import { isSolanaAddress } from '../../solana/address';
import { BURN_SELECTOR, BALANCE_OF_SELECTOR } from '../constants';

const WORD = 32;

function hexWord(n: bigint): string {
  if (n < 0n) throw new Error('negative uint256');
  const h = n.toString(16);
  if (h.length > WORD * 2) throw new Error('uint256 overflow');
  return h.padStart(WORD * 2, '0');
}

function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

function bytesHex(b: Uint8Array): string {
  let s = '';
  for (const x of b) s += x.toString(16).padStart(2, '0');
  return s;
}

/** `solana:<base58>` — the bridge service's `destinationFormat`. */
export function formatDestination(solanaAddress: string): string {
  const a = solanaAddress.trim();
  if (!isSolanaAddress(a)) throw new Error('Destination must be a base58 Solana address');
  return `solana:${a}`;
}

/** ABI-encode a dynamic `string` argument: [offset][len][data padded to 32]. */
function encodeStringTail(s: string): { len: string; data: string } {
  const b = utf8(s);
  const padded = Math.ceil(b.length / WORD) * WORD;
  return { len: hexWord(BigInt(b.length)), data: bytesHex(b).padEnd(padded * 2, '0') };
}

/** Calldata for `burn(uint256 amount, string destination)`. */
export function encodeBurnCalldata(amountRaw: bigint, destination: string): string {
  if (amountRaw <= 0n) throw new Error('burn amount must be positive');
  if (!destination.startsWith('solana:')) throw new Error('destination must be "solana:<address>"');
  const { len, data } = encodeStringTail(destination);
  // head: amount, offset-to-string (2 words = 0x40); tail: len, bytes
  return BURN_SELECTOR + hexWord(amountRaw) + hexWord(BigInt(2 * WORD)) + len + data;
}

/** Calldata for `balanceOf(address)`. */
export function encodeBalanceOf(address: string): string {
  const a = address.trim().toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(a)) throw new Error('invalid EVM address');
  return BALANCE_OF_SELECTOR + a.slice(2).padStart(WORD * 2, '0');
}

/** Decode a single uint256 return word. Empty/`0x` → 0n. */
export function decodeUint256(hex: string): bigint {
  const h = (hex ?? '0x').trim();
  if (h === '0x' || h === '') return 0n;
  if (!/^0x[0-9a-fA-F]+$/.test(h)) throw new Error('invalid hex word');
  return BigInt(h);
}

export function isEvmAddress(s: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(s.trim());
}
