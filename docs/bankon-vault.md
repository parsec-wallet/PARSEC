# bankon_vault — how PARSEC keeps your keys

The vault is where PARSEC keeps the secret half of every wallet: Algorand's 25-word phrase, Solana and
Arweave seeds, EVM and Bitcoin keys. This guide covers the vault as it is built today (the
first-generation format in `src-tauri/src/bankon_vault/`): what it is, how to use it, what to do when
something goes wrong, and how code talks to it. The second-generation format is specified separately in
[security/bankon-vault-spec.md](security/bankon-vault-spec.md) and is not compiled in yet (see the end of
this guide).

## In one paragraph

A vault is a folder on your device. It holds one encrypted file per wallet key and a list of the public
addresses in it. One passphrase opens it. PARSEC derives a key from that passphrase with Argon2id, uses
it to encrypt each wallet key with AES-256-GCM, and keeps it in Rust memory only while the vault is
unlocked. A device can hold several vaults, one per **profile**; one profile is open at a time.

## The PARSEC Keycore

**PARSEC Keycore** is the public name for the Rust core that keeps and uses your keys. It has two halves:

- **bankon_vault** keeps keys: the encrypted vault on disk described in this guide.
- **The signers** use them: one module per chain (`chain_algo`, `chain_sol`, `chain_ar`, `chain_evm`,
  `chain_btc`, `chain_ltc`). A signer reads the key from the vault inside Rust memory, signs, wipes
  it, and returns only the signature.

The interface, a dApp, or an agent can ask the Keycore for a signature. None of them ever receives a key.

## Words used here

| Word | Meaning |
|---|---|
| **Recovery phrase** | The 25 words (Algorand) or 24 words (Solana, Arweave) that *are* a wallet. Anyone holding them holds the wallet. Written on paper, never typed into anything but a wallet you trust. |
| **Vault passphrase** | What you choose to lock the vault on this device. It *protects* keys; it does not *create* them. It cannot recreate a wallet, and nothing can recover it. |
| **Vault** | The encrypted folder that holds wallet keys for one profile. |
| **Profile** | A named vault plus the list of wallets kept in it. `default` is the vault this device had first. |
| **Unlocked** | The vault's key is in Rust memory, so PARSEC can sign without asking again. Locking erases it. |

The difference between the first two rows is the most important thing in this guide. **Your recovery
phrases are the backup. The vault passphrase is a lock on this one copy.**

## Using it

### First wallet: the vault is made on the way

Red Pill → **Create New Wallet** → choose a chain. The flow has three steps: **Address** (your new
public key), **Back up** (copy the private key and write down the recovery phrase), then **Verify &
save**. On that last screen PARSEC looks at the open profile's vault and asks for one of three things:

| The profile's vault | What you are asked | What happens |
|---|---|---|
| does not exist yet | **Set the vault passphrase** (twice, 8+ characters) | The vault is created, the key is saved into it |
| exists and is locked | **Unlock the vault** (its passphrase), or **Create a new vault instead** just below it | Unlocked and the key added, or a new profile and vault made on the spot and the key saved there; the locked vault is kept |
| exists and is unlocked | nothing | The key is added under the passphrase already in use |

Restoring a wallet (**Restore Existing Wallet** / **Import**) ends with the same step. A watch-only
address stores no key, so it never asks.

### Every day: unlock, use, lock

1. **Red Pill.** The line under the title shows which profile the door opens: `Profile default`.
2. Optionally type a name or address (`yourname.algo`) to choose which wallet opens first. The address
   also chooses the **vault**: PARSEC finds the profile whose vault holds that key and opens it, so the
   passphrase you enter is checked against the right vault. If the key is in several vaults (a wallet
   restored into a new vault after a lost passphrase is in both), PARSEC lists them and you choose.
3. Enter the passphrase → **Unlock Wallet**. Wallets recorded in the vault but missing from the list on
   screen are recovered automatically ("Recovered 1 account from the keystore").
4. Work. Signing happens in Rust; the key is read from the vault for the signature and wiped after.
5. **Lock**: Settings → **Lock Wallet**, the tray's **Lock wallet**, leaving the Red Pill (**Log Out
   Completely**), or the idle timer (5 minutes by default, Settings). Locking erases the vault key from
   memory, ends dApp and Arweave connections, and clears session caches.

### Several vaults: profiles

Use a profile when you want wallets kept apart, each with its own passphrase. For example: a personal
vault, a vault for agents that pay small amounts unattended, and a vault that only receives.

- **See them:** Red Pill → `change · new vault`, or Settings → **Profiles**. Each row shows the
  profile's name, whether it has a vault, and every wallet in it with its full public address. You do
  not need a passphrase to read this: addresses are public, and the vault keeps its address list
  unencrypted for exactly this purpose.
- **Switch:** click a profile. The open vault is locked first. Each profile keeps its own wallet list.
- **Create:** **New vault (new profile)** → name it (letters, digits, `-`, `_`) → **Create vault**. The new
  profile is empty and open. Create or restore a wallet in it; that is when you set its passphrase.
- **Nothing is deleted** by switching or creating. Profiles you are not using stay on disk as they were.

### From BANKON

PARSEC shows this wherever a vault passphrase is set or a new vault is made:

> **BANKON guarantees this: if you lose your vault passphrase, no one will help you recover your
> sovereign identity. Not BANKON, not PARSEC, not anyone. There is no reset, no support desk and no
> back door. Failure to maintain your wallet private key, recovery phrase and vault passphrase
> results in loss of funds.**

It is a guarantee, not a disclaimer: nobody holds a copy, so nobody can be made to hand one over.

### I forgot my vault passphrase

The passphrase cannot be recovered or reset. It is what decrypts the vault, and PARSEC keeps no copy. A
reset that worked without the passphrase would also work for a thief.

What you can do instead, without losing anything. You never have to go back to the start: every
place that asks for the passphrase offers a new vault right under the field.

- **While saving a wallet** (the last step of create or restore): under **Unlock the vault**, choose
  **Forgot it? Create a new vault instead**. Name it, set its passphrase, and the wallet you are saving
  goes into the new vault.
- **At the door** (Red Pill or the unlock screen): **Forgot the passphrase? Create a new vault**. Name
  it → **Create vault**, then create wallets or **Restore Existing Wallet** from each recovery phrase.
  Your funds are on chain, not in the vault, so the same phrase brings back the same wallet with the
  same balance.

Either way the old vault stays on the device under its own profile name, untouched. If you remember
the passphrase later, choose that profile and unlock it.

A wallet whose recovery phrase is lost, in a vault whose passphrase is lost, cannot be recovered by
anyone. That is why the **Back up** step comes before **Verify & save**, and why it checks three words
of the phrase.

### Moving to another device, and backups

The vault folder is encrypted and can be copied as a whole, but a copy is only as safe as where you put
it, and only useful together with the passphrase. The dependable path is the same as above: recovery
phrases on paper, restored into a new vault on the new device.

For cold storage on Linux, the **Tomb** keeps a vault inside a LUKS volume whose key lives on a USB
drive: open the tomb, use the vault, close it, take the USB with you. Settings → Security & Vault →
**Mausoleum**.

## Where it is on disk

Under PARSEC's app data directory (Linux: `~/.local/share/net.cypherpunk2048.parsec-wallet/`; macOS:
`~/Library/Application Support/net.cypherpunk2048.parsec-wallet/`; Windows: `%APPDATA%\net.cypherpunk2048.parsec-wallet\`):

```
bankon_vault/            the `default` profile — the location vaults have always used
├── .verify              salt(32) ‖ nonce(12) ‖ AES-256-GCM("bankon_vault_ok") — checks the passphrase
├── vault.json           manifest: address, chain, label, created_at per wallet (no secrets)
└── keys/<address>.enc   nonce(12) ‖ AES-256-GCM(secret) — one file per wallet key
vaults/<name>/           every other profile, same layout
vault-profile            the open profile's name (absent = default)
```

The browser build has no Rust and no files: it keeps keys in `localStorage`, each encrypted with
PBKDF2-SHA256 (600,000 iterations) and AES-GCM via Web Crypto (`src/lib/crypto.ts`), under
`parsec-encrypted-keys` (default profile) or `parsec-encrypted-keys@<name>`.

## Cryptography

| Step | What is used |
|---|---|
| Passphrase → vault key | Argon2id, the `argon2` crate defaults (v1.3, 19 MiB memory, 2 passes, 1 lane), 32-byte random salt from `.verify`, 32-byte output |
| Passphrase check | Decrypt `.verify`; a wrong passphrase fails the GCM tag |
| Each wallet key | AES-256-GCM under the vault key, fresh 12-byte random nonce per write |
| While unlocked | The vault key lives in `VaultSession` (Rust); zeroed on lock and on drop |

Stated plainly, the limits of this format, all addressed by the second generation:

- One key encrypts every wallet in the vault; there is no per-entry key derivation.
- Changing the passphrase means re-encrypting everything (no wrapped data key). There is no
  change-passphrase command yet.
- The manifest is plaintext by design (addresses are public), so the list of addresses in a vault is
  visible to anyone with file access.
- Auto-lock is enforced by the frontend timer, not by Rust.
- While unlocked, the frontend store also holds the passphrase in a private field so it can re-unlock
  after a timeout. JavaScript cannot guarantee zeroing it (see [security/memory-hygiene.md](security/memory-hygiene.md)).

## For developers

### Rule

Views never call `invoke`. Code that needs the vault uses `src/lib/keystore.ts` (picks Rust or Web
Crypto), `src/lib/vault.ts` (typed Rust wrappers), `src/lib/profiles.ts` (profiles) and
`src/lib/ui/vault-pass.ts` (the passphrase step). A signing command returns a signature, never a key.

### Saving a key: use `vaultPass`

```ts
import { vaultPass } from '../lib/ui/vault-pass';
import { keystoreStore } from '../lib/keystore';

const vault = vaultPass();            // renders "set" / "unlock" / "already unlocked" for the open profile
view.append(vault.element);

async function save() {
  const pass = await vault.ready();   // creates or unlocks as needed; throws a message fit to show
  await keystoreStore(address, secret, pass, label, chain);
  store.setPassphrase(pass);
}
```

Do not call `keystoreCreate` yourself because the account list is empty. An existing vault with a lost
account list is exactly the case where that fails ("vault already exists").

### Profiles from code

```ts
import { listProfiles } from '../lib/profiles';
import { store } from '../lib/store';

const { active, profiles } = await listProfiles();  // [{ name, exists, accounts[], mirror[] }]
await store.useProfile('agents');                   // locks, points the vault at `agents`, reloads the wallet list
```

`store.profile` is the open profile's name. `profileChooser()` (`src/lib/ui/profile-chooser.ts`) is the
list UI used by the Red Pill and Settings.

### IPC commands

| Command | Allowed with the Blue Pill | What it does |
|---|---|---|
| `vault_status` | yes | `{ exists, unlocked, accounts, profile }` for the open profile |
| `vault_profiles` | yes | `{ active, profiles: [{ name, exists, accounts }] }` — addresses only |
| `vault_profile_select(name)` | yes (locks first; holds no secret) | Make `name` the open profile; records it in `vault-profile` |
| `vault_create(passphrase)` | no | Create the open profile's vault; refuses if one exists |
| `vault_unlock(passphrase)` | no | Check the passphrase, derive the vault key, start a session |
| `vault_lock` | yes (teardown) | Erase the vault key from memory |
| `vault_store_key(address, chain, label, secret)` | no | Encrypt and save a key; add it to the manifest |
| `vault_export_secret({address, passphrase, confirm})` | no | Backup export, the only command that returns a secret: needs an unlocked vault, the passphrase again (attempt-limited) and `confirm` equal to the address. Replaced `vault_retrieve_key` in 0.1.9 |
| `keycore_approve({address, chain, title, claims, payloads_b64})` | no | One native Keycore dialog for a batch; returns a single-use token covering exactly those payloads (SHA-256), for that account, for 2 minutes (0.2.0) |
| `keycore_allowance_grant({address, genesis_id, asset_id, per_payment, total, minutes})` / `_revoke` / `_status` | grant: no; revoke/status: yes | Session allowance for Algorand asset payments (the x402 auto-approve cap), granted in a native dialog, enforced on the decoded amount, ended by lock (0.2.0) |
| `vault_remove_account(address)` | no | Delete one key file and its manifest entry |
| `vault_list_accounts` | no | Manifest entries with `created_at` |
| `vault_destroy(passphrase)` | no | Delete the open profile's vault, after checking its passphrase |
| `tomb_*` (7) | status and teardown only | LUKS cold storage — `docs/security/` and the Mausoleum view |

The Blue Pill column is `VIEWING_COMMANDS` in `src/lib/mode.ts`, enforced by `platform.ts`.

### Contract

`bankon_vault` is shared with other BANKON projects ([security/vault-family.md](security/vault-family.md)),
so its IPC surface only grows. Profiles were added that way: the `default` profile keeps the original
directory, so existing vaults and every existing command behave as before.

## Second generation

`bankon-vault/2` (Argon2id → wrapped data key → per-entry HKDF, an encrypted index, Rust-enforced
auto-lock, passphrase change without re-encryption) is specified in
[security/bankon-vault-spec.md](security/bankon-vault-spec.md) and its 18 commands are in
`commands_v2.rs`, **not compiled in**. `src/lib/vault.ts` gates its wrappers on `VAULT_V2_IN_BUILD`
(false). When it lands, each profile directory migrates in place.
