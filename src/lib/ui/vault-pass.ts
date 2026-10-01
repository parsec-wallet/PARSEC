// PARSEC Wallet — "which vault, and its passphrase": the last step of every
// path that saves a key (create, verify, import, restore).
//
// Where a key goes depends on the open profile's vault:
//   none              → set a passphrase, create the vault, store the key;
//   exists, unlocked  → store the key in it; no passphrase asked;
//   exists, locked    → unlock it with its passphrase, then store the key —
//                       or, right there, "Create a new vault" instead.
// Asking to "set" a passphrase for a vault that already exists was the old
// failure: creating over an existing vault is refused ("vault already exists"),
// and a new passphrase would not open the old vault anyway.
//
// "Create a new vault" makes a new profile (lib/profiles.ts) without leaving the
// screen: the wallet being saved moves with it, and the locked vault stays on
// the device untouched.
//
// Layout, top to bottom: BANKON's notice (read before choosing), the passphrase
// with its eye toggle, strength meter and Generate, the confirmation with a live
// match check, the acknowledgement, then one button — `vaultAction` — directly
// under the fields, named for what it will do and disabled with a plain reason
// until the step can complete.

import { el, input, btn } from '../dom';
import { store } from '../store';
import { keystoreCreate, keystoreStatus, keystoreUnlock } from '../keystore';
import { listProfiles, toProfileName, validProfileName } from '../profiles';
import { passphraseField, type PassphraseField } from '../passphrase-field';
import { sovereignNotice } from './sovereign-notice';

/** `fresh`: a new vault in a new profile, chosen instead of unlocking. */
export type VaultMode = 'checking' | 'new' | 'unlocked' | 'locked' | 'fresh';

export interface VaultPass {
  /** The passphrase section to place in the view. */
  element: HTMLElement;
  /** The current mode (for views that word their button by it). */
  mode(): VaultMode;
  /** Why the step cannot complete yet, or '' when it can. */
  blocker(): string;
  /** The button's wording for the current mode, e.g. "Create vault & save". */
  actionLabel(): string;
  /**
   * Make the vault ready to take a key: create it, unlock it, or make a new
   * profile and its vault, as chosen. Returns the passphrase to hand to
   * `keystoreStore`; throws an Error whose message is fit to show.
   */
  ready(): Promise<string>;
  /** Register a listener for any change that may alter `blocker()` or the label. */
  onChange(fn: () => void): void;
  /** Overwrite every passphrase field (after saving, or when leaving). */
  wipe(): void;
}

export interface VaultPassOptions {
  /** Address of the wallet being saved, which moves to a new vault if one is made. */
  carry?: () => string | null;
  /** Enter in a passphrase field submits (the view's action). */
  onEnter?: () => void;
}

export const MIN_PASSPHRASE = 8;

export function vaultPass(opts: VaultPassOptions = {}): VaultPass {
  let newName = '';
  let acknowledged = false;
  let mode: VaultMode = store.getPassphrase() && store.getPassphrase() !== '__watch_only__' ? 'unlocked' : 'checking';
  const box = el('div', { cls: 'parsec-verify__pass parsec-vault' });
  const listeners: (() => void)[] = [];
  const changed = () => { for (const fn of listeners) fn(); };

  let pass: PassphraseField | null = null;
  let confirm: PassphraseField | null = null;

  function link(text: string, to: VaultMode): HTMLElement {
    return el('p', { cls: 'parsec-vaultpass__alt', children: [el('a', {
      text,
      attrs: { href: '#' },
      onClick: (e) => { e.preventDefault(); wipe(); mode = to; render(); },
    })] });
  }

  function newPassphraseFields(): HTMLElement[] {
    pass = passphraseField({
      placeholder: `New vault passphrase (${MIN_PASSPHRASE}+ characters)`,
      generate: true,
      onInput: () => { confirm?.refresh(); changed(); },
      onEnter: () => opts.onEnter?.(),
    });
    confirm = passphraseField({
      placeholder: 'Type it again to confirm',
      confirms: () => pass?.value() ?? '',
      onInput: () => changed(),
      onEnter: () => opts.onEnter?.(),
    });
    const box = el('input', { attrs: { type: 'checkbox', id: 'parsec-vault-ack' } }) as HTMLInputElement;
    box.checked = acknowledged;
    box.addEventListener('change', () => { acknowledged = box.checked; changed(); });
    const ack = el('label', { cls: 'parsec-vault__ack', attrs: { for: 'parsec-vault-ack' }, children: [
      box, el('span', { text: 'I have written this passphrase down. I understand no one can recover it for me.' }),
    ] });
    return [pass.el, confirm.el, ack];
  }

  function render(): void {
    const profile = store.profile;
    const which = profile === 'default' ? 'this device\'s vault' : `the “${profile}” vault`;
    pass = null; confirm = null;
    box.replaceChildren();
    if (mode === 'checking') {
      box.appendChild(el('p', { cls: 'parsec-view__desc', text: `Checking ${which}…` }));
    } else if (mode === 'unlocked') {
      box.append(
        el('h3', { cls: 'parsec-view__subtitle', text: 'Vault' }),
        el('p', { cls: 'parsec-view__desc', text: `Profile “${profile}” is unlocked. The key is added to its vault under the existing passphrase.` }),
      );
    } else if (mode === 'locked') {
      pass = passphraseField({ placeholder: 'Vault passphrase', current: true, autofocus: true, onInput: () => changed(), onEnter: () => opts.onEnter?.() });
      box.append(
        el('h3', { cls: 'parsec-view__subtitle', text: 'Unlock the vault' }),
        el('p', { cls: 'parsec-view__desc', text: `Profile “${profile}” already has a vault. Enter its passphrase; the key is added to it.` }),
        pass.el,
        link('Forgot it? Create a new vault instead', 'fresh'),
      );
    } else if (mode === 'fresh') {
      const nameField = input({
        placeholder: 'Name for the new vault, e.g. main-2',
        cls: 'bp5-input bp5-large parsec-vault__name',
        value: newName,
        onInput: (v) => { newName = v; changed(); },
      });
      box.append(
        el('h3', { cls: 'parsec-view__subtitle', text: 'Create a new vault' }),
        el('p', { cls: 'parsec-view__desc', text: `A new profile with its own vault and passphrase. This wallet is saved into it. `
          + `Profile “${profile}” and everything in it stay on this device, untouched.` }),
        sovereignNotice(),
        nameField,
        ...newPassphraseFields(),
        link(`Back to unlocking “${profile}”`, 'locked'),
      );
      setTimeout(() => nameField.focus(), 50);
    } else {
      box.append(
        el('h3', { cls: 'parsec-view__subtitle', text: 'Set the vault passphrase' }),
        el('p', { cls: 'parsec-view__desc', text: `This creates the vault for profile “${profile}”. The passphrase encrypts every key in it on this device; `
          + 'it cannot be recovered, only replaced by a new vault.' }),
        sovereignNotice(),
        ...newPassphraseFields(),
      );
    }
    changed();
  }

  render();
  if (mode === 'checking') {
    keystoreStatus()
      .then((st) => { mode = st.exists ? (st.unlocked && store.getPassphrase() ? 'unlocked' : 'locked') : 'new'; render(); })
      .catch(() => { mode = 'new'; render(); });
  }

  function blocker(): string {
    if (mode === 'checking') return 'Checking the vault…';
    if (mode === 'unlocked') return '';
    const p = pass?.value() ?? '';
    if (mode === 'locked') return p ? '' : 'Enter the vault passphrase.';
    if (mode === 'fresh' && !validProfileName(toProfileName(newName))) return 'Name the new vault.';
    if ([...p].length < MIN_PASSPHRASE) return `The passphrase needs at least ${MIN_PASSPHRASE} characters.`;
    if ((confirm?.value() ?? '') !== p) return 'Type the same passphrase in both fields.';
    if (!acknowledged) return 'Tick the box once the passphrase is written down.';
    return '';
  }

  function actionLabel(): string {
    switch (mode) {
      case 'unlocked': return 'Save to vault';
      case 'locked': return 'Unlock & save';
      case 'fresh': return 'Create new vault & save';
      case 'new': return 'Create vault & save';
      default: return 'Save';
    }
  }

  /** Make the new profile and move the wallet being saved into it. */
  async function moveToNewProfile(): Promise<void> {
    const name = toProfileName(newName);
    if (!validProfileName(name)) throw new Error('Name the new vault: letters, digits, - or _.');
    const { profiles } = await listProfiles();
    if (profiles.some((p) => p.name === name)) throw new Error(`A profile named “${name}” already exists. Choose another name.`);

    const mnemonic = store.getTempMnemonic();
    const address = opts.carry?.() ?? null;
    const moving = address ? store.get().accounts.find((a) => a.address === address) : undefined;
    if (moving) {
      // It has no key in the old vault yet; take it off the old profile's list.
      const rest = store.get().accounts.filter((a) => a.address !== address);
      store.set({ accounts: rest, activeAccountIndex: 0 });
    }
    await store.useProfile(name);
    store.setTempMnemonic(mnemonic);
    if (moving) store.set({ accounts: [moving], activeAccountIndex: 0 });
  }

  async function ready(): Promise<string> {
    const why = blocker();
    if (why) throw new Error(why);
    if (mode === 'unlocked') return store.getPassphrase() ?? '';
    const p = pass?.value() ?? '';
    if (mode === 'locked') {
      if (!(await keystoreUnlock(p))) throw new Error('That passphrase did not unlock the vault.');
      return p;
    }
    if (mode === 'fresh') await moveToNewProfile();
    await keystoreCreate(p);
    // From here the vault exists; a retry after a later failure must unlock, not create.
    mode = 'locked';
    return p;
  }

  function wipe(): void {
    pass?.clear();
    confirm?.clear();
  }

  return { element: box, mode: () => mode, blocker, actionLabel, ready, onChange: (fn) => { listeners.push(fn); }, wipe };
}

/**
 * The button that completes a vault step, placed directly under the fields.
 * Named for what it will do, disabled with the reason beside it until the step
 * can complete; `extra` adds the view's own condition (the words, the secret).
 */
export function vaultAction(
  vault: VaultPass,
  run: () => Promise<void>,
  opts: { extra?: () => string; label?: (base: string) => string; skip?: () => boolean } = {},
): { el: HTMLElement; refresh(): void; fail(message: string): void; submit(): void } {
  const why = el('p', { cls: 'parsec-vault__why', attrs: { 'aria-live': 'polite' } });
  const button = btn('', { intent: 'primary', large: true, cls: 'parsec-vault__submit' });
  let busy = false;
  let error = '';

  function refresh(): void {
    const reason = opts.extra?.() || (opts.skip?.() ? '' : vault.blocker());
    const label = opts.label ? opts.label(vault.actionLabel()) : vault.actionLabel();
    button.querySelector('.bp5-button-text')!.textContent = busy ? 'Saving…' : label;
    button.disabled = busy || !!reason;
    why.textContent = error || reason;
    why.dataset.tone = error ? 'error' : '';
  }

  async function go(): Promise<void> {
    if (busy || button.disabled) return;
    busy = true; error = ''; refresh();
    try {
      await run();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
      refresh();
    }
  }

  button.addEventListener('click', () => void go());
  vault.onChange(() => { error = ''; refresh(); });
  refresh();
  return {
    el: el('div', { cls: 'parsec-vault__action', children: [button, why] }),
    refresh,
    fail: (message: string) => { error = message; refresh(); },
    submit: () => void go(),
  };
}
