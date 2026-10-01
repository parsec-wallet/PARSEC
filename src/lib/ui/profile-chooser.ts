// PARSEC Wallet — the profile chooser.
//
// One list, used on the Red Pill door and in Settings: every profile on this
// device, which one is open, whether it has a vault yet, and the public
// address of every wallet in it — so you can tell your vaults apart by what
// they hold, without a passphrase. Below the list: "New vault", which makes a
// new profile next to the others and never touches an existing vault.

import { el, btn, input, toast } from '../dom';
import { store } from '../store';
import { getChainDescriptor } from '../chains';
import { sovereignNotice } from './sovereign-notice';
import {
  listProfiles, toProfileName, validProfileName, shortAddress,
  DEFAULT_PROFILE, type ProfileInfo,
} from '../profiles';

export interface ChooserOptions {
  /** After a switch or a new profile. `created` is true for a new, empty one. */
  onChanged?: (name: string, created: boolean) => void;
  /** Open the "new vault" form straight away (the forgotten-passphrase path). */
  startCreating?: boolean;
  /** Compact: one line per wallet, no explanatory text (the Red Pill door). */
  compact?: boolean;
}

interface Row { label: string; chain: string; address: string; watchOnly?: boolean }

/** The wallets a profile holds: the mirror's names and chains, plus any
 *  address the vault holds that the mirror does not know (a lost mirror). */
export function walletsOf(p: ProfileInfo): Row[] {
  const rows: Row[] = [];
  const seen = new Set<string>();
  for (const a of p.mirror) {
    const chains = Object.entries(a.chains);
    if (chains.length === 0) chains.push(['algorand', a.address]);
    for (const [chain, address] of chains) {
      if (!address || seen.has(address)) continue;
      seen.add(address);
      rows.push({ label: a.name, chain, address, watchOnly: a.watchOnly });
    }
  }
  for (const a of p.accounts) {
    if (seen.has(a.address)) continue;
    seen.add(a.address);
    rows.push({ label: a.label || 'Account', chain: a.chain, address: a.address });
  }
  return rows;
}

function chainLabel(chain: string): string {
  try { return getChainDescriptor(chain).label; } catch { return chain; }
}

function vaultNote(p: ProfileInfo, n: number): string {
  if (!p.exists) return n ? 'no vault yet · watch-only' : 'no vault yet';
  return `vault · ${n} wallet${n === 1 ? '' : 's'}`;
}

export function profileChooser(opts: ChooserOptions = {}): HTMLElement {
  const root = el('div', { cls: `parsec-profiles${opts.compact ? ' parsec-profiles--compact' : ''}` });
  let creating = !!opts.startCreating;
  let busy = false;

  async function choose(name: string, created: boolean): Promise<void> {
    if (busy) return;
    busy = true;
    try {
      await store.useProfile(name);
      if (!created) toast(`Profile “${name}” selected`, 'success');
      opts.onChanged?.(name, created);
    } catch (e) {
      toast(`Could not switch profile: ${e instanceof Error ? e.message : String(e)}`, 'danger', 8000);
    } finally {
      busy = false;
      void render();
    }
  }

  function createForm(existing: Set<string>): HTMLElement {
    let typed = '';
    const hint = el('p', { cls: 'parsec-profiles__hint' });
    const field = input({
      placeholder: 'Profile name, e.g. agents or payto',
      cls: 'bp5-input parsec-profiles__name',
      onInput: (v) => {
        typed = v;
        const n = toProfileName(v);
        hint.textContent = !v ? ''
          : !n ? 'Use letters, digits, - or _.'
          : existing.has(n) ? `“${n}” already exists — choose it from the list.`
          : `Creates profile “${n}” with its own new vault.`;
      },
      onEnter: () => void submit(),
    });
    async function submit(): Promise<void> {
      const n = toProfileName(typed);
      if (!validProfileName(n)) { toast('Give the profile a name: letters, digits, - or _.', 'danger'); return; }
      if (existing.has(n)) { toast(`Profile “${n}” already exists.`, 'warning'); return; }
      creating = false;
      await choose(n, true);
      toast(`Profile “${n}” is ready. Create or restore a wallet; its vault passphrase is set on the way.`, 'success', 7000);
    }
    setTimeout(() => field.focus(), 50);
    return el('div', { cls: 'parsec-profiles__create', children: [
      ...(opts.compact ? [] : [el('p', { cls: 'parsec-profiles__hint', text:
        'A new vault is empty and has its own passphrase. Your other vaults stay exactly as they are. '
        + 'To bring a wallet across, restore it with its recovery phrase.' })]),
      field,
      hint,
      sovereignNotice(),
      el('div', { cls: 'parsec-profiles__create-actions', children: [
        btn('Create vault', { intent: 'primary', icon: 'add', onClick: () => void submit() }),
        btn('Cancel', { minimal: true, onClick: () => { creating = false; void render(); } }),
      ]}),
    ]});
  }

  async function render(): Promise<void> {
    const list = await listProfiles();
    root.replaceChildren();
    const names = new Set(list.profiles.map((p) => p.name));

    const rows = el('div', { cls: 'parsec-profiles__list', attrs: { role: 'list' } });
    for (const p of list.profiles) {
      const active = p.name === list.active;
      const wallets = walletsOf(p);
      const head = el('div', { cls: 'parsec-profiles__head', children: [
        el('span', { cls: 'parsec-profiles__pname', text: p.name === DEFAULT_PROFILE ? 'default' : p.name }),
        el('span', { cls: 'parsec-profiles__state', text: vaultNote(p, wallets.length) }),
        ...(active ? [el('span', { cls: 'parsec-profiles__badge', text: 'open' })] : []),
      ]});
      const body = el('div', { cls: 'parsec-profiles__wallets' });
      if (wallets.length === 0) {
        body.appendChild(el('div', { cls: 'parsec-profiles__empty', text: p.exists ? 'Vault is empty.' : 'Create or restore a wallet to start this vault.' }));
      }
      for (const w of wallets) {
        body.appendChild(el('div', { cls: 'parsec-profiles__wallet', attrs: { title: w.address }, children: [
          el('span', { cls: 'parsec-profiles__wlabel', text: w.label + (w.watchOnly ? ' (watch)' : '') }),
          el('span', { cls: 'parsec-profiles__wchain', text: chainLabel(w.chain) }),
          el('code', { cls: 'parsec-profiles__waddr', text: opts.compact ? shortAddress(w.address) : w.address }),
        ]}));
      }
      const row = el('div', {
        cls: `parsec-profiles__row${active ? ' parsec-profiles__row--active' : ''}`,
        attrs: { role: 'listitem', tabindex: active ? '-1' : '0', 'aria-current': active ? 'true' : 'false',
          title: active ? 'This profile is open' : `Switch to “${p.name}”` },
        children: [head, body],
        onClick: () => { if (!active) void choose(p.name, false); },
      });
      row.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !active) void choose(p.name, false); });
      rows.appendChild(row);
    }
    root.appendChild(rows);

    root.appendChild(creating
      ? createForm(names)
      : btn('New vault (new profile)', { outlined: true, icon: 'add', cls: 'parsec-profiles__new', onClick: () => { creating = true; void render(); } }));
  }

  void render();
  return root;
}
