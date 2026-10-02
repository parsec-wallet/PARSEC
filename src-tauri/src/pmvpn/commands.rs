// pmVPN Tauri Commands — IPC interface for the frontend
// SPDX-FileCopyrightText: 2026 BANKON
// SPDX-License-Identifier: GPL-3.0-or-later
//
// These commands are the bridge between TypeScript and Rust.
// SSH connections run in async Tokio tasks.

use tauri::{AppHandle, Emitter, Manager};

use super::PmvpnState;
use super::client::SshSession;

use std::sync::Arc;
use tokio::sync::Mutex as TokioMutex;

/// Connect to a PMVPN server via SSH.
/// The auth_payload is a JSON string sent as the SSH password.
/// Returns a session ID.
#[tauri::command]
pub async fn pmvpn_connect(
    app: AppHandle,
    state: tauri::State<'_, PmvpnState>,
    host: String,
    port: u16,
    auth_payload: String,
) -> Result<String, String> {
    // Create session
    let mut session = SshSession::new(String::new(), host.clone(), port);

    // Create channels for terminal I/O
    let (tx, mut rx) = tokio::sync::mpsc::channel::<Vec<u8>>(256);
    session.tx = Some(tx);

    let connected = session.connected.clone();

    // Store session and get ID
    let session_id = {
        let mut guard = state.inner.lock().map_err(|_| "state poisoned")?;
        let id = guard.add(session);
        id
    };

    let sid = session_id.clone();
    let app_handle = app.clone();

    // Spawn async task for SSH connection
    // NOTE: This is a placeholder that uses the tauri-plugin-shell to
    // invoke an external SSH client. In production, this would use russh
    // directly. For now, we use the system ssh command as a bridge.
    let task = tokio::spawn(async move {
        // Use system SSH with the auth payload as password
        // This is a temporary bridge until russh is integrated.
        // The proper implementation will use russh directly.

        use tokio::process::Command;
        use tokio::io::{AsyncReadExt, AsyncWriteExt};

        let mut child = match Command::new("sshpass")
            .args([
                "-p", &auth_payload,
                "ssh",
                "-o", "StrictHostKeyChecking=no",
                "-o", "UserKnownHostsFile=/dev/null",
                "-o", "PreferredAuthentications=password",
                "-o", "PubkeyAuthentication=no",
                "-p", &port.to_string(),
                &format!("pmvpn@{}", host),
            ])
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
        {
            Ok(c) => c,
            Err(e) => {
                // sshpass not available — try direct approach
                // For the initial release, we'll emit an error
                // and guide users to the proper russh integration
                let _ = app_handle.emit("pmvpn-error", serde_json::json!({
                    "sessionId": sid,
                    "error": format!("SSH connection failed: {}", e),
                }));
                return;
            }
        };

        {
            let mut conn = connected.lock().await;
            *conn = true;
        }

        let mut stdout = child.stdout.take().unwrap();
        let mut stdin = child.stdin.take().unwrap();

        // Stdout → Tauri events (server output → terminal)
        let app2 = app_handle.clone();
        let sid2 = sid.clone();
        let read_task = tokio::spawn(async move {
            let mut buf = [0u8; 4096];
            loop {
                match stdout.read(&mut buf).await {
                    Ok(0) => break,
                    Ok(n) => {
                        let data = String::from_utf8_lossy(&buf[..n]).to_string();
                        let _ = app2.emit("pmvpn-terminal-data", serde_json::json!({
                            "sessionId": sid2,
                            "data": data,
                        }));
                    }
                    Err(_) => break,
                }
            }
        });

        // rx → stdin (terminal keystrokes → server)
        let write_task = tokio::spawn(async move {
            while let Some(data) = rx.recv().await {
                if stdin.write_all(&data).await.is_err() {
                    break;
                }
            }
        });

        // Wait for either to finish
        tokio::select! {
            _ = read_task => {},
            _ = write_task => {},
            _ = child.wait() => {},
        }

        {
            let mut conn = connected.lock().await;
            *conn = false;
        }
    });

    // Store the task handle
    {
        let mut guard = state.inner.lock().map_err(|_| "state poisoned")?;
        if let Some(s) = guard.get_mut(&session_id) {
            s.task = Some(task);
        }
    }

    Ok(session_id)
}

/// Disconnect from a PMVPN server.
#[tauri::command]
pub async fn pmvpn_disconnect(
    state: tauri::State<'_, PmvpnState>,
    session_id: String,
) -> Result<(), String> {
    let mut session = {
        let mut guard = state.inner.lock().map_err(|_| "state poisoned")?;
        guard.remove(&session_id)
    };

    if let Some(ref mut s) = session {
        s.disconnect().await;
    }

    Ok(())
}

/// Send data to the remote terminal.
#[tauri::command]
pub async fn pmvpn_send_data(
    state: tauri::State<'_, PmvpnState>,
    session_id: String,
    data: String,
) -> Result<(), String> {
    let tx = {
        let guard = state.inner.lock().map_err(|_| "state poisoned")?;
        let session = guard.get(&session_id).ok_or("session not found")?;
        session.tx.clone().ok_or("session not connected")?
    };

    tx.send(data.into_bytes())
        .await
        .map_err(|_| "send failed".to_string())
}

/// Resize the remote PTY.
#[tauri::command]
pub async fn pmvpn_resize(
    _state: tauri::State<'_, PmvpnState>,
    _session_id: String,
    _cols: u32,
    _rows: u32,
) -> Result<(), String> {
    // PTY resize will be implemented with russh proper.
    // System SSH doesn't support resize via stdin.
    Ok(())
}

/// Sign a challenge message using the EVM key from bankon_vault.
/// Retrieves key briefly for signing, then discards.
#[tauri::command]
pub async fn pmvpn_sign_challenge(
    app: AppHandle,
    vault_state: tauri::State<'_, crate::bankon_vault::VaultState>,
    address: String,
    message: String,
) -> Result<String, String> {
    crate::bankon_vault::binding::refuse_binding(message.as_bytes())?;
    // 1. Retrieve the private key from vault
    let guard = vault_state.inner.lock().map_err(|_| "vault state poisoned")?;
    let key = guard.key().ok_or("vault is locked")?;
    let dir = guard.dir().ok_or("vault is locked")?;

    let secret_bytes = crate::bankon_vault::store::VaultStore::retrieve_secret(dir, key, &address)?;
    let secret = String::from_utf8(secret_bytes)
        .map_err(|_| "stored secret is not valid utf-8")?;

    // 2. Sign the message using the private key
    // For EVM wallets, we use secp256k1 ECDSA signing.
    // The secret is expected to be a hex-encoded private key (0x-prefixed or raw).
    let key_bytes = hex_decode_key(&secret)?;

    // Use k256 (secp256k1) for signing
    use k256::ecdsa::SigningKey;

    if key_bytes.len() != 32 {
        return Err(format!("invalid key length: {} (expected 32)", key_bytes.len()));
    }
    let key_array: [u8; 32] = key_bytes.try_into().map_err(|_| "key conversion failed")?;

    let signing_key = SigningKey::from_bytes((&key_array).into())
        .map_err(|e| format!("invalid private key: {}", e))?;

    // EIP-191 personal_sign: "\x19Ethereum Signed Message:\n" + len + message
    let prefix = format!("\x19Ethereum Signed Message:\n{}", message.len());
    let mut prefixed = prefix.into_bytes();
    prefixed.extend_from_slice(message.as_bytes());

    // Hash with keccak256
    use sha3::{Keccak256, Digest};
    let hash = Keccak256::digest(&prefixed);

    // Sign
    let (signature, recovery_id) = signing_key
        .sign_prehash_recoverable(hash.as_slice())
        .map_err(|e| format!("signing failed: {}", e))?;

    // Encode as 0x-prefixed hex: r(32) + s(32) + v(1)
    let mut sig_bytes = Vec::with_capacity(65);
    sig_bytes.extend_from_slice(&signature.to_bytes());
    sig_bytes.push(recovery_id.to_byte() + 27); // EIP-155 v value

    let hex_sig = format!("0x{}", hex::encode(&sig_bytes));

    // 3. Zeroize the key material
    drop(signing_key);

    Ok(hex_sig)
}

fn hex_decode_key(secret: &str) -> Result<Vec<u8>, String> {
    let trimmed = secret.trim().strip_prefix("0x").unwrap_or(secret.trim());
    hex::decode(trimmed).map_err(|e| format!("invalid hex key: {}", e))
}
