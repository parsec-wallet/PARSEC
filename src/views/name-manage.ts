// Unified per-name management. Reads `parsec:active-name` from sessionStorage
// and routes every mutation through the active NamespaceAdapter. Optional
// sections (controllers, undername-limit) render only when the adapter
// declares the capability.

import { formatNameCost, warmArioPrice } from '../lib/names/cost-display';
import { el, btn, input, toast } from '../lib/dom';
import { store, getAccountAddress } from '../lib/store';
import {
  activeNamespaceId,
  getNamespace,
  type NamespaceAdapter,
  type NormalizedRecord,
} from '../lib/namespaces';

export function nameManageView(): HTMLElement {
  void warmArioPrice(); // costs gain their dollar value once the ARIO price is in
  const ns = getNamespace(activeNamespaceId());
  const name = sessionStorage.getItem('parsec:active-name') ?? '';

  const root = el('div', { cls: 'parsec-view parsec-confirm' });
  root.appendChild(el('div', {
    cls: 'parsec-view__header',
    children: [
      btn('Back', { minimal: true, icon: 'arrow-left', onClick: () => store.navigate('name-hub') }),
      el('h2', { cls: 'parsec-view__title', text: name ? `Manage "${name}"` : 'Manage name' }),
    ],
  }));

  if (!ns) {
    root.appendChild(el('p', { cls: 'parsec-empty', text: 'No namespace adapter registered.' }));
    return root;
  }
  if (!name) {
    root.appendChild(el('p', { cls: 'parsec-empty', text: 'No name selected. Pick one from the hub.' }));
    return root;
  }

  const body = el('div', { children: [el('p', { text: 'Loading...' })] });
  root.appendChild(body);
  void render(ns, name, body);
  return root;
}

async function render(ns: NamespaceAdapter, name: string, body: HTMLElement): Promise<void> {
  let record: NormalizedRecord | null;
  try { record = await ns.getRecord(name); } catch (e) {
    body.innerHTML = '';
    body.appendChild(el('p', { cls: 'parsec-empty', text: `Failed to load: ${e instanceof Error ? e.message : String(e)}` }));
    return;
  }
  if (!record) {
    body.innerHTML = '';
    body.appendChild(el('p', { cls: 'parsec-empty', text: 'Name not found.' }));
    return;
  }

  const s = store.get();
  const account = s.accounts[s.activeAccountIndex];
  const address = account ? (getAccountAddress(account, 'arweave-hd') ?? getAccountAddress(account, 'arweave')) : undefined;
  const isOwner = address && record.owner === address;
  const isController = address && (record.controllers ?? []).includes(address);
  const canMutate = isOwner || isController;

  body.innerHTML = '';

  body.appendChild(el('div', {
    cls: 'parsec-confirm__details',
    children: [
      row('Namespace', ns.displayName),
      row('Name', name),
      row('Type', record.type + (record.endTimestamp ? ` (expires ${new Date(record.endTimestamp).toLocaleDateString()})` : '')),
      row('Owner', truncAddr(record.owner)),
      ns.capabilities.controllers
        ? row('Controllers', record.controllers && record.controllers.length > 0 ? record.controllers.map(truncAddr).join(', ') : '—')
        : el('span', {}),
      row('Root @', record.rootTarget ?? '— not set —'),
      row('TTL', `${record.rootTtl}s`),
      row('Undernames', `${Object.keys(record.undernames).length}${record.undernameLimit !== undefined ? ` / ${record.undernameLimit}` : ''}`),
    ].filter(node => (node as HTMLElement).childNodes.length > 0) as HTMLElement[],
  }));

  if (!canMutate) {
    body.appendChild(el('div', {
      cls: 'parsec-callout bp5-callout bp5-intent-warning',
      children: [el('p', { text: 'You are not the owner or a controller. Mutations are read-only.' })],
    }));
    return;
  }
  if (!address) return;

  body.appendChild(buildRootSection(ns, name, record, address, () => void render(ns, name, body)));
  body.appendChild(buildUndernamesSection(ns, name, record, address, () => void render(ns, name, body)));
  if (record.type === 'lease') {
    body.appendChild(buildExtendSection(ns, name, address, () => void render(ns, name, body)));
  }
  if (ns.capabilities.increaseUndernameLimit && ns.increaseUndernameLimit) {
    body.appendChild(buildIncreaseUndernameSection(ns, name, address, record.undernameLimit ?? 10, () => void render(ns, name, body)));
  }
  body.appendChild(buildPrimarySection(ns, name, address));
  body.appendChild(buildTransferSection(ns, name, address, () => void render(ns, name, body)));
  if (ns.capabilities.controllers && ns.addController && ns.removeController) {
    body.appendChild(buildControllersSection(ns, name, address, record.controllers ?? [], () => void render(ns, name, body)));
  }
  body.appendChild(buildBindNftSection(ns, name));
  body.appendChild(buildMarketspaceSection(ns, name));
}

// ── Sections ────────────────────────────────────────────────

function buildRootSection(
  ns: NamespaceAdapter,
  name: string,
  record: NormalizedRecord,
  address: string,
  onChange: () => void,
): HTMLElement {
  const txInput = input({
    placeholder: 'Arweave tx-id (43 base64url chars)',
    cls: 'bp5-input bp5-fill',
    value: record.rootTarget ?? '',
  });
  return el('div', {
    cls: 'parsec-confirm__details',
    children: [
      el('h4', { text: 'Root record (@)' }),
      txInput,
      btn('Set @ target', {
        intent: 'primary',
        onClick: async () => {
          const v = txInput.value.trim();
          if (v.length !== 43 || !/^[A-Za-z0-9_-]+$/.test(v)) {
            toast('tx-id must be 43 base64url chars', 'warning');
            return;
          }
          await call(() => ns.setRootRecord({
            address,
            passphrase: store.getPassphrase()!,
            name,
            transactionId: v,
          }), '@ record set', onChange);
        },
      }),
    ],
  });
}

function buildUndernamesSection(
  ns: NamespaceAdapter,
  name: string,
  record: NormalizedRecord,
  address: string,
  onChange: () => void,
): HTMLElement {
  const subInput = input({ placeholder: 'subdomain (no dots)', cls: 'bp5-input' });
  const txInput = input({ placeholder: 'Arweave tx-id', cls: 'bp5-input bp5-fill' });
  const list = el('div', {
    children: Object.entries(record.undernames).map(([sub, val]) =>
      el('div', {
        cls: 'parsec-confirm__row',
        children: [
          el('span', { cls: 'parsec-confirm__label', text: sub }),
          el('span', { cls: 'parsec-confirm__value', text: truncAddr(val.transactionId) }),
          btn('Remove', {
            minimal: true,
            intent: 'danger',
            onClick: async () => {
              if (!confirm(`Remove undername "${sub}"?`)) return;
              try {
                await ns.removeUndername({ address, passphrase: store.getPassphrase()!, name, subdomain: sub });
                toast(`Removed ${sub}`, 'success');
                onChange();
              } catch (e) {
                toast(e instanceof Error ? e.message : String(e), 'warning');
              }
            },
          }),
        ],
      }),
    ),
  });

  return el('div', {
    cls: 'parsec-confirm__details',
    children: [
      el('h4', { text: `Undernames (${Object.keys(record.undernames).length})` }),
      list,
      subInput,
      txInput,
      btn('Add / update undername', {
        onClick: async () => {
          const sub = subInput.value.trim().toLowerCase();
          const tx = txInput.value.trim();
          if (!sub || sub === '@' || !/^[a-z0-9-]+$/.test(sub)) {
            toast('Subdomain must match a-z 0-9 -', 'warning'); return;
          }
          if (tx.length !== 43) { toast('tx-id must be 43 chars', 'warning'); return; }
          await call(() => ns.setUndername({ address, passphrase: store.getPassphrase()!, name, subdomain: sub, transactionId: tx }), `${sub} set`, onChange);
        },
      }),
    ],
  });
}

function buildExtendSection(ns: NamespaceAdapter, name: string, address: string, onChange: () => void): HTMLElement {
  const yearsInput = input({ placeholder: 'years (1-5)', cls: 'bp5-input', value: '1' });
  const costEl = el('span', { cls: 'parsec-confirm__value', text: 'unknown' });
  yearsInput.addEventListener('input', () => {
    const yrs = parseInt(yearsInput.value, 10);
    if (!Number.isFinite(yrs) || yrs < 1 || yrs > 5) return;
    void ns.getCost({ intent: 'Extend-Lease', name, years: yrs, purchaseType: 'lease' })
      .then((c) => { costEl.textContent = formatNameCost(c.amount, c.unit); })
      .catch(() => { /* ignore */ });
  });
  return el('div', {
    cls: 'parsec-confirm__details',
    children: [
      el('h4', { text: 'Extend lease' }),
      row('Cost', costEl),
      yearsInput,
      btn('Extend', {
        onClick: async () => {
          const yrs = parseInt(yearsInput.value, 10);
          if (!Number.isFinite(yrs) || yrs < 1 || yrs > 5) { toast('Years must be 1-5', 'warning'); return; }
          await call(() => ns.extendLease({ address, passphrase: store.getPassphrase()!, name, years: yrs }), 'Lease extended', onChange);
        },
      }),
    ],
  });
}

function buildIncreaseUndernameSection(
  ns: NamespaceAdapter,
  name: string,
  address: string,
  currentLimit: number,
  onChange: () => void,
): HTMLElement {
  const qtyInput = input({ placeholder: 'additional', cls: 'bp5-input', value: '10' });
  const costEl = el('span', { cls: 'parsec-confirm__value', text: 'unknown' });
  qtyInput.addEventListener('input', () => {
    const q = parseInt(qtyInput.value, 10);
    if (!Number.isFinite(q) || q < 1) return;
    void ns.getCost({ intent: 'Increase-Undername-Limit', name, quantity: q })
      .then((c) => { costEl.textContent = formatNameCost(c.amount, c.unit); })
      .catch(() => { /* ignore */ });
  });
  return el('div', {
    cls: 'parsec-confirm__details',
    children: [
      el('h4', { text: `Undername limit (current: ${currentLimit})` }),
      row('Cost', costEl),
      qtyInput,
      btn('Increase limit', {
        onClick: async () => {
          const q = parseInt(qtyInput.value, 10);
          if (!Number.isFinite(q) || q < 1) { toast('Quantity must be >= 1', 'warning'); return; }
          await call(() => ns.increaseUndernameLimit!({ address, passphrase: store.getPassphrase()!, name, quantity: q }), 'Undername limit increased', onChange);
        },
      }),
    ],
  });
}

function buildPrimarySection(ns: NamespaceAdapter, name: string, address: string): HTMLElement {
  return el('div', {
    cls: 'parsec-confirm__details',
    children: [
      el('h4', { text: 'Primary name' }),
      el('p', { cls: 'parsec-view__desc', text: 'Adapter handles the namespace-specific two-step flow internally.' }),
      btn('Request + acknowledge primary', {
        onClick: async () => {
          await call(() => ns.requestPrimary({ address, passphrase: store.getPassphrase()!, name }), 'Primary submitted', () => {});
        },
      }),
    ],
  });
}

function buildTransferSection(ns: NamespaceAdapter, name: string, address: string, onChange: () => void): HTMLElement {
  const toInput = input({ placeholder: 'destination Arweave address (43 chars)', cls: 'bp5-input bp5-fill' });
  return el('div', {
    cls: 'parsec-confirm__details',
    children: [
      el('h4', { text: 'Transfer ownership' }),
      toInput,
      btn('Transfer', {
        intent: 'danger',
        onClick: async () => {
          const to = toInput.value.trim();
          if (to.length !== 43) { toast('Must be a 43-char Arweave address', 'warning'); return; }
          if (!confirm(`Transfer "${name}" to ${truncAddr(to)}? Irreversible.`)) return;
          await call(() => ns.transferOwnership({ address, passphrase: store.getPassphrase()!, name, to }), 'Transferred', onChange);
        },
      }),
    ],
  });
}

function buildControllersSection(
  ns: NamespaceAdapter,
  name: string,
  address: string,
  current: string[],
  onChange: () => void,
): HTMLElement {
  const addInput = input({ placeholder: 'address to add', cls: 'bp5-input bp5-fill' });
  const removeInput = input({ placeholder: 'address to remove', cls: 'bp5-input bp5-fill' });
  return el('div', {
    cls: 'parsec-confirm__details',
    children: [
      el('h4', { text: `Controllers (${current.length})` }),
      ...current.map((c) => el('div', { cls: 'parsec-confirm__row', children: [el('span', { text: truncAddr(c) })] })),
      addInput,
      btn('Add controller', {
        onClick: async () => {
          if (addInput.value.trim().length !== 43) { toast('43 chars required', 'warning'); return; }
          await call(() => ns.addController!({ address, passphrase: store.getPassphrase()!, name, controller: addInput.value.trim() }), 'Controller added', onChange);
        },
      }),
      removeInput,
      btn('Remove controller', {
        intent: 'danger',
        onClick: async () => {
          if (removeInput.value.trim().length !== 43) { toast('43 chars required', 'warning'); return; }
          await call(() => ns.removeController!({ address, passphrase: store.getPassphrase()!, name, controller: removeInput.value.trim() }), 'Controller removed', onChange);
        },
      }),
    ],
  });
}

function buildBindNftSection(ns: NamespaceAdapter, name: string): HTMLElement {
  return el('div', {
    cls: 'parsec-confirm__details',
    children: [
      el('h4', { text: 'Bind an NFT' }),
      el('p', { cls: 'parsec-view__desc', text: 'Mint an Algorand ASA and bind its asset id into this name\'s records.' }),
      btn('Mint + bind an NFT', {
        intent: 'primary',
        icon: 'add',
        onClick: () => {
          sessionStorage.setItem('parsec:name-mint-namespace', ns.id);
          sessionStorage.setItem('parsec:name-mint-name', name);
          store.navigate('name-mint');
        },
      }),
    ],
  });
}

function buildMarketspaceSection(ns: NamespaceAdapter, name: string): HTMLElement {
  return el('div', {
    cls: 'parsec-confirm__details',
    children: [
      el('h4', { text: 'Marketspace' }),
      el('p', { cls: 'parsec-view__desc', text: 'List this name for sale on the BANKON Marketspace. Web mirror: agenticplace.pythai.net/marketspace.' }),
      btn('List for sale', {
        outlined: true,
        icon: 'shop',
        onClick: () => {
          sessionStorage.setItem('parsec:market-list-name', name);
          sessionStorage.setItem('parsec:market-list-namespace', ns.id);
          store.navigate('market-create');
        },
      }),
    ],
  });
}

// ── Helpers ─────────────────────────────────────────────────

async function call(
  fn: () => Promise<unknown>,
  successToast: string,
  onChange: () => void,
): Promise<void> {
  if (!store.getPassphrase()) {
    toast('Wallet is locked', 'danger');
    store.navigate('unlock');
    return;
  }
  try {
    await fn();
    toast(successToast, 'success');
    onChange();
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e), 'warning');
  }
}

function row(label: string, value: string | HTMLElement): HTMLElement {
  const valueNode = typeof value === 'string'
    ? el('span', { cls: 'parsec-confirm__value', text: value })
    : value;
  return el('div', {
    cls: 'parsec-confirm__row',
    children: [el('span', { cls: 'parsec-confirm__label', text: label }), valueNode],
  });
}

function truncAddr(a: string): string {
  if (!a) return '—';
  if (a.length <= 16) return a;
  return `${a.slice(0, 8)}...${a.slice(-6)}`;
}
