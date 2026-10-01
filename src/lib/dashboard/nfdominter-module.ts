// NFDominter dashboard tile — .algo name minting + management.
// Standalone row so the Algorand row stays focused on coin actions.

import { el, btn } from '../dom';
import { registerDashboardModule, type DashboardModule } from '../dashboard-modules';

export const nfdominterDashboardModule: DashboardModule = {
  id: 'nfdominter',
  priority: 25,
  enabled: true,
  render(ctx) {
    return el('div', {
      cls: 'parsec-dashboard__actions parsec-dashboard__nfdominter-actions',
      children: [
        btn('.algo Names', {
          intent: 'primary',
          icon: 'tag',
          onClick: () => ctx.navigate('nfdominter'),
        }),
      ],
    });
  },
};

registerDashboardModule(nfdominterDashboardModule);
