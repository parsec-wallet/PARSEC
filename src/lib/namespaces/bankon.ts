// BANKON Names adapter — implements NamespaceAdapter by routing to
// src/lib/bankon-names/client.ts. Token-agnostic; no child-process spawn.

import { signDataItemFromVault } from '../arweave/ans104';
import { aoMessage } from '../arweave/ao';
import {
  buildBuyBankonInput,
  buildExtendBankonLeaseInput,
  buildPrimaryBankonAcknowledgeInput,
  buildPrimaryBankonRequestInput,
  buildSetBankonRecordInput,
  buildTransferBankonInput,
  getBankonRecord,
  getBankonTokenCost,
  getOwnedBankonRecords,
  getReservedBankonName,
  type BankonRecord,
} from '../bankon-names/client';
import { formatArio } from '../arweave/ario';
import {
  paymentMethodUnit,
  type PaymentMethod,
  type PaymentProof,
} from '../bankon-names/payment';
import { registerNamespace } from './registry';
import type {
  CostQuery,
  CostQuote,
  NamespaceAdapter,
  NamespaceCapabilities,
  NormalizedRecord,
  SignedWrite,
} from './types';

const CAPS: NamespaceCapabilities = {
  controllers: false,
  increaseUndernameLimit: false,
  spawnsChildProcess: false,
  acceptedPaymentMethods: ['free', 'algorand', 'arweave-stake', 'bankon'],
};

function normalize(name: string, record: BankonRecord): NormalizedRecord {
  return {
    name,
    owner: record.owner,
    type: record.type,
    endTimestamp: record.endTimestamp,
    rootTarget: record.target,
    rootTtl: record.ttlSeconds,
    undernames: record.undernames,
    undernameLimit: record.undernameLimit,
    raw: record,
  };
}

function inputForCost(query: CostQuery): { method: PaymentMethod; years?: number; purchaseType?: 'lease' | 'permabuy' } {
  const method = (query.paymentMethod as PaymentMethod | undefined) ?? 'free';
  return {
    method,
    years: query.years,
    purchaseType: query.purchaseType,
  };
}

function paymentProofFor(method: string, proof: string | undefined, amount: bigint | undefined): PaymentProof {
  switch (method) {
    case 'algorand':
      return { method: 'algorand', txId: proof ?? '', microAlgos: amount ?? 0n };
    case 'arweave-stake':
      return { method: 'arweave-stake', txId: proof ?? '', winston: amount ?? 0n };
    case 'bankon':
      return { method: 'bankon', txId: proof ?? '', mBankon: amount ?? 0n };
    default:
      return { method: 'free' };
  }
}

export const bankonAdapter: NamespaceAdapter = {
  id: 'bankon',
  displayName: 'BANKON Names',
  capabilities: CAPS,

  async getRecord(name) {
    const rec = await getBankonRecord(name);
    return rec ? normalize(name, rec) : null;
  },

  async getOwnedRecords(owner) {
    const items = await getOwnedBankonRecords(owner);
    return items.map((i) => normalize(i.name, i.record));
  },

  async getCost(query: CostQuery): Promise<CostQuote> {
    const opts = inputForCost(query);
    const r = await getBankonTokenCost(query.intent, query.name, {
      paymentMethod: opts.method,
      years: opts.years,
      purchaseType: opts.purchaseType,
    });
    return { amount: r.amount, unit: paymentMethodUnit(r.method) };
  },

  async isReserved(name) {
    const r = await getReservedBankonName(name);
    return r !== null;
  },

  async claim(opts) {
    const proof = paymentProofFor(opts.paymentMethod, opts.paymentProof, opts.paymentAmount);
    const signed = await signDataItemFromVault(
      opts.address,
      opts.passphrase,
      buildBuyBankonInput({
        name: opts.name,
        purchaseType: opts.purchaseType,
        years: opts.years,
        payment: proof,
      }),
    );
    await aoMessage(signed);
    return { id: signed.id };
  },

  async setRootRecord(opts): Promise<SignedWrite> {
    const signed = await signDataItemFromVault(
      opts.address,
      opts.passphrase,
      buildSetBankonRecordInput({
        name: opts.name,
        subdomain: '@',
        transactionId: opts.transactionId,
        ttlSeconds: opts.ttlSeconds,
      }),
    );
    await aoMessage(signed);
    return { id: signed.id };
  },

  async setUndername(opts): Promise<SignedWrite> {
    const signed = await signDataItemFromVault(
      opts.address,
      opts.passphrase,
      buildSetBankonRecordInput({
        name: opts.name,
        subdomain: opts.subdomain,
        transactionId: opts.transactionId,
        ttlSeconds: opts.ttlSeconds,
      }),
    );
    await aoMessage(signed);
    return { id: signed.id };
  },

  async removeUndername(_opts): Promise<SignedWrite> {
    throw new Error('BANKON v1 does not support undername removal — overwrite or transfer the name to revoke.');
  },

  async extendLease(opts): Promise<SignedWrite> {
    const signed = await signDataItemFromVault(
      opts.address,
      opts.passphrase,
      buildExtendBankonLeaseInput({ name: opts.name, years: opts.years, payment: { method: 'free' } }),
    );
    await aoMessage(signed);
    return { id: signed.id };
  },

  async transferOwnership(opts): Promise<SignedWrite> {
    const signed = await signDataItemFromVault(
      opts.address,
      opts.passphrase,
      buildTransferBankonInput({ name: opts.name, to: opts.to }),
    );
    await aoMessage(signed);
    return { id: signed.id };
  },

  async requestPrimary(opts): Promise<SignedWrite> {
    // BANKON also uses two-step (request + acknowledge), both on the BNR.
    const signed = await signDataItemFromVault(
      opts.address,
      opts.passphrase,
      buildPrimaryBankonRequestInput({ name: opts.name }),
    );
    await aoMessage(signed);
    const ack = await signDataItemFromVault(
      opts.address,
      opts.passphrase,
      buildPrimaryBankonAcknowledgeInput(),
    );
    await aoMessage(ack);
    return { id: signed.id };
  },
};

/** Re-exported for the UI's cost-format helper. */
export const formatAmount = formatArio;

registerNamespace(bankonAdapter);
