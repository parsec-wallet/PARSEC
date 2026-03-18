// Parsec Wallet — Tomb IPC client
// Cold storage via encrypted volumes. Linux-only.
// .tomb on disk, .tomb.key on USB pen = poor man's cold storage.

import { invoke } from '@tauri-apps/api/core';
import { isTauri } from './vault';

export interface TombAvailability {
  available: boolean;
  tomb_path: string | null;
  version: string | null;
  missing_deps: string[];
}

export interface UsbDrive {
  mount_path: string;
  label: string;
  available_mb: number;
  total_mb: number;
}

/** Check if Tomb is available on this system */
export async function tombCheck(): Promise<TombAvailability> {
  if (!isTauri()) {
    return { available: false, tomb_path: null, version: null, missing_deps: ['not-desktop'] };
  }
  return invoke<TombAvailability>('tomb_check');
}

/** Detect USB drives suitable for key storage */
export async function tombDetectUsb(): Promise<UsbDrive[]> {
  if (!isTauri()) return [];
  return invoke<UsbDrive[]>('tomb_detect_usb');
}

/** Create a new tomb vault with key on specified path */
export async function tombCreate(
  passphrase: string,
  keyPath: string,
  sizeMb?: number,
): Promise<void> {
  await invoke('tomb_create', {
    passphrase,
    key_path: keyPath,
    size_mb: sizeMb,
  });
}

/** Open a tomb — mount encrypted volume */
export async function tombOpen(passphrase: string, keyPath: string): Promise<void> {
  await invoke('tomb_open', { passphrase, key_path: keyPath });
}

/** Close the tomb — unmount, data encrypted at rest */
export async function tombClose(): Promise<void> {
  await invoke('tomb_close');
}

/** Force-close (kills processes using the tomb) */
export async function tombSlam(): Promise<void> {
  await invoke('tomb_slam');
}

/** Check tomb status */
export async function tombStatus(): Promise<{
  exists: boolean;
  open: boolean;
  tomb_path: string;
}> {
  if (!isTauri()) return { exists: false, open: false, tomb_path: '' };
  return invoke('tomb_status');
}
