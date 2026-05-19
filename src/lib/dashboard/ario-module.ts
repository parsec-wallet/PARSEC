// AR.IO / ARIO-migration dashboard tile.
//
// Surfaces:
//   * AR.IO Names (→ name-hub with namespace=arns) when an Arweave addr exists
//   * Transfer ARIO when an Arweave addr exists
//   * ARIO → Solana migration (always; this is the June 1 deadline CTA)
//
// The Solana destination address chip lives in solana-module.

import { el, btn } from '../dom';
import { registerDashboardModule, type DashboardModule } from '../dashboard-modules';
import { setActiveNamespaceId } from '../namespaces/registry';

export const arioDashboardModule: DashboardModule = {
  id: 'ario',
  priority: 30,
  enabled: true,
  render(ctx) {
    const arweaveAddr = ctx.getChainAddress('arweave-hd') ?? ctx.getChainAddress('arweave');
    return el('div', {
      cls: 'parsec-dashboard__actions parsec-dashboard__ario-actions',
      children: [
        arweaveAddr
          ? btn('AR.IO Names', {
              intent: 'primary',
              icon: 'tag',
              onClick: () => {
                setActiveNamespaceId('arns');
                ctx.navigate('name-hub');
              },
            })
          : btn('Create Arweave', { outlined: true, icon: 'plus', onClick: () => ctx.navigate('arweave-create') }),
        arweaveAddr
          ? btn('Transfer ARIO', { outlined: true, icon: 'send-message', onClick: () => ctx.navigate('ario-transfer') })
          : el('span', {}),
        btn('ARIO → Solana', {
          intent: 'danger',
          icon: 'exchange',
          onClick: () => ctx.navigate('ario-migrate-solana'),
        }),
      ],
    });
  },
};

registerDashboardModule(arioDashboardModule);
