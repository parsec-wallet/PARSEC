# Security Policy

PARSEC is a sovereign wallet: it holds key material that maps directly to
participant funds. Reports about the vault, the signing paths, or the dApp bridge
are taken seriously and triaged ahead of feature work.

## Reporting a vulnerability

Report privately. Do not open a public issue, and do not include a working
exploit in the first message — a description of the class of problem, the
affected component, and the impact is enough to start.

- **Where:** open a private security advisory on the repository, or contact the
  maintainers through the address published at <https://github.com/parsec-wallet>.
- **Include:** affected version or commit, component, what an attacker gains, and
  the minimal steps to reproduce.
- **Expect:** acknowledgement, then an assessment against the severity classes
  below. We will tell you when a fix lands and credit you unless you ask us not to.

If a report involves live participant funds, say so in the first line.

## Severity classes

Modelled on [Bitcoin Core's disclosure policy](https://bitcoincore.org/en/security-advisories/),
with one deliberate departure noted below.

| Class | Meaning |
|---|---|
| **Critical** | Key material is disclosed, or an attacker can move funds without the participant's passphrase or confirmation. Includes any path that writes a secret to disk, the network, or a log in plaintext. |
| **High** | The vault's confidentiality or integrity is broken given realistic attacker access — for example a stolen disk plus a feasible offline attack, or an entry that decrypts under the wrong identity. |
| **Medium** | A weakening that does not by itself disclose a key: a downgraded KDF cost, a missing authentication binding, a lock that does not lock. |
| **Low** | Hardening gaps and defence-in-depth failures with no direct path to key disclosure. |

**Departure from Bitcoin Core:** they classify wallet bugs requiring local machine
access as Low, because their threat model does not treat a compromised host as in
scope. Ours does the opposite. PARSEC's stated design centre is that *the
passphrase is the only thing protecting a stolen machine*, so anything that
weakens at-rest protection, or that leaks a secret into swap, a core dump, or the
renderer's JavaScript heap, is **Critical or High here** even though it needs
local access.

## What is in scope

- `src-tauri/src/bankon_vault/` — the vault: format, KDFs, custody, memory handling.
- `src-tauri/src/chain_*/` — key derivation and signing.
- `src-tauri/src/parsec_connect/` — the dApp bridge.
- `src/lib/` — anything that can cause a secret to reach JavaScript, storage, or the DOM.
- The published web build, including its `localStorage` fallback.

## What is out of scope

- The absence of protection against an attacker who already has code execution as
  the participant's user account *while the vault is unlocked*. We reduce that
  blast radius (see below) but do not claim to defeat it.
- Tomb, `cryptsetup`, WebKitGTK, Tauri, and other upstream components. Report
  those upstream; tell us too if PARSEC's use of them makes it worse.
- Missing hardware-wallet support. It is a known gap, not a vulnerability.

## What PARSEC does and does not defend against

Stated plainly, because a security policy that only lists strengths is not one.
The full analysis is in [`docs/security/threat-model.md`](docs/security/threat-model.md).

**Defended:**

- **Stolen disk or laptop, vault locked.** Secrets are sealed with AES-256-GCM
  under keys derived by Argon2id at 256 MiB / t=3 / p=4. There is no verification
  token or sentinel to give an offline attacker a cheap confirmation oracle.
- **Another local process reading swap or a core dump.** Key material is held in
  `mlock`ed pages marked `MADV_DONTDUMP`, and the process disables core dumps at
  startup.
- **Tampering with the vault directory.** Every ciphertext authenticates its
  version, vault identity, entry and scheme, so entries cannot be swapped between
  slots or between vaults, and the account index cannot be rewritten.
- **Online guessing.** Unlock attempts back off persistently across restarts.

**Not defended:**

- **Malware running as you while the vault is unlocked.** It can ask the running
  wallet to sign. Lock the vault when you step away; the idle timer is a mitigation,
  not a boundary.
- **A keylogger capturing the passphrase as you type it.** Bitcoin Core names the
  same limit in its own documentation, and it is equally true here.
- **A forgotten passphrase.** There is no recovery, no escrow, and no hint. Bind a
  second custodian if that risk is unacceptable to you.
- **The web build to the standard of the desktop build.** The browser tier keeps
  an encrypted blob in `localStorage`, reachable by any script that achieves XSS.
  It is labelled as the weakest tier for that reason.

## Supported versions

PARSEC is pre-1.0 and moves fast. Fixes land on the default branch; there is no
backport channel yet. The Bitcoin path is gated behind an audit and is not
supported for mainnet custody — see
[`docs/integration/bankon-btc-waas.md`](docs/integration/bankon-btc-waas.md).

## Cryptographic claims

Every claim in these documents should resolve to something a stranger can re-run —
cp4096 commitment III is explicit that *"paid audits and screenshots do not
qualify"*. The vault format is specified byte-for-byte in
[`docs/security/bankon-vault-spec.md`](docs/security/bankon-vault-spec.md), and its
properties are asserted by the test suite (`cargo test --lib bankon_vault`),
including known-answer tests for the primitives.

**PARSEC has not been independently audited.** Do not read anything here as a
substitute for one.
