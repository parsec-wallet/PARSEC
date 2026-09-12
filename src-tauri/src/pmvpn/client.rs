// pmVPN SSH Client — russh connection manager
// SPDX-FileCopyrightText: 2026 BANKON
// SPDX-License-Identifier: GPL-3.0-only
//
// Each SshSession wraps a russh connection + channel.
// The session pipes terminal I/O through Tauri events.

use std::sync::Arc;
use tokio::sync::Mutex as TokioMutex;

/// Represents an active SSH session to a PMVPN server.
/// The actual russh connection is managed asynchronously.
pub struct SshSession {
    pub id: String,
    pub host: String,
    pub port: u16,
    /// Channel for sending data to the remote shell
    pub tx: Option<tokio::sync::mpsc::Sender<Vec<u8>>>,
    /// Handle to the background task
    pub task: Option<tokio::task::JoinHandle<()>>,
    /// Whether the session is still connected
    pub connected: Arc<TokioMutex<bool>>,
}

impl SshSession {
    pub fn new(id: String, host: String, port: u16) -> Self {
        Self {
            id,
            host,
            port,
            tx: None,
            task: None,
            connected: Arc::new(TokioMutex::new(false)),
        }
    }

    /// Send data to the remote shell.
    pub async fn send(&self, data: &[u8]) -> Result<(), String> {
        let tx = self.tx.as_ref().ok_or("session not connected")?;
        tx.send(data.to_vec())
            .await
            .map_err(|_| "send channel closed".to_string())
    }

    /// Disconnect and clean up.
    pub async fn disconnect(&mut self) {
        if let Some(task) = self.task.take() {
            task.abort();
        }
        self.tx = None;
        let mut connected = self.connected.lock().await;
        *connected = false;
    }
}

impl Drop for SshSession {
    fn drop(&mut self) {
        if let Some(task) = self.task.take() {
            task.abort();
        }
    }
}
