# Memory hygiene

The contract for anything in PARSEC that touches key material.
Implementation: `src-tauri/src/bankon_vault/secure_mem.rs`.

## Why this exists as its own module

Before it, the codebase had three different wipes: a plain
`iter_mut().for_each(|b| *b = 0)` in the vault session and the BTC and LTC chain
packs, and one correct `write_volatile` version in `chain_evm`. The plain loops
are dead stores — nothing reads the buffer afterwards, so LLVM is entitled to
delete them, and the "zeroization" they promise may not happen at all.

The correct one is now the only one, shared by every module (the last plain loops,
in the vault session and the BTC/LTC packs, were replaced in 0.1.4).

## No new dependencies

`zeroize` and `secrecy` are the obvious reach. Neither is a direct dependency, and
cp4096 commitment II says not to widen the dependency surface. The volatile-write
idiom is short enough to audit in one screen and was already proven in the tree,
so it was promoted rather than replaced. `mlock`, `madvise` and `prctl` come from
`libc`, which was already a direct dependency for `parsec_sandbox`.

## The primitives

### `wipe(&mut [u8])`

Volatile writes plus a `SeqCst` compiler fence. The volatility stops the compiler
eliding the stores; the fence stops them being sunk past the end of the borrow.

### `ct_eq(&[u8], &[u8]) -> bool`

Constant-time comparison. Runtime is a function of length only, never of content,
so comparing a candidate authenticator leaks nothing through timing.

### `SecretBytes`

The type every secret should live in.

- **Fixed capacity.** Allocated once at the required length and never grown, so a
  reallocation cannot leave a stale copy of the secret elsewhere on the heap.
- **Pinned.** `mlock` on the backing pages, plus `MADV_DONTDUMP` on Linux.
- **Wiped on drop**, then unlocked.
- **Not `Clone`.** A secret must never be duplicated implicitly.
- **Redacting `Debug`.** Renders `SecretBytes(<redacted>, N bytes)`.
- **Constant-time `PartialEq`.**

On the redacting `Debug`: the first implementation had no `Debug` at all, which is
stricter but forces callers into contortions around `unwrap_err`, `assert_eq!` and
error enums that carry a secret-bearing variant. Reporting only the length keeps
both properties — the value is never reconstructible from a log line, a panic
message, or a CI transcript. A test asserts it.

### `harden_process()`

Called first in `run()` (`lib.rs`), before any state that could hold key material
exists (since 0.1.4 — an audit found it had been written but never called).

- `RLIMIT_CORE = 0` — no core dumps.
- `PR_SET_DUMPABLE = 0` on Linux — the kernel will not hand this process to a
  core-dump helper, and same-uid non-root `ptrace` attach is refused.

A core file written while the vault is unlocked would contain the DEK and every
decrypted secret in plaintext, at a predictable path with ordinary permissions.
Unlike swap, it is trivially readable after the fact.

## Page locking is best-effort

`RLIMIT_MEMLOCK` is small by default on Linux and zero in some containers. Like
Bitcoin Core's `LockingFailed()`, a failed `mlock` produces a warning rather than
a refusal to start: a wallet that will not open is worse than one whose pages may
be swappable. `SecretBytes::is_locked()` reports what actually happened, so
nothing downstream assumes success.

`MADV_DONTDUMP` is applied whether or not `mlock` succeeded — the two protect
against different things.

## What is modelled on Bitcoin Core, and what is not

Bitcoin Core's `LockedPool` (`src/support/lockedpool.cpp`) is the strongest memory
discipline of any comparable wallet, and the model here.

**Taken:** `mlock` plus `MADV_DONTDUMP`; wipe before release; an explicit wipe on
lock rather than relying on drop order; honest soft-fail.

**Not taken:** the 256 KiB arena allocator. Core pools because it locks many small
objects; this vault locks a handful of 32- and 64-byte keys, so a direct
per-allocation `mlock` is simpler and has no arena metadata that would itself need
keeping outside the locked region.

## Rules

1. **A secret never becomes a JavaScript string.** Once it does it is immutable
   and garbage-collected and cannot be wiped. Signing stays in Rust.
   *Open:* the shipping vault still has `vault_retrieve_key`, which returns a
   secret to the frontend, and several frontend paths still sign with it. Removing
   them is the next remediation step; until then this rule is not met.
2. **Retrieve a secret only for the moment of signing**, and let `SecretBytes`
   drop end the exposure. Do not hold one across an `await`.
3. **Never `Debug`, log, or format a secret.** Use the redacting types.
4. **Never fan a secret into the environment.** mindX's `credential_provider`
   exports decrypted secrets into `os.environ`, where `/proc/<pid>/environ` and
   every child process can read them. That is a service pattern; in a wallet it
   would be critical.
5. **No process-lifetime plaintext cache.** If a cache is unavoidable, make it
   TTL-bounded and zeroizing. (The unlocked session key is such a cache: it lives in
   `SecretBytes` — locked, excluded from dumps, wiped on lock — since 0.1.4.)
6. **Prefer `ct_eq` for anything attacker-influenced.**

## What this does not achieve

Rust cannot guarantee a secret was never copied. The OS may have paged a value
before `mlock` was applied, a `memcpy` may leave a transient copy in a register or
a cache line, and an allocator may reuse the page. `SecretBytes` narrows the
window and removes the *predictable* copies — the ones in swap files, core dumps,
grown vectors, and log lines. It does not make the process opaque to an attacker
who already has code execution as the user while the vault is unlocked. See
[`threat-model.md`](threat-model.md), A6.
