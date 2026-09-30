// Namespace pack barrel. Importing this module triggers each adapter's
// self-registration via the side effects in arns.ts / bankon.ts.

import './arns';
import './bankon';
import './solana-arns';

export {
  activeNamespaceId,
  getNamespace,
  listNamespaces,
  registerNamespace,
  setActiveNamespaceId,
} from './registry';
export type {
  ClaimIntent,
  CostQuery,
  CostQuote,
  NamespaceAdapter,
  NamespaceCapabilities,
  NameIdentity,
  NormalizedRecord,
  PurchaseType,
  SignedWrite,
} from './types';
