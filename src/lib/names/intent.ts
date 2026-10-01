// Name intents — what a web page is allowed to ask PARSEC to do to a name, and how that
// request is turned into a sentence a person can actually judge.
//
// The dApp never sends transaction bytes. It states an intent; this module validates it and
// renders it; the user reads the sentence; only then does the wallet build and sign. Pure —
// no DOM, no SDK, no vault — so the wording and the validation are unit-testable.

import { isArweaveId, validateAddressFor, validateUndername, clampTtl, type AddressChain } from './controller-model';

/** Mirrors ALLOWED_NAME_OPS in src-tauri/src/parsec_connect/mod.rs. Keep the two in step. */
export const NAME_OPS = [
  'set-root',
  'set-undername',
  'remove-undername',
  'set-identity',
  'add-controller',
  'remove-controller',
  'set-primary',
] as const;
export type NameOp = (typeof NAME_OPS)[number];

export interface NameIntent {
  requestId: number;
  origin: string;
  namespace: string;
  op: NameOp | string;
  name: string;
  params: Record<string, unknown>;
}

/**
 * How much damage a mistaken approval does.
 *  - routine: changes what a name serves; reversible by setting it again.
 *  - elevated: hands another key ongoing write access, or changes identity others read.
 */
export type IntentRisk = 'routine' | 'elevated';

export interface RenderedIntent {
  /** One sentence, the thing the user actually reads. */
  headline: string;
  /** What happens after it lands, in concrete terms. */
  effect: string;
  /** Label/value pairs to show verbatim — ids and addresses, never paraphrased. */
  detail: { label: string; value: string; mono?: boolean }[];
  risk: IntentRisk;
  /** Set when the request cannot be run at all; the view refuses instead of asking. */
  error?: string;
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

function bad(headline: string, error: string): RenderedIntent {
  return { headline, effect: '', detail: [], risk: 'elevated', error };
}

/**
 * Render an intent for the approval dialog.
 *
 * `chain` decides how controller/owner addresses are validated — Solana for the Solana-era
 * ar.io registry, Arweave for BANKON and the AO-era registry.
 */
export function renderIntent(intent: NameIntent, chain: AddressChain): RenderedIntent {
  const { name, params } = intent;
  const p = params ?? {};

  switch (intent.op) {
    case 'set-root': {
      const tx = str(p.transactionId);
      if (!isArweaveId(tx)) return bad(`Point ${name} somewhere new`, 'The target is not a 43-character Arweave id.');
      const ttl = clampTtl(num(p.ttlSeconds) ?? 900);
      return {
        headline: `Point ${name} at new content`,
        effect: `Everyone loading ${name} gets this content instead, on every ar.io gateway, within ${ttl} seconds.`,
        detail: [
          { label: 'Name', value: name },
          { label: 'New target', value: tx, mono: true },
          { label: 'Cache for', value: `${ttl} seconds` },
        ],
        risk: 'routine',
      };
    }

    case 'set-undername': {
      const sub = validateUndername(str(p.undername));
      if (!sub.ok) return bad(`Add an undername to ${name}`, sub.reason ?? 'Invalid undername.');
      const tx = str(p.transactionId);
      if (!isArweaveId(tx)) return bad(`Add ${sub.value}_${name}`, 'The target is not a 43-character Arweave id.');
      const ttl = clampTtl(num(p.ttlSeconds) ?? 900);
      return {
        headline: `Serve ${sub.value}_${name} from new content`,
        effect: `${sub.value}_${name}.ar.io starts resolving to this content. The root ${name} is untouched.`,
        detail: [
          { label: 'Undername', value: `${sub.value}_${name}`, mono: true },
          { label: 'Target', value: tx, mono: true },
          { label: 'Cache for', value: `${ttl} seconds` },
        ],
        risk: 'routine',
      };
    }

    case 'remove-undername': {
      const sub = validateUndername(str(p.undername));
      if (!sub.ok) return bad(`Remove an undername from ${name}`, sub.reason ?? 'Invalid undername.');
      return {
        headline: `Stop serving ${sub.value}_${name}`,
        effect: `${sub.value}_${name}.ar.io stops resolving once caches expire. The slot is freed for reuse.`,
        detail: [{ label: 'Undername', value: `${sub.value}_${name}`, mono: true }],
        risk: 'routine',
      };
    }

    case 'set-identity': {
      const fields: { label: string; value: string; mono?: boolean }[] = [];
      if (typeof p.nickname === 'string') fields.push({ label: 'Nickname', value: str(p.nickname) || '(cleared)' });
      if (typeof p.ticker === 'string') fields.push({ label: 'Ticker', value: str(p.ticker) || '(cleared)' });
      if (typeof p.description === 'string') fields.push({ label: 'Description', value: str(p.description) || '(cleared)' });
      if (Array.isArray(p.keywords)) fields.push({ label: 'Keywords', value: (p.keywords as unknown[]).map(String).join(', ') || '(cleared)' });
      if (typeof p.logo === 'string') {
        const logo = str(p.logo);
        if (logo && !isArweaveId(logo)) return bad(`Update ${name}'s identity`, 'The logo is not a 43-character Arweave id.');
        fields.push({ label: 'Logo', value: logo || '(cleared)', mono: true });
      }
      if (fields.length === 0) return bad(`Update ${name}'s identity`, 'No identity fields were given.');
      const names = fields.map((f) => f.label.toLowerCase()).join(', ');
      return {
        headline: `Update ${name}'s ${names}`,
        effect: `Explorers and gateways will show this instead. ${fields.length} separate transaction${fields.length > 1 ? 's' : ''} to sign.`,
        detail: [{ label: 'Name', value: name }, ...fields],
        risk: 'elevated',
      };
    }

    case 'add-controller': {
      const c = str(p.controller);
      const v = validateAddressFor(chain, c);
      if (!v.ok) return bad(`Give another key control of ${name}`, v.reason ?? 'Invalid address.');
      return {
        headline: `Let ${c.slice(0, 8)}…${c.slice(-6)} manage ${name}`,
        effect: `That key can change where ${name} points, add and remove undernames, and edit its identity — until you remove it. It cannot transfer the name away.`,
        detail: [{ label: 'Name', value: name }, { label: 'New controller', value: c, mono: true }],
        risk: 'elevated',
      };
    }

    case 'remove-controller': {
      const c = str(p.controller);
      const v = validateAddressFor(chain, c);
      if (!v.ok) return bad(`Remove a controller from ${name}`, v.reason ?? 'Invalid address.');
      return {
        headline: `Stop ${c.slice(0, 8)}…${c.slice(-6)} managing ${name}`,
        effect: `That key loses write access to ${name} immediately.`,
        detail: [{ label: 'Name', value: name }, { label: 'Controller', value: c, mono: true }],
        risk: 'routine',
      };
    }

    case 'set-primary': {
      return {
        headline: `Make ${name} your primary name`,
        effect: `Explorers and gateways will show ${name} as the name for your address.`,
        detail: [{ label: 'Name', value: name }],
        risk: 'routine',
      };
    }

    default:
      return bad('Unsupported request', `PARSEC does not support the operation "${String(intent.op)}".`);
  }
}

/** Host shown in the dialog. Falls back to the raw string when it is not a URL. */
export function originLabel(origin: string): string {
  try {
    return new URL(origin).host;
  } catch {
    return origin || 'unknown origin';
  }
}

/**
 * Origins PARSEC will surface a name request from at all.
 *
 * The Rust CORS layer already gates who can open the socket; this is the second gate, in
 * the words the user sees — an origin not on this list is shown as untrusted even if it
 * somehow reached the dialog.
 */
export const KNOWN_ORIGINS: Record<string, string> = {
  'bankon.pythai.net': 'BANKON',
  'agenticplace.pythai.net': 'AgenticPlace',
  'mindx.pythai.net': 'mindX',
  'deltaverse.pythai.net': 'DeltaVerse',
  'rage.pythai.net': 'RAGE',
  'localhost': 'local development',
  '127.0.0.1': 'local development',
};

export function describeOrigin(origin: string): { host: string; label: string; known: boolean } {
  const host = originLabel(origin);
  const bare = host.replace(/:\d+$/, '');
  const label = KNOWN_ORIGINS[bare];
  return { host, label: label ?? host, known: label !== undefined };
}
