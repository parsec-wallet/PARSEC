// Permaweb dashboard tile — the module's single entry point on the dashboard: the Operator Desk and
// the Base→Solana ARIO bridge. Sits between chain-wallets (28) and the legacy ARIO row (30).
// Registered by ./module.ts (registerModule), not by importing this file.

import { el, btn } from '../dom';
import type { DashboardModule } from '../dashboard-modules';
import { setActiveNamespaceId } from '../namespaces/registry';

export const permawebDashboardModule: DashboardModule = {
  id: 'permaweb',
  priority: 29,
  enabled: true,
  render(ctx) {
    const sol = ctx.getChainAddress('solana');
    return el('div', {
      cls: 'parsec-dashboard__actions parsec-dashboard__permaweb-actions',
      children: [
        btn('Permaweb Desk', { intent: 'primary', icon: 'cloud', onClick: () => ctx.navigate('permaweb-desk') }),
        btn('Upload', { outlined: true, icon: 'cloud-upload', onClick: () => ctx.navigate('permaweb-upload') }),
        btn('Bridge ARIO', { outlined: true, icon: 'exchange', onClick: () => ctx.navigate('permaweb-bridge') }),
        ...(sol ? [btn('My ar.io names', {
          outlined: true,
          icon: 'tag',
          onClick: () => { setActiveNamespaceId('solana-arns'); ctx.navigate('name-hub'); },
        })] : []),
        ...(sol ? [] : [btn('Import Solana', { minimal: true, icon: 'import', onClick: () => ctx.navigate('solana-import') })]),
      ],
    });
  },
};
