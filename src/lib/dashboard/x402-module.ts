// x402 / AgenticPlace dashboard tile — the agent economy's four doors.
//
// Registered by `lib/x402/module.ts` through registerModule(), not by importing this
// file: one module declaration performs the router, navigation and dashboard
// registrations together (docs/modules.md).
//
// SPDX-FileCopyrightText: 2026 BANKON
// SPDX-License-Identifier: Apache-2.0

import { el, btn } from '../dom';
import type { DashboardModule } from '../dashboard-modules';

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
        btn('Bazaar', { outlined: true, icon: 'shop', onClick: () => ctx.navigate('x402-bazaar') }),
        btn('x402 Desk', { outlined: true, icon: 'bank-account', onClick: () => ctx.navigate('x402-desk') }),
      ],
    });
  },
};
