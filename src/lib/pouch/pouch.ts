// Parsec Wallet Pouch — Collection Manager
// One pouch, many chain wallets. Selective identity.

import type {
  WalletPouch, ChainWalletRef, PouchCompartment,
  WalletPurpose, Visibility, ExposureLevel,
} from './types';

const POUCH_STORAGE_KEY = 'parsec-pouch';

function generateId(): string {
  return crypto.getRandomValues(new Uint8Array(8))
    .reduce((s, b) => s + b.toString(16).padStart(2, '0'), '');
}

/** Load pouch from localStorage (metadata only, no secrets) */
export function loadPouch(): WalletPouch | null {
  try {
    const raw = localStorage.getItem(POUCH_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** Save pouch to localStorage (metadata only, no secrets) */
export function savePouch(pouch: WalletPouch): void {
  localStorage.setItem(POUCH_STORAGE_KEY, JSON.stringify(pouch));
}

/** Create a new empty pouch */
export function createPouch(name: string): WalletPouch {
  const pouch: WalletPouch = {
    pouchId: `pouch_${generateId()}`,
    name,
    createdAt: new Date().toISOString(),
    cypherpunk2048Version: '1.0.0',
    wallets: [],
    compartments: [],
    backupPolicy: {
      encryptedBackupRequired: true,
      plaintextBackupAllowed: false,
      plaintextBackupAdvancedOnly: true,
      requireTypedWarning: true,
    },
  };
  savePouch(pouch);
  return pouch;
}

/** Add a chain wallet to the pouch */
export function addWalletToPouch(
  pouch: WalletPouch,
  chainId: string,
  address: string,
  label: string,
  purpose: WalletPurpose = 'receive',
  visibility: Visibility = 'private',
  watchOnly = false,
): WalletPouch {
  const wallet: ChainWalletRef = {
    walletId: `${chainId}_${generateId()}`,
    chainId,
    label,
    purpose,
    visibility,
    address,
    watchOnly,
    publicSurfaces: [{
      chainId,
      surfaceType: 'address',
      value: address,
      label,
    }],
  };

  const updated = { ...pouch, wallets: [...pouch.wallets, wallet] };
  savePouch(updated);
  return updated;
}

/** Remove a wallet from the pouch */
export function removeWalletFromPouch(pouch: WalletPouch, walletId: string): WalletPouch {
  const updated = {
    ...pouch,
    wallets: pouch.wallets.filter(w => w.walletId !== walletId),
    compartments: pouch.compartments.map(c => ({
      ...c,
      memberWalletIds: c.memberWalletIds.filter(id => id !== walletId),
    })),
  };
  savePouch(updated);
  return updated;
}

/** Create a compartment (privacy group) */
export function createCompartment(
  pouch: WalletPouch,
  label: string,
  purpose: string,
  walletIds: string[],
  exposure: ExposureLevel = 'cold',
): WalletPouch {
  const compartment: PouchCompartment = {
    compartmentId: `comp_${generateId()}`,
    label,
    purpose,
    memberWalletIds: walletIds,
    exposureLevel: exposure,
  };

  const updated = { ...pouch, compartments: [...pouch.compartments, compartment] };
  savePouch(updated);
  return updated;
}

/** Get all wallets for a specific chain */
export function getChainWallets(pouch: WalletPouch, chainId: string): ChainWalletRef[] {
  return pouch.wallets.filter(w => w.chainId === chainId);
}

/** Get all public surfaces across all wallets */
export function getPublicSurfaces(pouch: WalletPouch): ChainWalletRef[] {
  return pouch.wallets.filter(w => w.visibility === 'public');
}

/** Count wallets per chain */
export function getChainCounts(pouch: WalletPouch): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const w of pouch.wallets) {
    counts[w.chainId] = (counts[w.chainId] || 0) + 1;
  }
  return counts;
}
