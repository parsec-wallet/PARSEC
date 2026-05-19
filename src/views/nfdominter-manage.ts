// Mine + Manage tabs. Both show the active account's NFDs; "manage" adds
// quick actions (link address, set metadata, set primary) on each row via
// inline expanders. Heavier flows navigate to a dedicated review screen.

import { el, btn, toast, input } from '../lib/dom';
import { store } from '../lib/store';
import {
  linkAddress,
  setPrimaryAddress,
  searchByOwner,
  type Nfd,
} from '../lib/nfd';
import type { NetworkId } from '../types/wallet';

type Mode = 'mine' | 'manage';

export function buildMineTab(owner: string, network: NetworkId, mode: Mode): HTMLElement {
  const list = el('div', { cls: 'parsec-nfdominter__list' });
  const status = el('div', { cls: 'parsec-nfdominter__list-status', text: 'loading your NFDs…' });

  (async () => {
    try {
      const resp = await searchByOwner(network, owner, { limit: 100, view: 'brief' });
      status.textContent = resp.total === 0
        ? 'No NFDs owned by this account yet.'
        : `${resp.total} NFD${resp.total === 1 ? '' : 's'} owned.`;
      for (const nfd of resp.nfds) list.appendChild(renderOwnerRow(nfd, mode, owner, network));
    } catch (e) {
      status.textContent = '';
      toast(`Load failed: ${(e as Error).message}`, 'danger');
    }
  })();

  return el('div', {
    cls: `parsec-nfdominter__mine parsec-nfdominter__mine--${mode}`,
    children: [status, list],
  });
}

function renderOwnerRow(nfd: Nfd, mode: Mode, owner: string, network: NetworkId): HTMLElement {
  const header = el('div', {
    cls: 'parsec-nfdominter__row-head',
    children: [
      el('span', { cls: 'parsec-nfdominter__row-name', text: nfd.name }),
      el('span', { cls: 'parsec-nfdominter__row-state', text: nfd.state }),
    ],
  });

  const controls = el('div', { cls: 'parsec-nfdominter__row-controls' });

  if (mode === 'manage') {
    const addrInput = input({
      placeholder: 'Algorand address to link',
      cls: 'bp5-input bp5-small',
    });

    const linkBtn = btn('Link', {
      minimal: true,
      icon: 'link',
      onClick: async () => {
        const pass = store.getPassphrase();
        if (!pass) { toast('Session locked.', 'warning'); return; }
        linkBtn.disabled = true;
        try {
          await linkAddress(
            { network, nfdNameOrAppId: nfd.name, owner, passphrase: pass },
            addrInput.value.trim(),
          );
          toast('Linked. It may take a block to propagate.', 'success');
        } catch (e) {
          toast(`Link failed: ${(e as Error).message}`, 'danger');
        } finally {
          linkBtn.disabled = false;
        }
      },
    });

    const primaryBtn = btn('Set primary', {
      minimal: true,
      icon: 'star',
      onClick: async () => {
        const pass = store.getPassphrase();
        if (!pass) { toast('Session locked.', 'warning'); return; }
        primaryBtn.disabled = true;
        try {
          await setPrimaryAddress(
            { network, nfdNameOrAppId: nfd.name, owner, passphrase: pass },
            owner,
          );
          toast('Primary set for this address.', 'success');
        } catch (e) {
          toast(`Primary failed: ${(e as Error).message}`, 'danger');
        } finally {
          primaryBtn.disabled = false;
        }
      },
    });

    controls.append(addrInput, linkBtn, primaryBtn);
  }

  const body = el('div', {
    cls: 'parsec-nfdominter__row-body',
    children: [
      el('div', {
        cls: 'parsec-nfdominter__row-meta',
        children: [
          el('span', { text: `app ${nfd.appID}` }),
          el('span', { text: nfd.category }),
          ...(nfd.caAlgo?.length ? [el('span', { text: `${nfd.caAlgo.length} linked` })] : []),
        ],
      }),
      controls,
    ],
  });

  return el('div', { cls: 'parsec-nfdominter__row', children: [header, body] });
}
