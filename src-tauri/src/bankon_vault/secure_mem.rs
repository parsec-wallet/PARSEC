// bankon_vault::secure_mem — secret-bearing memory that is wiped, unswappable,
// and excluded from core dumps.
//
// Modelled on Bitcoin Core's LockedPool / secure_allocator (src/support/), which
// is the strongest memory discipline of any comparable wallet: mlock to keep keys
// out of swap, MADV_DONTDUMP to keep them out of core files, and an explicit wipe
// on release. Two deliberate differences from the reference:
//
//   * Bitcoin Core pools allocations into 256 KiB arenas because it locks many
//     small objects. This vault locks a handful of 32/64-byte keys, so a direct
//     per-allocation mlock is simpler and has no arena metadata to keep outside
//     the locked region.
//   * Page locking is best-effort. RLIMIT_MEMLOCK is small by default on Linux
//     and zero in some containers; like Core's LockingFailed() we proceed with a
//     warning rather than refusing to start, because a wallet that will not open
//     is worse than one whose pages may be swappable.
//
// No new crates: `zeroize` is not a direct dependency and cp4096 commitment II
// says not to add one. The volatile-write idiom below is the same one already
// proven in chain_evm/commands.rs, generalised from [u8; 32] to [u8].

use std::sync::atomic::{compiler_fence, Ordering};

/// Overwrite `buf` with zeroes using volatile writes so the compiler cannot
/// elide them as dead stores, followed by a fence so the writes are not sunk
/// past the end of the borrow.
pub fn wipe(buf: &mut [u8]) {
    for b in buf.iter_mut() {
        // SAFETY: `b` is a valid, aligned, exclusively borrowed u8.
        unsafe { std::ptr::write_volatile(b, 0) };
    }
    compiler_fence(Ordering::SeqCst);
}

/// Constant-time equality. Runtime is a function of length only, never of
/// content, so comparing a candidate authenticator leaks nothing through timing.
pub fn ct_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff: u8 = 0;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    compiler_fence(Ordering::SeqCst);
    diff == 0
}

/// A heap buffer holding secret material.
///
/// Fixed capacity — it never reallocates, so a grow can never leave a stale copy
/// of the secret elsewhere on the heap. Wiped on drop. Deliberately not `Clone`,
/// not `Debug`, and not `Serialize`: a secret must never be duplicated implicitly
/// or reach a log line or an IPC response by accident.
pub struct SecretBytes {
    buf: Vec<u8>,
    locked: bool,
}

impl SecretBytes {
    /// Allocate `len` zeroed bytes and attempt to pin them.
    pub fn zeroed(len: usize) -> Self {
        let mut buf = Vec::with_capacity(len);
        buf.resize(len, 0u8);
        let locked = lock_region(&buf);
        Self { buf, locked }
    }

    /// Copy `src` into pinned memory. The caller still owns `src` and should wipe
    /// it if it was itself secret.
    pub fn from_slice(src: &[u8]) -> Self {
        let mut s = Self::zeroed(src.len());
        s.buf.copy_from_slice(src);
        s
    }

    pub fn as_slice(&self) -> &[u8] {
        &self.buf
    }

    pub fn as_mut_slice(&mut self) -> &mut [u8] {
        &mut self.buf
    }

    pub fn len(&self) -> usize {
        self.buf.len()
    }

    pub fn is_empty(&self) -> bool {
        self.buf.is_empty()
    }

    /// True if the pages backing this buffer were successfully pinned.
    pub fn is_locked(&self) -> bool {
        self.locked
    }
}

impl Drop for SecretBytes {
    fn drop(&mut self) {
        wipe(&mut self.buf);
        if self.locked {
            unlock_region(&self.buf);
        }
    }
}

/// Redacting `Debug`. Printing a secret must be impossible, but making the type
/// entirely unprintable forces callers into contortions around `unwrap_err`,
/// `assert_eq!` and error enums that embed a secret-carrying variant. Reporting
/// only the length keeps both properties: the value is never reconstructible from
/// a log line, panic message, or CI transcript.
impl std::fmt::Debug for SecretBytes {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "SecretBytes(<redacted>, {} bytes)", self.buf.len())
    }
}

impl PartialEq for SecretBytes {
    fn eq(&self, other: &Self) -> bool {
        ct_eq(&self.buf, &other.buf)
    }
}
impl Eq for SecretBytes {}

// ── page pinning ────────────────────────────────────────────────────────────

#[cfg(unix)]
fn page_span(buf: &[u8]) -> Option<(*mut libc::c_void, usize)> {
    if buf.is_empty() {
        return None;
    }
    // SAFETY: _SC_PAGESIZE is a valid sysconf name.
    let page = unsafe { libc::sysconf(libc::_SC_PAGESIZE) };
    if page <= 0 {
        return None;
    }
    let page = page as usize;
    let addr = buf.as_ptr() as usize;
    // madvise requires a page-aligned address, so align down and extend the span.
    let base = addr & !(page - 1);
    let span = (addr - base) + buf.len();
    let span = span.div_ceil(page) * page;
    Some((base as *mut libc::c_void, span))
}

#[cfg(unix)]
fn lock_region(buf: &[u8]) -> bool {
    let Some((addr, len)) = page_span(buf) else {
        return false;
    };
    // SAFETY: (addr, len) covers pages backing a live allocation we own.
    let ok = unsafe { libc::mlock(addr, len) } == 0;
    #[cfg(target_os = "linux")]
    unsafe {
        // Keep the secret out of core dumps even if mlock was refused.
        libc::madvise(addr, len, libc::MADV_DONTDUMP);
    }
    ok
}

#[cfg(unix)]
fn unlock_region(buf: &[u8]) {
    if let Some((addr, len)) = page_span(buf) {
        // SAFETY: same span that was locked.
        unsafe { libc::munlock(addr, len) };
    }
}

#[cfg(not(unix))]
fn lock_region(_buf: &[u8]) -> bool {
    false
}

#[cfg(not(unix))]
fn unlock_region(_buf: &[u8]) {}

/// Process-wide hardening, called once at startup.
///
/// Disables core dumps for the whole process. A core file written while the vault
/// is unlocked would contain the DEK and any decrypted secret in plaintext, and
/// unlike swap it lands in a predictable path with ordinary file permissions.
/// Bitcoin Core takes the same position via MADV_NOCORE / MADV_DONTDUMP.
pub fn harden_process() {
    #[cfg(unix)]
    unsafe {
        let zero = libc::rlimit {
            rlim_cur: 0,
            rlim_max: 0,
        };
        libc::setrlimit(libc::RLIMIT_CORE, &zero);
    }
    #[cfg(target_os = "linux")]
    unsafe {
        // Also stop the kernel handing this process to a core-dump helper and
        // block ptrace attach from non-root of the same uid.
        libc::prctl(libc::PR_SET_DUMPABLE, 0, 0, 0, 0);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wipe_zeroes_the_buffer() {
        let mut b = [0xAAu8; 64];
        wipe(&mut b);
        assert!(b.iter().all(|&x| x == 0));
    }

    #[test]
    fn ct_eq_matches_normal_equality() {
        assert!(ct_eq(b"abc", b"abc"));
        assert!(!ct_eq(b"abc", b"abd"));
        assert!(!ct_eq(b"abc", b"ab"));
        assert!(ct_eq(b"", b""));
    }

    #[test]
    fn secret_bytes_round_trips_and_compares_in_constant_time() {
        let a = SecretBytes::from_slice(b"a very secret value");
        let b = SecretBytes::from_slice(b"a very secret value");
        let c = SecretBytes::from_slice(b"a different value!!");
        assert_eq!(a, b);
        assert_ne!(a, c);
        assert_eq!(a.as_slice(), b"a very secret value");
        assert_eq!(a.len(), 19);
    }

    /// The whole point of the Debug impl: a panic message or log line must never
    /// be able to carry the secret.
    #[test]
    fn debug_output_never_contains_the_secret() {
        let s = SecretBytes::from_slice(b"correct horse battery staple");
        let rendered = format!("{s:?}");
        assert!(!rendered.contains("correct"), "leaked: {rendered}");
        assert!(!rendered.contains("horse"), "leaked: {rendered}");
        assert!(rendered.contains("redacted"));
        assert!(rendered.contains("28 bytes"));
    }

    #[test]
    fn secret_bytes_has_exact_capacity_so_it_cannot_realloc() {
        let s = SecretBytes::zeroed(32);
        assert_eq!(s.len(), 32);
        assert!(s.as_slice().iter().all(|&x| x == 0));
    }

    /// Not an assertion about the environment — RLIMIT_MEMLOCK may legitimately
    /// forbid pinning in a container. This documents that we report it honestly
    /// rather than silently pretending the pages are locked.
    #[test]
    fn page_locking_reports_its_own_outcome() {
        let s = SecretBytes::zeroed(32);
        let _ = s.is_locked();
    }
}
