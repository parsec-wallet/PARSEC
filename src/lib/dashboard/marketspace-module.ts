// BANKON Marketspace dashboard tile — name-listing registry surface.
// Renders only when the account has an Arweave address (same key signs
// listings and offers). Decoupled from the BANKON Names tile so the
// Marketspace can evolve independently (e.g., later: ASA marketplace).

import { el, btn } from '../dom';
import { registerDashboardModule, type DashboardModule } from '../dashboard-modules';
import { isBmrConfigured } from '../marketplace/process-id';

export const marketspaceDashboardModule: DashboardModule = {
  id: 'marketspace',
  priority: 50,
  enabled: true,
  render(ctx) {
    const arweaveAddr = ctx.getChainAddress('arweave-hd') ?? ctx.getChainAddress('arweave');
    if (!arweaveAddr) return null;
    const configured = isBmrConfigured();
    return el('div', {
      cls: 'parsec-dashboard__actions parsec-dashboard__marketspace-actions',
      children: [
        btn('Marketspace', {
          intent: configured ? 'primary' : 'warning',
          icon: configured ? 'shop' : 'warning-sign',
          onClick: () => ctx.navigate('market-hub'),
        }),
        btn('Create listing', {
          outlined: true,
          icon: 'plus',
          onClick: () => ctx.navigate('market-create'),
        }),
      ],
    });
  },
};

registerDashboardModule(marketspaceDashboardModule);
