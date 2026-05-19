// AR.IO Names (ArNS) adapter — implements NamespaceAdapter by routing to
// the existing src/lib/arweave/ario.ts + ant.ts helpers. ArNS names own a
// child ANT process; the adapter exposes both surfaces uniformly.

import { signDataItemFromVault } from '../arweave/ans104';
import { aoMessage } from '../arweave/ao';
import {
  buildBuyNameInput,
  buildExtendArnsLeaseInput,
  buildIncreaseUndernameLimitInput,
  buildPrimaryArnsRequestInput,
  formatArio,
  getArnsName,
  getArnsRecord,
  getOwnedArnsRecords,
  getReservedName,
  getTokenCost,
  type ArnsRecord,
} from '../arweave/ario';
import {
  primaryNameAcknowledge,
  removeAntRecord,
  setAntController,
  setAntRootRecord,
  setAntUndername,
  spawnAnt,
  transferAntOwnership,
} from '../arweave/ant';
import { buildArweaveSigner } from '../arweave/signer';
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
  controllers: true,
  increaseUndernameLimit: true,
  spawnsChildProcess: true,
  acceptedPaymentMethods: ['ario'],
};

async function normalize(name: string, record: ArnsRecord): Promise<NormalizedRecord> {
  const resolved = await getArnsName(name);
  const root = resolved?.antInfo.records['@'];
  const undernames: NormalizedRecord['undernames'] = {};
  if (resolved) {
    for (const [k, v] of Object.entries(resolved.antInfo.records)) {
      if (k !== '@') undernames[k] = v;
    }
  }
  return {
    name,
    owner: resolved?.antInfo.owner ?? '',
    controllers: resolved?.antInfo.controllers ?? [],
    type: record.type,
    endTimestamp: record.endTimestamp,
    rootTarget: root?.transactionId,
    rootTtl: root?.ttlSeconds ?? 3600,
    undernames,
    undernameLimit: record.undernameLimit,
    raw: { record, antInfo: resolved?.antInfo },
  };
}

export const arnsAdapter: NamespaceAdapter = {
  id: 'arns',
  displayName: 'AR.IO Names',
  capabilities: CAPS,

  async getRecord(name) {
    const rec = await getArnsRecord(name);
    if (!rec) return null;
    return normalize(name, rec);
  },

  async getOwnedRecords(owner) {
    const owned = await getOwnedArnsRecords(owner);
    return Promise.all(owned.map((o) => normalize(o.name, o.record)));
  },

  async getCost(query: CostQuery): Promise<CostQuote> {
    const cost = await getTokenCost(query.intent, query.name, {
      years: query.years,
      purchaseType: query.purchaseType,
      quantity: query.quantity,
    });
    return { amount: cost, unit: 'ARIO' };
  },

  async isReserved(name) {
    const r = await getReservedName(name);
    return r !== null;
  },

  async claim(opts) {
    // ArNS requires a child ANT spawn before Buy-Name.
    const spawn = await spawnAnt({
      address: opts.address,
      passphrase: opts.passphrase,
      name: opts.name,
    });
    const buyInput = buildBuyNameInput({
      name: opts.name,
      antProcessId: spawn.processId,
      purchaseType: opts.purchaseType,
      years: opts.purchaseType === 'lease' ? (opts.years ?? 1) : undefined,
    });
    const signed = await signDataItemFromVault(opts.address, opts.passphrase, buyInput);
    await aoMessage(signed);
    return { id: signed.id, childProcessId: spawn.processId };
  },

  async setRootRecord(opts): Promise<SignedWrite> {
    return withAntSigner(opts.address, opts.passphrase, opts.name, async (signer, antProcessId) => {
      return await setAntRootRecord({
        signer,
        antProcessId,
        transactionId: opts.transactionId,
        ttlSeconds: opts.ttlSeconds,
      });
    });
  },

  async setUndername(opts): Promise<SignedWrite> {
    return withAntSigner(opts.address, opts.passphrase, opts.name, async (signer, antProcessId) => {
      return await setAntUndername({
        signer,
        antProcessId,
        subdomain: opts.subdomain,
        transactionId: opts.transactionId,
        ttlSeconds: opts.ttlSeconds,
      });
    });
  },

  async removeUndername(opts): Promise<SignedWrite> {
    return withAntSigner(opts.address, opts.passphrase, opts.name, async (signer, antProcessId) => {
      return await removeAntRecord({ signer, antProcessId, subdomain: opts.subdomain });
    });
  },

  async extendLease(opts): Promise<SignedWrite> {
    const signed = await signDataItemFromVault(
      opts.address,
      opts.passphrase,
      buildExtendArnsLeaseInput({ name: opts.name, years: opts.years }),
    );
    await aoMessage(signed);
    return { id: signed.id };
  },

  async transferOwnership(opts): Promise<SignedWrite> {
    return withAntSigner(opts.address, opts.passphrase, opts.name, async (signer, antProcessId) => {
      return await transferAntOwnership({ signer, antProcessId, to: opts.to });
    });
  },

  async requestPrimary(opts): Promise<SignedWrite> {
    // Two-step on ArNS: Registry request, then ANT acknowledge.
    const signed = await signDataItemFromVault(
      opts.address,
      opts.passphrase,
      buildPrimaryArnsRequestInput({ name: opts.name }),
    );
    await aoMessage(signed);
    await withAntSigner(opts.address, opts.passphrase, opts.name, async (signer, antProcessId) => {
      return await primaryNameAcknowledge({ signer, antProcessId, name: opts.name });
    });
    return { id: signed.id };
  },

  async addController(opts): Promise<SignedWrite> {
    return withAntSigner(opts.address, opts.passphrase, opts.name, async (signer, antProcessId) => {
      return await setAntController({ signer, antProcessId, controller: opts.controller, action: 'add' });
    });
  },

  async removeController(opts): Promise<SignedWrite> {
    return withAntSigner(opts.address, opts.passphrase, opts.name, async (signer, antProcessId) => {
      return await setAntController({ signer, antProcessId, controller: opts.controller, action: 'remove' });
    });
  },

  async increaseUndernameLimit(opts): Promise<SignedWrite> {
    const signed = await signDataItemFromVault(
      opts.address,
      opts.passphrase,
      buildIncreaseUndernameLimitInput({ name: opts.name, quantity: opts.quantity }),
    );
    await aoMessage(signed);
    return { id: signed.id };
  },
};

async function withAntSigner<T>(
  address: string,
  passphrase: string,
  name: string,
  fn: (signer: Awaited<ReturnType<typeof buildArweaveSigner>>, antProcessId: string) => Promise<T>,
): Promise<T> {
  const record = await getArnsRecord(name);
  if (!record) throw new Error(`ArNS record for "${name}" not found`);
  const signer = await buildArweaveSigner(address, passphrase);
  try {
    return await fn(signer, record.processId);
  } finally {
    signer.dispose();
  }
}

/** Re-exported for the UI cost-format step (one helper, both namespaces). */
export const formatAmount = formatArio;

registerNamespace(arnsAdapter);
