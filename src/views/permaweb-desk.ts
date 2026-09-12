// Permaweb Desk — the module's landing. One screen: the operator wallet, its ARIO and SOL, whether
// it already runs a gateway, and what you can do from here (names, upload, bridge, join, send).
// Every number is a live read; nothing here signs.

import { el, btn, toast } from '../lib/dom';
import { store, getAccountAddress } from '../lib/store';
import { getGatewayFor, getOperatorBalances } from '../lib/permaweb/gateway/read';
import { marioToArio } from '../lib/permaweb/units';
import { MIN_OPERATOR_STAKE_ARIO } from '../lib/permaweb/constants';
import { setActiveNamespaceId } from '../lib/namespaces/registry';

export function permawebDeskView(): HTMLElement {
  const s = store.get();
  const account = s.accounts[s.activeAccountIndex];
  const sol = account ? getAccountAddress(account, 'solana') : undefined;

  const root = el('div', { cls: 'parsec-view parsec-confirm parsec-permaweb' });
  root.appendChild(el('div', {
    cls: 'parsec-view__header',
    children: [
      btn('Back', { minimal: true, icon: 'arrow-left', onClick: () => store.navigate('dashboard') }),
      el('h2', { cls: 'parsec-view__title', text: 'Permaweb Desk' }),
    ],
  }));

  if (!sol) {
    root.appendChild(el('div', {
      cls: 'parsec-confirm__details',
      children: [
        el('p', { cls: 'parsec-view__desc', text: 'The Solana-era ar.io registry signs with a Solana key. Import the one that owns your names and ARIO, or create a fresh operator key.' }),
        btn('Import Solana key', { intent: 'primary', icon: 'import', onClick: () => store.navigate('solana-import') }),
      ],
    }));
    root.appendChild(actions(false));
    return root;
  }

  const stats = el('div', { cls: 'parsec-permaweb__grid-2', children: [
    stat('Operator', `${sol.slice(0, 8)}…${sol.slice(-6)}`),
    stat('ARIO', 'reading…'), stat('SOL', 'reading…'), stat('Gateway', 'reading…'),
  ] });
  root.appendChild(el('div', { cls: 'parsec-confirm__details', children: [stats] }));
  root.appendChild(actions(true));

  void (async () => {
    try {
      const b = await getOperatorBalances(sol);
      const ario = Number(marioToArio(b.mario));
      setStat(stats, 1, `${ario.toLocaleString(undefined, { maximumFractionDigits: 2 })} ARIO`);
      setStat(stats, 2, `${b.sol.toLocaleString(undefined, { maximumFractionDigits: 4 })} SOL`);
      if (b.mario < MIN_OPERATOR_STAKE_ARIO * 1_000_000n) {
        stats.appendChild(el('p', { cls: 'parsec-view__desc', text: `Joining as a gateway needs ${MIN_OPERATOR_STAKE_ARIO.toLocaleString()} ARIO staked; serving and resolving names needs none.` }));
      }
    } catch (e) {
      setStat(stats, 1, 'unavailable'); setStat(stats, 2, 'unavailable');
      toast(`Balances: ${e instanceof Error ? e.message : String(e)}`, 'warning');
    }
    try {
      const gw = await getGatewayFor(sol);
      setStat(stats, 3, gw ? `joined · ${(gw as { settings?: { fqdn?: string } }).settings?.fqdn ?? 'fqdn unknown'}` : 'not joined');
    } catch { setStat(stats, 3, 'unavailable'); }
  })();

  return root;
}

function actions(hasSolana: boolean): HTMLElement {
  return el('div', {
    cls: 'parsec-confirm__details',
    children: [
      el('h4', { text: 'Do' }),
      el('div', { cls: 'parsec-dashboard__actions', children: [
        btn('My ar.io names', { intent: 'primary', icon: 'tag', disabled: !hasSolana, onClick: () => { setActiveNamespaceId('solana-arns'); store.navigate('name-hub'); } }),
        btn('Upload to Arweave', { outlined: true, icon: 'cloud-upload', onClick: () => store.navigate('permaweb-upload') }),
        btn('Bridge ARIO from Base', { outlined: true, icon: 'exchange', onClick: () => store.navigate('permaweb-bridge') }),
        btn('Join as a gateway', { outlined: true, icon: 'cloud-upload', disabled: !hasSolana, onClick: () => store.navigate('permaweb-gateway-join') }),
        btn('Send ARIO', { outlined: true, icon: 'send-message', disabled: !hasSolana, onClick: () => store.navigate('ario-transfer') }),
      ] }),
    ],
  });
}

function stat(label: string, value: string): HTMLElement {
  return el('div', { cls: 'parsec-permaweb__stat', children: [el('span', { text: label }), el('span', { text: value })] });
}
function setStat(grid: HTMLElement, i: number, value: string): void {
  const cell = grid.children[i]?.lastElementChild;
  if (cell) cell.textContent = value;
}
