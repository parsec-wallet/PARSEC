// Web Worker — runs the deterministic RSA-4096 Arweave key derivation off the
// main thread. The keygen is synchronous and blocking (~10–60s); doing it here
// keeps the UI responsive and avoids node-forge's async scheduler, which
// stalls in the bundled browser webview.

// bip39's mnemonicToSeedSync needs Buffer — the worker has its own global
// scope, so polyfill it here just as main.ts does for the main thread.
import { Buffer as BufferPolyfill } from 'buffer';
if (typeof globalThis.Buffer === 'undefined') {
  (globalThis as unknown as { Buffer: typeof BufferPolyfill }).Buffer = BufferPolyfill;
}

import { deriveJwkFromMnemonic } from './seed';

interface DeriveRequest {
  mnemonic: string;
  passphrase?: string;
}

self.onmessage = async (e: MessageEvent<DeriveRequest>) => {
  try {
    const jwk = await deriveJwkFromMnemonic(e.data.mnemonic, e.data.passphrase ?? '');
    (self as unknown as Worker).postMessage({ ok: true, jwk });
  } catch (err) {
    (self as unknown as Worker).postMessage({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
};
