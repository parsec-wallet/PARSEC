// The monitored "aspects" and their on/off state.
//
// Every aspect is OFF by default and the state lives in memory only — it is
// never persisted (no stored network data) and resets each time the screen
// is built. The participant lights each shield deliberately.

export type Aspect = 'network' | 'cpu' | 'gpu' | 'mac' | 'services';

export interface AspectDef {
  id: Aspect;
  label: string;
  desc: string;
}

export const ASPECTS: AspectDef[] = [
  { id: 'network', label: 'Network', desc: 'Interfaces + tamper watch' },
  { id: 'cpu', label: 'CPU', desc: 'Processor model & live load' },
  { id: 'gpu', label: 'GPU', desc: 'Graphics adapter' },
  { id: 'mac', label: 'MAC', desc: 'Show & spoof hardware addresses' },
  { id: 'services', label: 'Services', desc: 'IPFS / Arweave / Algorand reach' },
];

/** Aspects that need the Rust system snapshot (network_info). */
export const SYSTEM_ASPECTS: Aspect[] = ['network', 'cpu', 'gpu', 'mac'];

// In-memory only. A fresh session always starts fully off.
const onState: Record<Aspect, boolean> = {
  network: false,
  cpu: false,
  gpu: false,
  mac: false,
  services: false,
};

export function isAspectOn(a: Aspect): boolean {
  return onState[a];
}

export function setAspect(a: Aspect, on: boolean): void {
  onState[a] = on;
}

/** True when any aspect backed by the Rust snapshot is lit. */
export function anySystemAspectOn(): boolean {
  return SYSTEM_ASPECTS.some((a) => onState[a]);
}
