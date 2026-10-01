// Algorand dashboard tile — primary coin action row: Send / Swap /
// Receive / Buy. The NFD entry point lives in nfdominter-module.

import { el, btn } from '../dom';
import { registerDashboardModule, type DashboardModule } from '../dashboard-modules';

export const algorandDashboardModule: DashboardModule = {
  id: 'algorand',
  priority: 10,
  enabled: true,
  render(ctx) {
    return el('div', {
      cls: 'parsec-dashboard__actions',
      children: [
        btn('Send', { intent: 'primary', icon: 'arrow-top-right', onClick: () => ctx.navigate('send') }),
        btn('Swap', { intent: 'warning', icon: 'swap-horizontal', onClick: () => ctx.navigate('swap') }),
        btn('Receive', { intent: 'success', icon: 'arrow-bottom-left', onClick: () => ctx.navigate('receive') }),
        btn('BUY', { outlined: true, icon: 'dollar', onClick: () => ctx.navigate('onramp') }),
      ],
    });
  },
};

registerDashboardModule(algorandDashboardModule);
