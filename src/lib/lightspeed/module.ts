// Lightspeed — the module manifest. This file is the template: copy it,
// rename the id, state the choices honestly, point `load` at your view.
// One registration does router + navigation + dashboard (lib/modules.ts).
//
// Import cost matters — this runs on the first-paint path from main.ts. It
// pulls dom, lifecycle, the feeds and two tiny providers, no chain library.
// The view itself is lazy.

import { registerModule } from '../modules';
import { lightspeedDashboardModule } from './dashboard-module';
import { LIGHTSPEED_CHOICES, LIGHTSPEED_ID } from './choices';

registerModule({
  id: LIGHTSPEED_ID,
  tier: 'modules',
  priority: 90,
  enabled: true,
  choices: LIGHTSPEED_CHOICES,
  routes: [
    {
      id: LIGHTSPEED_ID,
      title: 'Lightspeed',
      load: async () => (await import('../../views/lightspeed')).lightspeedView,
      disclosure: 'pro',
      inRail: true,
      keywords: ['light client', 'light.js', 'evm', 'head block', 'observable', 'template', 'json-rpc'],
    },
  ],
  dashboard: lightspeedDashboardModule,
});
