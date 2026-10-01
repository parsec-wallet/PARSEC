// Lightspeed dashboard tile — head block from the chosen provider, live while
// the dashboard is on screen. Hidden while the provider is the local default:
// a row of `unknown · this device` on a newcomer's dashboard teaches nothing,
// and the view itself stays reachable from the rail.

import { el, btn } from '../dom';
import { onCleanup } from '../lifecycle';
import { provenanceLine } from '../ui/provenance';
import type { DashboardModule } from '../dashboard-modules';
import { blockNumber$ } from './feeds';
import { getProviderChoice } from './registry';
import { LIGHTSPEED_ID } from './choices';

export const lightspeedDashboardModule: DashboardModule = {
  id: LIGHTSPEED_ID,
  priority: 90,
  enabled: true,
  render(ctx) {
    if (getProviderChoice().id === 'local') return null;

    const chip = el('span', { cls: 'parsec-linkage__chip parsec-linkage__chip--unknown' });
    const head = el('span', { cls: 'parsec-confirm__value', text: 'head —' });
    const line = el('div', { cls: 'parsec-view__desc', text: 'reading…' });

    const unsubscribe = blockNumber$().subscribe((r) => {
      chip.className = `parsec-linkage__chip parsec-linkage__chip--${r.status}`;
      head.textContent = r.value === null ? (r.error ? `head — ${r.error}` : 'head — unknown') : `head #${r.value}`;
      line.textContent = provenanceLine(r.provenance);
    });
    onCleanup(unsubscribe);

    return el('div', {
      cls: 'parsec-dashboard__actions parsec-dashboard__lightspeed',
      children: [
        el('div', { cls: 'parsec-confirm__row', children: [chip, el('span', { cls: 'parsec-confirm__label', text: 'Lightspeed' }), head] }),
        line,
        btn('Open', { outlined: true, icon: 'flash', onClick: () => ctx.navigate(LIGHTSPEED_ID) }),
      ],
    });
  },
};
