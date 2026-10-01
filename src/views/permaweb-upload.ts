// Upload to Arweave — put a file or a whole site on the permaweb from inside the wallet, then point
// a name at it. Plan (exact sizes, free vs paid) → arm (public and permanent) → sign (Rust on
// desktop: the key never enters JS) → post to Turbo → verify the bytes gateways serve against the
// bytes that were signed.
//
// House rules (TIMELESS): the first thing on screen is the one number and the next action;
// estimates are labelled; a gateway that has not caught up is "pending", never "failed".

import { el, btn, toast } from '../lib/dom';
import { store, getAccountAddress } from '../lib/store';
import { isTauri } from '../lib/platform';
import { formatDecimal } from '../lib/money';
import {
  TurboError,
  WINC_DECIMALS,
  getTurboInfo,
  getTurboPriceWinc,
  planUpload,
  runUpload,
  uploadSignerFor,
  type TurboInfo,
  type UploadFile,
  type UploadPlan,
  type UploadResult,
} from '../lib/arweave/turbo';
import { guessContentType, normalizeManifestPath, stripCommonRoot } from '../lib/arweave/manifest';
import { VERIFY_GATEWAYS, summarize, verifyUpload, type GatewayCheck } from '../lib/permaweb/verify';
import { clearUploadReturn, offerUploadedTarget, peekUploadReturn } from '../lib/permaweb/handoff';

const C = 'parsec-upload';
/** Everything is held in memory and hashed; past this, permaweb-deploy is the right tool. */
const MAX_TOTAL_BYTES = 200 * 1024 * 1024;

interface State {
  files: UploadFile[];
  asSite: boolean;
  info?: TurboInfo;
  plan?: UploadPlan;
  /** undefined = not asked yet, null = the price service could not answer. */
  priceWinc?: bigint | null;
  armed: boolean;
  busy: boolean;
  log: string[];
  result?: UploadResult;
  checks?: GatewayCheck[];
  verifying: boolean;
}

export function permawebUploadView(): HTMLElement {
  const s = store.get();
  const account = s.accounts[s.activeAccountIndex];
  const address = account ? getAccountAddress(account, 'arweave-hd') ?? getAccountAddress(account, 'arweave') : undefined;
  const back = peekUploadReturn() ?? 'permaweb-desk';

  const root = el('div', { cls: `parsec-view parsec-confirm parsec-permaweb ${C}` });
  root.appendChild(el('div', {
    cls: 'parsec-view__header',
    children: [
      btn('Back', { minimal: true, icon: 'arrow-left', onClick: () => { clearUploadReturn(); store.navigate(back); } }),
      el('h2', { cls: 'parsec-view__title', text: 'Upload to Arweave' }),
    ],
  }));

  if (!address) {
    root.appendChild(el('div', {
      cls: 'parsec-confirm__details',
      children: [
        el('p', { cls: 'parsec-view__desc', text: 'Uploads are signed by an Arweave key, and this account has none yet. Create one — it lives in the vault like every other key.' }),
        btn('Create an Arweave account', { intent: 'primary', icon: 'key', onClick: () => store.navigate('arweave-create') }),
      ],
    }));
    return root;
  }
  const signer = address;

  const st: State = { files: [], asSite: false, armed: false, busy: false, log: [], verifying: false };
  const infoPromise = getTurboInfo();
  const body = el('div', { cls: `${C}__body` });
  // The progress log is one element, updated in place — a 200-file site would otherwise rebuild
  // every row on every signing and upload event.
  const logEl = el('pre', { cls: 'parsec-permaweb__log' });
  root.appendChild(body);

  // ── Picking ────────────────────────────────────────────────────────────────

  const fileInput = hiddenPicker(false);
  const folderInput = hiddenPicker(true);

  function hiddenPicker(folder: boolean): HTMLInputElement {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.multiple = true;
    inp.hidden = true;
    if (folder) inp.setAttribute('webkitdirectory', '');
    inp.addEventListener('change', () => {
      void addFiles(inp.files, folder).finally(() => { inp.value = ''; });
    });
    root.appendChild(inp);
    return inp;
  }

  async function addFiles(list: FileList | null, folder: boolean): Promise<void> {
    if (!list || list.length === 0) return;
    const arr = Array.from(list);
    const total = arr.reduce((n, f) => n + f.size, 0);
    if (total > MAX_TOTAL_BYTES) {
      toast(`That is ${fmtBytes(total)} — more than the ${fmtBytes(MAX_TOTAL_BYTES)} this screen holds in memory. Use permaweb-deploy for large sites.`, 'warning');
      return;
    }
    let paths: string[];
    try {
      const rel = arr.map((f) => (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name);
      paths = folder ? stripCommonRoot(rel) : rel.map((p) => normalizeManifestPath(p));
    } catch (e) {
      toast(msg(e), 'warning');
      return;
    }
    const files: UploadFile[] = [];
    for (let i = 0; i < arr.length; i++) {
      files.push({ path: paths[i], bytes: new Uint8Array(await arr[i].arrayBuffer()), contentType: guessContentType(paths[i], arr[i].type) });
    }
    Object.assign(st, { files, asSite: folder || files.length > 1, armed: false, log: [], result: undefined, checks: undefined });
    await replan();
  }

  async function replan(): Promise<void> {
    st.info ??= await infoPromise;
    try {
      st.plan = planUpload(st.files, st.info.freeUploadLimitBytes, { asSite: st.asSite });
    } catch (e) {
      st.plan = undefined;
      toast(msg(e), 'warning');
      render();
      return;
    }
    st.priceWinc = undefined;
    render();
    if (!st.plan.allFree) {
      const p = st.plan;
      const paid = p.items.filter((i) => !i.free).reduce((n, i) => n + i.size, 0) + (p.manifest && !p.manifest.free ? p.manifest.size : 0);
      try { st.priceWinc = await getTurboPriceWinc(paid); } catch { st.priceWinc = null; }
      render();
    }
  }

  // ── Uploading ──────────────────────────────────────────────────────────────

  async function upload(): Promise<void> {
    const plan = st.plan;
    if (!plan || st.busy || !st.armed) return;
    const passphrase = store.getPassphrase();
    if (!passphrase) { toast('Wallet is locked', 'danger'); store.navigate('unlock'); return; }
    let sign;
    try { sign = uploadSignerFor(signer, passphrase); } catch (e) { toast(msg(e), 'danger'); return; }

    st.busy = true;
    st.result = undefined;
    st.checks = undefined;
    st.log = [`Signing as ${short(signer)} — ${isTauri ? 'PARSEC Keycore; the key stays in the vault' : 'browser build; the vault key is used in this tab and zeroed after'}.`];
    render();
    try {
      st.result = await runUpload(plan, sign, (e) => {
        st.log.push(e.kind === 'signing' ? `${e.n}/${e.of}  signing ${e.path}` : `${e.n}/${e.of}  uploaded ${e.path} → ${e.id}`);
        renderLog();
      });
      st.log.push(`Done. ${st.result.manifest ? 'Site' : 'File'} id ${st.result.rootId}`);
      toast('Uploaded — checking what the gateways serve', 'success');
    } catch (e) {
      const text = e instanceof TurboError && e.status === 402 ? e.message : msg(e);
      st.log.push(`Stopped: ${text}`);
      toast(text, 'danger');
    } finally {
      st.busy = false;
      render();
    }
    if (st.result) await runVerify();
  }

  async function runVerify(): Promise<void> {
    const r = st.result;
    if (!r || st.verifying) return;
    const target = r.manifest ?? r.items[0];
    st.verifying = true;
    render();
    try {
      st.checks = await verifyUpload(target.id, target.bytes, VERIFY_GATEWAYS);
    } finally {
      st.verifying = false;
      render();
    }
  }

  function pointName(id: string): void {
    offerUploadedTarget(id);
    const ret = peekUploadReturn();
    clearUploadReturn();
    if (ret === 'name-controller') { store.navigate('name-controller'); return; }
    toast('Pick the name — its controller will have this id filled in', 'primary');
    store.navigate('name-hub');
  }

  // ── Rendering ──────────────────────────────────────────────────────────────

  function renderLog(): void {
    logEl.textContent = st.log.join('\n');
    logEl.scrollTop = logEl.scrollHeight;
  }

  function render(): void {
    renderLog();
    body.replaceChildren(
      pickSection(),
      ...(st.plan ? [planSection(st.plan)] : []),
      ...(st.log.length ? [logEl] : []),
      ...(st.result ? [resultSection(st.result)] : []),
    );
  }

  function pickSection(): HTMLElement {
    return el('div', {
      cls: 'parsec-confirm__details',
      children: [
        el('p', { cls: 'parsec-view__desc', text: st.files.length
          ? `${st.files.length} file${st.files.length === 1 ? '' : 's'} chosen. Pick again to replace them.`
          : 'Choose a file, or a folder to publish as a site. Nothing leaves this device until you sign.' }),
        el('div', { cls: 'parsec-dashboard__actions', children: [
          btn('Choose files', { intent: st.files.length ? 'none' : 'primary', icon: 'document', disabled: st.busy, onClick: () => fileInput.click() }),
          btn('Choose a folder (site)', { outlined: true, icon: 'folder-open', disabled: st.busy, onClick: () => folderInput.click() }),
        ] }),
      ],
    });
  }

  function planSection(p: UploadPlan): HTMLElement {
    const count = p.items.length + (p.manifest ? 1 : 0);
    const headline = p.allFree
      ? `Free — ${count} item${count === 1 ? '' : 's'}, ${fmtBytes(p.totalBytes)}`
      : st.priceWinc === undefined ? `Pricing ${fmtBytes(p.totalBytes)}…`
        : st.priceWinc === null ? 'Needs Turbo credits — price unavailable right now'
          : `≈ ${formatDecimal(st.priceWinc, WINC_DECIMALS, { maxFractionDigits: 6 })} AR in Turbo credits`;

    const rows = p.items.map((i) => el('div', {
      cls: `${C}__file`,
      children: [
        el('code', { cls: `${C}__path`, text: i.path }),
        el('span', { cls: `${C}__meta`, text: i.tags.find((t) => t.name === 'Content-Type')?.value ?? '' }),
        el('span', { cls: `${C}__meta`, text: fmtBytes(i.size) }),
        badge(i.free),
      ],
    }));
    if (p.manifest) {
      const bits = [p.manifest.index ? `root → ${p.manifest.index}` : 'no index.html — the root lists nothing', p.manifest.fallback ? `other paths → ${p.manifest.fallback}` : ''].filter(Boolean).join(' · ');
      rows.push(el('div', {
        cls: `${C}__file ${C}__file--manifest`,
        children: [el('code', { cls: `${C}__path`, text: '(manifest)' }), el('span', { cls: `${C}__meta`, text: bits }), el('span', { cls: `${C}__meta`, text: fmtBytes(p.manifest.size) }), badge(p.manifest.free)],
      }));
    }

    const siteToggle = st.files.length === 1 ? [checkbox(
      'Publish as a site — adds a manifest, so the name serves this file at its root and the id never changes when you add files later.',
      st.asSite,
      (v) => { st.asSite = v; void replan(); },
    )] : [];

    const arm = checkbox('I understand: anything uploaded to Arweave is public and permanent. It cannot be deleted or edited.', st.armed, (v) => { st.armed = v; render(); });

    return el('div', {
      cls: 'parsec-confirm__details',
      children: [
        el('div', { cls: `${C}__headline`, attrs: { 'data-tone': p.allFree ? 'done' : 'warn' }, text: headline }),
        el('p', { cls: 'parsec-view__desc', text: `Sizes are exact signed sizes. Turbo stores items up to ${fmtBytes(p.freeLimit)} free${st.info?.live ? ' (live from upload.ardrive.io)' : ' (fallback figure — Turbo did not answer)'}.${p.allFree ? '' : ' Larger items need Turbo credits on this Arweave address; without them Turbo refuses the item and nothing is charged. The AR figure is an estimate from payment.ardrive.io.'}` }),
        el('div', { cls: `${C}__files`, children: rows }),
        ...siteToggle,
        arm,
        el('div', { cls: 'parsec-dashboard__actions', children: [
          btn(st.busy ? 'Uploading…' : `Sign and upload ${count} item${count === 1 ? '' : 's'}`, {
            intent: 'primary', icon: 'cloud-upload', disabled: st.busy || !st.armed, onClick: () => void upload(),
          }),
        ] }),
      ],
    });
  }

  function resultSection(r: UploadResult): HTMLElement {
    const summary = st.verifying ? 'checking…' : st.checks ? summarize(st.checks) : 'not checked';
    const summaryText: Record<string, string> = {
      verified: 'Verified — a gateway serves exactly the bytes you signed',
      mismatch: 'MISMATCH — a gateway served different bytes. Do not point a name here until this is explained.',
      pending: 'Pending — no gateway has indexed it yet. Normal for a few minutes after an upload.',
      unknown: 'Unknown — no gateway could be reached',
      'checking…': 'Checking the gateways…',
      'not checked': 'Not checked yet',
    };
    const tone = summary === 'verified' ? 'done' : summary === 'mismatch' ? 'alert' : 'warn';

    return el('div', {
      cls: 'parsec-confirm__details',
      children: [
        el('h4', { text: r.manifest ? 'Your site is on Arweave' : 'Your file is on Arweave' }),
        el('div', { cls: 'parsec-permaweb__grid-2', children: [
          stat(r.manifest ? 'Site (manifest) id — point names here' : 'File id', r.rootId),
          stat('Signed by', short(signer)),
        ] }),
        el('div', { cls: `${C}__links`, children: [`https://turbo-gateway.com/${r.rootId}`, `https://arweave.net/${r.rootId}`].map((u) => el('a', { text: u, attrs: { href: u, target: '_blank', rel: 'noopener' } })) }),
        el('div', { cls: `${C}__headline`, attrs: { 'data-tone': tone }, text: summaryText[summary] ?? summary }),
        ...(st.checks ? [el('div', { cls: `${C}__checks`, children: st.checks.map(checkRow) })] : []),
        el('div', { cls: 'parsec-dashboard__actions', children: [
          btn('Point a name at this', { intent: 'primary', icon: 'send-to-map', disabled: summary === 'mismatch', onClick: () => pointName(r.rootId) }),
          btn('Copy id', { outlined: true, icon: 'duplicate', onClick: () => copy(r.rootId) }),
          btn('Check again', { outlined: true, icon: 'refresh', disabled: st.verifying, onClick: () => void runVerify() }),
        ] }),
        ...(r.manifest ? [el('details', { cls: `${C}__more`, children: [
          el('summary', { text: `${r.items.length} files` }),
          ...r.items.map((i) => el('div', { cls: `${C}__file`, children: [el('code', { cls: `${C}__path`, text: i.path }), el('code', { cls: `${C}__meta`, text: i.id })] })),
        ] })] : []),
      ],
    });
  }

  render();
  return root;
}

// ── Small parts ───────────────────────────────────────────────────────────────

function checkRow(c: GatewayCheck): HTMLElement {
  const host = c.gateway.replace(/^https?:\/\//, '');
  const text = c.state === 'match' ? 'serves exactly the bytes you signed'
    : c.state === 'mismatch' ? 'served DIFFERENT bytes'
      : c.state === 'pending' ? 'not indexed yet'
        : `unreachable${c.error ? ` (${c.error})` : ''}`;
  const tone = c.state === 'match' ? 'done' : c.state === 'mismatch' ? 'alert' : 'warn';
  const note = c.gatewayVerified === undefined ? '' : ` · gateway's own flag: ${c.gatewayVerified ? 'verified' : 'not yet'}`;
  return el('div', { cls: `${C}__check`, attrs: { 'data-tone': tone }, children: [el('code', { text: host }), el('span', { text: text + note })] });
}

function badge(free: boolean): HTMLElement {
  return el('span', { cls: `${C}__badge`, attrs: { 'data-tone': free ? 'done' : 'warn' }, text: free ? 'free' : 'credits' });
}

function checkbox(label: string, checked: boolean, onChange: (v: boolean) => void): HTMLElement {
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.checked = checked;
  box.addEventListener('change', () => onChange(box.checked));
  return el('label', { cls: `${C}__arm`, children: [box, label] });
}

function stat(label: string, value: string): HTMLElement {
  return el('div', { cls: 'parsec-permaweb__stat', children: [el('span', { text: label }), el('span', { text: value })] });
}

function copy(text: string): void {
  void navigator.clipboard.writeText(text).then(() => toast('Id copied', 'success')).catch(() => toast('Clipboard unavailable', 'warning'));
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
