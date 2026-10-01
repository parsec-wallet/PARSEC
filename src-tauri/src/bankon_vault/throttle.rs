// bankon_vault::throttle — unlock rate limiting.
//
// None of MetaMask, Pera, Bitcoin Core, or the mindX production vault limits
// unlock attempts at all. That is defensible for them and not for us: PARSEC is a
// desktop wallet whose vault sits at a predictable path, so an attacker who gets
// a shell — or simply sits down at an unattended machine — can otherwise drive
// the unlock command in a loop for as long as they like.
//
// HONEST SCOPE, because this control is easy to overstate:
//
//   * It stops an ONLINE attacker: someone at the keyboard, or driving the IPC
//     surface, who must go through this code to test a guess.
//   * It does NOT stop an OFFLINE attacker. Anyone holding the vault file can
//     copy it elsewhere and attack it with their own tooling, and can delete this
//     counter outright. Against that attacker the only defence is the Argon2id
//     cost and the passphrase's own entropy — which is exactly why the cost is
//     set at 256 MiB rather than the OWASP floor.
//
// So this is a speed bump on the live machine, not a security boundary, and the
// state file is deliberately not tamper-proofed: pretending otherwise would be
// worse than saying plainly what it does.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::store::VaultStore;

const ATTEMPTS_FILE: &str = ".attempts.json";

/// Failures tolerated before any delay is imposed. Fat-fingering a long
/// passphrase twice should cost nothing.
const FREE_ATTEMPTS: u32 = 3;

/// Longest backoff, reached after ~13 consecutive failures.
const MAX_DELAY_SECS: u64 = 3600;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AttemptLog {
    pub failures: u32,
    pub last_failure_at: u64,
    /// Unix seconds until which unlocking is refused.
    pub locked_until: u64,
}

fn path(dir: &Path) -> PathBuf {
    dir.join(ATTEMPTS_FILE)
}

fn now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

pub fn load(dir: &Path) -> AttemptLog {
    // A missing or unreadable log means "no failures recorded". It is a speed
    // bump, not a boundary, so it must never be the reason a vault cannot open.
    std::fs::read(path(dir))
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default()
}

fn save(dir: &Path, log: &AttemptLog) {
    if let Ok(data) = serde_json::to_vec_pretty(log) {
        let _ = VaultStore::write_atomic(&path(dir), &data);
    }
}

/// Delay owed after `failures` consecutive failures.
///
/// Doubles from one second once the free attempts are spent, capped so a
/// participant who genuinely forgot their passphrase is not locked out for days.
pub fn delay_for(failures: u32) -> u64 {
    if failures <= FREE_ATTEMPTS {
        return 0;
    }
    let over = failures - FREE_ATTEMPTS;
    // 1, 2, 4, 8 … seconds, saturating at the cap.
    1u64.checked_shl(over.saturating_sub(1))
        .unwrap_or(MAX_DELAY_SECS)
        .min(MAX_DELAY_SECS)
}

/// Refuse the attempt if a backoff is still in force.
pub fn check(dir: &Path) -> Result<(), String> {
    let log = load(dir);
    let now = now();
    if log.locked_until > now {
        let remaining = log.locked_until - now;
        return Err(format!(
            "too many failed unlock attempts — try again in {}. \
             ({} consecutive failures recorded.)",
            humanise(remaining),
            log.failures
        ));
    }
    Ok(())
}

/// Record a failed attempt and arm the next backoff window.
pub fn record_failure(dir: &Path) -> AttemptLog {
    let mut log = load(dir);
    log.failures = log.failures.saturating_add(1);
    log.last_failure_at = now();
    log.locked_until = now() + delay_for(log.failures);
    save(dir, &log);
    log
}

/// Clear the counter after a successful unlock.
pub fn record_success(dir: &Path) {
    let p = path(dir);
    if p.exists() {
        let _ = std::fs::remove_file(&p);
    }
}

fn humanise(secs: u64) -> String {
    match secs {
        0 => "a moment".to_string(),
        1 => "1 second".to_string(),
        s if s < 60 => format!("{s} seconds"),
        s if s < 120 => "1 minute".to_string(),
        s if s < 3600 => format!("{} minutes", s / 60),
        s => format!("{} minutes", s / 60),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(tag: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let d = std::env::temp_dir()
            .join(format!("bkvthr_{}_{}_{}", tag, std::process::id(), nanos));
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn the_first_few_attempts_are_free() {
        for f in 0..=FREE_ATTEMPTS {
            assert_eq!(delay_for(f), 0, "failure {f} should not be penalised");
        }
        assert!(delay_for(FREE_ATTEMPTS + 1) > 0);
    }

    #[test]
    fn backoff_doubles_then_caps() {
        assert_eq!(delay_for(4), 1);
        assert_eq!(delay_for(5), 2);
        assert_eq!(delay_for(6), 4);
        assert_eq!(delay_for(7), 8);
        // Monotonic, and never past the cap however many failures accumulate.
        let mut prev = 0;
        for f in 4..64 {
            let d = delay_for(f);
            assert!(d >= prev, "backoff must not decrease at {f}");
            assert!(d <= MAX_DELAY_SECS, "cap exceeded at {f}");
            prev = d;
        }
        assert_eq!(delay_for(60), MAX_DELAY_SECS);
    }

    #[test]
    fn failures_accumulate_and_survive_a_restart() {
        let d = scratch("persist");
        // Twelve failures puts the backoff in the hundreds of seconds, so this
        // assertion cannot race the clock. Five would arm a 2-second window that
        // can expire under parallel test load before `check` runs — the test
        // would then pass or fail depending on scheduling, which is worse than
        // having no test at all.
        for _ in 0..12 {
            record_failure(&d);
        }
        // A fresh read models the process having been restarted.
        assert_eq!(load(&d).failures, 12);
        assert!(delay_for(12) > 60, "this test relies on a long backoff");
        assert!(check(&d).is_err(), "a backoff should be in force");
        std::fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn a_successful_unlock_clears_the_counter() {
        let d = scratch("clear");
        for _ in 0..5 {
            record_failure(&d);
        }
        record_success(&d);
        assert_eq!(load(&d).failures, 0);
        assert!(check(&d).is_ok());
        std::fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn within_the_free_allowance_nothing_is_refused() {
        let d = scratch("free");
        for _ in 0..FREE_ATTEMPTS {
            record_failure(&d);
            assert!(check(&d).is_ok(), "free attempts must not be blocked");
        }
        // Push well past the allowance so the resulting window is long enough to
        // assert on without racing the clock.
        for _ in 0..9 {
            record_failure(&d);
        }
        assert!(check(&d).is_err(), "past the allowance, attempts must be refused");
        std::fs::remove_dir_all(&d).ok();
    }

    /// A corrupt or absent log must never be the reason a vault will not open.
    #[test]
    fn an_unreadable_log_fails_open() {
        let d = scratch("corrupt");
        std::fs::write(path(&d), b"{ not json").unwrap();
        assert_eq!(load(&d).failures, 0);
        assert!(check(&d).is_ok());
        std::fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn the_error_names_the_wait_and_the_failure_count() {
        let d = scratch("msg");
        for _ in 0..14 {
            record_failure(&d);
        }
        let err = check(&d).unwrap_err();
        assert!(err.contains("too many failed unlock attempts"), "got: {err}");
        assert!(err.contains("try again in"), "got: {err}");
        assert!(err.contains("14"), "should report the count: {err}");
        std::fs::remove_dir_all(&d).ok();
    }
}
