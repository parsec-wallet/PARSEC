// Name controller — one screen that runs a name end-to-end: where it points, its undernames, its
// identity, who controls it, and the one irreversible action. Built for the Solana-era ar.io
// registry first (deltaverse, bankon) but driven entirely through the NamespaceAdapter, so BANKON
// and AO-era names get the same screen.
//
// House rules (TIMELESS): the first thing on screen is the one number and the next action; every
// write is followed by a live re-read; estimates are labelled; empty states point to the next step.

import { el, btn, input, toast } from '../lib/dom';
import { store } from '../lib/store';
import {
  activeNamespaceId,
  getNamespace,
  type NameIdentity,
  type NamespaceAdapter,
  type NormalizedRecord,
} from '../lib/namespaces';
import { addressChainFor, namespaceAddress } from '../lib/names/address';
import {
  TTL_OPTIONS,
  clampTtl,
  describeTarget,
  gatewayUrl,
  identityDiff,
  isArweaveId,
  parseKeywords,
  probeGateway,
  recordUrls,
  truncId,
  validateAddressFor,
  validateUndername,
} from '../lib/names/controller-model';
import { setUploadReturn, takeUploadedTarget } from '../lib/permaweb/handoff';

const C = 'parsec-namectl';

export function nameControllerView(): HTMLElement {
  const ns = getNamespace(activeNamespaceId());
  const name = sessionStorage.getItem('parsec:active-name') ?? '';

  const root = el('div', { cls: `parsec-view parsec-confirm ${C}` });
  root.appendChild(el('div', {
    cls: 'parsec-view__header',
    children: [
      btn('Back', { minimal: true, icon: 'arrow-left', onClick: () => store.navigate('name-hub') }),
      el('h2', { cls: 'parsec-view__title', text: name || 'Name controller' }),
      el('span', { cls: `${C}__ns`, text: ns?.displayName ?? '' }),
    ],
  }));

  if (!ns || !name) {
    root.appendChild(el('p', { cls: 'parsec-empty', text: !ns ? 'No namespace adapter registered.' : 'No name selected — pick one in the hub.' }));
    return root;
  }

  const body = el('div', { cls: `${C}__body`, children: [el('p', { cls: 'parsec-view__desc', text: `Reading ${name}…` })] });
  root.appendChild(body);
  void render(ns, name, body);
  return root;
}

interface Ctx {
  ns: NamespaceAdapter;
  name: string;
  address: string;
  record: NormalizedRecord;
  ownGateway?: string;
  reload: () => void;
}

async function render(ns: NamespaceAdapter, name: string, body: HTMLElement): Promise<void> {
  let record: NormalizedRecord | null;
  try { record = await ns.getRecord(name); } catch (e) {
    body.replaceChildren(el('p', { cls: 'parsec-empty', text: `Could not read ${name}: ${msg(e)}` }));
    return;
  }
  if (!record) {
    body.replaceChildren(
      el('p', { cls: 'parsec-empty', text: `${name} is not registered in ${ns.displayName}.` }),
      btn('Claim it', { intent: 'primary', onClick: () => { sessionStorage.setItem('parsec:claim-name', name); store.navigate('name-claim'); } }),
    );
    return;
  }

  const s = store.get();
  const account = s.accounts[s.activeAccountIndex];
  const address = account ? namespaceAddress(account, ns) : undefined;
  const isOwner = !!address && record.owner === address;
  const isController = !!address && (record.controllers ?? []).includes(address);
  const canWrite = isOwner || isController;
  const ownGateway = safeOwnGateway();

  body.replaceChildren();
  body.appendChild(header(ns, record, address, isOwner, isController));

  if (!canWrite) {
    const chain = addressChainFor(ns);
    body.appendChild(el('div', {
      cls: 'parsec-callout bp5-callout bp5-intent-warning',
      children: [
        el('p', { text: address
          ? `This account's ${chain === 'solana' ? 'Solana' : 'Arweave'} address (${truncId(address)}) is neither the owner nor a controller. You can look, not change.`
          : `This account has no ${chain === 'solana' ? 'Solana' : 'Arweave'} address yet — import the one that owns ${name} (${truncId(record.owner)}).` }),
        ...(address ? [] : [btn(chain === 'solana' ? 'Import Solana key' : 'Create Arweave wallet', {
          intent: 'primary', onClick: () => store.navigate(chain === 'solana' ? 'solana-import' : 'arweave-create'),
        })]),
      ],
    }));
    body.appendChild(targetSection({ ns, name, address: '', record, ownGateway, reload: () => {} }, false));
    body.appendChild(undernamesSection({ ns, name, address: '', record, ownGateway, reload: () => {} }, false));
    return;
  }

  const ctx: Ctx = { ns, name, address: address!, record, ownGateway, reload: () => void render(ns, name, body) };
  body.appendChild(targetSection(ctx, true));
  body.appendChild(undernamesSection(ctx, true));
  if (ns.getIdentity && ns.setIdentity) body.appendChild(await identitySection(ctx));
  body.appendChild(accessSection(ctx, isOwner));
  if (isOwner) body.appendChild(dangerSection(ctx));
}

// ── Header: the one number and the state stamps ──────────────────────────────

function header(ns: NamespaceAdapter, r: NormalizedRecord, address: string | undefined, isOwner: boolean, isController: boolean): HTMLElement {
  const t = describeTarget(r.rootTarget);
  const used = Object.keys(r.undernames).length;
  const role = isOwner ? 'You own this name' : isController ? 'You control this name' : 'Read-only';
  return el('div', {
    cls: `${C}__head`,
    children: [
      el('div', { cls: `${C}__stamps`, children: [
        stamp(r.type === 'permabuy' ? 'Permanent' : `Lease · ${r.endTimestamp ? new Date(r.endTimestamp).toLocaleDateString() : '?'}`, 'lock'),
        stamp(t.stamp, t.tone),
        stamp(role, isOwner || isController ? 'done' : 'lock'),
      ] }),
      el('div', { cls: `${C}__facts`, children: [
        fact('Owner', truncId(r.owner), r.owner),
        fact('Controllers', (r.controllers ?? []).length ? (r.controllers ?? []).map((c) => truncId(c)).join(', ') : 'none besides the owner'),
        fact('Undernames', `${used} / ${r.undernameLimit ?? '∞'}`),
        fact('Registry', ns.displayName),
        ...(address ? [fact('Signing as', truncId(address), address)] : []),
      ] }),
    ],
  });
}

// ── Where it points ───────────────────────────────────────────────────────────

function targetSection(ctx: Ctx, canWrite: boolean): HTMLElement {
  const { name, record } = ctx;
  const current = record.rootTarget;
  const t = describeTarget(current);

  const probeOut = el('div', { cls: `${C}__probes` });
  const urls = recordUrls(name, undefined, ctx.ownGateway);

  const sec = section('Where it points', [
    el('div', { cls: `${C}__target`, children: [
      el('span', { cls: `${C}__k`, text: 'Root (@) target' }),
      el('code', { cls: `${C}__id`, text: current ?? '— not set —', attrs: current ? { title: current } : {} }),
      el('span', { cls: `${C}__k`, text: `TTL ${record.rootTtl}s` }),
      ...(current ? [btn('Copy', { minimal: true, icon: 'duplicate', onClick: () => copy(current, 'Target id copied') })] : []),
    ] }),
    ...(t.tone === 'warn' ? [callout('This is still the ar.io placeholder page. Upload your site and point the name at it — both from here.')] : []),
    ...(t.tone === 'alert' ? [callout('Nothing is served for this name yet. Upload a file or a site, or paste an id below.')] : []),
    el('div', { cls: `${C}__links`, children: urls.map((u) => link(u)) }),
    el('div', { cls: `${C}__row`, children: [
      btn('Check what gateways serve', { outlined: true, icon: 'satellite', onClick: () => void runProbes(urls, current, probeOut) }),
    ] }),
    probeOut,
  ]);

  if (!canWrite) return sec;

  const txInput = input({ placeholder: 'Manifest or tx id — 43 characters', cls: 'bp5-input bp5-fill' });
  const hint = el('span', { cls: `${C}__hint` });
  txInput.addEventListener('input', () => {
    const v = txInput.value.trim();
    hint.textContent = !v ? '' : isArweaveId(v) ? (v === current ? 'Already the current target' : 'Looks like an Arweave id') : 'Needs exactly 43 base64url characters';
    hint.dataset.tone = !v ? '' : isArweaveId(v) && v !== current ? 'done' : 'warn';
  });
  // Coming back from the upload view: its id is waiting, once.
  const offered = takeUploadedTarget();
  if (offered) { txInput.value = offered; txInput.dispatchEvent(new Event('input')); }
  const uploadHere = btn('Upload a file or site', {
    outlined: true,
    icon: 'cloud-upload',
    onClick: () => { setUploadReturn('name-controller'); store.navigate('permaweb-upload'); },
  });
  const ttl = ttlSelect(record.rootTtl);
  const go = btn('Point the name here', {
    intent: 'primary',
    icon: 'send-to-map',
    onClick: async () => {
      const v = txInput.value.trim();
      if (!isArweaveId(v)) { toast('Target must be a 43-character Arweave id', 'warning'); return; }
      const ttlSeconds = clampTtl(Number(ttl.value));
      await write(ctx, () => ctx.ns.setRootRecord({ address: ctx.address, passphrase: pass(), name, transactionId: v, ttlSeconds }), `${name} now points at ${truncId(v)}`);
    },
  });
  sec.appendChild(el('div', { cls: `${C}__form`, children: [
    el('label', { text: 'Point the name at' }),
    txInput, hint, uploadHere,
    el('label', { text: 'Cache for' }), ttl,
    go,
  ] }));
  return sec;
}

// ── Undernames ────────────────────────────────────────────────────────────────

function undernamesSection(ctx: Ctx, canWrite: boolean): HTMLElement {
  const { name, record } = ctx;
  const entries = Object.entries(record.undernames).sort(([a], [b]) => a.localeCompare(b));
  const limit = record.undernameLimit;
  const atLimit = limit !== undefined && entries.length >= limit;

  const subInput = input({ placeholder: 'undername, e.g. docs', cls: 'bp5-input' });
  const txInput = input({ placeholder: 'Manifest or tx id — 43 characters', cls: 'bp5-input bp5-fill' });
  const ttl = ttlSelect(900);
  const preview = el('span', { cls: `${C}__hint` });
  const refreshPreview = (): void => {
    const v = validateUndername(subInput.value);
    preview.textContent = !subInput.value ? '' : v.ok ? `will be served at ${gatewayUrl(name, 'ar.io', v.value)}` : v.reason ?? '';
    preview.dataset.tone = !subInput.value ? '' : v.ok ? 'done' : 'warn';
  };
  subInput.addEventListener('input', refreshPreview);

  const rows = entries.length
    ? entries.map(([sub, v]) => el('div', {
      cls: `${C}__urow`,
      children: [
        el('a', { cls: `${C}__sub`, text: sub, attrs: { href: gatewayUrl(name, 'ar.io', sub), target: '_blank', rel: 'noopener', title: `${sub}_${name}.ar.io` } }),
        el('code', { cls: `${C}__id`, text: truncId(v.transactionId, 10, 8), attrs: { title: v.transactionId } }),
        el('span', { cls: `${C}__k`, text: `${v.ttlSeconds}s` }),
        ...(canWrite ? [
          btn('Edit', { minimal: true, icon: 'edit', onClick: () => { subInput.value = sub; txInput.value = v.transactionId; ttl.value = String(v.ttlSeconds); refreshPreview(); txInput.focus(); } }),
          btn('Remove', { minimal: true, intent: 'danger', icon: 'trash', onClick: () => void removeUndername(ctx, sub) }),
        ] : []),
      ],
    }))
    : [el('p', { cls: 'parsec-view__desc', text: canWrite
      ? `No undernames yet. Each one becomes <undername>_${name} on every gateway — docs, api, app are the usual first three.`
      : 'No undernames set.' })];

  const sec = section(`Undernames · ${entries.length}${limit !== undefined ? ` of ${limit}` : ''}`, rows);
  if (!canWrite) return sec;

  sec.appendChild(el('div', { cls: `${C}__form`, children: [
    el('label', { text: 'Add or update an undername' }),
    el('div', { cls: `${C}__row`, children: [subInput, txInput] }),
    preview,
    el('label', { text: 'Cache for' }), ttl,
    btn('Save undername', {
      intent: 'primary',
      icon: 'add',
      disabled: atLimit,
      onClick: async () => {
        const v = validateUndername(subInput.value);
        if (!v.ok) { toast(v.reason ?? 'Invalid undername', 'warning'); return; }
        const tx = txInput.value.trim();
        if (!isArweaveId(tx)) { toast('Target must be a 43-character Arweave id', 'warning'); return; }
        const isNew = !(v.value in record.undernames);
        if (isNew && atLimit) { toast(`All ${limit} undername slots are used — increase the limit first`, 'warning'); return; }
        await write(ctx, () => ctx.ns.setUndername({ address: ctx.address, passphrase: pass(), name, subdomain: v.value, transactionId: tx, ttlSeconds: clampTtl(Number(ttl.value)) }), `${v.value}_${name} saved`);
      },
    }),
  ] }));

  if (ctx.ns.capabilities.increaseUndernameLimit && ctx.ns.increaseUndernameLimit) {
    sec.appendChild(increaseLimitForm(ctx, limit ?? 10, atLimit));
  }
  return sec;
}

function increaseLimitForm(ctx: Ctx, limit: number, atLimit: boolean): HTMLElement {
  const qty = input({ placeholder: 'how many more', cls: 'bp5-input', value: '10' });
  const cost = el('span', { cls: `${C}__hint`, text: 'cost: —' });
  const quote = (): void => {
    const q = parseInt(qty.value, 10);
    if (!Number.isFinite(q) || q < 1) return;
    void ctx.ns.getCost({ intent: 'Increase-Undername-Limit', name: ctx.name, quantity: q })
      .then((c) => { cost.textContent = `cost: ${fmt(c.amount, c.unit)} (live quote)`; })
      .catch(() => { cost.textContent = 'cost: quote unavailable'; });
  };
  qty.addEventListener('input', quote);
  quote();
  return el('details', {
    cls: `${C}__more`,
    attrs: atLimit ? { open: '' } : {},
    children: [
      el('summary', { text: `Need more than ${limit} undernames?` }),
      el('div', { cls: `${C}__row`, children: [qty, cost] }),
      btn('Increase limit', {
        outlined: true,
        onClick: async () => {
          const q = parseInt(qty.value, 10);
          if (!Number.isFinite(q) || q < 1) { toast('Enter how many more slots you need', 'warning'); return; }
          await write(ctx, () => ctx.ns.increaseUndernameLimit!({ address: ctx.address, passphrase: pass(), name: ctx.name, quantity: q }), `Limit raised by ${q}`);
        },
      }),
    ],
  });
}

async function removeUndername(ctx: Ctx, sub: string): Promise<void> {
  // Inline confirm — no window.confirm(): the row turns into a question with two buttons.
  const host = document.querySelector(`.${C}__urow a[title="${sub}_${ctx.name}.ar.io"]`)?.parentElement;
  if (!host) return;
  host.replaceChildren(
    el('span', { text: `Remove ${sub}_${ctx.name}? Gateways stop serving it within its TTL.` }),
    btn('Remove', { intent: 'danger', onClick: async () => {
      await write(ctx, () => ctx.ns.removeUndername({ address: ctx.address, passphrase: pass(), name: ctx.name, subdomain: sub }), `${sub}_${ctx.name} removed`);
    } }),
    btn('Keep', { minimal: true, onClick: () => ctx.reload() }),
  );
}

// ── Identity ──────────────────────────────────────────────────────────────────

async function identitySection(ctx: Ctx): Promise<HTMLElement> {
  let current: NameIdentity;
  try { current = await ctx.ns.getIdentity!(ctx.name); } catch (e) {
    return section('Identity', [el('p', { cls: 'parsec-view__desc', text: `Could not read the token's identity: ${msg(e)}` })]);
  }
  const nick = input({ placeholder: 'nickname', cls: 'bp5-input', value: current.nickname });
  const ticker = input({ placeholder: 'ticker', cls: 'bp5-input', value: current.ticker });
  const desc = el('textarea', { cls: 'bp5-input bp5-fill', attrs: { rows: '2', placeholder: 'one sentence about this name' } }) as HTMLTextAreaElement;
  desc.value = current.description;
  const kw = input({ placeholder: 'keywords, comma separated', cls: 'bp5-input bp5-fill', value: current.keywords.join(', ') });
  const logo = input({ placeholder: 'logo image tx id (≤ 100 kB image on Arweave)', cls: 'bp5-input bp5-fill', value: current.logo });
  const logoPreview = el('img', { cls: `${C}__logo`, attrs: { alt: '', src: current.logo ? `https://arweave.net/${current.logo}` : '' } });
  logo.addEventListener('input', () => { logoPreview.setAttribute('src', isArweaveId(logo.value) ? `https://arweave.net/${logo.value.trim()}` : ''); });

  const pending = el('span', { cls: `${C}__hint` });
  const next = (): NameIdentity => ({ nickname: nick.value, ticker: ticker.value, description: desc.value, keywords: parseKeywords(kw.value), logo: logo.value });
  const refresh = (): void => {
    const d = Object.keys(identityDiff(current, next()));
    pending.textContent = d.length ? `${d.length} change${d.length > 1 ? 's' : ''} to sign: ${d.join(', ')}` : 'No changes';
    pending.dataset.tone = d.length ? 'warn' : '';
  };
  for (const i of [nick, ticker, desc, kw, logo]) i.addEventListener('input', refresh);
  refresh();

  return section('Identity', [
    el('p', { cls: 'parsec-view__desc', text: 'How explorers and gateways label this name. Each changed field is one signed transaction.' }),
    el('div', { cls: `${C}__grid`, children: [
      field('Nickname', nick), field('Ticker', ticker),
    ] }),
    field('Description', desc),
    field('Keywords', kw),
    el('div', { cls: `${C}__row`, children: [field('Logo', logo), logoPreview] }),
    pending,
    btn('Save identity', {
      intent: 'primary',
      icon: 'floppy-disk',
      onClick: async () => {
        const patch = identityDiff(current, next());
        if (!Object.keys(patch).length) { toast('Nothing changed', 'primary'); return; }
        if (patch.logo && !isArweaveId(patch.logo)) { toast('Logo must be a 43-character Arweave tx id', 'warning'); return; }
        await write(ctx, () => ctx.ns.setIdentity!({ address: ctx.address, passphrase: pass(), name: ctx.name, patch }), `Identity updated (${Object.keys(patch).join(', ')})`);
      },
    }),
  ]);
}

// ── Access: controllers + primary ─────────────────────────────────────────────

function accessSection(ctx: Ctx, isOwner: boolean): HTMLElement {
  const { ns, name, record } = ctx;
  const chain = addressChainFor(ns);
  const children: HTMLElement[] = [];

  if (ns.capabilities.controllers && ns.addController && ns.removeController) {
    const list = (record.controllers ?? []).filter((c) => c !== record.owner);
    children.push(el('p', { cls: 'parsec-view__desc', text: 'Controllers can change targets, undernames and identity, but cannot transfer the name.' }));
    children.push(...(list.length
      ? list.map((c) => el('div', { cls: `${C}__urow`, children: [
        el('code', { cls: `${C}__id`, text: truncId(c, 10, 8), attrs: { title: c } }),
        ...(isOwner ? [btn('Remove', { minimal: true, intent: 'danger', onClick: async () => {
          await write(ctx, () => ns.removeController!({ address: ctx.address, passphrase: pass(), name, controller: c }), `Controller ${truncId(c)} removed`);
        } })] : []),
      ] }))
      : [el('p', { cls: 'parsec-view__desc', text: 'Only the owner controls this name.' })]));
    if (isOwner) {
      const addr = input({ placeholder: chain === 'solana' ? 'Solana address of the new controller' : 'Arweave address of the new controller', cls: 'bp5-input bp5-fill' });
      const hint = el('span', { cls: `${C}__hint` });
      addr.addEventListener('input', () => { const v = validateAddressFor(chain, addr.value); hint.textContent = addr.value ? (v.ok ? 'Valid address' : v.reason ?? '') : ''; hint.dataset.tone = v.ok ? 'done' : 'warn'; });
      children.push(el('div', { cls: `${C}__form`, children: [
        el('label', { text: 'Add a controller — e.g. a deploy key for CI, a PARSEC service key' }),
        addr, hint,
        btn('Add controller', { outlined: true, icon: 'new-person', onClick: async () => {
          const v = validateAddressFor(chain, addr.value);
          if (!v.ok) { toast(v.reason ?? 'Invalid address', 'warning'); return; }
          await write(ctx, () => ns.addController!({ address: ctx.address, passphrase: pass(), name, controller: addr.value.trim() }), `Controller added`);
        } }),
      ] }));
    }
  }

  children.push(el('div', { cls: `${C}__form`, children: [
    el('label', { text: 'Primary name' }),
    el('p', { cls: 'parsec-view__desc', text: `Make ${name} the name gateways and explorers show for ${truncId(ctx.address)}.` }),
    btn('Set as my primary name', { outlined: true, icon: 'star', onClick: async () => {
      await write(ctx, () => ns.requestPrimary({ address: ctx.address, passphrase: pass(), name }), `Primary-name request sent for ${name}`);
    } }),
  ] }));

  return section('Access', children);
}

// ── Danger: transfer ──────────────────────────────────────────────────────────

function dangerSection(ctx: Ctx): HTMLElement {
  const chain = addressChainFor(ctx.ns);
  const to = input({ placeholder: chain === 'solana' ? 'new owner — Solana address' : 'new owner — Arweave address', cls: 'bp5-input bp5-fill' });
  const typed = input({ placeholder: `type ${ctx.name} to confirm`, cls: 'bp5-input' });
  const go = btn('Transfer ownership', { intent: 'danger', icon: 'warning-sign', disabled: true, onClick: async () => {
    const v = validateAddressFor(chain, to.value);
    if (!v.ok) { toast(v.reason ?? 'Invalid address', 'warning'); return; }
    await write(ctx, () => ctx.ns.transferOwnership({ address: ctx.address, passphrase: pass(), name: ctx.name, to: to.value.trim() }), `${ctx.name} transferred to ${truncId(to.value.trim())}`);
  } });
  const gate = (): void => { go.disabled = !(typed.value.trim() === ctx.name && validateAddressFor(chain, to.value).ok); };
  to.addEventListener('input', gate); typed.addEventListener('input', gate);
  return el('details', { cls: `${C}__danger`, children: [
    el('summary', { text: 'Transfer this name' }),
    el('p', { cls: 'parsec-view__desc', text: 'Irreversible. The new owner gets the token; your controllers are wiped.' }),
    to, typed, go,
  ] });
}

// ── Probes ────────────────────────────────────────────────────────────────────

async function runProbes(urls: string[], expected: string | undefined, out: HTMLElement): Promise<void> {
  out.replaceChildren(...urls.map((u) => el('div', { cls: `${C}__probe`, text: `${u} …` })));
  const results = await Promise.all(urls.map((u) => probeGateway(u, expected)));
  out.replaceChildren(...results.map((p) => {
    const state = p.error ? `unreachable (${p.error})`
      : !p.ok ? `HTTP ${p.status} — not indexed yet` // a fresh name takes a while to reach every gateway
        : p.matches === false ? `serving ${truncId(p.resolvedId)} — old copy, wait out the TTL`
          : p.matches ? 'serving the current target'
            : `serving ${truncId(p.resolvedId)}`;
    const tone = p.error || !p.ok ? 'alert' : p.matches === false ? 'warn' : 'done';
    return el('div', { cls: `${C}__probe`, attrs: { 'data-tone': tone }, children: [link(p.url), el('span', { text: state })] });
  }));
}

// ── Small parts ───────────────────────────────────────────────────────────────

function section(title: string, children: HTMLElement[]): HTMLElement {
  return el('section', { cls: `${C}__section parsec-confirm__details`, children: [el('h4', { text: title }), ...children] });
}
function stamp(text: string, tone: 'done' | 'warn' | 'alert' | 'lock'): HTMLElement {
  return el('span', { cls: `${C}__stamp`, attrs: { 'data-tone': tone }, text });
}
function fact(k: string, v: string, title?: string): HTMLElement {
  return el('div', { cls: `${C}__fact`, children: [el('span', { cls: `${C}__k`, text: k }), el('span', { cls: `${C}__v`, text: v, attrs: title ? { title } : {} })] });
}
function field(label: string, control: HTMLElement): HTMLElement {
  return el('div', { cls: `${C}__field`, children: [el('label', { text: label }), control] });
}
function callout(text: string): HTMLElement {
  return el('div', { cls: 'parsec-callout bp5-callout bp5-intent-warning', children: [el('p', { text })] });
}
function link(url: string): HTMLElement {
  return el('a', { text: url.replace(/^https:\/\//, ''), attrs: { href: url, target: '_blank', rel: 'noopener' } });
}
function ttlSelect(current: number): HTMLSelectElement {
  const opts = TTL_OPTIONS.some((o) => o.seconds === current) ? TTL_OPTIONS : [{ seconds: current, label: `${current} s — current` }, ...TTL_OPTIONS];
  const sel = el('select', { cls: 'bp5-input', children: opts.map((o) => el('option', { attrs: { value: String(o.seconds), ...(o.seconds === current ? { selected: 'selected' } : {}) }, text: o.label })) }) as HTMLSelectElement;
  return sel;
}
function copy(text: string, done: string): void {
  void navigator.clipboard.writeText(text).then(() => toast(done, 'success')).catch(() => toast('Clipboard unavailable', 'warning'));
}
function fmt(amount: bigint, unit: string): string {
  return unit === 'ARIO' ? `${(Number(amount) / 1e6).toLocaleString(undefined, { maximumFractionDigits: 2 })} ARIO` : `${amount.toString()} ${unit}`;
}
function pass(): string {
  return store.getPassphrase()!;
}
function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
/** The operator's own gateway FQDN, if the desk has recorded one (e.g. gw.bankon.pythai.net). */
function safeOwnGateway(): string | undefined {
  try { return localStorage.getItem('parsec:own-gateway') || undefined; } catch { return undefined; }
}

/** Every write: lock check → sign → toast → live re-read. Errors stay on screen long enough to copy. */
async function write(ctx: Ctx, fn: () => Promise<unknown>, done: string): Promise<void> {
  if (!store.getPassphrase()) { toast('Wallet is locked', 'danger'); store.navigate('unlock'); return; }
  try {
    await fn();
    toast(done, 'success');
    ctx.reload();
  } catch (e) {
    toast(msg(e), 'danger');
  }
}
