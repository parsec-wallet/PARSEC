// Chain-wallet tile — create or surface the per-account Solana and Arweave
// addresses, side by side. Grouping the two "create wallet" CTAs on one row
// keeps extra-chain wallet creation together on the Algorand dashboard,
// above the ARIO row.

import { el, btn, toast } from '../dom';
import { registerDashboardModule, type DashboardModule, type DashboardContext } from '../dashboard-modules';

function copy(label: string, addr: string): void {
  void navigator.clipboard.writeText(addr);
  toast(`${label} address copied`, 'success');
}

function solanaButton(ctx: DashboardContext): HTMLElement {
  const addr = ctx.getChainAddress('solana');
  return addr
    ? btn('Solana addr ✓', { outlined: true, icon: 'tick', onClick: () => copy('Solana', addr) })
    : btn('Create Solana', { outlined: true, icon: 'plus', onClick: () => ctx.navigate('solana-create') });
}

function arweaveButton(ctx: DashboardContext): HTMLElement {
  const addr = ctx.getChainAddress('arweave-hd') ?? ctx.getChainAddress('arweave');
  return addr
    ? btn('Arweave addr ✓', { outlined: true, icon: 'tick', onClick: () => copy('Arweave', addr) })
    : btn('Create Arweave', { outlined: true, icon: 'plus', onClick: () => ctx.navigate('arweave-create') });
}

export const chainWalletsModule: DashboardModule = {
  id: 'chain-wallets',
  priority: 28, // above ario (30) — the create row sits over the ARIO row
  enabled: true,
  render(ctx) {
    return el('div', {
      cls: 'parsec-dashboard__actions parsec-dashboard__chain-wallets',
      children: [solanaButton(ctx), arweaveButton(ctx)],
    });
  },
};

registerDashboardModule(chainWalletsModule);
