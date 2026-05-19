// ANS-104 DataItem encoding, signing, and verification — Parsec-owned.
//
// AO messages are signed DataItems per ANS-104 v1 (RSA-PSS signature type = 1).
// We vendor the canonical algorithm here so Parsec is the keystore of record:
// every byte that touches a vault-held JWK is code we control. No arbundles
// dependency. Spec: https://github.com/ArweaveTeam/arweave-standards/blob/master/ans/ANS-104.md
//
// Binary layout (signature type = 1, RSA-PSS, 512-byte sig, 512-byte owner):
//   [0..2)      signature type (LE u16)        = 1
//   [2..514)    signature                       (512 bytes, zeroed before signing)
//   [514..1026) owner (RSA public modulus n)    (512 bytes, raw)
//   [1026..)    target present byte
//                 1 → 32-byte target follows
//                 0 → no target
//                next: anchor present byte
//                 1 → 32-byte anchor follows
//                 0 → no anchor
//                next: tags count (LE u64) + tags bytes length (LE u64) + tags Avro bytes
//                next: data bytes
//
// The signed payload is a deep-hash over a fixed list of fields per the spec
// (NOT the binary above) — see dataItemSignatureData().

import { addressFromJwk, base64urlToBytes, bytesToBase64url, parseJwk, type ArweaveJwk } from './jwk';
import { keystoreRetrieve } from '../keystore';

export interface DataItemTag {
  name: string;
  value: string;
}

export interface DataItemInput {
  /** Owner: base64url RSA modulus `n` (matches Arweave Transaction.owner). */
  owner: string;
  /** Optional recipient address (43-char base64url). */
  target?: string;
  /** Optional anchor (32 bytes, base64url-encoded). */
  anchor?: string;
  tags?: DataItemTag[];
  /** Raw bytes or UTF-8 string. */
  data: Uint8Array | string;
}

export interface SignedDataItem {
  /** Full ANS-104 binary, ready to POST to AO MU or to bundle. */
  raw: Uint8Array;
  /** SHA-256 of the signature, base64url-encoded. The DataItem id. */
  id: string;
  /** base64url-encoded signature. */
  signature: string;
  /** base64url-encoded owner (= input owner). */
  owner: string;
}

const SIG_TYPE_RSA_PSS = 1;
const RSA_PSS_SIG_LENGTH = 512;
const RSA_PSS_OWNER_LENGTH = 512;

// ── Public API ───────────────────────────────────────────────

/**
 * Sign a DataItem with a JWK. Pure — no vault, no network. Caller is
 * responsible for zeroing the JWK after use.
 */
export async function signDataItem(
  input: DataItemInput,
  jwk: ArweaveJwk | JsonWebKey,
): Promise<SignedDataItem> {
  if (!jwk.n) throw new Error('JWK missing public modulus n');
  if (jwk.n !== input.owner) {
    throw new Error('DataItem owner does not match signing JWK');
  }

  const dataBytes = typeof input.data === 'string'
    ? new TextEncoder().encode(input.data)
    : input.data;

  const tags = input.tags ?? [];
  const tagsBytes = encodeTags(tags);

  // 1. Deep-hash the spec-defined field list.
  const sigData = await dataItemSignatureData({
    owner: input.owner,
    target: input.target,
    anchor: input.anchor,
    tagsBytes,
    data: dataBytes,
  });

  // 2. RSA-PSS sign with SHA-256 + 32-byte salt (Arweave convention).
  const cryptoKey = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'RSA-PSS', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sigBuf = await crypto.subtle.sign(
    { name: 'RSA-PSS', saltLength: 32 },
    cryptoKey,
    sigData as unknown as BufferSource,
  );
  const signature = new Uint8Array(sigBuf);
  if (signature.length !== RSA_PSS_SIG_LENGTH) {
    throw new Error(`Unexpected signature length ${signature.length}`);
  }

  // 3. id = SHA-256(signature), base64url.
  const idBuf = await crypto.subtle.digest('SHA-256', signature as unknown as BufferSource);
  const id = bytesToBase64url(new Uint8Array(idBuf));

  // 4. Assemble the binary DataItem.
  const ownerBytes = base64urlToBytes(input.owner);
  if (ownerBytes.length !== RSA_PSS_OWNER_LENGTH) {
    throw new Error(`Unexpected owner length ${ownerBytes.length}`);
  }
  const targetBytes = input.target ? base64urlToBytes(input.target) : null;
  const anchorBytes = input.anchor ? base64urlToBytes(input.anchor) : null;
  if (targetBytes && targetBytes.length !== 32) {
    throw new Error(`Unexpected target length ${targetBytes.length}`);
  }
  if (anchorBytes && anchorBytes.length !== 32) {
    throw new Error(`Unexpected anchor length ${anchorBytes.length}`);
  }

  const raw = assembleDataItem({
    signature,
    ownerBytes,
    targetBytes,
    anchorBytes,
    tagsCount: tags.length,
    tagsBytes,
    dataBytes,
  });

  return {
    raw,
    id,
    signature: bytesToBase64url(signature),
    owner: input.owner,
  };
}

/**
 * Retrieve the JWK from the vault, sign the DataItem, zero the plaintext JWK.
 * Mirrors signTxFromVault() in tx.ts.
 */
export async function signDataItemFromVault(
  address: string,
  passphrase: string,
  input: Omit<DataItemInput, 'owner'> & { owner?: string },
): Promise<SignedDataItem> {
  const secret = await keystoreRetrieve(address, passphrase);
  if (!secret) throw new Error(`No Arweave key in vault for ${address}`);
  let jwk: ArweaveJwk;
  try {
    jwk = parseJwk(secret);
  } catch {
    throw new Error('Vault secret for Arweave wallet must be a JWK JSON string');
  }
  try {
    const derived = await addressFromJwk(jwk);
    if (derived !== address) {
      throw new Error(`Vault JWK address (${derived}) does not match wallet ${address}`);
    }
    return await signDataItem({ ...input, owner: jwk.n! }, jwk);
  } finally {
    jwk.d = '';
    jwk.p = '';
    jwk.q = '';
    jwk.dp = '';
    jwk.dq = '';
    jwk.qi = '';
  }
}

/**
 * Verify a signed DataItem. Decodes the binary, recomputes deep-hash, checks
 * RSA-PSS signature against the owner's public key, and confirms the id.
 */
export async function verifyDataItem(raw: Uint8Array): Promise<boolean> {
  const parsed = decodeDataItem(raw);
  if (parsed.sigType !== SIG_TYPE_RSA_PSS) return false;

  // Use the raw tagsBytes the signer embedded in the binary, not a re-encoded
  // copy. Avro is canonical for our encoder but we still want to verify the
  // exact bytes that were signed.
  const sigData = await dataItemSignatureData({
    owner: parsed.owner,
    target: parsed.target,
    anchor: parsed.anchor,
    tagsBytes: parsed.tagsBytes,
    data: parsed.data,
  });

  const publicKey = await crypto.subtle.importKey(
    'jwk',
    { kty: 'RSA', n: parsed.owner, e: 'AQAB' },
    { name: 'RSA-PSS', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const ok = await crypto.subtle.verify(
    { name: 'RSA-PSS', saltLength: 32 },
    publicKey,
    parsed.signature as unknown as BufferSource,
    sigData as unknown as BufferSource,
  );
  return ok;
}

// ── Deep-hash (ANS-104 sig data) ─────────────────────────────
// Per spec, the signature is computed over deepHash of:
//   [ "dataitem", "1", "1", owner, target, anchor, tags, data ]
// Each leaf is hashed; lists hash by combining child hashes recursively.

export async function dataItemSignatureData(opts: {
  owner: string;
  target?: string;
  anchor?: string;
  tagsBytes: Uint8Array;
  data: Uint8Array;
}): Promise<Uint8Array> {
  const ownerBytes = base64urlToBytes(opts.owner);
  const targetBytes = opts.target ? base64urlToBytes(opts.target) : new Uint8Array(0);
  const anchorBytes = opts.anchor ? base64urlToBytes(opts.anchor) : new Uint8Array(0);

  return deepHash([
    new TextEncoder().encode('dataitem'),
    new TextEncoder().encode('1'),    // version
    new TextEncoder().encode('1'),    // signature type (RSA-PSS)
    ownerBytes,
    targetBytes,
    anchorBytes,
    opts.tagsBytes,
    opts.data,
  ]);
}

/**
 * Arweave-style deep hash. A leaf hashes to SHA-384(tag || len(bytes) || bytes);
 * a list hashes by folding child-tag hashes left-to-right with SHA-384.
 * Used by both Arweave native transactions and ANS-104.
 */
async function deepHash(input: Uint8Array | Uint8Array[]): Promise<Uint8Array> {
  if (input instanceof Uint8Array) {
    const tag = concat([
      new TextEncoder().encode('blob'),
      new TextEncoder().encode(String(input.length)),
    ]);
    const tagHash = await sha384(tag);
    const dataHash = await sha384(input);
    return sha384(concat([tagHash, dataHash]));
  }

  // List
  const tag = concat([
    new TextEncoder().encode('list'),
    new TextEncoder().encode(String(input.length)),
  ]);
  let acc = await sha384(tag);
  for (const chunk of input) {
    const childHash = await deepHash(chunk);
    acc = await sha384(concat([acc, childHash]));
  }
  return acc;
}

async function sha384(bytes: Uint8Array): Promise<Uint8Array> {
  const buf = await crypto.subtle.digest('SHA-384', bytes as unknown as BufferSource);
  return new Uint8Array(buf);
}

function concat(parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
}

// ── Tags encoding (Avro) ─────────────────────────────────────
// ANS-104 tags use an Avro-encoded array-of-records: each tag is a record
// of {name: bytes, value: bytes}. The wire format for an Avro array is a
// sequence of blocks, each prefixed by a zigzag varint count (followed by
// an optional total-byte-length when count is negative). We emit a single
// block followed by a terminating 0 count.

export function encodeTags(tags: DataItemTag[]): Uint8Array {
  if (tags.length === 0) return new Uint8Array(0);

  const blockParts: Uint8Array[] = [];
  for (const tag of tags) {
    blockParts.push(avroBytes(new TextEncoder().encode(tag.name)));
    blockParts.push(avroBytes(new TextEncoder().encode(tag.value)));
  }
  const blockBody = concat(blockParts);

  // Single block: count = tags.length (positive). Terminator: count = 0.
  return concat([
    avroLong(tags.length),
    blockBody,
    avroLong(0),
  ]);
}

export function decodeTags(buf: Uint8Array): DataItemTag[] {
  if (buf.length === 0) return [];
  const tags: DataItemTag[] = [];
  let off = 0;
  while (off < buf.length) {
    const [count, n1] = readAvroLong(buf, off);
    off += n1;
    if (count === 0n) break;
    let blockCount = count;
    if (blockCount < 0n) {
      blockCount = -blockCount;
      // Skip block-length prefix (we don't need it for sequential parse).
      const [, n2] = readAvroLong(buf, off);
      off += n2;
    }
    for (let i = 0n; i < blockCount; i++) {
      const { value: name, next: o1 } = readAvroBytes(buf, off);
      off = o1;
      const { value: value, next: o2 } = readAvroBytes(buf, off);
      off = o2;
      tags.push({
        name: new TextDecoder().decode(name),
        value: new TextDecoder().decode(value),
      });
    }
  }
  return tags;
}

function avroLong(n: number | bigint): Uint8Array {
  // ZigZag-encoded variable-length long. Per Avro spec.
  let v = typeof n === 'bigint' ? n : BigInt(n);
  v = (v << 1n) ^ (v >> 63n);
  const bytes: number[] = [];
  while ((v & ~0x7fn) !== 0n) {
    bytes.push(Number((v & 0x7fn) | 0x80n));
    v >>= 7n;
  }
  bytes.push(Number(v));
  return new Uint8Array(bytes);
}

function readAvroLong(buf: Uint8Array, offset: number): [bigint, number] {
  let result = 0n;
  let shift = 0n;
  let pos = offset;
  let b: number;
  do {
    if (pos >= buf.length) throw new Error('Truncated Avro long');
    b = buf[pos++];
    result |= BigInt(b & 0x7f) << shift;
    shift += 7n;
  } while (b & 0x80);
  // ZigZag decode.
  const decoded = (result >> 1n) ^ -(result & 1n);
  return [decoded, pos - offset];
}

function avroBytes(bytes: Uint8Array): Uint8Array {
  return concat([avroLong(bytes.length), bytes]);
}

function readAvroBytes(buf: Uint8Array, offset: number): { value: Uint8Array; next: number } {
  const [len, n] = readAvroLong(buf, offset);
  const start = offset + n;
  const end = start + Number(len);
  if (end > buf.length) throw new Error('Truncated Avro bytes');
  return { value: buf.slice(start, end), next: end };
}

// ── Binary assembly + decoding ───────────────────────────────

function assembleDataItem(opts: {
  signature: Uint8Array;
  ownerBytes: Uint8Array;
  targetBytes: Uint8Array | null;
  anchorBytes: Uint8Array | null;
  tagsCount: number;
  tagsBytes: Uint8Array;
  dataBytes: Uint8Array;
}): Uint8Array {
  const targetSection = opts.targetBytes
    ? concat([new Uint8Array([1]), opts.targetBytes])
    : new Uint8Array([0]);
  const anchorSection = opts.anchorBytes
    ? concat([new Uint8Array([1]), opts.anchorBytes])
    : new Uint8Array([0]);

  const tagsCountBytes = leU64(BigInt(opts.tagsCount));
  const tagsByteLen = leU64(BigInt(opts.tagsBytes.length));

  return concat([
    leU16(SIG_TYPE_RSA_PSS),
    opts.signature,
    opts.ownerBytes,
    targetSection,
    anchorSection,
    tagsCountBytes,
    tagsByteLen,
    opts.tagsBytes,
    opts.dataBytes,
  ]);
}

export interface DecodedDataItem {
  sigType: number;
  signature: Uint8Array;
  owner: string;       // base64url
  target?: string;     // base64url (43 chars) if present
  anchor?: string;     // base64url if present
  tags: DataItemTag[];
  /** Raw Avro-encoded tags as they sit in the binary — used by verifyDataItem
   * so the signature check operates on the exact bytes that were signed. */
  tagsBytes: Uint8Array;
  data: Uint8Array;
  id: string;          // SHA-256(signature) base64url
}

export async function decodeDataItemAsync(raw: Uint8Array): Promise<DecodedDataItem> {
  const sync = decodeDataItem(raw);
  const idBuf = await crypto.subtle.digest('SHA-256', sync.signature as unknown as BufferSource);
  sync.id = bytesToBase64url(new Uint8Array(idBuf));
  return sync;
}

function decodeDataItem(raw: Uint8Array): DecodedDataItem {
  let off = 0;
  const sigType = readU16LE(raw, off); off += 2;
  if (sigType !== SIG_TYPE_RSA_PSS) {
    throw new Error(`Unsupported signature type ${sigType}`);
  }
  const signature = raw.slice(off, off + RSA_PSS_SIG_LENGTH); off += RSA_PSS_SIG_LENGTH;
  const ownerBytes = raw.slice(off, off + RSA_PSS_OWNER_LENGTH); off += RSA_PSS_OWNER_LENGTH;

  let target: string | undefined;
  if (raw[off++] === 1) {
    target = bytesToBase64url(raw.slice(off, off + 32));
    off += 32;
  }
  let anchor: string | undefined;
  if (raw[off++] === 1) {
    anchor = bytesToBase64url(raw.slice(off, off + 32));
    off += 32;
  }

  const tagsCount = Number(readU64LE(raw, off)); off += 8;
  const tagsByteLen = Number(readU64LE(raw, off)); off += 8;
  const tagsBytes = raw.slice(off, off + tagsByteLen); off += tagsByteLen;
  const tags = decodeTags(tagsBytes);
  if (tagsCount !== tags.length) {
    throw new Error(`Tag count mismatch (header=${tagsCount}, decoded=${tags.length})`);
  }

  const data = raw.slice(off);
  return {
    sigType,
    signature,
    owner: bytesToBase64url(ownerBytes),
    target,
    anchor,
    tags,
    tagsBytes,
    data,
    id: '', // filled in by decodeDataItemAsync
  };
}

// ── Little-endian helpers ────────────────────────────────────

function leU16(n: number): Uint8Array {
  return new Uint8Array([n & 0xff, (n >> 8) & 0xff]);
}

function readU16LE(buf: Uint8Array, off: number): number {
  return buf[off] | (buf[off + 1] << 8);
}

function leU64(n: bigint): Uint8Array {
  const out = new Uint8Array(8);
  for (let i = 0; i < 8; i++) {
    out[i] = Number((n >> BigInt(i * 8)) & 0xffn);
  }
  return out;
}

function readU64LE(buf: Uint8Array, off: number): bigint {
  let r = 0n;
  for (let i = 0; i < 8; i++) {
    r |= BigInt(buf[off + i]) << BigInt(i * 8);
  }
  return r;
}
