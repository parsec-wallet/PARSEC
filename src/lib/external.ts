// PARSEC Wallet — open a web page outside PARSEC.
//
// On desktop the page opens in the participant's default browser (the opener
// plugin), never inside PARSEC's own window: a third-party page in the wallet's
// webview would run beside the wallet. Only https URLs are opened.

import { invoke, isTauri } from './platform';

export function isHttpsUrl(url: string): boolean {
  try { return new URL(url).protocol === 'https:'; } catch { return false; }
}

/** Open an https URL in the default browser. Returns false if it was refused. */
export async function openExternal(url: string): Promise<boolean> {
  if (!isHttpsUrl(url)) return false;
  if (isTauri) {
    await invoke('plugin:opener|open_url', { url });
    return true;
  }
  window.open(url, '_blank', 'noopener,noreferrer');
  return true;
}
