// Approval dialog for a name request from a web page (bankon.pythai.net, AgenticPlace, mindX).
//
// The page asked for an intent, not a signature. This screen states that intent in one
// sentence, shows the name's current state so the change can be judged against it, and only
// then signs — through the same NamespaceAdapter the in-wallet controller uses. The page never
// sees a key, and never hands us bytes to sign blind.

import { el, btn, toast } from '../lib/dom';
import { store } from '../lib/store';
import { connectApproveName, connectRejectName, type NameRequest } from '../lib/connect';
import { getNamespace, type NamespaceAdapter, type NormalizedRecord } from '../lib/namespaces';
import { addressChainFor, namespaceAddress } from '../lib/names/address';
import { describeOrigin, renderIntent, type NameIntent } from '../lib/names/intent';
import { describeTarget, truncId } from '../lib/names/controller-model';

const C = 'parsec-nameapprove';

let pending: NameRequest | null = null;

export function setNamePending(request: NameRequest): void {
  pending = request;
}
export function clearNamePending(): void {
  pending = null;
}

export function connectNameApproveView(): HTMLElement {
  const root = el('div', { cls: `parsec-view parsec-confirm ${C}` });
  const req = pending;

  if (!req) {
    root.appendChild(el('p', { cls: 'parsec-empty', text: 'No pending request.' }));
    root.appendChild(btn('Back to dashboard', { onClick: () => store.navigate('dashboard') }));
    return root;
  }

  const ns = getNamespace(req.namespace);
  const chain = addressChainFor(ns);
  const intent: NameIntent = {
    requestId: req.requestId,
    origin: req.origin,
    namespace: req.namespace,
    op: req.op,
    name: req.name,
    params: (req.params ?? {}) as Record<string, unknown>,
  };
  const view = renderIntent(intent, chain);
  const who = describeOrigin(req.origin);

  root.appendChild(el('div', {
    cls: 'parsec-view__header',
    children: [el('h2', { cls: 'parsec-view__title', text: 'A site is asking to change a name' })],
  }));

  // Who is asking — first, because it decides whether the rest matters.
  root.appendChild(el('div', {
    cls: `${C}__origin`,
    attrs: { 'data-known': String(who.known) },
    children: [
      el('span', { cls: `${C}__origin-label`, text: who.known ? who.label : 'Unrecognised site' }),
      el('span', { cls: `${C}__origin-host`, text: who.host }),
    ],
  }));

  if (!ns) {
    root.appendChild(refusal(`Parsec has no adapter for the namespace "${req.namespace}".`, req));
    return root;
  }
  if (view.error) {
    root.appendChild(refusal(view.error, req));
    return root;
  }

  // The sentence.
  root.appendChild(el('div', {
    cls: `${C}__intent`,
    attrs: { 'data-risk': view.risk },
    children: [
      el('h3', { cls: `${C}__headline`, text: view.headline }),
      el('p', { cls: `${C}__effect`, text: view.effect }),
    ],
  }));

  root.appendChild(el('div', {
    cls: 'parsec-confirm__details',
    children: view.detail.map((d) => el('div', {
      cls: 'parsec-confirm__row',
      children: [
        el('span', { cls: 'parsec-confirm__label', text: d.label }),
        el('span', { cls: `parsec-confirm__value${d.mono ? ` ${C}__mono` : ''}`, text: d.value }),
      ],
    })),
  }));

  // What the name looks like right now, so the change can be judged against something.
  const current = el('div', { cls: `${C}__current`, children: [el('span', { cls: `${C}__k`, text: 'Reading the name…' })] });
  root.appendChild(current);

  const actions = el('div', { cls: 'parsec-confirm__actions' });
  root.appendChild(actions);
  root.appendChild(el('p', {
    cls: 'parsec-view__desc',
    text: 'Parsec builds and signs this itself with your vault key. The site never sees the key and never chose the transaction.',
  }));

  void prepare(ns, req, current, actions, view.risk);
  return root;
}

async function prepare(
  ns: NamespaceAdapter,
  req: NameRequest,
  current: HTMLElement,
  actions: HTMLElement,
  risk: 'routine' | 'elevated',
): Promise<void> {
  const s = store.get();
  const account = s.accounts[s.activeAccountIndex];
  const address = account ? namespaceAddress(account, ns) : undefined;

  let record: NormalizedRecord | null = null;
  try { record = await ns.getRecord(req.name); } catch { /* shown below */ }

  current.replaceChildren();
  if (!record) {
    current.appendChild(el('span', { cls: `${C}__k`, text: `Could not read ${req.name} from ${ns.displayName}. Approving may fail.` }));
  } else {
    const t = describeTarget(record.rootTarget);
    current.append(
      row('Currently serves', record.rootTarget ? `${truncId(record.rootTarget, 10, 8)} — ${t.stamp}` : 'nothing'),
      row('Undernames', `${Object.keys(record.undernames).length} of ${record.undernameLimit ?? '∞'} used`),
      row('Owner', truncId(record.owner)),
    );
  }

  const canWrite = !!address && !!record
    && (record.owner === address || (record.controllers ?? []).includes(address));

  if (!canWrite) {
    current.appendChild(el('div', {
      cls: 'parsec-callout bp5-callout bp5-intent-warning',
      children: [el('p', {
        text: address
          ? `This account (${truncId(address)}) neither owns nor controls ${req.name}, so Parsec cannot make this change.`
          : `This account has no ${addressChainFor(ns) === 'solana' ? 'Solana' : 'Arweave'} address, so Parsec cannot sign for ${req.name}.`,
      })],
    }));
    actions.appendChild(btn('Decline', { intent: 'danger', large: true, onClick: () => void decline(req, 'Wallet cannot sign for this name') }));
    return;
  }

  const approve = btn(risk === 'elevated' ? 'I understand — approve' : 'Approve', { intent: 'primary', large: true });
  const reject = btn('Reject', { intent: 'danger', large: true, outlined: true, onClick: () => void decline(req, 'User rejected') });

  approve.addEventListener('click', () => {
    approve.disabled = true; reject.disabled = true;
    approve.querySelector('.bp5-button-text')!.textContent = 'Signing…';
    void execute(ns, req, address!, approve, reject);
  });

  // An elevated request has to be armed first: one deliberate act before the one that signs.
  if (risk === 'elevated') {
    approve.disabled = true;
    const arm = el('label', {
      cls: `${C}__arm`,
      children: [
        el('input', { attrs: { type: 'checkbox' } }),
        el('span', { text: 'I have read what this changes' }),
      ],
    });
    (arm.firstElementChild as HTMLInputElement).addEventListener('change', (e) => {
      approve.disabled = !(e.target as HTMLInputElement).checked;
    });
    actions.appendChild(arm);
  }
  actions.append(approve, reject);
}

async function execute(
  ns: NamespaceAdapter,
  req: NameRequest,
  address: string,
  approve: HTMLButtonElement,
  reject: HTMLButtonElement,
): Promise<void> {
  const passphrase = store.getPassphrase();
  if (!passphrase) {
    toast('Wallet is locked', 'danger');
    await decline(req, 'Wallet locked');
    return;
  }
  const p = (req.params ?? {}) as Record<string, unknown>;
  const base = { address, passphrase, name: req.name };

  try {
    let result: unknown;
    switch (req.op) {
      case 'set-root':
        result = await ns.setRootRecord({ ...base, transactionId: String(p.transactionId), ttlSeconds: p.ttlSeconds as number | undefined });
        break;
      case 'set-undername':
        result = await ns.setUndername({ ...base, subdomain: String(p.undername).toLowerCase(), transactionId: String(p.transactionId), ttlSeconds: p.ttlSeconds as number | undefined });
        break;
      case 'remove-undername':
        result = await ns.removeUndername({ ...base, subdomain: String(p.undername).toLowerCase() });
        break;
      case 'set-identity':
        if (!ns.setIdentity) throw new Error(`${ns.displayName} cannot edit identity`);
        result = await ns.setIdentity({ ...base, patch: identityPatch(p) });
        break;
      case 'add-controller':
        if (!ns.addController) throw new Error(`${ns.displayName} has no controllers`);
        result = await ns.addController({ ...base, controller: String(p.controller) });
        break;
      case 'remove-controller':
        if (!ns.removeController) throw new Error(`${ns.displayName} has no controllers`);
        result = await ns.removeController({ ...base, controller: String(p.controller) });
        break;
      case 'set-primary':
        result = await ns.requestPrimary(base);
        break;
      default:
        throw new Error(`Unsupported operation ${req.op}`);
    }
    await connectApproveName(req.requestId, result as Record<string, unknown>);
    toast(`${req.name} updated`, 'success');
    finish();
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    toast(message, 'danger');
    // Tell the page why, rather than leaving it on a 300 s timeout.
    await connectRejectName(req.requestId, `Failed: ${message}`).catch(() => { /* socket may be gone */ });
    approve.disabled = false; reject.disabled = false;
    approve.querySelector('.bp5-button-text')!.textContent = 'Retry';
    finishLater();
  }
}

/** Only the identity fields the page actually sent — never invent a field to clear. */
function identityPatch(p: Record<string, unknown>): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const k of ['nickname', 'ticker', 'description', 'logo'] as const) {
    if (typeof p[k] === 'string') patch[k] = String(p[k]).trim();
  }
  if (Array.isArray(p.keywords)) patch.keywords = (p.keywords as unknown[]).map(String);
  return patch;
}

async function decline(req: NameRequest, reason: string): Promise<void> {
  await connectRejectName(req.requestId, reason).catch(() => { /* socket may be gone */ });
  finish();
}

function finish(): void {
  clearNamePending();
  store.navigate('dashboard');
}
function finishLater(): void {
  // keep the dialog open so the user can retry or reject
}

function refusal(text: string, req: NameRequest): HTMLElement {
  return el('div', {
    cls: 'parsec-confirm__details',
    children: [
      el('div', { cls: 'parsec-callout bp5-callout bp5-intent-danger', children: [el('p', { text })] }),
      btn('Dismiss', { intent: 'danger', large: true, onClick: () => void decline(req, text) }),
    ],
  });
}

function row(label: string, value: string): HTMLElement {
  return el('div', {
    cls: 'parsec-confirm__row',
    children: [el('span', { cls: 'parsec-confirm__label', text: label }), el('span', { cls: 'parsec-confirm__value', text: value })],
  });
}
