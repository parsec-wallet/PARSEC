// Permaweb — the module manifest (lib/modules.ts). One registration: routes, rail entry, dashboard
// tile. Replaces three registerView lines in main.ts and the static nav entry. Runs on the
// first-paint path, so it imports only the tile; every view stays lazy.

import { registerModule } from '../modules';
import { permawebDashboardModule } from './dashboard-module';
import { PERMAWEB_CHOICES, PERMAWEB_ID } from './choices';

registerModule({
  id: PERMAWEB_ID,
  tier: 'agenticplace',
  priority: 30,
  enabled: true,
  choices: PERMAWEB_CHOICES,
  routes: [
    {
      id: 'permaweb-desk',
      title: 'Permaweb Desk',
      load: async () => (await import('../../views/permaweb-desk')).permawebDeskView,
      disclosure: 'more',
      inRail: true,
      keywords: ['arweave', 'gateway', 'ario', 'permaweb'],
    },
    {
      id: 'permaweb-upload',
      title: 'Upload to Arweave',
      load: async () => (await import('../../views/permaweb-upload')).permawebUploadView,
      disclosure: 'more',
      inRail: true,
      keywords: ['upload', 'turbo', 'publish', 'site', 'manifest', 'permanent', 'store'],
    },
    {
      id: 'permaweb-bridge',
      title: 'Bridge ARIO from Base',
      load: async () => (await import('../../views/permaweb-bridge')).permawebBridgeView,
      disclosure: 'more',
      keywords: ['bridge', 'base', 'ario', 'solana', 'migrate'],
    },
    {
      id: 'permaweb-gateway-join',
      title: 'Join ar.io as a gateway',
      load: async () => (await import('../../views/permaweb-gateway-join')).permawebGatewayJoinView,
      disclosure: 'pro',
      keywords: ['gateway', 'operator', 'stake', 'observer'],
    },
  ],
  dashboard: permawebDashboardModule,
});
