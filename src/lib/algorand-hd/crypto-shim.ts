// Node `crypto` polyfill for the algorithms used by
// @algorandfoundation/xhd-wallet-api in the browser/Tauri webview.
//
// xhd-wallet-api's bip32-ed25519.js does:
//   import { createHash, createHmac } from "crypto"
//   createHash("sha256" | "sha512").update(...).digest()
//   createHmac("sha512", key).update(...).digest()
//
// Vite externalizes "crypto" by default — we alias it to this file instead
// so the lib runs unmodified.

import { sha256 } from '@noble/hashes/sha2.js';
import { sha512 } from '@noble/hashes/sha2.js';
import { hmac } from '@noble/hashes/hmac.js';

type HashAlg = 'sha256' | 'sha512';

class Hasher {
  private chunks: Uint8Array[] = [];
  constructor(private algo: HashAlg) {}
  update(data: Uint8Array | Buffer | string): this {
    let bytes: Uint8Array;
    if (typeof data === 'string') {
      bytes = new TextEncoder().encode(data);
    } else if (data instanceof Uint8Array) {
      bytes = data;
    } else {
      bytes = new Uint8Array(data as ArrayBufferLike);
    }
    this.chunks.push(bytes);
    return this;
  }
  digest(): Buffer {
    const total = this.chunks.reduce((n, c) => n + c.length, 0);
    const flat = new Uint8Array(total);
    let off = 0;
    for (const c of this.chunks) { flat.set(c, off); off += c.length; }
    const out = this.algo === 'sha256' ? sha256(flat) : sha512(flat);
    // Buffer extends Uint8Array — Buffer.from gives the lib something it can
    // call .toString('hex')/.subarray on like a Node Buffer.
    return bufferFrom(out);
  }
}

class Hmac {
  private chunks: Uint8Array[] = [];
  constructor(private algo: HashAlg, private key: Uint8Array) {}
  update(data: Uint8Array | Buffer | string): this {
    let bytes: Uint8Array;
    if (typeof data === 'string') {
      bytes = new TextEncoder().encode(data);
    } else if (data instanceof Uint8Array) {
      bytes = data;
    } else {
      bytes = new Uint8Array(data as ArrayBufferLike);
    }
    this.chunks.push(bytes);
    return this;
  }
  digest(): Buffer {
    const total = this.chunks.reduce((n, c) => n + c.length, 0);
    const flat = new Uint8Array(total);
    let off = 0;
    for (const c of this.chunks) { flat.set(c, off); off += c.length; }
    const hashFn = this.algo === 'sha256' ? sha256 : sha512;
    const out = hmac(hashFn, this.key, flat);
    return bufferFrom(out);
  }
}

export function createHash(algo: string): Hasher {
  if (algo !== 'sha256' && algo !== 'sha512') {
    throw new Error(`crypto-shim: unsupported hash ${algo}`);
  }
  return new Hasher(algo);
}

export function createHmac(algo: string, key: Uint8Array | Buffer | string): Hmac {
  if (algo !== 'sha256' && algo !== 'sha512') {
    throw new Error(`crypto-shim: unsupported hmac ${algo}`);
  }
  let keyBytes: Uint8Array;
  if (typeof key === 'string') keyBytes = new TextEncoder().encode(key);
  else if (key instanceof Uint8Array) keyBytes = key;
  else keyBytes = new Uint8Array(key as ArrayBufferLike);
  return new Hmac(algo, keyBytes);
}

// Node Buffer is just Uint8Array with extras — for our purposes a Uint8Array
// presented as a Buffer suffices for the consumers we care about.
function bufferFrom(u8: Uint8Array): Buffer {
  // In a Node-Buffer-aware environment this is a real Buffer; otherwise it
  // is a Uint8Array pretending to be one (the consumer treats the result as
  // raw bytes and calls .subarray which Uint8Array supports natively).
  if (typeof Buffer !== 'undefined' && Buffer.from) return Buffer.from(u8);
  return u8 as unknown as Buffer;
}

export default { createHash, createHmac };
