// Solana dashboard tile — owns the lifecycle of the per-account Solana
// address (create when absent, surface + copy when present). Decoupled
// from the ARIO migration row so Solana is reachable on its own.

import { el, btn, toast } from '../dom';
import { registerDashboardModule, type DashboardModule } from '../dashboard-modules';

export const solanaDashboardModule: DashboardModule = {
  id: 'solana',
  priority: 35,
  enabled: true,
  render(ctx) {
    const solanaAddr = ctx.getChainAddress('solana');
    return el('div', {
      cls: 'parsec-dashboard__actions parsec-dashboard__solana-actions',
      children: [
        solanaAddr
          ? btn('Solana addr ✓', {
              outlined: true,
              icon: 'tick',
              onClick: () => {
                void navigator.clipboard.writeText(solanaAddr);
                toast('Solana address copied', 'success');
              },
            })
          : btn('Create Solana', {
              outlined: true,
              icon: 'plus',
              onClick: () => ctx.navigate('solana-create'),
            }),
      ],
    });
  },
};

registerDashboardModule(solanaDashboardModule);
