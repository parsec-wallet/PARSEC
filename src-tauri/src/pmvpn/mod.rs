// pmVPN Module — Rust SSH client via russh
// GPL-3.0 (Parsec client module)
//
// Manages SSH connections to PMVPN servers.
// Authentication: wallet signature JSON sent as SSH password.
// Terminal I/O piped through Tauri events.

pub mod commands;
mod client;

use std::collections::HashMap;
use std::sync::Mutex;

/// Global session state — holds active SSH connections.
pub struct PmvpnState {
    pub inner: Mutex<PmvpnSessions>,
}

impl Default for PmvpnState {
    fn default() -> Self {
        Self {
            inner: Mutex::new(PmvpnSessions::default()),
        }
    }
}

#[derive(Default)]
pub struct PmvpnSessions {
    sessions: HashMap<String, client::SshSession>,
    next_id: u64,
}

impl PmvpnSessions {
    pub fn add(&mut self, session: client::SshSession) -> String {
        self.next_id += 1;
        let id = format!("pmvpn-{}", self.next_id);
        self.sessions.insert(id.clone(), session);
        id
    }

    pub fn get(&self, id: &str) -> Option<&client::SshSession> {
        self.sessions.get(id)
    }

    pub fn get_mut(&mut self, id: &str) -> Option<&mut client::SshSession> {
        self.sessions.get_mut(id)
    }

    pub fn remove(&mut self, id: &str) -> Option<client::SshSession> {
        self.sessions.remove(id)
    }

    pub fn clear(&mut self) {
        self.sessions.clear();
    }
}
