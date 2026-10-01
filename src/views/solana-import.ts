// Import an existing Solana key into the vault — mnemonic (Phantom / Solflare / any BIP-39 wallet),
// base58 keypair export, or `solana-keygen` JSON. The participant keeps the key; parsec becomes its
// signer. Same one-identity-many-chains mapping as solana-create.

import { exactTextField, normalizePhrase } from '../lib/phrase-input';
import { el, btn, toast } from '../lib/dom';
import { store } from '../lib/store';
import { previewSolanaSecret, importSolanaKeyToVault } from '../lib/permaweb/wallet/keys';

export function solanaImportView(): HTMLElement {
  let draft = '';
  let preview: { address: string; kind: string } | null = null;
  let busy = false;

  const addressEl = el('div', { cls: 'parsec-arc52__primary-address', text: '—' });
  const kindEl = el('div', { cls: 'parsec-view__desc', text: '' });
  const ta = document.createElement('textarea');
  ta.className = 'bp5-input parsec-permaweb__wide';
  ta.rows = 4;
  ta.placeholder = '24-word mnemonic · base58 keypair · [12,34,…] JSON keypair';
  exactTextField(ta);
  ta.addEventListener('input', () => {
    draft = normalizePhrase(ta.value);
    previewSolanaSecret(draft).then((p) => { preview = p; addressEl.textContent = p.address; kindEl.textContent = p.kind === 'mnemonic' ? 'BIP-39 mnemonic → m/44\'/501\'/0\'/0\' (Phantom-compatible)' : 'Raw ed25519 keypair (stored as-is)'; })
      .catch((e) => { preview = null; addressEl.textContent = '—'; kindEl.textContent = draft.trim() ? (e instanceof Error ? e.message : String(e)) : ''; });
  });

  async function save(): Promise<void> {
    if (busy || !preview) return;
    const passphrase = store.getPassphrase();
    if (!passphrase) { toast('Wallet is locked', 'danger'); store.navigate('unlock'); return; }
    const st = store.get();
    const account = st.accounts[st.activeAccountIndex];
    if (!account) { toast('No active account', 'danger'); return; }
    busy = true;
    try {
      const { account: updated, address } = await importSolanaKeyToVault(draft, passphrase, account);
      const accounts = [...st.accounts]; accounts[st.activeAccountIndex] = updated; store.set({ accounts });
      ta.value = ''; draft = '';
      toast(`Solana ${address.slice(0, 8)}… imported to vault`, 'success');
      store.selectChain(st.activeAccountIndex, 'solana');
    } catch (e) { toast(e instanceof Error ? e.message : String(e), 'danger'); busy = false; }
  }

  return el('div', { cls: 'parsec-view parsec-create parsec-arc52 parsec-permaweb', children: [
    el('div', { cls: 'parsec-view__header', children: [btn('Back', { minimal: true, icon: 'arrow-left', onClick: () => store.navigate('dashboard') })] }),
    el('h2', { cls: 'parsec-view__title', text: 'Import Solana key' }),
    el('p', { cls: 'parsec-view__desc', text: 'Bring an existing Solana key under parsec custody. Nothing leaves this device: the secret is encrypted into the vault under its own address and only released to a signer that zeroizes it.' }),
    el('div', { cls: 'parsec-callout bp5-callout bp5-intent-warning', text: 'Paste only on a machine you trust. A mnemonic gives the Phantom/Solflare-standard first account; a base58 or JSON keypair is used exactly as exported.' }),
    ta,
    el('div', { cls: 'parsec-arc52__primary-label', text: 'Address:' }),
    addressEl,
    kindEl,
    btn('Import to vault', { intent: 'primary', large: true, icon: 'import', onClick: () => void save() }),
  ] });
}
