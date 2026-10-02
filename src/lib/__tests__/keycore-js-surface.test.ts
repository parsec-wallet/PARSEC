// 0.2.0 exit check, JavaScript side: where can JavaScript still touch a private key?
//
// Every file that derives a secret key from a phrase, or signs with a key it holds, is listed
// here with the reason it may. A new one fails this test until it is justified. Files that
// exist for the browser build must also branch on `isTauri`, so the desktop takes the Keycore.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(__dirname, '..', '..');
const KEY_USE = /mnemonicToSecretKey|signWithJwk|crypto\.subtle\.sign\(|ed25519\.sign\(|\.signTxn\(|createKeyPairSignerFromBytes|secp256k1\.sign\(/;

type Why = 'browser-build' | 'typed-phrase-preview' | 'pure-helper' | 'external-signer';
const ALLOWED: Record<string, Why> = {
  'lib/algorand/signer.ts': 'browser-build',
  'lib/algorand/assets.ts': 'browser-build',
  'lib/x402/bridge.ts': 'browser-build',
  'lib/solana/kit-signer.ts': 'browser-build',
  'lib/arweave/vault-key.ts': 'browser-build',
  // Derives an address from a phrase the person is typing in (import, classification).
  'lib/algorand/validate.ts': 'typed-phrase-preview',
  // JWK signing primitives; only the browser branch of vault-key.ts gives them a key.
  'lib/arweave/ans104.ts': 'pure-helper',
  'lib/arweave/tx.ts': 'pure-helper',
  // MetaMask signs; PARSEC never holds that key.
  'lib/xchain/sign.ts': 'external-signer',
  // The browser build's create flow; on the desktop the Keycore creates (0.2.1).
  'views/create-wallet.ts': 'browser-build',
  // generateAccount / recoverAccount: the browser build's create flow, the admin key
  // ceremony (admin-keygen.ts, a documented residual) and typed-phrase checks.
  'lib/algorand/account.ts': 'pure-helper',
};

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return n === '__tests__' ? [] : files(p);
    return p.endsWith('.ts') ? [p] : [];
  });
}

describe('JavaScript key use is confined to justified files', () => {
  const found = files(ROOT)
    .filter((p) => KEY_USE.test(readFileSync(p, 'utf8')))
    .map((p) => relative(ROOT, p).split('\\').join('/'))
    .sort();

  it('no file outside the list derives or signs with a key', () => {
    expect(found.filter((f) => !(f in ALLOWED))).toEqual([]);
  });

  it('the list holds no stale entries', () => {
    expect(Object.keys(ALLOWED).filter((f) => !found.includes(f))).toEqual([]);
  });

  it('every browser-build file branches to the Keycore on the desktop', () => {
    const unguarded = Object.entries(ALLOWED)
      .filter(([, why]) => why === 'browser-build')
      .filter(([f]) => !/\bisTauri\b/.test(readFileSync(join(ROOT, f), 'utf8')))
      .map(([f]) => f);
    expect(unguarded).toEqual([]);
  });
});
