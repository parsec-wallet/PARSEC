// Namespace registry — the single source of truth for which name registries
// the wallet supports. Adapters self-register at module load by calling
// `registerNamespace`. The unified name-* views read the active adapter via
// `getNamespace(id)` (id arrives via sessionStorage from the caller).

import type { NamespaceAdapter } from './types';

const REGISTRY: Map<string, NamespaceAdapter> = new Map();

export function registerNamespace(adapter: NamespaceAdapter): void {
  REGISTRY.set(adapter.id, adapter);
}

export function getNamespace(id: string): NamespaceAdapter | undefined {
  return REGISTRY.get(id);
}

/** All registered adapters, in registration order (Map preserves insertion). */
export function listNamespaces(): NamespaceAdapter[] {
  return Array.from(REGISTRY.values());
}

/** Read the id from sessionStorage; default to 'bankon' since that's the
 *  Parsec-sovereign namespace. Callers can override via `?ns=` or the
 *  parsec:namespace-id session key set by the upstream view. */
export function activeNamespaceId(): string {
  return sessionStorage.getItem('parsec:namespace-id') || 'bankon';
}

export function setActiveNamespaceId(id: string): void {
  sessionStorage.setItem('parsec:namespace-id', id);
}
