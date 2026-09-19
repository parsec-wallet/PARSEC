// Which provider Lightspeed reads from. The choice is a per-device preference
// (persistence: 'device') — never account state, never a secret — so
// localStorage is appropriate, exactly as lib/nav.ts persists disclosure.
// Default is the local provider: Parsec never escalates to an external
// service silently (docs/modules.md rule 6).

import { localProvider } from './providers/local';
import { jsonRpcProvider } from './providers/json-rpc';
import type { LightspeedProvider } from './types';

export type ProviderId = 'local' | 'json-rpc';

export interface ProviderChoice {
  readonly id: ProviderId;
  readonly url: string;
}

const ID_KEY = 'parsec:lightspeed-provider';
const URL_KEY = 'parsec:lightspeed-rpc-url';

function readKey(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null; // no storage (tests, private mode) — fall through to the default
  }
}

export function getProviderChoice(): ProviderChoice {
  const id = readKey(ID_KEY);
  const url = readKey(URL_KEY) ?? '';
  return { id: id === 'json-rpc' && url ? 'json-rpc' : 'local', url };
}

export function setProviderChoice(choice: ProviderChoice): void {
  try {
    localStorage.setItem(ID_KEY, choice.id);
    localStorage.setItem(URL_KEY, choice.url);
  } catch {
    /* best-effort persistence */
  }
  cached = null;
}

let cached: { key: string; provider: LightspeedProvider } | null = null;

/** The provider the participant chose, built once per distinct choice. */
export function activeProvider(): LightspeedProvider {
  const choice = getProviderChoice();
  const key = `${choice.id} ${choice.url}`;
  if (cached?.key === key) return cached.provider;
  let provider: LightspeedProvider;
  try {
    provider = choice.id === 'json-rpc' ? jsonRpcProvider(choice.url) : localProvider;
  } catch {
    provider = localProvider; // a malformed URL is not a reason to fail the surface
  }
  cached = { key, provider };
  return provider;
}
