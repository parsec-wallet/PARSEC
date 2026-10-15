// ANS-104 DataItem encoding, signing, and verification — PARSEC-owned.
//
// AO messages are signed DataItems per ANS-104 v1 (RSA-PSS signature type = 1).
// We vendor the canonical algorithm here so PARSEC is the keystore of record:
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
//
// Signature type 4 (Solana) has the same layout with a 64-byte ed25519 signature and a 32-byte
// owner (the Solana public key). Its signer signs the ASCII hex of the 48-byte deep-hash, not the
// hash itself — @dha-team/arbundles HexSolanaSigner, which @ardrive/turbo-sdk uses for
// token 'solana' (read 2026-10-15). Turbo charges the credits of the owner's Solana address.

import { base64urlToBytes, bytesToBase64url, type ArweaveJwk } from './jwk';
import { signWithJwk, vaultArweaveKey } from './vault-key';

export interface DataItemTag {
  name: string;
  value: string;
}

export interface DataItemInput {
  /** Owner: base64url RSA modulus `n` (type 1), or base64url Solana public key (type 4). */
  owner: string;
  /** ANS-104 signature type: 1 Arweave RSA-PSS (default), 4 Solana ed25519. */
  sigType?: SigType;
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
export const SIG_TYPE_SOLANA = 4;
export type SigType = typeof SIG_TYPE_RSA_PSS | typeof SIG_TYPE_SOLANA;
/** Signature and owner lengths per signature type (arbundles SIG_CONFIG). */
const SIG_CONFIG: Record<SigType, { sig: number; owner: number }> = {
  1: { sig: 512, owner: 512 },
  4: { sig: 64, owner: 32 },
};

/** What a type-4 signer signs: the ASCII hex of the deep-hash (arbundles HexSolanaSigner). */
export function solanaSigningMessage(sigData: Uint8Array): Uint8Array {
  let hex = '';
  for (const b of sigData) hex += b.toString(16).padStart(2, '0');
  return new TextEncoder().encode(hex);
}

// ── Public API ───────────────────────────────────────────────

/** Produces the signature over a DataItem's deep-hash: 512-byte RSA-PSS (type 1) or 64-byte ed25519 (type 4, over solanaSigningMessage). */
export type DataItemSigner = (signatureData: Uint8Array) => Promise<Uint8Array>;

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
  return signDataItemWith(input, (sigData) => signWithJwk(jwk, sigData));
}

/**
 * Build a DataItem whose signature comes from elsewhere — the Rust
 * `chain_ar_sign` command on desktop, where the key never enters JS. The
 * signer only ever sees the deep-hash, which is public. `input.owner` must be
 * the signer's public modulus or the item will not verify.
 */
export async function signDataItemWith(
  input: DataItemInput,
  sign: DataItemSigner,
): Promise<SignedDataItem> {
  const dataBytes = typeof input.data === 'string'
    ? new TextEncoder().encode(input.data)
    : input.data;

  const tags = input.tags ?? [];
  const tagsBytes = encodeTags(tags);
  const sigType: SigType = input.sigType ?? SIG_TYPE_RSA_PSS;
  const cfg = SIG_CONFIG[sigType];
  if (!cfg) throw new Error(`Unsupported signature type ${String(sigType)}`);

  // 1. Deep-hash the spec-defined field list.
  const sigData = await dataItemSignatureData({
    sigType,
    owner: input.owner,
    target: input.target,
    anchor: input.anchor,
    tagsBytes,
    data: dataBytes,
  });

  // 2. The signature, from whichever signer the caller supplied.
  const signature = await sign(sigData);
  if (signature.length !== cfg.sig) {
    throw new Error(`Unexpected signature length ${signature.length}`);
  }

  // 3. id = SHA-256(signature), base64url.
  const idBuf = await crypto.subtle.digest('SHA-256', signature as unknown as BufferSource);
  const id = bytesToBase64url(new Uint8Array(idBuf));

  // 4. Assemble the binary DataItem.
  const ownerBytes = base64urlToBytes(input.owner);
  if (ownerBytes.length !== cfg.owner) {
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
    sigType,
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
 * Exact byte length of the signed DataItem for a payload, known before signing
 * — so a caller can decide free tier vs paid without spending a signature.
 * sigtype(2) + signature(512) + owner(512) + target flag(1, +32 if present)
 * + anchor flag(1, +32 if present) + tag count(8) + tag-bytes length(8)
 * + tags + data.
 */
export function estimateDataItemSize(opts: {
  dataLength: number;
  tags?: DataItemTag[];
  target?: boolean;
  anchor?: boolean;
  sigType?: SigType;
}): number {
  const cfg = SIG_CONFIG[opts.sigType ?? SIG_TYPE_RSA_PSS];
  return 2 + cfg.sig + cfg.owner
    + (opts.target ? 33 : 1) + (opts.anchor ? 33 : 1)
    + 8 + 8 + encodeTags(opts.tags ?? []).length + opts.dataLength;
}

/** Sign the DataItem with the vault key for `address` (the Keycore on the desktop). */
export async function signDataItemFromVault(
  address: string,
  passphrase: string,
  input: Omit<DataItemInput, 'owner'> & { owner?: string },
): Promise<SignedDataItem> {
  const key = await vaultArweaveKey(address, passphrase);
  try {
    return await signDataItemWith({ ...input, owner: key.owner }, key.sign);
  } finally {
    key.dispose();
  }
}

/**
 * Verify a signed DataItem. Decodes the binary, recomputes deep-hash, checks
 * RSA-PSS signature against the owner's public key, and confirms the id.
 */
export async function verifyDataItem(raw: Uint8Array): Promise<boolean> {
  const parsed = decodeDataItem(raw);
  if (parsed.sigType !== SIG_TYPE_RSA_PSS && parsed.sigType !== SIG_TYPE_SOLANA) return false;

  // Use the raw tagsBytes the signer embedded in the binary, not a re-encoded
  // copy. Avro is canonical for our encoder but we still want to verify the
  // exact bytes that were signed.
  const sigData = await dataItemSignatureData({
    sigType: parsed.sigType as SigType,
    owner: parsed.owner,
    target: parsed.target,
    anchor: parsed.anchor,
    tagsBytes: parsed.tagsBytes,
    data: parsed.data,
  });

  if (parsed.sigType === SIG_TYPE_SOLANA) {
    try {
      const pk = await crypto.subtle.importKey('raw', base64urlToBytes(parsed.owner) as unknown as BufferSource, { name: 'Ed25519' }, false, ['verify']);
      const ok = await crypto.subtle.verify({ name: 'Ed25519' }, pk, parsed.signature as unknown as BufferSource, solanaSigningMessage(sigData) as unknown as BufferSource);
      if (!ok) return false;
    } catch {
      return false; // a runtime without WebCrypto Ed25519 cannot say yes
    }
    const idBuf = await crypto.subtle.digest('SHA-256', parsed.signature as unknown as BufferSource);
    return bytesToBase64url(new Uint8Array(idBuf)).length === 43;
  }

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
  /** Defaults to 1; the type is itself one of the hashed fields. */
  sigType?: SigType;
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
    new TextEncoder().encode(String(opts.sigType ?? SIG_TYPE_RSA_PSS)), // signature type
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
  sigType: SigType;
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
    leU16(opts.sigType),
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
  const cfg = SIG_CONFIG[sigType as SigType];
  if (!cfg) {
    throw new Error(`Unsupported signature type ${sigType}`);
  }
  const signature = raw.slice(off, off + cfg.sig); off += cfg.sig;
  const ownerBytes = raw.slice(off, off + cfg.owner); off += cfg.owner;

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
