// Parsec Wallet — the shared layout for creating a wallet.
//
// Every chain's creation screen reads the same way, in the same order:
//
//   1. Your address  — the public key, shown first: this is what the wallet IS.
//   2. Back it up    — the private key and the recovery phrase, each hidden until
//                      revealed, each with its own copy (and a download where a key
//                      is a file, like an Arweave JWK).
//   3. Save          — into the vault.
//
// Long values (a 58-char Algorand address, a base58 Solana key) are monospace and
// wrap on any character, so nothing overflows a narrow window. Status is shown in
// place, not in a toast that disappears before it is read.

import { el, btn, toast } from '../dom';

/** A numbered strip showing where the participant is. */
export function stepStrip(labels: string[], active: number): HTMLElement {
  return el('ol', {
    cls: 'parsec-keyflow__steps',
    attrs: { 'aria-label': 'Wallet creation steps' },
    children: labels.map((label, i) =>
      el('li', {
        cls: `parsec-keyflow__step${i === active ? ' parsec-keyflow__step--active' : ''}${i < active ? ' parsec-keyflow__step--done' : ''}`,
        attrs: i === active ? { 'aria-current': 'step' } : {},
        children: [
          el('span', { cls: 'parsec-keyflow__step-num', text: String(i + 1) }),
          el('span', { cls: 'parsec-keyflow__step-label', text: label }),
        ],
      }),
    ),
  });
}

async function copy(value: string, what: string, secret: boolean): Promise<void> {
  try {
    await navigator.clipboard.writeText(value);
    toast(secret ? `${what} copied. Paste it somewhere offline, then clear your clipboard.` : `${what} copied`, secret ? 'warning' : 'success');
  } catch {
    toast('Could not reach the clipboard', 'danger');
  }
}

export interface AddressPanel {
  el: HTMLElement;
  set(address: string): void;
  pending(message: string): void;
  fail(message: string): void;
}

/** Step 1: the public address, large, monospace, copyable. */
export function addressPanel(chainLabel: string, initial?: string): AddressPanel {
  const value = el('div', { cls: 'parsec-keyflow__address', attrs: { 'aria-live': 'polite' } });
  const status = el('p', { cls: 'parsec-keyflow__status' });
  let current = '';
  const copyBtn = btn('Copy address', {
    minimal: true, icon: 'duplicate',
    onClick: () => { if (current) void copy(current, 'Address', false); },
  });
  const panel = el('section', {
    cls: 'parsec-keyflow__panel parsec-keyflow__panel--address',
    children: [
      el('h3', { cls: 'parsec-keyflow__heading', text: `Your ${chainLabel} address` }),
      el('p', { cls: 'parsec-keyflow__hint', text: 'Your public key. Share it to receive funds; it cannot spend them.' }),
      value,
      status,
      el('div', { cls: 'parsec-keyflow__actions', children: [copyBtn] }),
    ],
  });
  const api: AddressPanel = {
    el: panel,
    set(address) {
      current = address;
      value.textContent = address;
      value.classList.remove('parsec-keyflow__address--pending');
      status.textContent = '';
      status.classList.remove('parsec-keyflow__status--error');
      (copyBtn as HTMLButtonElement).disabled = false;
    },
    pending(message) {
      current = '';
      value.textContent = '';
      value.classList.add('parsec-keyflow__address--pending');
      status.textContent = message;
      status.classList.remove('parsec-keyflow__status--error');
      (copyBtn as HTMLButtonElement).disabled = true;
    },
    fail(message) {
      current = '';
      value.textContent = '';
      status.textContent = message;
      status.classList.add('parsec-keyflow__status--error');
      (copyBtn as HTMLButtonElement).disabled = true;
    },
  };
  if (initial) api.set(initial); else api.pending('Deriving…');
  return api;
}

export interface SecretPanel {
  el: HTMLElement;
  set(value: string): void;
}

/**
 * The private key, hidden until revealed.
 *
 * `download` offers the key as a file instead of (or as well as) text — an
 * Arweave JWK is a 3 KB JSON document nobody should be asked to copy by eye.
 */
export function secretPanel(opts: {
  title: string;
  hint: string;
  format: string;
  download?: { filename: string; mime: string };
  large?: boolean;
}): SecretPanel {
  let value = '';
  let shown = false;
  const box = el('div', {
    cls: `parsec-keyflow__secret${opts.large ? ' parsec-keyflow__secret--large' : ''} parsec-keyflow__secret--hidden`,
    text: '•••• •••• •••• ••••',
  });
  const revealBtn = btn('Reveal', {
    minimal: true, icon: 'eye-open',
    onClick: () => {
      if (!value) return;
      shown = !shown;
      box.textContent = shown ? value : '•••• •••• •••• ••••';
      box.classList.toggle('parsec-keyflow__secret--hidden', !shown);
      revealBtn.textContent = shown ? 'Hide' : 'Reveal';
    },
  });
  const copyBtn = btn('Copy', {
    minimal: true, icon: 'duplicate',
    onClick: () => { if (value) void copy(value, opts.title, true); },
  });
  const actions: HTMLElement[] = [revealBtn, copyBtn];
  if (opts.download) {
    const d = opts.download;
    actions.push(btn('Download', {
      minimal: true, icon: 'download',
      onClick: () => {
        if (!value) return;
        const url = URL.createObjectURL(new Blob([value], { type: d.mime }));
        const a = document.createElement('a');
        a.href = url;
        a.download = d.filename;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        toast(`${d.filename} saved. Keep it offline; anyone with it controls the wallet.`, 'warning');
      },
    }));
  }
  for (const b of actions) (b as HTMLButtonElement).disabled = true;
  const panel = el('section', {
    cls: 'parsec-keyflow__panel',
    children: [
      el('h3', { cls: 'parsec-keyflow__heading', text: opts.title }),
      el('p', { cls: 'parsec-keyflow__hint', text: opts.hint }),
      el('p', { cls: 'parsec-keyflow__format', text: opts.format }),
      box,
      el('div', { cls: 'parsec-keyflow__actions', children: actions }),
    ],
  });
  return {
    el: panel,
    set(v) {
      value = v;
      for (const b of actions) (b as HTMLButtonElement).disabled = false;
    },
  };
}

/** The recovery phrase, blurred until revealed, numbered, copyable. */
export function phrasePanel(words: string[], hint: string): HTMLElement {
  const grid = el('div', {
    cls: 'parsec-mnemonic-grid parsec-keyflow__phrase parsec-keyflow__phrase--hidden',
    attrs: { 'aria-hidden': 'true' },
    children: words.map((word, i) =>
      el('div', {
        cls: 'parsec-mnemonic-word',
        children: [
          el('span', { cls: 'parsec-mnemonic-word__num', text: `${i + 1}` }),
          el('span', { cls: 'parsec-mnemonic-word__text', text: word }),
        ],
      }),
    ),
  });
  let shown = false;
  const revealBtn = btn('Reveal phrase', {
    minimal: true, icon: 'eye-open',
    onClick: () => {
      shown = !shown;
      grid.classList.toggle('parsec-keyflow__phrase--hidden', !shown);
      grid.setAttribute('aria-hidden', String(!shown));
      revealBtn.textContent = shown ? 'Hide phrase' : 'Reveal phrase';
    },
  });
  return el('section', {
    cls: 'parsec-keyflow__panel',
    children: [
      el('h3', { cls: 'parsec-keyflow__heading', text: `Recovery phrase · ${words.length} words` }),
      el('p', { cls: 'parsec-keyflow__hint', text: hint }),
      grid,
      el('div', {
        cls: 'parsec-keyflow__actions',
        children: [
          revealBtn,
          btn('Copy phrase', { minimal: true, icon: 'duplicate', onClick: () => void copy(words.join(' '), 'Recovery phrase', true) }),
        ],
      }),
    ],
  });
}

/** The warning every backup step carries, said once and plainly. */
export function backupWarning(): HTMLElement {
  return el('div', {
    cls: 'parsec-callout bp5-callout bp5-intent-warning parsec-keyflow__warning',
    children: [el('p', { text: 'The private key and the recovery phrase each control this wallet completely. Store them offline. Parsec will never ask you for them again except to restore.' })],
  });
}
