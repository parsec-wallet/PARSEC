// SPDX-FileCopyrightText: 2026 BANKON
// SPDX-License-Identifier: Apache-2.0
//
// IPC for the desktop shell: window controls for the custom title bar, the
// close-to-tray preference, and start at login. The frontend reaches these
// through lib/app-shell.ts → lib/platform.ts, like every other command.

use std::sync::atomic::Ordering;

use tauri::{AppHandle, Manager, Runtime, State, WebviewWindow};

use super::{autostart_enabled, set_autostart, ShellState};

#[tauri::command]
pub fn app_shell_minimize<R: Runtime>(window: WebviewWindow<R>) -> Result<(), String> {
    #[cfg(desktop)]
    return window.minimize().map_err(|e| e.to_string());
    #[cfg(mobile)]
    {
        let _ = window;
        Ok(())
    }
}

#[tauri::command]
pub fn app_shell_toggle_maximize<R: Runtime>(window: WebviewWindow<R>) -> Result<bool, String> {
    #[cfg(desktop)]
    {
        let maximized = window.is_maximized().map_err(|e| e.to_string())?;
        if maximized { window.unmaximize() } else { window.maximize() }.map_err(|e| e.to_string())?;
        Ok(!maximized)
    }
    #[cfg(mobile)]
    {
        let _ = window;
        Ok(true) // a mobile app is always full screen
    }
}

/// The title bar's close button: the same as the system close — it hides to
/// the tray when that preference is on (see `on_window_event`), else quits.
#[tauri::command]
pub fn app_shell_close<R: Runtime>(window: WebviewWindow<R>) -> Result<(), String> {
    #[cfg(desktop)]
    return window.close().map_err(|e| e.to_string());
    #[cfg(mobile)]
    {
        let _ = window;
        Ok(())
    }
}

#[tauri::command]
pub fn app_shell_quit<R: Runtime>(app: AppHandle<R>) {
    app.exit(0);
}

#[tauri::command]
pub fn app_shell_set_close_to_tray(state: State<'_, ShellState>, enabled: bool) {
    state.close_to_tray.store(enabled, Ordering::Relaxed);
}

#[tauri::command]
pub fn app_shell_autostart_get<R: Runtime>(app: AppHandle<R>) -> Result<bool, String> {
    autostart_enabled(&app.config().identifier)
}

#[tauri::command]
pub fn app_shell_autostart_set<R: Runtime>(app: AppHandle<R>, enabled: bool) -> Result<bool, String> {
    let id = app.config().identifier.clone();
    set_autostart(&id, enabled)?;
    autostart_enabled(&id)
}

/// Whether this launch was a start-at-login launch (the window began hidden).
#[tauri::command]
pub fn app_shell_started_hidden<R: Runtime>(app: AppHandle<R>) -> bool {
    let _ = app.state::<ShellState>();
    std::env::args().any(|a| a == super::HIDDEN_ARG)
}
