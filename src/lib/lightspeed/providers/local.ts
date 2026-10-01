// The local default — docs/modules.md rule 6: ship something that works with
// nothing but PARSEC. It has no network, so it answers `null` to everything;
// the feeds render `unknown · this device`, which is the truth.

import type { LightspeedProvider } from '../types';

export const localProvider: LightspeedProvider = {
  id: 'local',
  displayName: 'Local (no network)',
  origin: 'this device',
  reach: 'internal',
  blockNumber: async () => null,
  chainId: async () => null,
  balanceOf: async () => null,
  syncStatus: async () => null,
  call: async () => null,
};
