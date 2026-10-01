// Bridge to the Rust network_monitor commands. The webview cannot read MAC
// addresses, local interface IPs, CPU or GPU on its own — these go through
// the desktop backend. All are read-only snapshots; nothing is cached here.

import { invoke, isTauri } from '../platform';
import type { NetworkInfo } from './types';

export { isTauri };

/**
 * Turn the Rust monitor on or off. It is off by default — `fetchNetworkInfo`
 * errors until this has been set true.
 */
export async function setNetworkMonitorEnabled(on: boolean): Promise<void> {
  if (!isTauri) return;
  await invoke('network_monitor_set_enabled', { on });
}

/** A fresh interfaces + CPU + GPU snapshot. Throws while the monitor is off. */
export async function fetchNetworkInfo(): Promise<NetworkInfo> {
  return invoke<NetworkInfo>('network_info');
}

/**
 * MAC spoofing — set an interface's hardware address. Requires OS privilege;
 * the backend surfaces a permission error when run unprivileged.
 */
export async function spoofMac(iface: string, mac: string): Promise<string> {
  return invoke<string>('network_set_mac', { interface: iface, mac });
}

/** A random, locally-administered unicast MAC (the `x2`/`x6`/`xA`/`xE` bit). */
export function randomMac(): string {
  const b = crypto.getRandomValues(new Uint8Array(6));
  b[0] = (b[0] & 0xfc) | 0x02; // locally administered, unicast
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join(':');
}
