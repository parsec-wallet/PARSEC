// creator.agent — PARSEC's permanent page creator. ① LOAD · ② ARM · ③ DEPLOY.
//
// ① LOAD   start from the name's current page (any page: ours loads exactly, others are extracted),
//          a template, or blank — and autofill every empty field from what PARSEC already knows.
// ② ARM    edit with every field open, a live preview and one-click suggestions; arming states the
//          release (Launch or Deploy), the exact price, which key signs, and what the name will
//          point at.
// ③ DEPLOY 3 · 2 · 1 — three explicit confirmations (each a click or Enter, never a timer), then the
//          offer sheet, then upload + point, signed in the PARSEC Keycore. Forever: the new Target ID
//          is permanent, the previous version stays permanent, and rollback is pointing back.
//
// The preview is DOM inside the view, not an iframe: the app's CSP (default-src 'self') allows no
// blob: frames and no remote images, so remote images are fetched through the gateways the CSP
// already allows and shown as data: URIs, and anything else is drawn as a placeholder.

import { el, btn, input, toast, copyText } from '../lib/dom';
import { store, getAccountAddress } from '../lib/store';
import { isTauri } from '../lib/platform';
import { onCleanup } from '../lib/lifecycle';
import { formatDecimal } from '../lib/money';
import { openOffer } from '../lib/ui/offer';
import { activeNamespaceId, getNamespace, type NameIdentity, type NamespaceAdapter, type NormalizedRecord } from '../lib/namespaces';
import { namespaceAddress } from '../lib/names/address';
import {
  ARIO_PLACEHOLDER_TARGET,
  DETAILS_GATEWAY,
  gatewayUrl,
  probeGateway,
  readTargetInput,
  resolveNameTarget,
  truncId,
  validateUndername,
  type GatewayProbe,
} from '../lib/names/controller-model';
import { SIG_TYPE_SOLANA } from '../lib/arweave/ans104';
import {
  TurboError,
  WINC_DECIMALS,
  getTurboInfo,
  getTurboPriceWinc,
  planUpload,
  runUpload,
  solanaUploadSignerFor,
  uploadSignerFor,
  type TurboInfo,
  type UploadPlan,
  type UploadResult,
  type UploadSigner,
} from '../lib/arweave/turbo';
import { VERIFY_GATEWAYS, summarize, verifyUpload, type GatewayCheck } from '../lib/permaweb/verify';
import {
  BLOCK_TYPES,
  FIELD_LABELS,
  FONTS,
  SOCIAL_PLATFORMS,
  TEMPLATES,
  blankDoc,
  emptyBlock,
  getField,
  hostLabel,
  isHex6,
  moveBlock,
  newPageId,
  nextBlockId,
  nextRelease,
  releaseType,
  removeBlock,
  setField,
  templateById,
  templateDoc,
  themeFromTemplate,
  updateBlock,
  type Block,
  type BlockType,
  type FieldKey,
  type FontId,
  type PageDoc,
  type ReleaseType,
  type SocialPlatform,
  type TemplateId,
} from '../lib/creator/model';
import { FILL_NOTES, autofill, receiveUri, type FillSource, type ReceiveAddress } from '../lib/creator/autofill';
import { initials, sigilSvg } from '../lib/creator/autogen';
import { readableOn } from '../lib/creator/color';
import { importPage, simplifyHtml, simplifyWithDom, type ImportResult } from '../lib/creator/importer';
import { CARD_PNG, CARD_SVG, AVATAR_SVG, cardFor, renderPage, resolveUrl } from '../lib/creator/render';
import { suggest, type Suggestion } from '../lib/creator/suggest';
import { INFT_MINT_ENABLED, INFT_MINT_REASON, buildInftMetadata, inftJson } from '../lib/creator/inft';

const C = 'parsec-creator';
const MANIFEST_TYPE = 'application/x.arweave-manifest+json';
/** A page larger than this is not a page anyone wants to edit here. */
const MAX_PAGE_BYTES = 2 * 1024 * 1024;
const RECEIVE_CHAINS: readonly { id: string; label: string }[] = [
  { id: 'bitcoin', label: 'Bitcoin' }, { id: 'ethereum', label: 'Ethereum / Base' }, { id: 'solana', label: 'Solana' },
  { id: 'algorand', label: 'Algorand' }, { id: 'litecoin', label: 'Litecoin' },
];

type Step = 1 | 2 | 3;

interface AvatarFile { path: string; bytes: Uint8Array; contentType: string; dataUrl: string }

interface Deployed {
  upload: UploadResult;
  pointed: boolean;
  pointError?: string;
  checks?: GatewayCheck[];
  probe?: GatewayProbe;
  verifying: boolean;
  metadataId?: string;
}

interface St {
  step: Step;
  ns?: NamespaceAdapter;
  name: string;
  ext: string;
  reading: boolean;
  record?: NormalizedRecord | null;
  identity?: NameIdentity | null;
  logoReachable?: boolean;
  /** What the name (or extension) points at now. */
  target?: string | null;
  /** The page found at the target, whatever made it. */
  served?: ImportResult | null;
  servedNote: string;
  doc?: PageDoc;
  filled: Partial<Record<FieldKey, FillSource>>;
  touched: Set<FieldKey>;
  includeReceive: boolean;
  avatarFile?: AvatarFile;
  cardPng?: { key: string; bytes: Uint8Array | null };
  info?: TurboInfo;
  plan?: UploadPlan;
  planError?: string;
  /** undefined = not asked; null = no answer. */
  priceWinc?: bigint | null;
  confirmed: 0 | 1 | 2 | 3;
  busy: boolean;
  log: string[];
  deployed?: Deployed;
}

export function permawebCreateView(): HTMLElement {
  const s = store.get();
  const account = s.accounts[s.activeAccountIndex];
  const ns = getNamespace(activeNamespaceId()) ?? getNamespace('solana-arns');
  const arAddress = account ? getAccountAddress(account, 'arweave-hd') ?? getAccountAddress(account, 'arweave') : undefined;
  const solAddress = account && isTauri ? getAccountAddress(account, 'solana') : undefined;
  const payer: 'solana' | 'arweave' | null = solAddress && (ns?.addressChain === 'solana' || !arAddress) ? 'solana' : arAddress ? 'arweave' : solAddress ? 'solana' : null;
  const payerAddress = payer === 'solana' ? solAddress : payer === 'arweave' ? arAddress : undefined;
  const signerAddress = account && ns ? namespaceAddress(account, ns) : undefined;
  const back = readSession('parsec:creator-return') === 'name-controller' ? 'name-controller' : 'permaweb-desk';

  const st: St = {
    step: 1, ns, name: readSession('parsec:active-name') ?? '', ext: readSession('parsec:creator-ext') ?? '',
    reading: false, servedNote: '', filled: {}, touched: new Set(), includeReceive: false,
    confirmed: 0, busy: false, log: [],
  };
  const infoPromise = getTurboInfo();
  const imageCache = new Map<string, string | null>();
  let planTimer: ReturnType<typeof setTimeout> | undefined;
  let liveTimer: ReturnType<typeof setTimeout> | undefined;
  let planSeq = 0;
  onCleanup(() => { clearTimeout(planTimer); clearTimeout(liveTimer); });

  const root = el('div', { cls: `parsec-view parsec-confirm parsec-permaweb ${C}` });
  const stepper = el('div', { cls: `${C}__stepper`, attrs: { role: 'list', 'aria-label': 'Release steps' } });
  const badge = el('span', { cls: `${C}__release` });
  root.appendChild(el('div', {
    cls: 'parsec-view__header',
    children: [
      btn('Back', { minimal: true, icon: 'arrow-left', onClick: () => { writeSession('parsec:creator-return', null); store.navigate(back); } }),
      el('h2', { cls: 'parsec-view__title', text: 'Create a permanent page' }),
      badge,
    ],
  }));
  root.appendChild(stepper);
  const body = el('div', { cls: `${C}__body` });
  root.appendChild(body);

  // Live parts of ② ARM, updated in place so typing never loses focus.
  const preview = el('div', { cls: `${C}__pv`, attrs: { 'aria-label': 'Preview' } });
  const suggestBox = el('div', { cls: `${C}__suggest` });
  const armBox = el('div', { cls: `${C}__arm` });
  const logEl = el('pre', { cls: 'parsec-permaweb__log' });

  // ── Derived ───────────────────────────────────────────────────────────────

  const placeholder = ARIO_PLACEHOLDER_TARGET;
  const targetIsOurs = (): boolean => st.served?.source === 'parsec';
  const release = (): ReleaseType => releaseType(st.target, targetIsOurs(), placeholder);
  const releaseDoc = (): PageDoc | undefined => (st.doc ? nextRelease(st.doc, { target: st.target, page: targetIsOurs() ? st.served!.doc : null }, placeholder) : undefined);
  const host = (): string => hostLabel({ name: st.name, extension: st.ext });
  const canWrite = (): boolean => !!st.record && !!signerAddress && (st.record.owner === signerAddress || (st.record.controllers ?? []).includes(signerAddress));

  function receiveAddresses(): ReceiveAddress[] {
    if (!account) return [];
    const out: ReceiveAddress[] = [];
    for (const c of RECEIVE_CHAINS) {
      const a = getAccountAddress(account, c.id);
      const uri = a ? receiveUri(c.id, a) : undefined;
      if (a && uri) out.push({ label: c.label, address: a, uri });
    }
    return out;
  }

  // ── Rendering ─────────────────────────────────────────────────────────────

  function renderStepper(): void {
    const steps: [Step, string, string][] = [[1, '①', 'LOAD'], [2, '②', 'ARM'], [3, '③', 'DEPLOY']];
    stepper.replaceChildren(...steps.map(([n, mark, label]) => {
      const reachable = n === 1 || (n === 2 && !!st.doc) || (n === 3 && !!st.doc && st.step >= 2 && !!st.plan);
      const b = btn(`${mark} ${label}`, {
        minimal: st.step !== n, intent: st.step === n ? 'primary' : 'none', cls: `${C}__step`, disabled: !reachable || st.busy,
        onClick: () => go(n),
      });
      b.setAttribute('role', 'listitem');
      if (st.step === n) b.setAttribute('aria-current', 'step');
      return b;
    }));
    const r = st.doc ? release() : null;
    badge.textContent = r === 'launch' ? 'Launch' : r === 'deploy' ? 'Deploy' : '';
    badge.dataset.kind = r ?? '';
    badge.title = r === 'launch' ? 'First release to this address' : r === 'deploy' ? 'A new version of the page already here' : '';
  }

  function go(n: Step): void {
    if (n === 3 && st.step !== 3) st.confirmed = 0;
    st.step = n;
    render();
  }

  function render(): void {
    renderStepper();
    if (st.step === 1) body.replaceChildren(loadStep());
    else if (st.step === 2) body.replaceChildren(armStep());
    else body.replaceChildren(deployStep());
  }

  // ── ① LOAD ────────────────────────────────────────────────────────────────

  function loadStep(): HTMLElement {
    const nameIn = input({ placeholder: 'ArNS name, e.g. bankon', cls: 'bp5-input', value: st.name });
    const extIn = input({ placeholder: 'extension (optional), e.g. docs', cls: 'bp5-input', value: st.ext });
    const readBtn = btn(st.reading ? 'Reading…' : 'Read the name', {
      intent: st.record ? 'none' : 'primary', icon: 'search', disabled: st.reading || !ns,
      onClick: () => void readName(nameIn.value, extIn.value),
    });
    nameIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') void readName(nameIn.value, extIn.value); });
    extIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') void readName(nameIn.value, extIn.value); });

    const importIn = input({ placeholder: 'name, name_ext, ar://…, gateway link or Target ID', cls: 'bp5-input bp5-fill' });
    const importBtn = btn('Load this page', { outlined: true, icon: 'import', disabled: st.reading, onClick: () => void importAny(importIn.value) });
    importIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') void importAny(importIn.value); });

    const receive = checkbox(
      `Add a receive link for each of this account's addresses (${receiveAddresses().length} found). Off by default: a page is public forever.`,
      st.includeReceive, (v) => { st.includeReceive = v; },
    );

    const status: HTMLElement[] = [];
    if (st.record === null) status.push(callout(`${st.name} is not registered in ${ns?.displayName ?? 'this registry'}. You can still build the page; pointing needs the name.`));
    if (st.record) {
      status.push(el('div', { cls: `${C}__facts`, children: [
        fact('Address', `ar://${host()}`),
        fact('Points at', st.target ? (st.target === placeholder ? 'the ar.io placeholder' : truncId(st.target)) : 'nothing yet', st.target ?? undefined),
        fact('Found there', st.servedNote || '—'),
        fact('Identity', st.identity ? (st.identity.nickname || st.identity.description ? 'read' : 'empty') : st.identity === null ? 'not readable' : '—'),
        fact('You can point it', canWrite() ? 'yes' : signerAddress ? 'no — not the owner or a controller' : 'no key for this registry'),
      ] }));
    }

    const starts: HTMLElement[] = [];
    if (st.served) {
      starts.push(choice(
        st.served.source === 'parsec' ? `Edit the current page (v${st.served.doc.version})` : 'Edit the current page',
        st.served.notes.join(' '),
        () => start(cloneDoc(st.served!.doc)), true,
      ));
    }
    const tplGrid = el('div', { cls: `${C}__tpls`, children: TEMPLATES.map((t) => templateCard(t.id, () => start(templateDoc({ pageId: freshId(), name: st.name, extension: st.ext, template: t.id })))) });
    starts.push(el('div', { cls: `${C}__choice`, children: [el('strong', { text: 'Start from a template' }), el('span', { cls: `${C}__meta`, text: 'A few blocks to edit; nothing invented.' }), tplGrid] }));
    starts.push(choice('Blank page', 'Only what autofill knows.', () => start(blankDoc({ pageId: freshId(), name: st.name, extension: st.ext })), false));
    if (st.doc) starts.push(choice('Keep editing', 'Back to the page you were working on.', () => go(2), false));

    return el('div', { cls: `${C}__load`, children: [
      section('Which address', [
        el('p', { cls: 'parsec-view__desc', text: 'The page is for an ArNS name, or one of its extensions (served at extension_name). Read it to see what it serves now and what PARSEC can fill in.' }),
        el('div', { cls: `${C}__row`, children: [nameIn, extIn, readBtn] }),
        ...status,
      ]),
      section('Start from', [...starts, receive]),
      section('Or load any page', [
        el('p', { cls: 'parsec-view__desc', text: 'A PARSEC page loads exactly. An ar.io Pages page loads from its embedded data when it has some. Anything else is read from its HTML — every field stays editable.' }),
        el('div', { cls: `${C}__row`, children: [importIn, importBtn] }),
      ]),
    ] });
  }

  async function readName(rawName: string, rawExt: string): Promise<void> {
    const name = rawName.trim().toLowerCase().replace(/^ar:\/\//, '');
    if (!/^[a-z0-9-]{1,51}$/.test(name)) { toast('Enter an ArNS name: a–z, 0–9 and hyphens', 'warning'); return; }
    const extV = rawExt.trim() ? validateUndername(rawExt) : { ok: true, value: '' };
    if (!extV.ok) { toast(extV.reason ?? 'Invalid extension', 'warning'); return; }
    if (!ns) return;
    Object.assign(st, { name, ext: extV.value, reading: true, record: undefined, identity: undefined, target: undefined, served: undefined, servedNote: '', logoReachable: undefined });
    writeSession('parsec:active-name', name);
    writeSession('parsec:creator-ext', extV.value || null);
    render();
    try {
      const [record, identity] = await Promise.all([
        ns.getRecord(name).catch(() => null),
        ns.getIdentity ? ns.getIdentity(name).catch(() => null) : Promise.resolve(null),
      ]);
      st.record = record;
      st.identity = identity;
      st.target = record ? (extV.value ? record.undernames[extV.value]?.transactionId ?? null : record.rootTarget ?? null) : null;
      if (identity?.logo && /^[A-Za-z0-9_-]{43}$/.test(identity.logo)) st.logoReachable = (await arImage(identity.logo)) !== null;
      if (st.target && st.target !== placeholder) {
        try {
          const page = await fetchPage(st.target);
          st.served = importPage(page.simple, { pageId: freshId(), name, extension: extV.value, paths: page.paths });
          st.servedNote = st.served.source === 'parsec' ? `a PARSEC page, v${st.served.doc.version}` : st.served.source === 'ario-pages' ? 'a page-builder page' : 'a page not made here';
        } catch (e) {
          st.served = null;
          st.servedNote = msg(e);
        }
      } else {
        st.servedNote = st.target === placeholder ? 'the ar.io placeholder — this will be a Launch' : 'nothing yet — this will be a Launch';
      }
    } finally {
      st.reading = false;
      render();
    }
  }

  async function importAny(raw: string): Promise<void> {
    const v = raw.trim();
    if (!v) { toast('Paste a name, an ar:// link, a gateway link or a Target ID', 'warning'); return; }
    st.reading = true;
    render();
    try {
      let id: string | null = null;
      let r = readTargetInput(v);
      if (r.kind === 'invalid' && /^[a-z0-9_-]{1,113}$/i.test(v)) r = readTargetInput(`ar://${v.toLowerCase()}`);
      if (r.kind === 'id') id = r.id;
      else if (r.kind === 'name') {
        id = await resolveNameTarget(r.name, r.undername);
        if (!id) throw new Error(`ar://${r.undername ? `${r.undername}_` : ''}${r.name} does not resolve on ar.io`);
      } else if (r.kind === 'ipfs' || r.kind === 'invalid') throw new Error(r.note);
      if (!id) throw new Error('Nothing to load');
      if (id === placeholder) throw new Error('That is the ar.io placeholder page — start from a template instead.');
      const page = await fetchPage(id);
      const result = importPage(page.simple, { pageId: freshId(), name: st.name, extension: st.ext, paths: page.paths });
      toast(result.notes[0] ?? 'Loaded', 'success');
      start(cloneDoc(result.doc));
    } catch (e) {
      toast(msg(e), 'warning');
    } finally {
      st.reading = false;
      if (st.step === 1) render();
    }
  }

  /** Begin editing `doc`: keep it on this name, restore its private labels, then autofill. */
  function start(doc: PageDoc): void {
    let d: PageDoc = { ...doc, domain: { name: st.name || doc.domain.name, extension: st.ext } };
    if (!d.pageId) d.pageId = freshId();
    d = { ...d, settings: { ...d.settings, labels: readLabels(d.pageId) } };
    st.touched = new Set();
    st.avatarFile = undefined;
    const r = autofill(d, {
      name: d.domain.name, identity: st.identity ?? null, logoReachable: st.logoReachable,
      extensions: st.ext ? [] : Object.keys(st.record?.undernames ?? {}), addresses: receiveAddresses(), includeReceive: st.includeReceive,
    });
    st.doc = r.doc;
    st.filled = r.filled;
    if (r.addedBlocks) toast(`Autofill added ${r.addedBlocks} block${r.addedBlocks === 1 ? '' : 's'}`, 'primary');
    st.deployed = undefined;
    st.log = [];
    go(2);
    schedulePlan(0);
  }

  // ── ② ARM ─────────────────────────────────────────────────────────────────

  function armStep(): HTMLElement {
    const doc = st.doc!;
    refreshLive();
    return el('div', { cls: `${C}__arm-step`, children: [
      el('div', { cls: `${C}__editor`, children: [
        profileSection(doc),
        blocksSection(doc),
        themeSection(doc),
        settingsSection(doc),
        domainSection(doc),
      ] }),
      el('div', { cls: `${C}__side`, children: [
        section('Preview', [preview, el('p', { cls: `${C}__meta`, text: 'Drawn here from the same document the page is rendered from. Links do not open in the preview.' })]),
        section('Suggestions', [suggestBox]),
        section('Arm', [armBox]),
      ] }),
    ] });
  }

  /** The document changed: refresh preview, suggestions and arming (not the editor). */
  function changed(structural = false): void {
    st.confirmed = 0;
    if (structural) { render(); } else { clearTimeout(liveTimer); liveTimer = setTimeout(refreshLive, 120); }
    schedulePlan();
  }

  function refreshLive(): void {
    if (!st.doc) return;
    renderPreview(st.doc);
    renderSuggestions();
    renderArm();
    renderStepper();
  }

  function fieldNote(k: FieldKey): HTMLElement {
    const src = st.filled[k];
    return el('span', { cls: `${C}__auto`, text: src ? FILL_NOTES[src] : '' });
  }

  function textField(k: FieldKey, opts: { multiline?: boolean; placeholder?: string; max?: number } = {}): HTMLElement {
    const value = getField(st.doc!, k);
    const control = opts.multiline
      ? (el('textarea', { cls: 'bp5-input bp5-fill', attrs: { rows: '3', placeholder: opts.placeholder ?? '' } }) as HTMLTextAreaElement)
      : input({ cls: 'bp5-input bp5-fill', placeholder: opts.placeholder ?? '', value });
    if (control instanceof HTMLTextAreaElement) control.value = value;
    const note = fieldNote(k);
    const count = el('span', { cls: `${C}__count` });
    const showCount = (): void => {
      if (!opts.max) return;
      const n = control.value.trim().length;
      count.textContent = `${n} / ${opts.max}`;
      count.dataset.tone = n > opts.max ? 'warn' : '';
    };
    showCount();
    control.addEventListener('input', () => {
      st.doc = setField(st.doc!, k, control.value);
      st.touched.add(k);
      if (st.filled[k]) { delete st.filled[k]; note.textContent = ''; }
      showCount();
      changed();
    });
    return el('div', { cls: `${C}__field`, children: [
      el('label', { children: [FIELD_LABELS[k], note, count] }), control,
    ] });
  }

  function profileSection(doc: PageDoc): HTMLElement {
    const fileIn = document.createElement('input');
    fileIn.type = 'file';
    fileIn.accept = 'image/png,image/jpeg,image/webp';
    fileIn.hidden = true;
    fileIn.addEventListener('change', () => { const f = fileIn.files?.[0]; fileIn.value = ''; if (f) void useAvatarFile(f); });
    const av = doc.profile.avatar;
    const mode = av === 'autogen' ? 'Generated sigil' : !av ? 'Initials' : st.avatarFile && av === st.avatarFile.path ? 'Your image (resized to 512 px)' : 'Image from a link';
    const avatarLink = input({ cls: 'bp5-input bp5-fill', placeholder: 'or ar://<id> / https://… image', value: /^(ar|https?):/i.test(av) ? av : '' });
    avatarLink.addEventListener('change', () => setAvatar(avatarLink.value.trim()));
    return section('Profile', [
      el('div', { cls: `${C}__avatar`, children: [
        el('div', { cls: `${C}__field`, children: [
          el('label', { children: ['Avatar', fieldNote('avatar'), el('span', { cls: `${C}__count`, text: mode })] }),
          el('div', { cls: `${C}__row`, children: [
            btn('Generated sigil', { minimal: av !== 'autogen', outlined: av === 'autogen', onClick: () => setAvatar('autogen') }),
            btn('Upload PNG / JPG / WebP', { minimal: true, icon: 'upload', onClick: () => fileIn.click() }),
            btn('Initials', { minimal: av !== '', outlined: av === '', onClick: () => setAvatar('') }),
          ] }),
          avatarLink, fileIn,
        ] }),
      ] }),
      textField('displayName', { placeholder: 'Your name or the project’s' }),
      textField('tagline', { placeholder: 'What you do, in a line', max: 120 }),
      textField('intro', { multiline: true, placeholder: 'A short intro (optional)' }),
    ]);
  }

  function setAvatar(v: string): void {
    st.doc = setField(st.doc!, 'avatar', v);
    st.touched.add('avatar');
    delete st.filled.avatar;
    changed(true);
  }

  async function useAvatarFile(f: File, maxPx = 512, quality = 0.85): Promise<void> {
    try {
      const out = await resizeImage(f, maxPx, quality);
      st.avatarFile = out;
      setAvatar(out.path);
      toast(`Avatar ready: ${fmtBytes(out.bytes.length)}`, 'success');
    } catch (e) {
      toast(`Could not read that image: ${msg(e)}`, 'warning');
    }
  }

  async function recompressAvatar(): Promise<void> {
    const a = st.avatarFile;
    if (!a) { setAvatar('autogen'); return; }
    try {
      const out = await resizeImage(new Blob([a.bytes as unknown as BlobPart], { type: a.contentType }), 256, 0.6);
      st.avatarFile = out;
      setAvatar(out.path);
      toast(`Avatar recompressed: ${fmtBytes(a.bytes.length)} → ${fmtBytes(out.bytes.length)}`, 'success');
    } catch (e) {
      toast(msg(e), 'warning');
    }
  }

  function blocksSection(doc: PageDoc): HTMLElement {
    const typeSel = el('select', { cls: 'bp5-input', attrs: { 'aria-label': 'Block type' }, children: BLOCK_TYPES.map((b) => el('option', { attrs: { value: b.type }, text: b.label })) }) as HTMLSelectElement;
    const rows = doc.blocks.map((b, i) => blockEditor(b, i, doc.blocks.length));
    return section(`Blocks · ${doc.blocks.length}`, [
      ...(rows.length ? rows : [el('p', { cls: 'parsec-view__desc', text: 'No blocks yet. Add links, headings, text, images, embeds, a social row, a button or a verify badge.' })]),
      el('div', { cls: `${C}__row`, children: [
        typeSel,
        btn('Add block', { outlined: true, icon: 'add', onClick: () => {
          const d = st.doc!;
          st.doc = { ...d, blocks: [...d.blocks, emptyBlock(typeSel.value as BlockType, nextBlockId(d))] };
          changed(true);
        } }),
      ] }),
    ]);
  }

  function blockEditor(b: Block, i: number, n: number): HTMLElement {
    const patch = (p: Partial<Block>): void => { st.doc = updateBlock(st.doc!, b.id, p); changed(); };
    const text = (label: string, value: string, set: (v: string) => void, placeholder = ''): HTMLElement => {
      const c = input({ cls: 'bp5-input bp5-fill', placeholder, value });
      c.addEventListener('input', () => set(c.value));
      return el('div', { cls: `${C}__field`, children: [el('label', { text: label }), c] });
    };
    const area = (label: string, value: string, set: (v: string) => void): HTMLElement => {
      const c = el('textarea', { cls: 'bp5-input bp5-fill', attrs: { rows: '3' } }) as HTMLTextAreaElement;
      c.value = value;
      c.addEventListener('input', () => set(c.value));
      return el('div', { cls: `${C}__field`, children: [el('label', { text: label }), c] });
    };
    let fields: HTMLElement[] = [];
    switch (b.type) {
      case 'link': fields = [
        text('Label', b.label, (v) => patch({ label: v })),
        text('URL or ar://', b.url, (v) => patch({ url: v }), 'https://… or ar://name'),
        text('Icon (emoji, optional)', b.icon, (v) => patch({ icon: v.slice(0, 16) })),
      ]; break;
      case 'heading': fields = [text('Heading', b.text, (v) => patch({ text: v }))]; break;
      case 'text': fields = [area('Text', b.text, (v) => patch({ text: v }))]; break;
      case 'image': fields = [
        text('Image (ar://<id> or https://…)', b.src, (v) => patch({ src: v })),
        text('Alt text', b.alt, (v) => patch({ alt: v }), 'What the image shows'),
      ]; break;
      case 'embed': fields = [
        text('Embed URL (https or ar://)', b.url, (v) => patch({ url: v })),
        text('Title', b.title, (v) => patch({ title: v })),
      ]; break;
      case 'divider': fields = []; break;
      case 'button': fields = [text('Label', b.label, (v) => patch({ label: v })), text('URL or ar://', b.url, (v) => patch({ url: v }))]; break;
      case 'verify': fields = [text('Label', b.label, (v) => patch({ label: v })), text('Verify URL', b.url, (v) => patch({ url: v }))]; break;
      case 'social': fields = [socialEditor(b.id, b.links)]; break;
    }
    const label = BLOCK_TYPES.find((t) => t.type === b.type)?.label ?? b.type;
    const autoNote = b.auto === 'extension' ? "filled from the name's extensions" : b.auto === 'receive' ? "filled from this account's addresses" : b.auto === 'import' ? 'loaded from the page' : b.auto === 'identity' ? "filled from the name's identity" : '';
    return el('div', { cls: `${C}__block`, attrs: { 'data-type': b.type }, children: [
      el('div', { cls: `${C}__block-head`, children: [
        el('strong', { text: label }),
        el('span', { cls: `${C}__auto`, text: autoNote }),
        btn('Up', { minimal: true, icon: 'arrow-up', disabled: i === 0, onClick: () => { st.doc = moveBlock(st.doc!, b.id, -1); changed(true); } }),
        btn('Down', { minimal: true, icon: 'arrow-down', disabled: i === n - 1, onClick: () => { st.doc = moveBlock(st.doc!, b.id, 1); changed(true); } }),
        btn('Remove', { minimal: true, intent: 'danger', icon: 'trash', onClick: () => { st.doc = removeBlock(st.doc!, b.id); changed(true); } }),
      ] }),
      ...fields,
    ] });
  }

  function socialEditor(id: string, links: { platform: SocialPlatform; url: string }[]): HTMLElement {
    const set = (next: { platform: SocialPlatform; url: string }[], structural: boolean): void => {
      st.doc = updateBlock(st.doc!, id, { links: next });
      changed(structural);
    };
    const rows = links.map((l, i) => {
      const sel = el('select', { cls: 'bp5-input', attrs: { 'aria-label': 'Platform' }, children: SOCIAL_PLATFORMS.map((p) => el('option', { attrs: { value: p, ...(p === l.platform ? { selected: 'selected' } : {}) }, text: p })) }) as HTMLSelectElement;
      const url = input({ cls: 'bp5-input', placeholder: l.platform === 'email' ? 'you@example.com' : 'https://…', value: l.url });
      sel.addEventListener('change', () => set(links.map((x, j) => (j === i ? { ...x, platform: sel.value as SocialPlatform } : x)), false));
      url.addEventListener('input', () => { links = links.map((x, j) => (j === i ? { ...x, url: url.value } : x)); set(links, false); });
      return el('div', { cls: `${C}__row`, children: [sel, url, btn('Remove', { minimal: true, icon: 'cross', onClick: () => set(links.filter((_, j) => j !== i), true) })] });
    });
    return el('div', { cls: `${C}__field`, children: [
      el('label', { text: 'Platform links' }),
      ...rows,
      btn('Add a platform', { minimal: true, icon: 'add', onClick: () => set([...links, { platform: 'website', url: '' }], true) }),
    ] });
  }

  function themeSection(doc: PageDoc): HTMLElement {
    const t = doc.theme;
    const setTheme = (p: Partial<PageDoc['theme']>, structural = false): void => { st.doc = { ...st.doc!, theme: { ...st.doc!.theme, ...p } }; changed(structural); };
    const colour = (label: string, value: string, set: (v: string) => void): HTMLElement => {
      const pick = input({ type: 'color', cls: `${C}__swatch`, value });
      const hex = input({ cls: 'bp5-input', value, placeholder: '#rrggbb' });
      pick.setAttribute('aria-label', `${label} colour`);
      pick.addEventListener('input', () => { hex.value = pick.value; set(pick.value.toLowerCase()); });
      hex.addEventListener('input', () => { if (isHex6(hex.value.trim())) { pick.value = hex.value.trim(); set(hex.value.trim().toLowerCase()); } });
      return el('div', { cls: `${C}__field`, children: [el('label', { text: label }), el('div', { cls: `${C}__row`, children: [pick, hex] })] });
    };
    const select = <T extends string>(label: string, value: T, options: readonly [T, string][], set: (v: T) => void): HTMLElement => {
      const s = el('select', { cls: 'bp5-input', children: options.map(([v, l]) => el('option', { attrs: { value: v, ...(v === value ? { selected: 'selected' } : {}) }, text: l })) }) as HTMLSelectElement;
      s.addEventListener('change', () => set(s.value as T));
      return el('div', { cls: `${C}__field`, children: [el('label', { text: label }), s] });
    };
    return section('Theme', [
      el('div', { cls: `${C}__tpls`, children: TEMPLATES.map((tp) => templateCard(tp.id, () => {
        const wasFav = !st.doc!.settings.favicon || st.filled.favicon === 'template' || st.doc!.settings.favicon === templateById(st.doc!.theme.template).favicon;
        st.doc = { ...st.doc!, theme: themeFromTemplate(tp.id, st.doc!.theme), settings: { ...st.doc!.settings, favicon: wasFav ? tp.favicon : st.doc!.settings.favicon } };
        changed(true);
      }, tp.id === t.template)) }),
      el('div', { cls: `${C}__grid`, children: [
        select<FontId>('Font', t.font, (Object.keys(FONTS) as FontId[]).map((f) => [f, FONTS[f].label]), (v) => setTheme({ font: v })),
        colour('Accent', t.accent, (v) => setTheme({ accent: v })),
        colour('Text', t.text, (v) => setTheme({ text: v })),
        select<'solid' | 'gradient'>('Background', t.background.kind, [['solid', 'Solid'], ['gradient', 'Gradient']], (v) => setTheme({ background: { ...st.doc!.theme.background, kind: v } }, true)),
        colour(t.background.kind === 'gradient' ? 'Background from' : 'Background', t.background.from, (v) => setTheme({ background: { ...st.doc!.theme.background, from: v } })),
        ...(t.background.kind === 'gradient' ? [colour('Background to', t.background.to, (v) => setTheme({ background: { ...st.doc!.theme.background, to: v } }))] : []),
        select('Button shape', t.buttonShape, [['pill', 'Pill'], ['rounded', 'Rounded'], ['square', 'Square']], (v) => setTheme({ buttonShape: v })),
        select('Header', t.align, [['center', 'Centred'], ['left', 'Left']], (v) => setTheme({ align: v })),
        select('Width', t.width, [['standard', 'Standard'], ['wide', 'Wide']], (v) => setTheme({ width: v })),
      ] }),
    ]);
  }

  function settingsSection(doc: PageDoc): HTMLElement {
    const og = doc.settings.ogImage;
    const ogLink = input({ cls: 'bp5-input bp5-fill', placeholder: 'or ar://<id> / https://… image', value: og && og !== 'autogen' ? og : '' });
    const setOg = (v: string): void => { st.doc = setField(st.doc!, 'ogImage', v); st.touched.add('ogImage'); delete st.filled.ogImage; changed(true); };
    ogLink.addEventListener('change', () => setOg(ogLink.value.trim()));

    const tagRows = doc.settings.tags.map((t, i) => {
      const n = input({ cls: 'bp5-input', placeholder: 'Name', value: t.name });
      const v = input({ cls: 'bp5-input', placeholder: 'Value', value: t.value });
      const upd = (): void => { const tags = st.doc!.settings.tags.map((x, j) => (j === i ? { name: n.value, value: v.value } : x)); st.doc = { ...st.doc!, settings: { ...st.doc!.settings, tags } }; changed(); };
      n.addEventListener('input', upd); v.addEventListener('input', upd);
      return el('div', { cls: `${C}__row`, children: [n, v, btn('Remove', { minimal: true, icon: 'cross', onClick: () => { st.doc = { ...st.doc!, settings: { ...st.doc!.settings, tags: st.doc!.settings.tags.filter((_, j) => j !== i) } }; changed(true); } })] });
    });
    const labels = input({ cls: 'bp5-input bp5-fill', placeholder: 'private labels, comma separated', value: doc.settings.labels.join(', ') });
    labels.addEventListener('input', () => {
      const list = Array.from(new Set(labels.value.split(',').map((x) => x.trim()).filter(Boolean))).slice(0, 32);
      st.doc = { ...st.doc!, settings: { ...st.doc!.settings, labels: list } };
      writeLabels(st.doc.pageId, list);
    });
    const note = input({ cls: 'bp5-input bp5-fill', placeholder: 'What changed in this version (optional, public)', value: doc.versionNote });
    note.addEventListener('input', () => { st.doc = { ...st.doc!, versionNote: note.value.slice(0, 300) }; changed(); });

    return section('Page settings', [
      textField('title', { placeholder: 'Shown in the tab', max: 60 }),
      textField('seoTitle', { placeholder: 'Optional: overrides the title in search and previews', max: 60 }),
      textField('seoDescription', { multiline: true, placeholder: 'One or two sentences for search and social previews', max: 160 }),
      textField('favicon', { placeholder: 'One emoji, e.g. 🌙' }),
      el('div', { cls: `${C}__field`, children: [
        el('label', { children: ['Social image', fieldNote('ogImage')] }),
        el('div', { cls: `${C}__row`, children: [
          btn('Generated card', { minimal: og !== 'autogen', outlined: og === 'autogen', onClick: () => setOg('autogen') }),
          btn('None', { minimal: og !== '', outlined: og === '', onClick: () => setOg('') }),
        ] }),
        ogLink,
      ] }),
      el('div', { cls: `${C}__field`, children: [
        el('label', { text: 'Custom Arweave tags (added to the page item, public)' }),
        ...tagRows,
        btn('Add a tag', { minimal: true, icon: 'add', onClick: () => { st.doc = { ...st.doc!, settings: { ...st.doc!.settings, tags: [...st.doc!.settings.tags, { name: '', value: '' }] } }; changed(true); } }),
      ] }),
      el('div', { cls: `${C}__field`, children: [el('label', { text: 'Private labels (kept on this device, never uploaded)' }), labels] }),
      el('div', { cls: `${C}__field`, children: [el('label', { text: 'Version note' }), note] }),
    ]);
  }

  function domainSection(doc: PageDoc): HTMLElement {
    const r = releaseDoc()!;
    const history = [...(st.target && st.target !== placeholder ? [st.target] : []), ...r.previous.filter((p) => p !== st.target)];
    return section('Address and versions', [
      el('div', { cls: `${C}__facts`, children: [
        fact('Address', `ar://${hostLabel(doc.domain) || '—'}`),
        fact('Release', `${release() === 'launch' ? 'Launch' : 'Deploy'} · version ${r.version}`),
        fact('Page id', truncId(r.pageId, 8, 4), r.pageId),
      ] }),
      el('p', { cls: `${C}__meta`, text: 'To change the name or extension, go back to ① LOAD. Earlier versions stay permanent; rollback points the name back at one.' }),
      historyList(history),
    ]);
  }

  function historyList(ids: string[]): HTMLElement {
    if (!ids.length) return el('p', { cls: `${C}__meta`, text: 'No earlier versions at this address.' });
    return el('div', { cls: `${C}__history`, children: ids.map((id, i) => el('div', { cls: `${C}__hrow`, children: [
      el('code', { text: truncId(id, 10, 8), attrs: { title: id } }),
      el('span', { cls: `${C}__meta`, text: id === st.target ? 'served now' : `earlier · ${i}` }),
      el('a', { text: 'open', attrs: { href: `https://arweave.net/${id}`, target: '_blank', rel: 'noopener' } }),
      ...(id !== st.target && canWrite() ? [btn('Point back', { minimal: true, icon: 'undo', onClick: () => rollback(id) })] : []),
    ] })) });
  }

  // ── Preview (DOM, styled through custom properties — no inline style attributes) ──

  function renderPreview(doc: PageDoc): void {
    const t = doc.theme;
    const bg = t.background.kind === 'gradient' ? `linear-gradient(160deg, ${t.background.from}, ${t.background.to})` : t.background.from;
    const set = (k: string, v: string): void => preview.style.setProperty(k, v);
    set('--cp-bg', bg);
    set('--cp-fg', t.text);
    set('--cp-ac', t.accent);
    set('--cp-on', readableOn(t.accent));
    set('--cp-r', t.buttonShape === 'pill' ? '999px' : t.buttonShape === 'rounded' ? '10px' : '0');
    set('--cp-font', FONTS[t.font].stack);
    preview.dataset.align = t.align;
    const display = doc.profile.displayName.trim() || doc.settings.title.trim() || doc.domain.name || 'Your page';
    const avatar = previewImage(doc.profile.avatar === 'autogen' ? 'autogen' : doc.profile.avatar);
    const head = el('div', { cls: `${C}__pv-head`, children: [
      avatar ? el('img', { cls: `${C}__pv-av`, attrs: { src: avatar, alt: '' } }) : el('div', { cls: `${C}__pv-av ${C}__pv-av--initials`, text: initials(display) }),
      el('div', { cls: `${C}__pv-name`, text: display }),
      ...(doc.profile.tagline.trim() ? [el('div', { cls: `${C}__pv-tag`, text: doc.profile.tagline.trim() })] : []),
      ...(doc.profile.intro.trim() ? [el('div', { cls: `${C}__pv-txt`, text: doc.profile.intro.trim() })] : []),
    ] });
    preview.replaceChildren(head, ...doc.blocks.map(previewBlock).filter((x): x is HTMLElement => !!x), el('div', { cls: `${C}__pv-foot`, text: `ar://${hostLabel(doc.domain) || 'name'} · v${releaseDoc()?.version ?? 1}` }));
  }

  function previewBlock(b: Block): HTMLElement | null {
    switch (b.type) {
      case 'link': return b.url.trim() && resolveUrl(b.url) ? el('div', { cls: `${C}__pv-link`, attrs: { title: b.url }, children: [...(b.icon ? [el('span', { text: b.icon })] : []), el('span', { text: b.label.trim() || b.url.trim() })] }) : null;
      case 'heading': return b.text.trim() ? el('div', { cls: `${C}__pv-h`, text: b.text.trim() }) : null;
      case 'text': return b.text.trim() ? el('div', { cls: `${C}__pv-txt`, text: b.text.trim() }) : null;
      case 'image': {
        if (!b.src.trim()) return null;
        const src = previewImage(b.src);
        return src ? el('img', { cls: `${C}__pv-img`, attrs: { src, alt: b.alt } }) : el('div', { cls: `${C}__pv-ph`, text: `Image · ${b.alt || b.src}` });
      }
      case 'embed': return b.url.trim() ? el('div', { cls: `${C}__pv-ph`, text: `Embed · ${b.title || b.url}` }) : null;
      case 'divider': return el('hr', { cls: `${C}__pv-hr` });
      case 'social': {
        const items = b.links.filter((l) => l.url.trim());
        return items.length ? el('div', { cls: `${C}__pv-soc`, children: items.map((l) => el('span', { text: l.platform })) }) : null;
      }
      case 'button': return b.label.trim() && b.url.trim() ? el('div', { cls: `${C}__pv-btn`, text: b.label.trim() }) : null;
      case 'verify': return b.url.trim() ? el('div', { cls: `${C}__pv-ver`, text: `✓ ${b.label.trim() || 'Verified'}` }) : null;
    }
  }

  /** A data: URI the CSP allows for the preview, or null (drawn as a placeholder / initials). */
  function previewImage(src: string): string | null {
    const v = src.trim();
    if (!v) return null;
    if (v === 'autogen') return svgDataUrl(sigilSvg(hostLabel(st.doc!.domain) || 'page', st.doc!.theme.accent));
    if (st.avatarFile && v === st.avatarFile.path) return st.avatarFile.dataUrl;
    const m = /^ar:\/\/([A-Za-z0-9_-]{43})$/.exec(v) ?? /^https:\/\/(?:arweave\.net|turbo-gateway\.com)\/([A-Za-z0-9_-]{43})$/.exec(v);
    if (!m) return null;
    const cached = imageCache.get(m[1]);
    if (cached !== undefined) return cached;
    void arImage(m[1]).then((u) => { if (u && st.doc) renderPreview(st.doc); });
    return null;
  }

  async function arImage(id: string): Promise<string | null> {
    if (imageCache.has(id)) return imageCache.get(id) ?? null;
    imageCache.set(id, null);
    try {
      const res = await fetch(`${DETAILS_GATEWAY}/raw/${id}`);
      const type = (res.headers.get('content-type') ?? '').split(';')[0].trim();
      if (!res.ok || !/^image\/(png|jpeg|webp|gif|svg\+xml|avif)$/.test(type)) return null;
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.length > 1024 * 1024) return null;
      const url = `data:${type};base64,${toB64(bytes)}`;
      imageCache.set(id, url);
      return url;
    } catch {
      return null;
    }
  }

  // ── Suggestions ───────────────────────────────────────────────────────────

  function renderSuggestions(): void {
    if (!st.doc) return;
    const known: Record<string, string> = {};
    for (const ext of Object.keys(st.record?.undernames ?? {})) known[gatewayUrl(st.name, 'arweave.net', ext)] = `ar://${ext}_${st.name}`;
    const list = suggest(st.doc, {
      launch: release() === 'launch',
      known,
      ...(st.plan ? { sizes: [...st.plan.items.map((i) => ({ path: i.path, size: i.size })), ...(st.plan.manifest ? [{ path: '(manifest)', size: st.plan.manifest.size }] : [])], freeLimit: st.plan.freeLimit } : {}),
    });
    if (!list.length) { suggestBox.replaceChildren(el('p', { cls: `${C}__meta`, text: 'Nothing to suggest — the page reads well.' })); return; }
    suggestBox.replaceChildren(...list.map((sg) => el('div', { cls: `${C}__sg`, attrs: { 'data-id': sg.id }, children: [
      el('div', { cls: `${C}__sg-text`, children: [el('strong', { text: sg.title }), el('span', { cls: `${C}__meta`, text: sg.why })] }),
      ...(sg.apply || sg.action ? [btn(sg.action === 'launch' ? 'Arm the Launch' : 'Apply', { outlined: true, onClick: () => applySuggestion(sg) })] : []),
    ] })));
  }

  function applySuggestion(sg: Suggestion): void {
    if (sg.action === 'recompress-avatar') { void recompressAvatar(); return; }
    if (sg.action === 'launch') { if (st.plan) go(3); else toast('Waiting for the size and price', 'primary'); return; }
    if (!sg.apply || !st.doc) return;
    const before = st.doc;
    st.doc = sg.apply(st.doc);
    for (const k of Object.keys(FIELD_LABELS) as FieldKey[]) if (getField(before, k) !== getField(st.doc, k)) { st.touched.add(k); delete st.filled[k]; }
    toast(`Applied: ${sg.title}`, 'success');
    changed(true);
  }

  // ── Planning: the exact files, sizes and price ─────────────────────────────

  function schedulePlan(ms = 400): void {
    clearTimeout(planTimer);
    planTimer = setTimeout(() => void replan(), ms);
  }

  async function replan(): Promise<void> {
    const doc = releaseDoc();
    if (!doc) return;
    const seq = ++planSeq;
    st.info ??= await infoPromise;
    let cardPng: Uint8Array | undefined;
    if (doc.settings.ogImage === 'autogen') {
      const svg = cardFor(doc);
      if (st.cardPng?.key !== svg) st.cardPng = { key: svg, bytes: await rasterize(svg, 1200, 630) };
      const png = st.cardPng.bytes;
      // A PNG card is for social sites (they do not read SVG); dropped if it would cost anything.
      if (png && png.length + 2048 <= st.info.freeUploadLimitBytes) cardPng = png;
    }
    if (seq !== planSeq) return;
    try {
      const { files } = renderPage(doc, { ...(st.avatarFile ? { avatarFile: st.avatarFile } : {}), ...(cardPng ? { cardPng } : {}) });
      st.plan = planUpload(files, st.info.freeUploadLimitBytes, { asSite: true, ...(payer === 'solana' ? { sigType: SIG_TYPE_SOLANA } : {}) });
      st.planError = undefined;
    } catch (e) {
      st.plan = undefined;
      st.planError = msg(e);
    }
    st.priceWinc = undefined;
    refreshIfArming();
    if (st.plan && !st.plan.allFree) {
      const paid = st.plan.items.filter((i) => !i.free).reduce((n, i) => n + i.size, 0) + (st.plan.manifest && !st.plan.manifest.free ? st.plan.manifest.size : 0);
      const winc = await getTurboPriceWinc(paid).catch(() => null);
      if (seq !== planSeq) return;
      st.priceWinc = winc;
      refreshIfArming();
    }
  }

  function refreshIfArming(): void {
    if (st.step === 2) { renderSuggestions(); renderArm(); renderStepper(); }
    if (st.step === 3 && !st.busy && !st.deployed) render();
  }

  function priceText(): string {
    const p = st.plan;
    if (!p) return st.planError ? `Cannot plan: ${st.planError}` : 'Sizing…';
    if (p.allFree) return 'Free';
    if (st.priceWinc === undefined) return 'Pricing…';
    if (st.priceWinc === null) return 'Needs Turbo credits — price unavailable right now';
    return `≈ ${formatDecimal(st.priceWinc, WINC_DECIMALS, { maxFractionDigits: 6 })} AR in Turbo credits`;
  }

  function planLine(): string {
    const p = st.plan;
    if (!p) return '';
    const count = p.items.length + (p.manifest ? 1 : 0);
    return `${count} items (${p.items.map((i) => i.path).join(', ')} + manifest), ${fmtBytes(p.totalBytes)} signed`;
  }

  function keyLine(): string {
    if (!payer || !payerAddress) return 'No key — this account has no Arweave or Solana key';
    return `${payer === 'solana' ? 'Solana' : 'Arweave'} key ${short(payerAddress)}, in the PARSEC Keycore${isTauri ? '' : ' (browser build: the vault key, zeroed after)'}`;
  }

  function pointLine(): string {
    if (!st.name) return 'No name chosen — the page will only be uploaded';
    if (!st.record) return `${st.name} has not been read — go back to ① LOAD to point it`;
    if (!canWrite()) return `This account cannot point ar://${host()} — the page will only be uploaded`;
    return `ar://${host()} → the new page (its Target ID is known after upload)`;
  }

  function renderArm(): void {
    if (!st.doc) return;
    const p = st.plan;
    const r = release();
    armBox.replaceChildren(
      el('div', { cls: `${C}__facts`, children: [
        fact('Release', r === 'launch' ? 'Launch — first page at this address' : `Deploy — version ${releaseDoc()?.version ?? '?'} of the page here`),
        fact('Price', priceText()),
        fact('Signs', keyLine()),
        fact('Points', pointLine()),
      ] }),
      ...(p ? [el('p', { cls: `${C}__meta`, text: `${planLine()}. Turbo stores items up to ${fmtBytes(p.freeLimit)} free${st.info?.live ? ' (live)' : ' (fallback figure)'}.` })] : []),
      el('p', { cls: `${C}__permanent`, text: 'Public and permanent — once deployed it cannot be deleted or edited. A new version is a new page; the old one stays.' }),
      btn('Arm → ③ DEPLOY', { intent: 'primary', large: true, icon: 'flag', disabled: !p || !payer || (!p.allFree && st.priceWinc === undefined), onClick: () => go(3) }),
    );
  }

  // ── ③ DEPLOY ──────────────────────────────────────────────────────────────

  function deployStep(): HTMLElement {
    if (st.deployed) return resultView(st.deployed);
    const r = release();
    const steps: [3 | 2 | 1, string][] = [
      [3, 'Public and permanent: it cannot be deleted or edited.'],
      [2, `${priceText()} · ${planLine()} · signed by the ${keyLine()}.`],
      [1, canWrite() ? `Point ar://${host()} at the new page${st.target && st.target !== placeholder ? ` (now ${truncId(st.target)}; it stays permanent)` : ''}.` : `${pointLine()}.`],
    ];
    const rows = steps.map(([n, text], i) => {
      const done = st.confirmed > i;
      const current = st.confirmed === i;
      const b = btn(done ? 'Confirmed' : n === 1 ? (r === 'launch' ? 'Confirm and launch' : 'Confirm and deploy') : 'Confirm', {
        intent: current ? 'primary' : 'none', outlined: !current, disabled: !current || st.busy || !st.plan || !payer,
        onClick: () => confirmStep(i),
      });
      if (current) queueMicrotask(() => b.focus());
      return el('div', { cls: `${C}__count-row`, attrs: { 'data-state': done ? 'done' : current ? 'current' : 'later' }, children: [
        el('span', { cls: `${C}__count-n`, text: String(n), attrs: { 'aria-hidden': 'true' } }),
        el('span', { cls: `${C}__count-text`, text }),
        b,
      ] });
    });
    return el('div', { cls: `${C}__deploy`, children: [
      section(`${r === 'launch' ? 'Launch' : 'Deploy'} · 3 · 2 · 1`, [
        el('p', { cls: 'parsec-view__desc', text: 'Three confirmations, each one a click or Enter. Nothing fires on a timer. The last one opens the price sheet; signing happens only after you choose there.' }),
        ...rows,
        ...(st.log.length ? [logEl] : []),
      ]),
      section('Versions', [historyList([...(st.target && st.target !== placeholder ? [st.target] : []), ...(releaseDoc()?.previous ?? []).filter((p) => p !== st.target)])]),
    ] });
  }

  function confirmStep(i: number): void {
    if (st.confirmed !== i) return;
    st.confirmed = (i + 1) as 1 | 2 | 3;
    if (st.confirmed < 3) { render(); return; }
    render();
    openDeployOffer();
  }

  function openDeployOffer(): void {
    const p = st.plan;
    const doc = releaseDoc();
    if (!p || !doc) return;
    const r = release();
    openOffer({
      kicker: r === 'launch' ? 'Launch · price' : 'Deploy · price',
      price: priceText(),
      detail: `Version ${doc.version} of ar://${host()} · ${planLine()} · public and permanent`,
      fine: `Signed in the PARSEC Keycore by the ${keyLine()}. ${canWrite() ? 'Then the name is pointed (one more signature). ' : ''}The previous version stays permanent; rollback points back at it.`,
      buyLabel: r === 'launch' ? 'Sign and launch' : 'Sign and deploy',
      onBuy: deliver,
      onLeave: () => { st.confirmed = 0; render(); },
    });
  }

  /** Upload (once — a retry after a failed point does not upload again), then point, then verify. */
  async function deliver(): Promise<void> {
    const plan = st.plan;
    const doc = releaseDoc();
    if (!plan || !doc || !payer || !payerAddress) throw new Error('Nothing planned to deploy');
    const passphrase = store.getPassphrase();
    if (!passphrase) { store.navigate('unlock'); throw new Error('Wallet is locked'); }
    st.busy = true;
    try {
      let upload = st.deployed?.upload;
      if (!upload) {
        const sign: UploadSigner = payer === 'solana' ? solanaUploadSignerFor(payerAddress) : uploadSignerFor(payerAddress, passphrase);
        st.log = [`Signing as ${short(payerAddress)} — ${isTauri ? 'PARSEC Keycore; the key stays in the vault' : 'browser build; the vault key is used in this tab and zeroed after'}.`];
        render();
        try {
          upload = await runUpload(plan, sign, (e) => {
            st.log.push(e.kind === 'signing' ? `${e.n}/${e.of}  signing ${e.path}` : `${e.n}/${e.of}  uploaded ${e.path} → ${e.id}`);
            renderLog();
          });
        } catch (e) {
          const text = e instanceof TurboError && e.status === 402 ? e.message : msg(e);
          st.log.push(`Stopped: ${text}`);
          renderLog();
          throw new Error(text);
        }
        st.log.push(`Uploaded. Target ID ${upload.rootId}`);
        st.deployed = { upload, pointed: false, verifying: false };
        // The document now lives at this id: keep editing from it, with its history.
        st.doc = { ...doc };
      }
      if (canWrite() && !st.deployed!.pointed) {
        await point(upload.rootId);
        st.deployed!.pointed = true;
        st.log.push(`ar://${host()} now points at ${upload.rootId}`);
      }
      toast(st.deployed!.pointed ? `ar://${host()} → v${doc.version}` : 'Uploaded — point the name from its owning account', 'success');
    } catch (e) {
      if (st.deployed) st.deployed.pointError = msg(e);
      throw e;
    } finally {
      st.busy = false;
      render();
    }
    // Once pointed, the name serves this very document: the next edit is the next version of it.
    if (st.deployed!.pointed) {
      st.target = st.deployed!.upload.rootId;
      st.served = { doc: st.doc!, source: 'parsec', notes: [] };
    }
    void verifyDeployed();
  }

  async function point(id: string): Promise<void> {
    if (!ns || !signerAddress) throw new Error('No key for this registry');
    const passphrase = store.getPassphrase();
    if (!passphrase) throw new Error('Wallet is locked');
    if (st.ext) {
      const ttl = st.record?.undernames[st.ext]?.ttlSeconds ?? 900;
      await ns.setUndername({ address: signerAddress, passphrase, name: st.name, subdomain: st.ext, transactionId: id, ttlSeconds: ttl });
    } else {
      await ns.setRootRecord({ address: signerAddress, passphrase, name: st.name, transactionId: id, ttlSeconds: st.record?.rootTtl });
    }
  }

  function rollback(id: string): void {
    openOffer({
      kicker: 'Rollback · price',
      price: 'No upload',
      detail: `Point ar://${host()} back at ${truncId(id)}`,
      fine: 'One signed record change. Nothing is deleted: the newer version stays permanent too, and you can point forward again.',
      buyLabel: 'Sign and point back',
      onBuy: async () => {
        await point(id);
        toast(`ar://${host()} points at ${truncId(id)} again`, 'success');
        // Re-read the record and the page now served, so the next release builds on the right version.
        void readName(st.name, st.ext);
      },
    });
  }

  async function verifyDeployed(): Promise<void> {
    const d = st.deployed;
    if (!d || d.verifying) return;
    const m = d.upload.manifest ?? d.upload.items[0];
    d.verifying = true;
    render();
    try {
      const [checks, probe] = await Promise.all([
        verifyUpload(m.id, m.bytes, VERIFY_GATEWAYS),
        d.pointed ? probeGateway(gatewayUrl(st.name, 'ar.io', st.ext || undefined), d.upload.rootId) : Promise.resolve(undefined),
      ]);
      d.checks = checks;
      d.probe = probe;
    } finally {
      d.verifying = false;
      render();
    }
  }

  function resultView(d: Deployed): HTMLElement {
    const id = d.upload.rootId;
    const summary = d.verifying ? 'checking' : d.checks ? summarize(d.checks) : 'not checked';
    const text: Record<string, string> = {
      verified: 'Verified — a gateway serves exactly the bytes you signed',
      mismatch: 'MISMATCH — a gateway served different bytes. Do not share this until it is explained.',
      pending: 'Pending — not indexed yet. Normal for a few minutes after an upload.',
      unknown: 'Unknown — no gateway could be reached',
      checking: 'Checking the gateways…',
      'not checked': 'Not checked yet',
    };
    const probeText = !d.probe ? (d.pointed ? '' : 'The name was not pointed from this account.')
      : d.probe.matches ? `ar://${host()} already serves the new page on ar.io`
        : d.probe.resolvedId ? `ar.io still serves ${truncId(d.probe.resolvedId)} — the old copy, until the cache time (TTL) runs out`
          : 'ar.io has not picked up the change yet';
    return el('div', { cls: `${C}__deploy`, children: [
      section(d.pointed ? 'Deployed — forever' : 'Uploaded — forever', [
        el('div', { cls: `${C}__facts`, children: [
          fact('Target ID', id, id),
          fact('Version', String(st.doc?.version ?? '?')),
          fact('Address', `ar://${host()}`),
        ] }),
        el('div', { cls: `${C}__links`, children: [`https://${host()}.ar.io`, `https://arweave.net/${id}`].map((u) => el('a', { text: u, attrs: { href: u, target: '_blank', rel: 'noopener' } })) }),
        el('div', { cls: `${C}__headline`, attrs: { 'data-tone': summary === 'verified' ? 'done' : summary === 'mismatch' ? 'alert' : 'warn' }, text: text[summary] ?? summary }),
        ...(probeText ? [el('p', { cls: `${C}__meta`, text: probeText })] : []),
        ...(d.pointError && !d.pointed ? [callout(`Uploaded, but pointing failed: ${d.pointError}. Open ③ again to retry — it will not upload twice.`)] : []),
        logEl,
        el('div', { cls: 'parsec-dashboard__actions', children: [
          btn('Copy Target ID', { outlined: true, icon: 'duplicate', onClick: () => void copyText(id, 'Target ID copied') }),
          btn('Check again', { outlined: true, icon: 'refresh', disabled: d.verifying, onClick: () => void verifyDeployed() }),
          ...(!d.pointed && canWrite() ? [btn('Retry pointing', { intent: 'primary', icon: 'send-to-map', onClick: () => openDeployOffer() })] : []),
          btn('Edit again (next version)', { minimal: true, icon: 'edit', onClick: () => { st.deployed = undefined; st.log = []; go(2); schedulePlan(0); } }),
        ] }),
      ]),
      inftSection(d),
      section('Versions', [historyList([id, ...(st.doc?.previous ?? []).filter((p) => p !== id)])]),
    ] });
  }

  // ── iNFT: prepare only ────────────────────────────────────────────────────

  function inftSection(d: Deployed): HTMLElement {
    const doc = st.doc!;
    const find = (p: string): string | undefined => d.upload.items.find((i) => i.path === p)?.id;
    const imageId = find(CARD_PNG) ?? find(CARD_SVG) ?? find(AVATAR_SVG) ?? d.upload.items.find((i) => i.path.startsWith('avatar.'))?.id;
    const meta = buildInftMetadata(doc, { manifestId: d.upload.rootId, ...(imageId ? { imageId } : {}) });
    const json = inftJson(meta);
    const mint = btn('Mint the iNFT', { intent: 'primary', icon: 'cube', disabled: !INFT_MINT_ENABLED });
    mint.title = INFT_MINT_REASON;
    return section('Prepare iNFT (permanence mint)', [
      el('p', { cls: 'parsec-view__desc', text: 'ERC-721 metadata for this deploy: the image, the page and its storageURI all point at permanent ids. Copy it, or upload it as metadata.json — free, a few hundred bytes.' }),
      el('pre', { cls: `${C}__json`, text: json }),
      el('div', { cls: 'parsec-dashboard__actions', children: [
        btn('Copy metadata', { outlined: true, icon: 'duplicate', onClick: () => void copyText(json, 'Metadata copied') }),
        btn(d.metadataId ? 'metadata.json uploaded' : 'Upload metadata.json', { outlined: true, icon: 'cloud-upload', disabled: !!d.metadataId || st.busy, onClick: () => void uploadMetadata(d, json) }),
        mint,
      ] }),
      ...(d.metadataId ? [el('p', { cls: `${C}__meta`, children: ['metadata.json: ', el('code', { text: `ar://${d.metadataId}` })] })] : []),
      el('p', { cls: `${C}__meta`, text: INFT_MINT_REASON }),
    ]);
  }

  async function uploadMetadata(d: Deployed, json: string): Promise<void> {
    if (!payer || !payerAddress) return;
    const passphrase = store.getPassphrase();
    if (!passphrase) { toast('Wallet is locked', 'danger'); return; }
    st.busy = true;
    render();
    try {
      const info = st.info ?? await infoPromise;
      const plan = planUpload([{ path: 'metadata.json', bytes: new TextEncoder().encode(json), contentType: 'application/json', tags: [{ name: 'Page-Id', value: st.doc!.pageId }] }], info.freeUploadLimitBytes, payer === 'solana' ? { sigType: SIG_TYPE_SOLANA } : {});
      if (!plan.allFree) throw new Error('metadata.json would not be free — not uploaded');
      const sign = payer === 'solana' ? solanaUploadSignerFor(payerAddress) : uploadSignerFor(payerAddress, passphrase);
      const res = await runUpload(plan, sign);
      d.metadataId = res.rootId;
      toast('metadata.json uploaded', 'success');
    } catch (e) {
      toast(msg(e), 'danger');
    } finally {
      st.busy = false;
      render();
    }
  }

  function renderLog(): void {
    logEl.textContent = st.log.join('\n');
    logEl.scrollTop = logEl.scrollHeight;
  }

  // ── Small parts that need the state ───────────────────────────────────────

  function templateCard(id: TemplateId, onPick: () => void, current = false): HTMLElement {
    const t = templateById(id);
    const sw = el('span', { cls: `${C}__tpl-sw`, attrs: { 'aria-hidden': 'true' } });
    sw.style.setProperty('--sw-bg', t.background.kind === 'gradient' ? `linear-gradient(135deg, ${t.background.from}, ${t.background.to})` : t.background.from);
    sw.style.setProperty('--sw-ac', t.accent);
    const b = el('button', { cls: `${C}__tpl`, attrs: { type: 'button', 'aria-pressed': current ? 'true' : 'false', title: t.note }, children: [sw, el('span', { text: `${t.favicon} ${t.label}` })], onClick: onPick });
    return b;
  }

  renderLog();
  render();
  if (st.name && ns) void readName(st.name, st.ext);
  return root;
}

// ── Fetching a published page ─────────────────────────────────────────────────

interface FetchedPage { simple: ReturnType<typeof simplifyHtml>; paths: Record<string, string> }

/** Read an id from the gateway: a manifest's index page (with its path → id map), or one HTML file. */
async function fetchPage(id: string): Promise<FetchedPage> {
  const res = await fetch(`${DETAILS_GATEWAY}/raw/${id}`);
  if (res.status === 404) throw new Error('not on the gateways yet');
  if (!res.ok) throw new Error(`gateway answered HTTP ${res.status}`);
  const type = (res.headers.get('content-type') ?? '').split(';')[0].trim();
  let paths: Record<string, string> = {};
  let htmlRes = res;
  if (type === MANIFEST_TYPE) {
    const m = (await res.json()) as { paths?: Record<string, { id?: unknown }>; index?: { path?: unknown } };
    for (const [p, v] of Object.entries(m.paths ?? {})) if (typeof v?.id === 'string' && /^[A-Za-z0-9_-]{43}$/.test(v.id)) paths[p] = v.id;
    const index = typeof m.index?.path === 'string' ? m.index.path : 'index.html';
    const indexId = paths[index];
    if (!indexId) throw new Error('a site with no index page');
    htmlRes = await fetch(`${DETAILS_GATEWAY}/raw/${indexId}`);
    if (!htmlRes.ok) throw new Error(`index page: HTTP ${htmlRes.status}`);
  } else if (!/html/i.test(type)) {
    throw new Error(`one file of type ${type || 'unknown'}, not a page`);
  }
  const bytes = new Uint8Array(await htmlRes.arrayBuffer());
  if (bytes.length > MAX_PAGE_BYTES) throw new Error('a page larger than 2 MiB — too big to edit here');
  const html = new TextDecoder().decode(bytes);
  const simple = typeof DOMParser !== 'undefined' ? simplifyWithDom(html) : simplifyHtml(html);
  return { simple, paths };
}

// ── Images in the app (canvas; no remote loads) ──────────────────────────────

/** Resize to ≤ maxPx on the long side and encode WebP (PNG where WebP encoding is unavailable). */
async function resizeImage(f: Blob, maxPx: number, quality: number): Promise<{ path: string; bytes: Uint8Array; contentType: string; dataUrl: string }> {
  if (!/^image\/(png|jpeg|webp)$/.test(f.type)) throw new Error('use a PNG, JPG or WebP image');
  const bmp = await createImageBitmap(f);
  const scale = Math.min(1, maxPx / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no canvas');
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, 'image/webp', quality));
  if (!blob) throw new Error('could not encode the image');
  const contentType = blob.type === 'image/webp' ? 'image/webp' : 'image/png';
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return { path: contentType === 'image/webp' ? 'avatar.webp' : 'avatar.png', bytes, contentType, dataUrl: `data:${contentType};base64,${toB64(bytes)}` };
}

/** SVG → PNG bytes through a canvas, or null where the WebView will not (tainted canvas, no decode). */
async function rasterize(svg: string, w: number, h: number): Promise<Uint8Array | null> {
  try {
    const img = new Image();
    img.src = svgDataUrl(svg);
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, 'image/png'));
    return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
  } catch {
    return null;
  }
}

function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

// ── Small parts ───────────────────────────────────────────────────────────────

function cloneDoc(d: PageDoc): PageDoc {
  return JSON.parse(JSON.stringify(d)) as PageDoc;
}

function freshId(): string {
  return newPageId(crypto.getRandomValues(new Uint8Array(16)));
}

const LABELS_KEY = 'parsec:creator-labels:';
function readLabels(pageId: string): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(LABELS_KEY + pageId) ?? '[]') as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, 32) : [];
  } catch { return []; }
}
function writeLabels(pageId: string, labels: string[]): void {
  try {
    if (labels.length) localStorage.setItem(LABELS_KEY + pageId, JSON.stringify(labels));
    else localStorage.removeItem(LABELS_KEY + pageId);
  } catch { /* storage unavailable — labels are a convenience */ }
}

function readSession(k: string): string | null {
  try { return sessionStorage.getItem(k); } catch { return null; }
}
function writeSession(k: string, v: string | null): void {
  try { if (v === null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, v); } catch { /* per-tab convenience only */ }
}

function section(title: string, children: HTMLElement[]): HTMLElement {
  return el('section', { cls: `${C}__section parsec-confirm__details`, children: [el('h4', { text: title }), ...children] });
}
function fact(k: string, v: string, title?: string): HTMLElement {
  return el('div', { cls: `${C}__fact`, children: [el('span', { cls: `${C}__k`, text: k }), el('span', { cls: `${C}__v`, text: v, attrs: title ? { title } : {} })] });
}
function callout(text: string): HTMLElement {
  return el('div', { cls: 'parsec-callout bp5-callout bp5-intent-warning', children: [el('p', { text })] });
}
function choice(title: string, note: string, onPick: () => void, primary: boolean): HTMLElement {
  return el('div', { cls: `${C}__choice`, children: [
    el('div', { children: [el('strong', { text: title }), el('span', { cls: `${C}__meta`, text: note })] }),
    btn(primary ? 'Edit' : 'Start', { intent: primary ? 'primary' : 'none', outlined: !primary, onClick: onPick }),
  ] });
}
function checkbox(label: string, checked: boolean, onChange: (v: boolean) => void): HTMLElement {
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.checked = checked;
  box.addEventListener('change', () => onChange(box.checked));
  return el('label', { cls: `${C}__check`, children: [box, label] });
}
function toB64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MiB`;
}
function short(a: string): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}
function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
