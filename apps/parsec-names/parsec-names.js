// parsec-names.js — manage ar.io names from a web page, with Parsec holding the key.
//
// Drop-in for bankon.pythai.net, agenticplace.pythai.net, mindx.pythai.net and
// deltaverse.pythai.net. No build step, no dependencies, no bundler:
//
//   import { ParsecNames } from '/vendor/parsec-names.js';
//   const pn = new ParsecNames();
//   await pn.detect();                                  // is Parsec running?
//   const state = await pn.read('deltaverse');          // works with or without Parsec
//   await pn.setRoot('deltaverse', manifestId, 900);    // asks Parsec; user approves
//
// TWO HALVES, ON PURPOSE
//   Reading is public: it goes to ar.io gateways over plain HTTPS and needs no wallet.
//   A page can always show the truth about a name, even to a visitor with nothing installed.
//   Writing goes to Parsec on localhost, which states the intent to the user and signs with a
//   vault key. This module never sees a private key, never builds a transaction, and cannot
//   make a change without a human approving the sentence Parsec shows them.
//
// WHY NOT A BROWSER WALLET
//   A Phantom-style signer would mean this page builds the Solana transaction and asks for a
//   blind byte-signature. Parsec is asked for a *named operation* instead — the wallet decides
//   what transaction that means. A compromised page can ask for the wrong thing, but it cannot
//   dress an arbitrary payload up as a name change.
//
// LOCALHOST FROM AN HTTPS PAGE
//   http://localhost is a "potentially trustworthy" origin, so Chrome and Firefox allow this
//   from an HTTPS page. Safari is stricter and may block it. Always handle detect() === false;
//   never leave the UI in a state that assumes a wallet.

const DEFAULT_PORT = 9876;
const DEFAULT_GATEWAYS = ['ar.io', 'arweave.net', 'permagate.io'];

/** Operations Parsec accepts. Mirrors ALLOWED_NAME_OPS in the Rust server. */
export const NAME_OPS = [
  'set-root',
  'set-undername',
  'remove-undername',
  'set-identity',
  'add-controller',
  'remove-controller',
  'set-primary',
];

export class ParsecNotAvailable extends Error {
  constructor(message = 'Parsec is not running on this machine') {
    super(message);
    this.name = 'ParsecNotAvailable';
  }
}

/** The user declined, or Parsec refused. `code` is the JSON-RPC code. */
export class ParsecRejected extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'ParsecRejected';
    this.code = code;
  }
}

export class ParsecNames {
  /**
   * @param {object}   [opts]
   * @param {number}   [opts.port=9876]        Connect port.
   * @param {string}   [opts.namespace='solana-arns']  Registry: solana-arns | arns | bankon.
   * @param {string[]} [opts.gateways]         Gateways used for public reads.
   * @param {number}   [opts.timeoutMs=1500]   Detection timeout — keep it short; a missing
   *                                           wallet must not stall the page.
   */
  constructor(opts = {}) {
    this.port = opts.port ?? DEFAULT_PORT;
    this.namespace = opts.namespace ?? 'solana-arns';
    this.gateways = opts.gateways ?? DEFAULT_GATEWAYS;
    this.timeoutMs = opts.timeoutMs ?? 1500;
    this.base = `http://127.0.0.1:${this.port}/parsec/v1/connect`;
    this._ws = null;
    this._nextId = 1;
    this._waiting = new Map();
    this.available = null; // null = not yet checked
    this.info = null;
  }

  // ── Detection ───────────────────────────────────────────────────────────────

  /** Is Parsec running and reachable? Never throws; returns a boolean. */
  async detect() {
    try {
      const res = await this.#fetchWithTimeout(`${this.base}/health`, this.timeoutMs);
      this.available = res.ok;
      if (res.ok) this.info = await res.json().catch(() => null);
    } catch {
      this.available = false;
    }
    return this.available;
  }

  /** Addresses Parsec has, once connected. Requires Parsec. */
  async accounts() {
    return this.#rpc('parsec_accounts', {});
  }

  // ── Public reads (no wallet needed) ─────────────────────────────────────────

  /**
   * What a name currently serves, straight from ar.io gateways.
   *
   * Returns `{ name, url, resolvedId, ttlSeconds, undernameLimit, gateway, ok }`.
   * `resolvedId === null` means no gateway has indexed it yet — a new name, not an error.
   */
  async read(name, undername) {
    const host = undername && undername !== '@' ? `${undername}_${name}` : name;
    for (const gw of this.gateways) {
      const url = `https://${host}.${gw}`;
      try {
        const res = await this.#fetchWithTimeout(url, 8000, { method: 'HEAD' });
        const h = res.headers;
        const resolvedId = h.get('x-arns-resolved-id');
        if (!resolvedId) continue;
        return {
          name, undername: undername ?? '@', url, gateway: gw, ok: res.ok,
          resolvedId,
          ttlSeconds: Number(h.get('x-arns-ttl-seconds')) || null,
          undernameLimit: Number(h.get('x-arns-undername-limit')) || null,
          antId: h.get('x-arns-ant-id'),
        };
      } catch { /* try the next gateway */ }
    }
    return { name, undername: undername ?? '@', url: `https://${host}.${this.gateways[0]}`, gateway: null, ok: false, resolvedId: null, ttlSeconds: null, undernameLimit: null, antId: null };
  }

  /** ar.io's placeholder manifest — a name that still serves this has no content of its own. */
  static PLACEHOLDER = 'T9_V2HfiAq5qlLzObfyayj2-cjPujxpg25TRi4OZbe4';

  /** True when the name is registered but still shows ar.io's "your name is ready" page. */
  static isPlaceholder(resolvedId) {
    return resolvedId === ParsecNames.PLACEHOLDER;
  }

  // ── Writes (Parsec approves and signs) ──────────────────────────────────────

  /** Point the root (@) record at a manifest or transaction id. */
  setRoot(name, transactionId, ttlSeconds = 900) {
    return this.request('set-root', name, { transactionId, ttlSeconds });
  }

  /** Add or update an undername: served at `<undername>_<name>`. */
  setUndername(name, undername, transactionId, ttlSeconds = 900) {
    return this.request('set-undername', name, { undername, transactionId, ttlSeconds });
  }

  removeUndername(name, undername) {
    return this.request('remove-undername', name, { undername });
  }

  /** Any of nickname, ticker, description, keywords[], logo. One signature per field. */
  setIdentity(name, patch) {
    return this.request('set-identity', name, patch);
  }

  addController(name, controller) {
    return this.request('add-controller', name, { controller });
  }

  removeController(name, controller) {
    return this.request('remove-controller', name, { controller });
  }

  setPrimary(name) {
    return this.request('set-primary', name, {});
  }

  /**
   * The general form. Resolves with the wallet's result (typically `{ id }`) once the user
   * approves and the transaction lands; rejects with ParsecRejected if they decline.
   *
   * There is no progress callback: the page should say "waiting for approval in Parsec" from
   * the moment this is called until it settles.
   */
  async request(op, name, params = {}) {
    if (!NAME_OPS.includes(op)) throw new Error(`Unknown operation: ${op}`);
    return this.#rpc('parsec_nameRequest', {
      namespace: this.namespace,
      op,
      name,
      params,
      origin: location.origin,
    });
  }

  // ── Transport ───────────────────────────────────────────────────────────────

  async #socket() {
    if (this._ws && this._ws.readyState === WebSocket.OPEN) return this._ws;
    if (this.available === false) throw new ParsecNotAvailable();
    if (this.available === null && !(await this.detect())) throw new ParsecNotAvailable();

    return new Promise((resolve, reject) => {
      let ws;
      try {
        ws = new WebSocket(`ws://127.0.0.1:${this.port}/parsec/v1/connect/ws`);
      } catch (e) {
        reject(new ParsecNotAvailable(e.message));
        return;
      }
      const fail = () => {
        this.available = false;
        this._ws = null;
        reject(new ParsecNotAvailable('Could not open a channel to Parsec'));
      };
      ws.addEventListener('open', () => { this._ws = ws; resolve(ws); });
      ws.addEventListener('error', fail);
      ws.addEventListener('close', () => {
        this._ws = null;
        // Anything still in flight will never be answered — fail it rather than hang.
        for (const [, { reject: rj }] of this._waiting) {
          rj(new ParsecNotAvailable('Parsec closed the connection'));
        }
        this._waiting.clear();
      });
      ws.addEventListener('message', (ev) => {
        let msg;
        try { msg = JSON.parse(ev.data); } catch { return; }
        const pending = this._waiting.get(msg.id);
        if (!pending) return;
        this._waiting.delete(msg.id);
        if (msg.error) pending.reject(new ParsecRejected(msg.error.message, msg.error.code));
        else pending.resolve(msg.result);
      });
    });
  }

  async #rpc(method, params) {
    const ws = await this.#socket();
    const id = this._nextId++;
    return new Promise((resolve, reject) => {
      this._waiting.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  #fetchWithTimeout(url, ms, init = {}) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    return fetch(url, { ...init, signal: ctrl.signal, mode: 'cors' })
      .finally(() => clearTimeout(timer));
  }

  /** Close the channel. Call on page unload if you like; it is not required. */
  close() {
    if (this._ws) this._ws.close();
    this._ws = null;
  }
}

// ── Validation, shared with the wallet so both sides agree ────────────────────

export const isArweaveId = (s) => /^[A-Za-z0-9_-]{43}$/.test((s ?? '').trim());

export function validateUndername(s) {
  const value = (s ?? '').trim().toLowerCase();
  if (!value) return { ok: false, value, reason: 'Enter an undername' };
  if (value === '@') return { ok: false, value, reason: '"@" is the root record' };
  if (value.length > 61) return { ok: false, value, reason: 'At most 61 characters' };
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(value)) {
    return { ok: false, value, reason: 'Use a–z, 0–9 and hyphens; no leading or trailing hyphen' };
  }
  return { ok: true, value };
}

/** Where an undername is actually served — underscore, one DNS label. */
export const undernameUrl = (name, undername, gateway = 'ar.io') =>
  undername && undername !== '@' ? `https://${undername}_${name}.${gateway}` : `https://${name}.${gateway}`;
