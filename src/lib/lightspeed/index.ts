// Lightspeed barrel — the light.js idea (reactive chain reads over a
// participant-chosen provider) reimplemented in-house with zero dependencies,
// and Parsec's template for a module that states its choices. Doc:
// docs/lightspeed.md. Registration is a side effect of ./module, imported
// from main.ts; this barrel is the API.

export { poll, readOnce, mapReading } from './observable';
export type { Observable, Reading, Unsubscribe, Source } from './observable';
export type { LightspeedProvider, SyncStatus } from './types';
export { localProvider } from './providers/local';
export { jsonRpcProvider } from './providers/json-rpc';
export { activeProvider, getProviderChoice, setProviderChoice } from './registry';
export type { ProviderChoice, ProviderId } from './registry';
export {
  FREQUENCY,
  blockNumber$,
  chainId$,
  balanceOf$,
  syncStatus$,
  readBlockNumber,
  makeContract,
  erc20,
  encodeAddressArg,
  decodeUint256,
  ERC20_BALANCE_OF,
  post$,
} from './feeds';
export { LIGHTSPEED_CHOICES, LIGHTSPEED_ID } from './choices';
