// aORC application identifiers.
//
// Testnet ids are baked in. Mainnet ids are sourced (in priority order):
//   1. Vite env vars VITE_AORC_MAINNET_{MINTER,REGISTRY,BONAFIDE,TYPEMINTER}
//   2. The MAINNET constant below (commit these post-deployment)
//
// `isAorcConfigured(network)` reports false until every id is non-zero, so
// the UI gates the aORC type-mint surface until the deploy is wired up.

import type { NetworkId } from '../../types/wallet';

export interface AorcAppIds {
  minter: number;
  registry: number;
  bonaFide: number;
  typeMinter: number;
}

const TESTNET: AorcAppIds = {
  minter: 757891101,
  registry: 757891112,
  bonaFide: 757895044,
  typeMinter: 757895349,
};

const MAINNET_BAKED: AorcAppIds = {
  minter: 0,
  registry: 0,
  bonaFide: 0,
  typeMinter: 0,
};

function readEnvUint(key: string): number {
  try {
    const v = (import.meta.env as Record<string, string | undefined>)[key];
    if (!v) return 0;
    const n = Number.parseInt(v, 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

function mainnetIds(): AorcAppIds {
  return {
    minter:     readEnvUint('VITE_AORC_MAINNET_MINTER')     || MAINNET_BAKED.minter,
    registry:   readEnvUint('VITE_AORC_MAINNET_REGISTRY')   || MAINNET_BAKED.registry,
    bonaFide:   readEnvUint('VITE_AORC_MAINNET_BONAFIDE')   || MAINNET_BAKED.bonaFide,
    typeMinter: readEnvUint('VITE_AORC_MAINNET_TYPEMINTER') || MAINNET_BAKED.typeMinter,
  };
}

export function getAorcIds(network: NetworkId): AorcAppIds {
  if (network === 'mainnet') return mainnetIds();
  return TESTNET; // testnet + betanet share the testnet ids in practice
}

export function isAorcConfigured(network: NetworkId): boolean {
  const ids = getAorcIds(network);
  return ids.minter > 0 && ids.typeMinter > 0;
}
