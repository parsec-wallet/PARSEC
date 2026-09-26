// AR.IO Names (Solana era) adapter — the post-migration ArNS registry: the `ario-arns` Solana
// program, ANTs as Metaplex Core NFTs, ARIO as the SPL token. Routes to
// src/lib/arweave/solana-arns-client.ts (lazy @ar.io/sdk). The AO-era `arns` adapter stays for
// legacy reads; this one is where new registrations and management happen.

import * as client from '../arweave/solana-arns-client';
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
  controllers: true,             // verified: SolanaANTWriteable.addController/removeController
  increaseUndernameLimit: true,
  spawnsChildProcess: false,     // buyRecord spawns the ANT itself on Solana
  acceptedPaymentMethods: ['ario'],
};

async function normalize(name: string, rec: client.SolArnsRecord): Promise<NormalizedRecord> {
  const state = await client.getAntState(rec.processId);
  const undernames: NormalizedRecord['undernames'] = {};
  let rootTarget: string | undefined;
  let rootTtl = 3600;
  for (const [k, v] of Object.entries(state.records)) {
    if (k === '@') {
      rootTarget = v.transactionId;
      rootTtl = v.ttlSeconds ?? 3600;
    } else {
      undernames[k] = { transactionId: v.transactionId, ttlSeconds: v.ttlSeconds ?? 3600 };
    }
  }
  return {
    name,
    owner: state.owner ?? '',
    controllers: state.controllers,
    type: rec.type,
    endTimestamp: rec.endTimestamp,
    rootTarget,
    rootTtl,
    undernames,
    undernameLimit: rec.undernameLimit,
    raw: { record: rec, ant: state },
  };
}

export const solanaArnsAdapter: NamespaceAdapter = {
  id: 'solana-arns',
  displayName: 'AR.IO Names (Solana)',
  capabilities: CAPS,
  // Writes go through the vault-bridged Solana kit signer, so the owner and
  // signer is the account's Solana address, not its Arweave one.
  addressChain: 'solana',

  async getRecord(name): Promise<NormalizedRecord | null> {
    const rec = await client.getRecord(name);
    return rec ? normalize(name, rec) : null;
  },

  async getOwnedRecords(): Promise<NormalizedRecord[]> {
    // No efficient owner index on the Solana registry from a public RPC yet
    // (getProgramAccounts scans are heavy). The UI treats an empty list as
    // "search for a specific name instead" — same UX as a cold cache.
    return [];
  },

  async getCost(query: CostQuery): Promise<CostQuote> {
    const amount = await client.getCost({
      intent: query.intent,
      name: query.name,
      purchaseType: query.purchaseType,
      years: query.years,
      quantity: query.quantity,
    });
    return { amount, unit: 'ARIO' };
  },

  async isReserved(name): Promise<boolean> {
    return client.isReserved(name);
  },

  async claim(opts): Promise<SignedWrite & { childProcessId?: string }> {
    const res = await client.buyName({
      address: opts.address,
      passphrase: opts.passphrase,
      name: opts.name,
      purchaseType: opts.purchaseType,
      years: opts.years,
    });
    return { id: res.id, childProcessId: res.processId };
  },

  async setRootRecord(opts): Promise<SignedWrite> {
    return client.setBaseNameRecord(opts);
  },

  async setUndername(opts): Promise<SignedWrite> {
    return client.setUndernameRecord({ ...opts, undername: opts.subdomain });
  },

  async removeUndername(opts): Promise<SignedWrite> {
    return client.removeUndernameRecord({ ...opts, undername: opts.subdomain });
  },

  async extendLease(opts): Promise<SignedWrite> {
    return client.extendLease(opts);
  },

  async transferOwnership(opts): Promise<SignedWrite> {
    return client.transferAnt(opts);
  },

  async requestPrimary(opts): Promise<SignedWrite> {
    return client.requestPrimaryName(opts);
  },

  async addController(opts): Promise<SignedWrite> {
    return client.addController(opts);
  },

  async removeController(opts): Promise<SignedWrite> {
    return client.removeController(opts);
  },

  async increaseUndernameLimit(opts): Promise<SignedWrite> {
    return client.increaseUndernameLimit(opts);
  },
};

registerNamespace(solanaArnsAdapter);
