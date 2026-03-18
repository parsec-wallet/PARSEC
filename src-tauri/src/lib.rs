mod bankon_vault;

use bankon_vault::VaultState;
use bankon_vault::commands::*;
use bankon_vault::tomb_commands::*;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_os::init())
        .manage(VaultState::default())
        .invoke_handler(tauri::generate_handler![
            // bankon_vault — file-based encrypted vault
            vault_status,
            vault_create,
            vault_unlock,
            vault_lock,
            vault_store_key,
            vault_retrieve_key,
            vault_remove_account,
            vault_list_accounts,
            vault_destroy,
            // bankon_vault — tomb integration (Linux cold storage)
            tomb_check,
            tomb_detect_usb,
            tomb_create,
            tomb_open,
            tomb_close,
            tomb_slam,
            tomb_status,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Parsec Wallet");
}
