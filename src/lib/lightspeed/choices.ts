// What Lightspeed elects. Observe-only: it watches chain state and never asks
// for a signature. Reach is external because the participant may point it at
// a JSON-RPC node; the local default stays on the device and says so in every
// provenance line. The provider preference is a device setting, not a secret.

import type { ModuleChoices } from '../module-choices';

export const LIGHTSPEED_ID = 'lightspeed';

export const LIGHTSPEED_CHOICES: ModuleChoices = {
  privilege: 'observe',
  reach: 'external',
  persistence: 'device',
  provider: 'optional-external',
};
