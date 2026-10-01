// SPDX-FileCopyrightText: 2026 BANKON
// SPDX-License-Identifier: Apache-2.0
//
// app_shell — the desktop shell around the wallet: the tray, close-to-tray,
// start-at-login, and the window controls the custom title bar calls.
//
// No new dependency. The tray is Tauri's own (`tray-icon` feature). Start at
// login is the platform's own mechanism, written directly:
//
//   Linux    $XDG_CONFIG_HOME/autostart/parsec-wallet.desktop   (XDG autostart)
//   macOS    ~/Library/LaunchAgents/<identifier>.plist          (launchd, RunAtLoad)
//   Windows  HKCU\Software\Microsoft\Windows\CurrentVersion\Run  (via reg.exe)
//
// Each entry launches the current executable with `--hidden`, which starts the
// app in the tray instead of opening the window.

pub mod commands;

use std::sync::atomic::{AtomicBool, Ordering};

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{App, AppHandle, Emitter, Manager, Runtime, Window, WindowEvent};

/// The flag the frontend passes when started at login.
pub const HIDDEN_ARG: &str = "--hidden";
/// The event the frontend listens for to lock the wallet from the tray.
pub const TRAY_LOCK_EVENT: &str = "parsec://tray-lock";

/// Shell preferences that the Rust side must know without asking the page.
pub struct ShellState {
    /// Close hides to the tray instead of quitting. Default on; the page sends
    /// the participant's saved choice at startup.
    pub close_to_tray: AtomicBool,
}

impl Default for ShellState {
    fn default() -> Self {
        Self { close_to_tray: AtomicBool::new(true) }
    }
}

pub fn show_main<R: Runtime>(app: &AppHandle<R>) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

fn toggle_main<R: Runtime>(app: &AppHandle<R>) {
    if let Some(w) = app.get_webview_window("main") {
        if w.is_visible().unwrap_or(false) {
            let _ = w.hide();
        } else {
            show_main(app);
        }
    }
}

/// Build the tray and honour `--hidden`. Called from the builder's `setup`.
pub fn setup<R: Runtime>(app: &mut App<R>) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "Show PARSEC", true, None::<&str>)?;
    let lock = MenuItem::with_id(app, "lock", "Lock wallet", true, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "Quit PARSEC", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &lock, &sep, &quit])?;

    let mut tray = TrayIconBuilder::with_id("parsec-tray")
        .tooltip("PARSEC Wallet")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_main(app),
            "lock" => {
                let _ = app.emit(TRAY_LOCK_EVENT, ());
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            // Linux trays (appindicator) do not deliver clicks; the menu covers it.
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                toggle_main(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;

    if std::env::args().any(|a| a == HIDDEN_ARG) {
        if let Some(w) = app.get_webview_window("main") {
            let _ = w.hide();
        }
    }
    Ok(())
}

/// Close-to-tray: a close request on the main window hides it when the
/// preference is on. Quit (tray menu) exits for real.
pub fn on_window_event<R: Runtime>(window: &Window<R>, event: &WindowEvent) {
    if let WindowEvent::CloseRequested { api, .. } = event {
        if window.label() != "main" {
            return;
        }
        let state = window.app_handle().state::<ShellState>();
        if state.close_to_tray.load(Ordering::Relaxed) {
            api.prevent_close();
            let _ = window.hide();
        }
    }
}

// ── Start at login ──────────────────────────────────────────────────────────

const APP_NAME: &str = "PARSEC Wallet";

fn exe() -> Result<String, String> {
    std::env::current_exe()
        .map_err(|e| format!("cannot locate the executable: {e}"))
        .map(|p| p.to_string_lossy().into_owned())
}

#[cfg(target_os = "linux")]
fn entry_path(_identifier: &str) -> Result<std::path::PathBuf, String> {
    let base = std::env::var_os("XDG_CONFIG_HOME")
        .map(std::path::PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|h| std::path::PathBuf::from(h).join(".config")))
        .ok_or("no HOME or XDG_CONFIG_HOME")?;
    Ok(base.join("autostart").join("parsec-wallet.desktop"))
}

#[cfg(target_os = "macos")]
fn entry_path(identifier: &str) -> Result<std::path::PathBuf, String> {
    let home = std::env::var_os("HOME").ok_or("no HOME")?;
    Ok(std::path::PathBuf::from(home).join("Library/LaunchAgents").join(format!("{identifier}.plist")))
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
pub fn autostart_enabled(identifier: &str) -> Result<bool, String> {
    Ok(entry_path(identifier)?.exists())
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
pub fn set_autostart(identifier: &str, enabled: bool) -> Result<(), String> {
    let path = entry_path(identifier)?;
    if !enabled {
        if path.exists() {
            std::fs::remove_file(&path).map_err(|e| format!("could not remove {}: {e}", path.display()))?;
        }
        return Ok(());
    }
    let exe = exe()?;
    #[cfg(target_os = "linux")]
    let body = format!(
        "[Desktop Entry]\nType=Application\nName={APP_NAME}\nComment=Start {APP_NAME} in the tray\nExec=\"{exe}\" {HIDDEN_ARG}\nTerminal=false\nX-GNOME-Autostart-enabled=true\n"
    );
    #[cfg(target_os = "macos")]
    let body = format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">\n<plist version=\"1.0\"><dict>\n<key>Label</key><string>{identifier}</string>\n<key>ProgramArguments</key><array><string>{exe}</string><string>{HIDDEN_ARG}</string></array>\n<key>RunAtLoad</key><true/>\n</dict></plist>\n"
    );
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("could not create {}: {e}", dir.display()))?;
    }
    std::fs::write(&path, body).map_err(|e| format!("could not write {}: {e}", path.display()))
}

#[cfg(target_os = "windows")]
const RUN_KEY: &str = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run";

#[cfg(target_os = "windows")]
pub fn autostart_enabled(_identifier: &str) -> Result<bool, String> {
    let out = std::process::Command::new("reg")
        .args(["query", RUN_KEY, "/v", APP_NAME])
        .output()
        .map_err(|e| format!("reg query failed: {e}"))?;
    Ok(out.status.success())
}

#[cfg(target_os = "windows")]
pub fn set_autostart(_identifier: &str, enabled: bool) -> Result<(), String> {
    let mut cmd = std::process::Command::new("reg");
    if enabled {
        let value = format!("\"{}\" {HIDDEN_ARG}", exe()?);
        cmd.args(["add", RUN_KEY, "/v", APP_NAME, "/t", "REG_SZ", "/d", &value, "/f"]);
    } else {
        if !autostart_enabled(_identifier)? {
            return Ok(());
        }
        cmd.args(["delete", RUN_KEY, "/v", APP_NAME, "/f"]);
    }
    let out = cmd.output().map_err(|e| format!("reg failed: {e}"))?;
    if out.status.success() { Ok(()) } else { Err(String::from_utf8_lossy(&out.stderr).into_owned()) }
}

#[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
pub fn autostart_enabled(_identifier: &str) -> Result<bool, String> { Ok(false) }

#[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
pub fn set_autostart(_identifier: &str, _enabled: bool) -> Result<(), String> {
    Err("start at login is not supported on this platform".into())
}
