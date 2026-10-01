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
// the device untouched. The open profile is named on screen, so the passphrase
// asked for is never ambiguous when a device holds several vaults.

import { el, input } from '../dom';
import { store } from '../store';
import { keystoreCreate, keystoreStatus, keystoreUnlock } from '../keystore';
import { listProfiles, toProfileName, validProfileName } from '../profiles';
import { sovereignNotice } from './sovereign-notice';

/** `fresh`: a new vault in a new profile, chosen instead of unlocking. */
export type VaultMode = 'checking' | 'new' | 'unlocked' | 'locked' | 'fresh';

export interface VaultPass {
  /** The passphrase section to place in the view. */
  element: HTMLElement;
  /** The current mode (for views that word their button by it). */
  mode(): VaultMode;
  /**
   * Make the vault ready to take a key: create it, unlock it, or make a new
   * profile and its vault, as chosen. Returns the passphrase to hand to
   * `keystoreStore`; throws an Error whose message is fit to show.
   */
  ready(): Promise<string>;
}

export interface VaultPassOptions {
  onModeChange?: (m: VaultMode) => void;
  /** Address of the wallet being saved, which moves to a new vault if one is made. */
  carry?: () => string | null;
}

export const MIN_PASSPHRASE = 8;

export function vaultPass(opts: VaultPassOptions = {}): VaultPass {
  let passphrase = '';
  let confirm = '';
  let newName = '';
  let mode: VaultMode = store.getPassphrase() && store.getPassphrase() !== '__watch_only__' ? 'unlocked' : 'checking';
  const box = el('div', { cls: 'parsec-verify__pass' });

  const passField = (placeholder: string) =>
    input({ type: 'password', placeholder, cls: 'bp5-input bp5-large parsec-passphrase-input', onInput: (v) => { passphrase = v; } });
  const confirmField = () =>
    input({ type: 'password', placeholder: 'Confirm passphrase', cls: 'bp5-input bp5-large parsec-passphrase-input', onInput: (v) => { confirm = v; } });

  function link(text: string, to: VaultMode): HTMLElement {
    return el('p', { cls: 'parsec-vaultpass__alt', children: [el('a', {
      text,
      attrs: { href: '#' },
      onClick: (e) => { e.preventDefault(); passphrase = ''; confirm = ''; mode = to; render(); },
    })] });
  }

  function render(): void {
    const profile = store.profile;
    const which = profile === 'default' ? 'this device\'s vault' : `the “${profile}” vault`;
    box.replaceChildren();
    if (mode === 'checking') {
      box.appendChild(el('p', { cls: 'parsec-view__desc', text: `Checking ${which}…` }));
    } else if (mode === 'unlocked') {
      box.append(
        el('h3', { cls: 'parsec-view__subtitle', text: 'Vault' }),
        el('p', { cls: 'parsec-view__desc', text: `Profile “${profile}” is unlocked. The key is added to its vault under the existing passphrase.` }),
      );
    } else if (mode === 'locked') {
      box.append(
        el('h3', { cls: 'parsec-view__subtitle', text: 'Unlock the vault' }),
        el('p', { cls: 'parsec-view__desc', text: `Profile “${profile}” already has a vault. Enter its passphrase; the key is added to it.` }),
        passField('Vault passphrase'),
        link('Forgot it? Create a new vault instead', 'fresh'),
      );
    } else if (mode === 'fresh') {
      const nameField = input({
        placeholder: 'Name for the new vault, e.g. main-2',
        cls: 'bp5-input bp5-large parsec-profiles__name',
        value: newName,
        onInput: (v) => { newName = v; },
      });
      box.append(
        el('h3', { cls: 'parsec-view__subtitle', text: 'Create a new vault' }),
        el('p', { cls: 'parsec-view__desc', text: `A new profile with its own vault and passphrase. This wallet is saved into it. `
          + `Profile “${profile}” and everything in it stay on this device, untouched.` }),
        nameField,
        passField(`New vault passphrase (${MIN_PASSPHRASE}+ characters)`),
        confirmField(),
        sovereignNotice(),
        link(`Back to unlocking “${profile}”`, 'locked'),
      );
      setTimeout(() => nameField.focus(), 50);
    } else {
      box.append(
        el('h3', { cls: 'parsec-view__subtitle', text: 'Set the vault passphrase' }),
        el('p', { cls: 'parsec-view__desc', text: `This creates the vault for profile “${profile}”. The passphrase encrypts every key in it on this device; `
          + 'it cannot be recovered, only replaced by a new vault.' }),
        passField(`Passphrase (${MIN_PASSPHRASE}+ characters)`),
        confirmField(),
        sovereignNotice(),
      );
    }
    opts.onModeChange?.(mode);
  }

  render();
  if (mode === 'checking') {
    keystoreStatus()
      .then((st) => { mode = st.exists ? (st.unlocked && store.getPassphrase() ? 'unlocked' : 'locked') : 'new'; render(); })
      .catch(() => { mode = 'new'; render(); });
  }

  function checkNewPassphrase(): void {
    if (passphrase.length < MIN_PASSPHRASE) throw new Error(`Passphrase must be at least ${MIN_PASSPHRASE} characters.`);
    if (passphrase !== confirm) throw new Error('Passphrases don\'t match.');
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
    if (mode === 'checking') throw new Error('Still checking the vault — try again in a moment.');
    if (mode === 'unlocked') return store.getPassphrase() ?? '';
    if (mode === 'locked') {
      if (!passphrase) throw new Error('Enter the vault passphrase.');
      if (!(await keystoreUnlock(passphrase))) throw new Error('That passphrase did not unlock the vault.');
      return passphrase;
    }
    checkNewPassphrase();
    if (mode === 'fresh') await moveToNewProfile();
    await keystoreCreate(passphrase);
    // From here the vault exists; a retry after a later failure must unlock, not create.
    mode = 'locked';
    return passphrase;
  }

  return { element: box, mode: () => mode, ready };
}
