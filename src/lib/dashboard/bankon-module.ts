// BANKON Names dashboard tile. Only renders if the account has an Arweave
// address (the same key signs BANKON and ArNS claims). The Marketspace
// entry point lives in marketspace-module.

import { el, btn } from '../dom';
import { registerDashboardModule, type DashboardModule } from '../dashboard-modules';
import { setActiveNamespaceId } from '../namespaces/registry';
import { isBnrConfigured } from '../bankon-names/process-id';

export const bankonDashboardModule: DashboardModule = {
  id: 'bankon',
  priority: 40,
  enabled: true,
  render(ctx) {
    const arweaveAddr = ctx.getChainAddress('arweave-hd') ?? ctx.getChainAddress('arweave');
    if (!arweaveAddr) return null;
    const configured = isBnrConfigured();
    return el('div', {
      cls: 'parsec-dashboard__actions parsec-dashboard__bankon-actions',
      children: [
        btn('BANKON Names', {
          intent: configured ? 'primary' : 'warning',
          icon: configured ? 'shield' : 'warning-sign',
          onClick: () => {
            if (configured) {
              setActiveNamespaceId('bankon');
              ctx.navigate('name-hub');
            } else {
              ctx.navigate('bankon-admin');
            }
          },
        }),
        btn('Resolve', {
          outlined: true,
          icon: 'search',
          onClick: () => {
            setActiveNamespaceId('bankon');
            ctx.navigate('name-resolve');
          },
        }),
        ...(configured ? [] : [
          btn('Setup needed', {
            intent: 'warning',
            minimal: true,
            icon: 'cog',
            onClick: () => {
              sessionStorage.setItem('parsec:bankon-admin-mode', 'spawn');
              ctx.navigate('bankon-admin');
            },
          }),
        ]),
      ],
    });
  },
};

registerDashboardModule(bankonDashboardModule);
