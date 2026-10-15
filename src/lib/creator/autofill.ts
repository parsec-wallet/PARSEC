// Autofill — fill every empty field from what PARSEC already knows about the name and the account,
// and say where each value came from. Two rules hold everywhere: nothing is invented (a field with
// no source stays empty), and nothing the person typed is overwritten (a locked field, or one that
// already has a value, is left alone).

import type { NameIdentityFields } from '../names/controller-model';
import { getField, nextBlockId, setField, templateById, type Block, type FieldKey, type LinkBlock, type PageDoc } from './model';

/** One of the account's addresses, offered as a "receive" link. */
export interface ReceiveAddress {
  /** Display chain name, e.g. "Solana". */
  label: string;
  address: string;
  /** The payment URI, e.g. solana:<addr>. */
  uri: string;
}

export interface AutofillSources {
  /** The ArNS name the page is for. */
  name: string;
  /** The name's ANT identity, when the namespace adapter could read it. */
  identity?: NameIdentityFields | null;
  /** False when the logo id did not resolve on a gateway; undefined when not checked. */
  logoReachable?: boolean;
  /** The name's extensions (undernames), each a page of its own. */
  extensions?: readonly string[];
  /** The account's chain addresses. */
  addresses?: readonly ReceiveAddress[];
  /** Add a receive link per address. Off unless the person turns it on. */
  includeReceive?: boolean;
}

/** Where a value came from, said in the editor beside the field. */
export type FillSource = 'identity' | 'name' | 'template' | 'autogen' | 'tagline';

export const FILL_NOTES: Readonly<Record<FillSource, string>> = {
  identity: "filled from the name's identity",
  name: 'filled from the name',
  template: 'filled from the template',
  autogen: 'generated from the name',
  tagline: 'filled from the tagline',
};

export interface AutofillResult {
  doc: PageDoc;
  /** Each field PARSEC filled, and from where. */
  filled: Partial<Record<FieldKey, FillSource>>;
  /** How many blocks were added. */
  addedBlocks: number;
}

/** The payment URI for an address, by chain id; undefined when PARSEC knows no standard one. */
export function receiveUri(chainId: string, address: string): string | undefined {
  switch (chainId) {
    case 'bitcoin': return `bitcoin:${address}`;
    case 'litecoin': return `litecoin:${address}`;
    case 'ethereum': return `ethereum:${address}`;
    case 'solana': return `solana:${address}`;
    case 'algorand': return `algorand://${address}`;
    default: return undefined;
  }
}

/**
 * Fill the empty, unlocked fields of `doc` from `src`. `locked` holds the fields the person has
 * typed in this session: they are never touched, even when empty.
 */
export function autofill(doc: PageDoc, src: AutofillSources, locked: ReadonlySet<FieldKey> = new Set()): AutofillResult {
  const filled: Partial<Record<FieldKey, FillSource>> = {};
  let d = doc;
  const id = src.identity ?? null;
  const name = src.name.trim().toLowerCase();

  const fill = (k: FieldKey, v: string | undefined, from: FillSource): void => {
    const value = (v ?? '').trim();
    if (!value || locked.has(k) || getField(d, k).trim()) return;
    d = setField(d, k, value);
    filled[k] = from;
  };

  fill('displayName', id?.nickname, 'identity');
  fill('displayName', name, 'name');
  fill('title', id?.nickname, 'identity');
  fill('title', name.toUpperCase(), 'name');
  fill('tagline', id?.description, 'identity');
  // The SEO description repeats the tagline: what the page says it is, in one line.
  fill('seoDescription', getField(d, 'tagline'), filled.tagline ? 'identity' : 'tagline');
  fill('favicon', templateById(d.theme.template).favicon, 'template');
  if (id?.logo && /^[A-Za-z0-9_-]{43}$/.test(id.logo) && src.logoReachable !== false) fill('avatar', `ar://${id.logo}`, 'identity');
  fill('avatar', 'autogen', 'autogen');
  fill('ogImage', 'autogen', 'autogen');

  // Blocks: one link per extension, and (when asked) one receive link per address — each added once.
  const have = new Set(d.blocks.filter((b): b is LinkBlock => b.type === 'link').map((b) => b.url.trim().toLowerCase()));
  const added: Block[] = [];
  const add = (b: Omit<LinkBlock, 'id'>): void => {
    if (have.has(b.url.toLowerCase())) return;
    have.add(b.url.toLowerCase());
    added.push({ ...b, id: '' });
  };
  for (const ext of src.extensions ?? []) {
    if (!/^[a-z0-9-]{1,61}$/.test(ext)) continue;
    add({ type: 'link', label: ext, url: `https://${ext}_${name}.ar.io`, icon: '', auto: 'extension' });
  }
  if (src.includeReceive) {
    for (const a of src.addresses ?? []) {
      add({ type: 'link', label: `Receive · ${a.label} · ${a.address.slice(0, 6)}…${a.address.slice(-4)}`, url: a.uri, icon: '', auto: 'receive' });
    }
  }
  if (added.length) {
    const blocks = [...d.blocks];
    for (const b of added) blocks.push({ ...b, id: nextBlockId({ ...d, blocks }) } as Block);
    d = { ...d, blocks };
  }
  return { doc: d, filled, addedBlocks: added.length };
}
