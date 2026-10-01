// ARC-19: template-based mutable NFTs.
//
// The asset URL is a template like "template-ipfs://{ipfscid:1:raw:reserve:sha2-256}"
// and the actual CID is encoded in the asset's reserve address (32 bytes of
// the 36-byte address payload, followed by a 4-byte checksum). Updating the
// reserve address changes the CID without re-issuing the asset.
//
// We support the most common shape: codec=raw, multihash=sha2-256, version=1.
// That covers ~all ARC-19 collections in the wild.

import algosdk from 'algosdk';

const TEMPLATE_PREFIX = 'template-ipfs://';
const BASE32_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';

/** RFC 4648 base32 lowercase, no padding. */
function base32EncodeLower(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 0x1f];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 0x1f];
  return out;
}

/**
 * Detect whether a URL field is an ARC-19 template.
 */
export function isArc19Template(url: string | undefined | null): boolean {
  if (!url) return false;
  return url.startsWith(TEMPLATE_PREFIX) && url.includes('{ipfscid:');
}

/**
 * Resolve an ARC-19 template URL using the reserve address.
 * Returns an `ipfs://<cidv1>` URL or null if the template can't be resolved.
 *
 * The reserve address holds 32 bytes of the multihash digest. We rebuild the
 * full multihash (sha2-256 = 0x12, length 0x20, then digest) and emit a CIDv1
 * with codec=raw (0x55).
 */
export function resolveArc19(templateUrl: string, reserveAddress: string): string | null {
  if (!isArc19Template(templateUrl)) return null;
  if (!reserveAddress) return null;

  // Extract codec from the template — we only handle raw for now.
  // template form: template-ipfs://{ipfscid:<version>:<codec>:reserve:<hash>}
  const parts = templateUrl.match(/\{ipfscid:(\d+):([^:]+):reserve:([^}]+)\}/);
  if (!parts) return null;
  const [, version, codec, hashName] = parts;
  if (version !== '1') return null;
  if (hashName !== 'sha2-256') return null;
  if (codec !== 'raw' && codec !== 'dag-pb') return null;

  let pubkey: Uint8Array;
  try {
    const decoded = algosdk.decodeAddress(reserveAddress);
    pubkey = decoded.publicKey;
  } catch {
    return null;
  }
  if (pubkey.length !== 32) return null;

  // CIDv1 = <multibase><cid-version=1><codec><multihash>
  // multihash = <0x12 sha2-256><0x20 length=32><32-byte digest>
  const cidVersion = 0x01;
  const codecCode = codec === 'raw' ? 0x55 : 0x70; // raw vs dag-pb
  const cidBytes = new Uint8Array(2 + 2 + 32);
  cidBytes[0] = cidVersion;
  cidBytes[1] = codecCode;
  cidBytes[2] = 0x12; // sha2-256
  cidBytes[3] = 0x20; // 32 bytes
  cidBytes.set(pubkey, 4);

  // multibase 'b' prefix = base32 lowercase no-padding
  const cid = `b${base32EncodeLower(cidBytes)}`;
  return `ipfs://${cid}`;
}
