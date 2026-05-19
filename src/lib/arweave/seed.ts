// Deterministic RSA-4096 derivation from a BIP-39 mnemonic.
//
// WebCrypto's RSA-PSS generateKey accepts no seed — so we use node-forge's
// seedable RSA generator with a PRNG fed from the BIP-39 seed bytes, then
// convert the resulting PKCS8 PEM into a JWK via WebCrypto. The final key
// material is what arweave-js consumes (a standard RSA-PSS JWK).
//
// This is parsec's own derivation — it is NOT byte-compatible with Wander's
// human-crypto-keys path. Users importing from Wander must use JWK import,
// not mnemonic. Parsec-generated mnemonics produce parsec-deterministic keys.

import * as bip39 from 'bip39';
import forge from 'node-forge';

const RSA_BITS = 4096;
const RSA_PUBLIC_EXPONENT = 0x10001;

/**
 * Derive an Arweave RSA-4096 JWK from a BIP-39 mnemonic.
 * Deterministic: same mnemonic + passphrase → same JWK.
 *
 * SLOW: takes ~10–30s on first call (RSA-4096 prime search). The async
 * forge generator yields to the event loop between candidate primes so
 * the UI remains responsive.
 */
export async function deriveJwkFromMnemonic(
  mnemonic: string,
  passphrase = '',
): Promise<JsonWebKey> {
  const trimmed = mnemonic.trim();
  if (!bip39.validateMnemonic(trimmed)) {
    throw new Error('Invalid BIP-39 mnemonic');
  }
  const seed = bip39.mnemonicToSeedSync(trimmed, passphrase); // 64 bytes
  try {
    const prng = createSeededPrng(seed);
    const keyPair = await forgeGenerateKeyPairAsync(prng);
    return await forgePrivateKeyToJwk(keyPair.privateKey);
  } finally {
    seed.fill(0);
  }
}

// ── Seeded PRNG ────────────────────────────────────────────────
// Forge's collector calls seedFileSync(n) whenever it needs entropy. We
// stretch the 64-byte BIP-39 seed deterministically via SHA-512(seed || ctr)
// — equivalent to a counter-mode KDF. Producing the SAME byte stream for
// the SAME seed is the determinism guarantee.

function createSeededPrng(seed: Uint8Array): forge.random.Random {
  const seedBinary = uint8ToBinaryString(seed);
  let counter = 0;
  const prng = forge.random.createInstance();
  prng.seedFileSync = (needed: number): string => {
    let out = '';
    while (out.length < needed) {
      const ctrBytes = String.fromCharCode(
        counter & 0xff,
        (counter >>> 8) & 0xff,
        (counter >>> 16) & 0xff,
        (counter >>> 24) & 0xff,
      );
      const block = forge.md.sha512.create()
        .update(seedBinary)
        .update(ctrBytes)
        .digest()
        .bytes();
      out += block;
      counter++;
    }
    return out.slice(0, needed);
  };
  // Forge's pool starts empty; the first call to generateBytes() invokes
  // seedFileSync(), so our deterministic stream supplies every byte.
  return prng;
}

function uint8ToBinaryString(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return s;
}

// ── Forge async wrapper ────────────────────────────────────────

function forgeGenerateKeyPairAsync(prng: forge.random.Random): Promise<forge.pki.rsa.KeyPair> {
  return new Promise((resolve, reject) => {
    forge.pki.rsa.generateKeyPair(
      { bits: RSA_BITS, e: RSA_PUBLIC_EXPONENT, prng, workers: 0 },
      (err, keyPair) => {
        if (err) return reject(err);
        resolve(keyPair);
      },
    );
  });
}

// ── PEM → JWK via WebCrypto ────────────────────────────────────

async function forgePrivateKeyToJwk(privateKey: forge.pki.rsa.PrivateKey): Promise<JsonWebKey> {
  const pkcs8Der = forge.asn1.toDer(
    forge.pki.wrapRsaPrivateKey(forge.pki.privateKeyToAsn1(privateKey)),
  ).getBytes();
  const pkcs8Bytes = binaryStringToUint8(pkcs8Der);

  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    pkcs8Bytes.buffer.slice(pkcs8Bytes.byteOffset, pkcs8Bytes.byteOffset + pkcs8Bytes.byteLength) as ArrayBuffer,
    { name: 'RSA-PSS', hash: 'SHA-256' },
    true,
    ['sign'],
  );
  return await crypto.subtle.exportKey('jwk', cryptoKey);
}

function binaryStringToUint8(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}
