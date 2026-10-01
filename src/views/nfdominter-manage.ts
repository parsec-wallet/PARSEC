// My Names tab — the single owned-.algo surface (replaces the old, near-
// identical Mine + Manage tabs).
//
// Each name is a collapsed row by default: avatar, name, state, a "primary"
// badge. Click it to expand the management controls — linked addresses
// (with unlink), set-primary, edit display, and transfer. Every on-chain
// action reloads the list so the row reflects the new state.

import { storeEditor } from '../lib/ui/store-editor';
import algosdk from 'algosdk';

import { el, btn, toast, input } from '../lib/dom';
import { store, getAccountAddress } from '../lib/store';
import {
  linkAddress,
  unlinkAddress,
  setPrimaryNfd,
  setMetadata,
  offerNfdForTransfer,
  searchByOwner,
  resolveAddress,
  invalidateNfdCaches,
  type Nfd,
} from '../lib/nfd';
import { uploadData } from '../lib/arweave';
import type { NetworkId } from '../types/wallet';
import type { NfdominterTab } from './nfdominter';

export function buildNamesTab(
  owner: string,
  network: NetworkId,
  switchTab: (tab: NfdominterTab) => void,
): HTMLElement {
  const status = el('div', { cls: 'parsec-nfdominter__list-status', text: 'Loading your .algo names…' });
  const list = el('div', { cls: 'parsec-nfdominter__list' });
  const root = el('div', { cls: 'parsec-nfdominter__mine', children: [status, list] });

  async function load(): Promise<void> {
    status.textContent = 'Loading your .algo names…';
    list.innerHTML = '';
    try {
      const [resp, primary] = await Promise.all([
        searchByOwner(network, owner, { limit: 100, view: 'full' }),
        resolveAddress(network, owner).catch(() => null),
      ]);
      const primaryName = primary?.name ?? '';
      if (resp.total === 0) {
        status.textContent = '';
        list.appendChild(el('div', {
          cls: 'parsec-nfdominter__empty',
          children: [
            el('p', { cls: 'parsec-empty', text: 'You don’t own any .algo names yet.' }),
            btn('Claim your first .algo', {
              intent: 'primary', icon: 'plus', large: true,
              onClick: () => switchTab('mint'),
            }),
          ],
        }));
        return;
      }
      status.textContent = `${resp.total} .algo name${resp.total === 1 ? '' : 's'} owned.`;
      for (const nfd of resp.nfds) {
        list.appendChild(renderRow(nfd, owner, network, primaryName, resp.nfds.length, () => { void load(); }));
      }
    } catch (e) {
      status.textContent = '';
      toast(`Load failed: ${(e as Error).message}`, 'danger');
    }
  }

  void load();
  return root;
}

/** Avatar URL from the NFD's user-defined fields, normalized to https. */
function avatarUrl(nfd: Nfd): string | null {
  const raw = nfd.properties?.userDefined?.avatar;
  if (!raw) return null;
  if (raw.startsWith('http://') || raw.startsWith('https://')) return raw;
  if (raw.startsWith('ipfs://')) return `https://ipfs.io/ipfs/${raw.slice(7)}`;
  return null;
}

/**
 * NFD lease status. V3 names (Sept 2024+) carry an `expirationTime` and must
 * be renewed; pre-v2 names have none and never expire.
 */
function expiryStatus(nfd: Nfd): { text: string; soon: boolean } {
  const exp = nfd.properties?.internal?.expirationTime;
  if (!exp) return { text: 'Never expires (permanent legacy NFD)', soon: false };
  const ms = Number(exp) * 1000;
  if (!Number.isFinite(ms) || ms <= 0) return { text: 'Never expires', soon: false };
  const date = new Date(ms).toLocaleDateString();
  const days = Math.round((ms - Date.now()) / 86_400_000);
  if (days < 0) return { text: `Lease expired ${date}`, soon: true };
  if (days <= 60) return { text: `Renew by ${date} — ${days} day${days === 1 ? '' : 's'} left`, soon: true };
  return { text: `Leased — renew by ${date}`, soon: false };
}

function renderRow(
  nfd: Nfd,
  owner: string,
  network: NetworkId,
  primaryName: string,
  totalNames: number,
  reload: () => void,
): HTMLElement {
  const isPrimary = nfd.name === primaryName;

  // ── Collapsed header ────────────────────────────────────────────────────
  const avatar = avatarUrl(nfd);
  const avatarEl = avatar
    ? (() => {
        const img = el('img', { cls: 'parsec-nfdominter__row-avatar', attrs: { alt: '' } }) as HTMLImageElement;
        img.src = avatar;
        img.addEventListener('error', () => { img.replaceWith(placeholderAvatar(nfd.name)); });
        return img;
      })()
    : placeholderAvatar(nfd.name);

  const caret = el('span', { cls: 'parsec-nfdominter__row-caret', text: '›' });
  const header = el('div', {
    cls: 'parsec-nfdominter__row-head',
    children: [
      avatarEl,
      el('span', { cls: 'parsec-nfdominter__row-name', text: nfd.name }),
      ...(isPrimary ? [el('span', { cls: 'parsec-nfdominter__row-badge', text: 'primary' })] : []),
      el('span', { cls: 'parsec-nfdominter__row-state', text: nfd.state }),
      caret,
    ],
  });

  // ── Expandable body ─────────────────────────────────────────────────────
  const body = el('div', { cls: 'parsec-nfdominter__row-body', attrs: { hidden: 'true' } });
  const row = el('div', { cls: 'parsec-nfdominter__row', children: [header, body] });

  let built = false;
  header.addEventListener('click', () => {
    const open = body.hasAttribute('hidden');
    if (open && !built) { body.append(...buildControls()); built = true; }
    body.toggleAttribute('hidden');
    row.classList.toggle('parsec-nfdominter__row--open', open);
  });

  function buildControls(): HTMLElement[] {
    return [
      meta(),
      displayProfileGroup(nfd, owner, network),
      linkedAddressesGroup(nfd, owner, network, reload),
      primaryGroup(nfd, owner, network, isPrimary, totalNames, reload),
      transferGroup(nfd, owner, network, reload),
      // Root names only: a subdomain store sells label.yourname.algo.
      ...(/^[a-z0-9]+\.algo$/.test(nfd.name) ? [controlGroup('Subdomain store', [storeEditor(nfd.name, owner, network)])] : []),
    ];
  }

  function meta(): HTMLElement {
    const linked = nfd.caAlgo?.length ?? 0;
    const expiry = expiryStatus(nfd);
    return el('div', {
      cls: 'parsec-nfdominter__row-meta',
      children: [
        el('span', { text: `app ${nfd.appID ?? '—'}` }),
        ...(nfd.category ? [el('span', { text: nfd.category })] : []),
        el('span', { text: `${linked} linked address${linked === 1 ? '' : 'es'}` }),
        el('span', {
          cls: expiry.soon ? 'parsec-nfdominter__meta-warn' : '',
          text: expiry.text,
        }),
      ],
    });
  }

  return row;
}

function placeholderAvatar(name: string): HTMLElement {
  return el('div', {
    cls: 'parsec-nfdominter__row-avatar parsec-nfdominter__row-avatar--ph',
    text: name.slice(0, 1).toUpperCase(),
  });
}

// ── Control groups ────────────────────────────────────────────────────────

function controlGroup(label: string, children: HTMLElement[]): HTMLElement {
  return el('div', {
    cls: 'parsec-nfdominter__control-group',
    children: [el('span', { cls: 'parsec-nfdominter__control-label', text: label }), ...children],
  });
}

function linkedAddressesGroup(
  nfd: Nfd,
  owner: string,
  network: NetworkId,
  reload: () => void,
): HTMLElement {
  const rows: HTMLElement[] = (nfd.caAlgo ?? []).map((addr) => {
    const unlinkBtn = btn('Unlink', {
      minimal: true, icon: 'cross', cls: 'bp5-small',
      onClick: async () => {
        const pass = store.getPassphrase();
        if (!pass) { toast('Session locked. Unlock first.', 'warning'); return; }
        unlinkBtn.disabled = true;
        try {
          await unlinkAddress({ network, nfdNameOrAppId: nfd.name, owner, passphrase: pass }, addr);
          toast('Address unlinked.', 'success');
          reload();
        } catch (e) {
          toast(`Unlink failed: ${(e as Error).message}`, 'danger');
          unlinkBtn.disabled = false;
        }
      },
    });
    return el('div', {
      cls: 'parsec-nfdominter__linked-row',
      children: [
        el('span', { cls: 'parsec-nfdominter__mono', text: `${addr.slice(0, 8)}…${addr.slice(-6)}` }),
        unlinkBtn,
      ],
    });
  });

  const addrInput = input({ placeholder: 'Algorand address to link', cls: 'bp5-input bp5-small' });
  const linkBtn = btn('Link address', {
    minimal: true, icon: 'link', cls: 'bp5-small',
    onClick: async () => {
      const pass = store.getPassphrase();
      if (!pass) { toast('Session locked. Unlock first.', 'warning'); return; }
      const addr = addrInput.value.trim();
      if (!algosdk.isValidAddress(addr)) { toast('Enter a valid Algorand address.', 'warning'); return; }
      linkBtn.disabled = true;
      try {
        await linkAddress({ network, nfdNameOrAppId: nfd.name, owner, passphrase: pass }, addr);
        toast('Address linked.', 'success');
        reload();
      } catch (e) {
        toast(`Link failed: ${(e as Error).message}`, 'danger');
        linkBtn.disabled = false;
      }
    },
  });

  return controlGroup('Linked addresses', [
    ...(rows.length ? rows : [el('span', { cls: 'parsec-nfdominter__hint', text: 'No addresses linked yet.' })]),
    el('div', { cls: 'parsec-nfdominter__inline-form', children: [addrInput, linkBtn] }),
  ]);
}

function primaryGroup(
  nfd: Nfd,
  owner: string,
  network: NetworkId,
  isPrimary: boolean,
  totalNames: number,
  reload: () => void,
): HTMLElement {
  if (isPrimary) {
    // Already the address's primary — nothing to do, say so plainly.
    return controlGroup('Primary name', [
      el('span', {
        cls: 'parsec-nfdominter__primary-ok',
        text: `✓ ${nfd.name} is your primary name. Your wallet address already resolves to it everywhere — the dashboard, Receive, and other wallets.`,
      }),
    ]);
  }
  // With more than one name, this is a switch, not a first-time set.
  const multi = totalNames > 1;
  const primaryBtn = btn(multi ? 'Make this my primary' : 'Set as primary', {
    intent: 'primary', icon: 'star',
    onClick: async () => {
      const pass = store.getPassphrase();
      if (!pass) { toast('Session locked. Unlock first.', 'warning'); return; }
      primaryBtn.disabled = true;
      const ctx = { network, nfdNameOrAppId: nfd.name, owner, passphrase: pass };
      try {
        // Verifying the wallet address on the name is the real operation:
        // NFD requires that signed link before the name resolves to the
        // address at all. With a single verified name it is then already
        // the address's primary — NFD's explicit setPrimaryAddress (asserts
        // 2+ addresses) and setPrimaryNfd (asserts 2+ names) only
        // disambiguate when there are several.
        if (!(nfd.caAlgo ?? []).includes(owner)) {
          toast('Linking your address to the name…', 'primary');
          try {
            await linkAddress(ctx, owner);
          } catch (e) {
            // Tolerate an already-verified address (e.g. linked on a prior
            // attempt before this list was refreshed).
            if (!/already|verified|exist/i.test((e as Error).message)) throw e;
          }
        }
        // Designate it explicitly when the address has multiple names; with
        // one it is already primary and the registry asserts — harmless.
        try {
          await setPrimaryNfd(ctx, owner);
        } catch (e) {
          console.info('[nfdominter] single verified name — already primary:', e);
        }
        invalidateNfdCaches();
        toast(`${nfd.name} is now your primary name.`, 'success');
        reload();
      } catch (e) {
        toast(`Set primary failed: ${(e as Error).message}`, 'danger');
        primaryBtn.disabled = false;
      }
    },
  });
  return controlGroup('Primary name', [
    el('span', {
      cls: 'parsec-nfdominter__hint',
      text: multi
        ? 'You own more than one name — make this the one your address resolves to. The previous primary stays yours; only the display changes.'
        : 'Make this the name wallets and PARSEC show for your address. Your address is linked to it automatically first.',
    }),
    el('div', { cls: 'parsec-nfdominter__inline-form', children: [primaryBtn] }),
  ]);
}

// Display profile — the fields NFD shows in wallets and explorers. Prefilled
// from the already-loaded full NFD record; saving signs one metadata update.
function displayProfileGroup(nfd: Nfd, owner: string, network: NetworkId): HTMLElement {
  const ud = nfd.properties?.userDefined ?? {};
  const s = store.get();
  const account = s.accounts[s.activeAccountIndex];
  const arweaveAddr = account
    ? (getAccountAddress(account, 'arweave-hd') ?? getAccountAddress(account, 'arweave'))
    : undefined;

  const fieldEls: Record<string, HTMLInputElement | HTMLTextAreaElement> = {};
  function textField(key: string, label: string, placeholder: string, multiline = false): HTMLElement {
    let control: HTMLInputElement | HTMLTextAreaElement;
    if (multiline) {
      control = el('textarea', {
        cls: 'bp5-input parsec-nfdominter__edit-textarea',
        attrs: { rows: '2', placeholder },
      }) as HTMLTextAreaElement;
      control.value = ud[key] ?? '';
    } else {
      control = input({ placeholder, cls: 'bp5-input bp5-small', value: ud[key] ?? '' });
    }
    fieldEls[key] = control;
    return el('label', {
      cls: 'parsec-nfdominter__edit-field',
      children: [el('span', { cls: 'parsec-nfdominter__edit-label', text: label }), control],
    });
  }

  // ── Avatar: URL plus optional Arweave upload ───────────────────────────
  const avatarInput = input({ placeholder: 'https://… image URL', cls: 'bp5-input bp5-small', value: ud.avatar ?? '' });
  fieldEls.avatar = avatarInput;
  const avatarPreview = el('img', { cls: 'parsec-nfdominter__row-avatar', attrs: { alt: '' } }) as HTMLImageElement;
  const syncPreview = (): void => {
    const u = avatarInput.value.trim();
    if (u) { avatarPreview.src = u; avatarPreview.removeAttribute('hidden'); }
    else avatarPreview.setAttribute('hidden', 'true');
  };
  avatarInput.addEventListener('input', syncPreview);
  syncPreview();

  const uploadStatus = el('span', { cls: 'parsec-nfdominter__hint' });
  const avatarChildren: HTMLElement[] = [
    el('span', { cls: 'parsec-nfdominter__edit-label', text: 'Avatar image' }),
    el('div', { cls: 'parsec-nfdominter__inline-form', children: [avatarPreview, avatarInput] }),
  ];
  if (arweaveAddr) {
    const fileInput = el('input', {
      cls: 'parsec-nfdominter__file-input',
      attrs: { type: 'file', accept: 'image/*' },
    }) as HTMLInputElement;
    fileInput.addEventListener('change', () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      const pass = store.getPassphrase();
      if (!pass) { toast('Session locked. Unlock first.', 'warning'); return; }
      uploadStatus.textContent = `Uploading ${file.name}…`;
      void file.arrayBuffer()
        .then((buf) => uploadData(arweaveAddr, pass, {
          data: new Uint8Array(buf),
          tags: [{ name: 'Content-Type', value: file.type || 'image/png' }],
        }))
        .then((receipt) => {
          avatarInput.value = `https://arweave.net/${receipt.id}`;
          syncPreview();
          uploadStatus.textContent = 'Uploaded — permanent on Arweave.';
        })
        .catch((e: unknown) => {
          uploadStatus.textContent = '';
          toast(`Upload failed: ${e instanceof Error ? e.message : String(e)}`, 'danger');
        });
    });
    avatarChildren.push(el('div', {
      cls: 'parsec-nfdominter__inline-form',
      children: [el('span', { cls: 'parsec-nfdominter__hint', text: 'or upload an image →' }), fileInput, uploadStatus],
    }));
  }
  const avatarField = el('div', { cls: 'parsec-nfdominter__edit-field', children: avatarChildren });

  const saveBtn = btn('Save profile', {
    intent: 'primary', icon: 'floppy-disk',
    onClick: async () => {
      const pass = store.getPassphrase();
      if (!pass) { toast('Session locked. Unlock first.', 'warning'); return; }
      const metadata: Record<string, string> = {};
      for (const [key, control] of Object.entries(fieldEls)) {
        const v = control.value.trim();
        if (v) metadata[key] = v;
      }
      if (Object.keys(metadata).length === 0) { toast('Nothing to save.', 'warning'); return; }
      saveBtn.disabled = true;
      try {
        await setMetadata({ network, nfdNameOrAppId: nfd.name, owner, passphrase: pass }, metadata);
        toast(`Profile saved for ${nfd.name}.`, 'success');
      } catch (e) {
        toast(`Save failed: ${(e as Error).message}`, 'danger');
      } finally {
        saveBtn.disabled = false;
      }
    },
  });

  return controlGroup('Display profile', [
    el('p', {
      cls: 'parsec-nfdominter__hint',
      text: `${nfd.name} is your minted name — it never changes. These fields only control how it presents in wallets and explorers.`,
    }),
    textField('bio', 'Bio', 'A short description', true),
    textField('url', 'Website', 'https://…'),
    avatarField,
    textField('banner', 'Banner image URL', 'https://… (1500×500)'),
    el('div', { cls: 'parsec-nfdominter__inline-form', children: [saveBtn] }),
  ]);
}

function transferGroup(
  nfd: Nfd,
  owner: string,
  network: NetworkId,
  reload: () => void,
): HTMLElement {
  // NFD has no unilateral transfer: reserve the name for the recipient
  // (free, or at a price), and they claim it from their wallet.
  const recipientInput = input({ placeholder: 'Recipient Algorand address', cls: 'bp5-input bp5-small' });
  const priceInput = input({
    type: 'number', placeholder: '0', value: '0',
    cls: 'bp5-input bp5-small parsec-nfdominter__price-input',
  });
  priceInput.min = '0';

  const transferBtn = btn('Transfer name', {
    intent: 'warning', outlined: true, icon: 'send-to',
    onClick: async () => {
      const pass = store.getPassphrase();
      if (!pass) { toast('Session locked. Unlock first.', 'warning'); return; }
      if (!nfd.appID) { toast('NFD application id unknown — cannot transfer.', 'danger'); return; }
      const recipient = recipientInput.value.trim();
      if (!algosdk.isValidAddress(recipient)) { toast('Enter a valid recipient address.', 'warning'); return; }
      const algos = Math.max(0, Number(priceInput.value) || 0);
      const priceMicroAlgos = BigInt(Math.round(algos * 1_000_000));
      const verb = priceMicroAlgos > 0n ? `sell for ${algos} ALGO to` : 'gift to';
      if (!confirm(
        `Transfer ${nfd.name} — ${verb} ${recipient}?\n\n`
        + 'The recipient must claim it from their own wallet to complete the '
        + 'transfer. Until they do, you keep the name and can cancel the offer.',
      )) return;
      transferBtn.disabled = true;
      try {
        const txid = await offerNfdForTransfer({
          network, nfdAppId: nfd.appID, owner, passphrase: pass, recipient, priceMicroAlgos,
        });
        toast(`Offer sent (${txid.slice(0, 8)}…). ${recipient.slice(0, 6)}… can now claim ${nfd.name}.`, 'success');
        reload();
      } catch (e) {
        toast(`Transfer failed: ${(e as Error).message}`, 'danger');
        transferBtn.disabled = false;
      }
    },
  });

  return controlGroup('Send / transfer', [
    el('div', {
      cls: 'parsec-nfdominter__inline-form',
      children: [
        recipientInput,
        priceInput,
        el('span', { cls: 'parsec-nfdominter__hint', text: 'ALGO (0 = gift)' }),
        transferBtn,
      ],
    }),
  ]);
}
