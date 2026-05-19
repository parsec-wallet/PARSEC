// x402 / AgenticPlace dashboard tile — Identity + Agents.

import { el, btn } from '../dom';
import { registerDashboardModule, type DashboardModule } from '../dashboard-modules';

export const x402DashboardModule: DashboardModule = {
  id: 'x402',
  priority: 20,
  enabled: true,
  render(ctx) {
    return el('div', {
      cls: 'parsec-dashboard__actions parsec-dashboard__x402-actions',
      children: [
        btn('Identity', { outlined: true, icon: 'id-number', onClick: () => ctx.navigate('identity') }),
        btn('Agents', { outlined: true, icon: 'search', onClick: () => ctx.navigate('agents') }),
      ],
    });
  },
};

registerDashboardModule(x402DashboardModule);
