// BANKON Names payment proofs.
//
// The BNR is token-agnostic: every claim carries a Payment-Method + a
// Payment-Proof tag pair (plus a declared amount). v1 trusts the
// signed attestation; v2 will swap in oracle verifiers. Either way,
// these helpers are the canonical mapping from a typed payment proof
// to the DataItem tag list.

import type { DataItemTag } from '../arweave/ans104';

export type PaymentMethod = 'free' | 'algorand' | 'arweave-stake' | 'bankon';

export type PaymentProof =
  | { method: 'free' }
  | { method: 'algorand'; txId: string; microAlgos: bigint }
  | { method: 'arweave-stake'; txId: string; winston: bigint }
  | { method: 'bankon'; txId: string; mBankon: bigint };

export function paymentProofToTags(p: PaymentProof): DataItemTag[] {
  switch (p.method) {
    case 'free':
      return [
        { name: 'Payment-Method', value: 'free' },
        { name: 'Payment-Proof', value: 'open-beta' },
        { name: 'Payment-Amount', value: '0' },
      ];
    case 'algorand':
      return [
        { name: 'Payment-Method', value: 'algorand' },
        { name: 'Payment-Proof', value: p.txId },
        { name: 'Payment-Amount', value: p.microAlgos.toString() },
      ];
    case 'arweave-stake':
      return [
        { name: 'Payment-Method', value: 'arweave-stake' },
        { name: 'Payment-Proof', value: p.txId },
        { name: 'Payment-Amount', value: p.winston.toString() },
      ];
    case 'bankon':
      return [
        { name: 'Payment-Method', value: 'bankon' },
        { name: 'Payment-Proof', value: p.txId },
        { name: 'Payment-Amount', value: p.mBankon.toString() },
      ];
  }
}

/** Human label for the UI cost preview. */
export function paymentMethodUnit(m: PaymentMethod): string {
  switch (m) {
    case 'free': return 'free';
    case 'algorand': return 'microALGO';
    case 'arweave-stake': return 'winston';
    case 'bankon': return 'mBANKON';
  }
}
