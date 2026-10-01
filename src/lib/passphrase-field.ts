// PARSEC Wallet — passphrase field
//
// One control used everywhere a passphrase is chosen or entered: masked by
// default with an eye toggle to reveal, a live strength meter, and a generator.
//
// Design decisions worth stating:
//
//   * Length is never enforced. The participant may choose anything; the meter
//     makes the consequence legible and then gets out of the way. Sovereignty
//     over your own vault includes the right to make it weaker than we would.
//   * Masking uses a native `type="password"` input rather than a text input with
//     a hand-rolled mask. A text input holding the real passphrase would be
//     exposed to autofill, spellcheck and IME history; the mask glyph is then the
//     platform's to choose.
//   * The meter is `assessPassphrase` (lib/passphrase-strength.ts): an entropy
//     estimate that sees common passwords, words, years, keyboard runs and
//     look-alike swaps, not only length. It is guidance; the vault's own rule
//     (Rust `vault_create`, 8 characters minimum) decides. `strengthOf` keeps the
//     length bands of `bankon_vault::overseer` for the second-generation vault.
//   * Generate draws six words from the BIP-39 English list (2,048 words, ~66
//     bits) with the platform CSPRNG, and reveals them so they can be written down.

import { el, input } from './dom';
import { assessPassphrase } from './passphrase-strength';

export type Strength = 'weak' | 'medium' | 'strong';

/** Mirrors `WEAK_PASSPHRASE_LEN` / `STRONG_PASSPHRASE_LEN` in Rust. */
export const WEAK_AT_OR_BELOW = 6;
export const STRONG_AT = 12;

/** Band a passphrase by length. Kept in step with the Rust implementation. */
export function strengthOf(passphrase: string): Strength {
  const n = [...passphrase].length;
  if (n >= STRONG_AT) return 'strong';
  if (n > WEAK_AT_OR_BELOW) return 'medium';
  return 'weak';
}


// Two 16px glyphs, drawn rather than pulled from an icon set (no runtime deps).
const EYE_CLOSED = `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
<path fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"
 d="M2 9.5c1.6 2 3.6 3 6 3s4.4-1 6-3M4.2 11.2 3 12.9M8 12.5V14.4M11.8 11.2 13 12.9"/></svg>`;

const EYE_OPEN = `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
<path fill="none" stroke="currentColor" stroke-width="1.3"
 d="M1.6 8S4 4 8 4s6.4 4 6.4 4-2.4 4-6.4 4-6.4-4-6.4-4Z"/>
<circle cx="8" cy="8" r="1.9" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>`;

export interface PassphraseField {
  /** The wrapper to mount. */
  el: HTMLElement;
  /** The underlying input, for focus() or form wiring. */
  input: HTMLInputElement;
  value(): string;
  setValue(v: string): void;
  /** Overwrite the field and re-mask it. */
  clear(): void;
  /** Re-run the meter or the match check (a confirm field calls this when the first field changes). */
  refresh(): void;
}

export interface PassphraseFieldOptions {
  placeholder?: string;
  /** Show the strength meter. Off for "confirm" and "current passphrase" fields. */
  meter?: boolean;
  /** Show the Generate button. Off for anything but choosing a new passphrase. */
  generate?: boolean;
  autofocus?: boolean;
  onInput?: (value: string) => void;
  onEnter?: (value: string) => void;
  /** Entering an existing passphrase: no meter, and offered as current-password. */
  current?: boolean;
  /** A confirm field: compares itself with this value and says whether they match. */
  confirms?: () => string;
  /** Extra classes for the input (e.g. a view's own input style). */
  inputCls?: string;
}

/** Six words from the BIP-39 English list, uniformly, with the platform CSPRNG (~66 bits). */
export async function generatePassphrase(count = 6): Promise<string> {
  const { wordlists } = await import('bip39');
  const list = wordlists.english as string[];
  const idx = crypto.getRandomValues(new Uint16Array(count));
  // 2,048 = 2^11, so masking to 11 bits is uniform.
  return Array.from(idx, (i) => list[i & 0x7ff]).join('-');
}

export function passphraseField(opts: PassphraseFieldOptions = {}): PassphraseField {
  const showMeter = opts.meter !== false && !opts.current && !opts.confirms;
  const showGenerate = opts.generate === true;

  const inp = input({
    type: 'password',
    placeholder: opts.placeholder ?? 'Passphrase',
    cls: `bp5-input bp5-large parsec-passphrase__input${opts.inputCls ? ` ${opts.inputCls}` : ''}`,
    onInput: (v) => {
      update(v);
      opts.onInput?.(v);
    },
    onEnter: opts.onEnter,
  });
  // Never offer this to a password manager or spellchecker.
  inp.autocomplete = opts.current ? 'current-password' : 'new-password';
  inp.spellcheck = false;
  inp.setAttribute('autocapitalize', 'off');
  inp.setAttribute('autocorrect', 'off');

  const reveal = el('button', {
    cls: 'bp5-button bp5-minimal parsec-passphrase__reveal',
    html: EYE_CLOSED,
    attrs: { type: 'button', 'aria-label': 'Show passphrase', 'aria-pressed': 'false' },
  });
  reveal.addEventListener('click', () => {
    const nowVisible = inp.type === 'password';
    inp.type = nowVisible ? 'text' : 'password';
    reveal.innerHTML = nowVisible ? EYE_OPEN : EYE_CLOSED;
    reveal.setAttribute('aria-label', nowVisible ? 'Hide passphrase' : 'Show passphrase');
    reveal.setAttribute('aria-pressed', String(nowVisible));
    inp.focus();
  });

  const row = el('div', { cls: 'parsec-passphrase__row', children: [inp, reveal] });

  const bar = el('div', { cls: 'parsec-passphrase__bar' });
  const fill = el('div', { cls: 'parsec-passphrase__fill' });
  bar.appendChild(fill);
  const label = el('span', { cls: 'parsec-passphrase__label' });
  const note = el('div', { cls: 'parsec-passphrase__note' });
  const meter = el('div', { cls: 'parsec-passphrase__meter', children: [bar, label] });

  const children: HTMLElement[] = [row];
  if (showGenerate) {
    const gen = el('button', {
      cls: 'bp5-button bp5-minimal parsec-passphrase__generate',
      text: 'Generate',
      attrs: { type: 'button' },
    });
    gen.addEventListener('click', () => {
      void generatePassphrase()
        .then((p) => {
          inp.value = p;
          // Reveal it — a generated passphrase the participant cannot read is a
          // passphrase they cannot record, and this one is not recoverable.
          inp.type = 'text';
          reveal.innerHTML = EYE_OPEN;
          reveal.setAttribute('aria-pressed', 'true');
          reveal.setAttribute('aria-label', 'Hide passphrase');
          update(p);
          opts.onInput?.(p);
        })
        .catch(() => {
          note.textContent = 'Could not generate a passphrase here.';
        });
    });
    children.push(el('div', { cls: 'parsec-passphrase__actions', children: [gen] }));
  }
  if (showMeter) children.push(meter, note);
  else if (opts.confirms) children.push(note);

  const wrapper = el('div', { cls: 'parsec-passphrase', children });

  function update(v: string): void {
    if (opts.confirms) {
      const want = opts.confirms();
      wrapper.dataset.match = !v ? '' : v === want ? 'yes' : 'no';
      note.textContent = !v ? '' : v === want ? 'Matches' : want.startsWith(v) ? 'Keep typing…' : 'Doesn’t match yet';
      return;
    }
    if (!showMeter) return;
    const a = assessPassphrase(v);
    const band: Strength = a.level <= 1 ? 'weak' : a.level === 2 ? 'medium' : 'strong';
    wrapper.dataset.strength = v ? band : '';
    fill.style.width = v ? `${(a.level + 1) * 20}%` : '0%';
    label.textContent = v ? `${a.label} · ~${a.bits} bits` : '';
    note.textContent = v ? (a.warnings[0] ?? a.hint) : '';
  }

  update('');
  if (opts.autofocus) queueMicrotask(() => inp.focus());

  return {
    el: wrapper,
    input: inp,
    value: () => inp.value,
    setValue: (v: string) => {
      inp.value = v;
      update(v);
    },
    refresh: () => update(inp.value),
    clear: () => {
      inp.value = '';
      inp.type = 'password';
      reveal.innerHTML = EYE_CLOSED;
      reveal.setAttribute('aria-pressed', 'false');
      update('');
    },
  };
}
