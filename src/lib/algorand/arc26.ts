// ARC-26: algorand:// transaction-request URIs.
// Spec: https://arc.algorand.foundation/ARCs/arc-0026
//
// Pattern adapted from AlgoNode/algourl (Go, Unlicense). Reimplemented in TS.

import algosdk from 'algosdk';

const SCHEME = 'algorand://';

export interface Arc26Payload {
  address: string;
  amount?: number;       // microalgos (or asset base units when assetId set)
  assetId?: number;
  note?: string;         // plain UTF-8 (encoded as ?note=)
  xnote?: string;        // immutable note (?xnote=) — receiver MUST NOT change
  label?: string;
  asset?: string;        // alias param sometimes seen for assetId
}

export interface Arc26Args {
  address: string;
  amount?: number;
  assetId?: number;
  note?: string;
  xnote?: string;
  label?: string;
}

/** Build an algorand:// URI per ARC-26. */
export function encodeArc26(args: Arc26Args): string {
  if (!algosdk.isValidAddress(args.address)) {
    throw new Error(`Invalid Algorand address: ${args.address}`);
  }

  const params = new URLSearchParams();
  if (args.amount !== undefined) {
    if (!Number.isFinite(args.amount) || args.amount < 0) throw new Error('amount must be non-negative');
    params.set('amount', String(Math.floor(args.amount)));
  }
  if (args.assetId !== undefined) {
    if (!Number.isInteger(args.assetId) || args.assetId < 0) throw new Error('assetId must be a non-negative integer');
    params.set('asset', String(args.assetId));
  }
  if (args.note) params.set('note', args.note);
  if (args.xnote) params.set('xnote', args.xnote);
  if (args.label) params.set('label', args.label);

  const qs = params.toString();
  return qs ? `${SCHEME}${args.address}?${qs}` : `${SCHEME}${args.address}`;
}

/**
 * Parse an algorand:// URI. Returns null if the URI does not match the
 * algorand:// scheme or if the embedded address is not a valid Algorand
 * address.
 */
export function parseArc26(uri: string): Arc26Payload | null {
  if (!uri || !uri.startsWith(SCHEME)) return null;
  const body = uri.slice(SCHEME.length);

  const queryStart = body.indexOf('?');
  const address = queryStart < 0 ? body : body.slice(0, queryStart);
  if (!algosdk.isValidAddress(address)) return null;

  const payload: Arc26Payload = { address };

  if (queryStart >= 0) {
    const params = new URLSearchParams(body.slice(queryStart + 1));
    const amount = params.get('amount');
    if (amount !== null) {
      const n = Number(amount);
      if (Number.isFinite(n) && n >= 0) payload.amount = Math.floor(n);
    }
    const asset = params.get('asset');
    if (asset !== null) {
      const n = Number(asset);
      if (Number.isInteger(n) && n >= 0) payload.assetId = n;
    }
    const note = params.get('note');
    if (note !== null) payload.note = note;
    const xnote = params.get('xnote');
    if (xnote !== null) payload.xnote = xnote;
    const label = params.get('label');
    if (label !== null) payload.label = label;
  }

  return payload;
}

/** Test for an algorand:// URI without parsing. */
export function isArc26Uri(s: string): boolean {
  return typeof s === 'string' && s.startsWith(SCHEME);
}
