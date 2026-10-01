// Solana address: base58-encoded 32-byte ed25519 public key.
// Bitcoin alphabet (no I, l, 0, O). Implementation is purely numeric; no
// runtime deps. Solana addresses are 32 bytes → 43-44 chars in base58.

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export function base58Encode(bytes: Uint8Array): string {
  if (bytes.length === 0) return '';

  // Leading zero bytes become leading '1' chars (one '1' per leading 0x00).
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;

  // Convert big-endian byte array to a big integer, then to base-58.
  const size = Math.ceil(bytes.length * 138 / 100) + 1; // log(256)/log(58) ≈ 1.366
  const buf = new Uint8Array(size);
  let length = 0;
  for (let i = zeros; i < bytes.length; i++) {
    let carry = bytes[i];
    let j = 0;
    for (let k = size - 1; (carry !== 0 || j < length) && k >= 0; k--, j++) {
      carry += 256 * buf[k];
      buf[k] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    if (carry !== 0) throw new Error('base58 encoding overflow');
    length = j;
  }

  // Strip leading zeros from the converted buffer.
  let it = size - length;
  while (it < size && buf[it] === 0) it++;

  let result = '1'.repeat(zeros);
  for (; it < size; it++) result += ALPHABET[buf[it]];
  return result;
}

export function base58Decode(s: string): Uint8Array {
  if (s.length === 0) return new Uint8Array(0);

  // Leading '1' chars are leading zero bytes.
  let zeros = 0;
  while (zeros < s.length && s[zeros] === '1') zeros++;

  const size = Math.ceil(s.length * 733 / 1000) + 1; // log(58)/log(256) ≈ 0.733
  const buf = new Uint8Array(size);
  let length = 0;
  for (let i = zeros; i < s.length; i++) {
    const idx = ALPHABET.indexOf(s[i]);
    if (idx < 0) throw new Error(`Invalid base58 char "${s[i]}" at position ${i}`);
    let carry = idx;
    let j = 0;
    for (let k = size - 1; (carry !== 0 || j < length) && k >= 0; k--, j++) {
      carry += 58 * buf[k];
      buf[k] = carry & 0xff;
      carry >>= 8;
    }
    if (carry !== 0) throw new Error('base58 decoding overflow');
    length = j;
  }

  let it = size - length;
  while (it < size && buf[it] === 0) it++;

  const out = new Uint8Array(zeros + (size - it));
  for (let i = 0; i < zeros; i++) out[i] = 0;
  for (let i = zeros; it < size; i++, it++) out[i] = buf[it];
  return out;
}

/** Validate a Solana base58 address: 32 bytes, valid alphabet, typical 43-44 chars. */
export function isSolanaAddress(s: string): boolean {
  if (typeof s !== 'string') return false;
  if (s.length < 32 || s.length > 44) return false;
  try {
    const bytes = base58Decode(s);
    return bytes.length === 32;
  } catch {
    return false;
  }
}
