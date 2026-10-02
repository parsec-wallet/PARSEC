mod bankon_vault;
mod pmvpn;
mod parsec_search;
mod parsec_mesh;
mod parsec_throttle;
mod parsec_sandbox;
mod parsec_validate;
mod parsec_connect;
mod chain_algo;
mod chain_ar;
mod chain_btc;
mod chain_evm;
mod chain_ltc;
mod chain_sol;
mod network_monitor;
mod app_shell;
mod parsec_http;
#[cfg(test)]
mod surface_tests;

use bankon_vault::VaultState;
use bankon_vault::commands::*;
use bankon_vault::commands_v2::*;
use bankon_vault::profiles::*;
use bankon_vault::tomb_commands::*;
use pmvpn::PmvpnState;
use pmvpn::commands::*;
use parsec_search::SearchState;
use parsec_search::commands::*;
use parsec_mesh::MeshState;
use parsec_mesh::commands::*;
use parsec_throttle::ThrottleState;
use parsec_throttle::commands::*;
use parsec_sandbox::SandboxState;
use parsec_sandbox::commands::*;
use parsec_validate::commands::*;
use parsec_connect::ConnectState;
use parsec_connect::commands::*;
use chain_algo::commands::*;
use chain_ar::commands::*;
use chain_btc::commands::*;
use chain_evm::commands::*;
use chain_ltc::commands::*;
use chain_sol::commands::*;
use network_monitor::NetworkMonitorState;
use network_monitor::commands::*;
use app_shell::ShellState;
use app_shell::commands::*;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Before anything can hold key material: no core dumps (a core written while the vault
    // is unlocked would carry the session key), and on Linux no same-user ptrace/dump.
    bankon_vault::secure_mem::harden_process();
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
        .manage(bankon_vault::approval::ApprovalState::default())
        .manage(PmvpnState::default())
        .manage(SearchState::default())
        .manage(MeshState::default())
        .manage(ThrottleState::default())
        .manage(SandboxState::default())
        .manage(ConnectState::default())
        .manage(NetworkMonitorState::default())
        .manage(ShellState::default())
        // The desktop shell: tray, close-to-tray, start at login (app_shell).
        .setup(|app| { app_shell::setup(app)?; Ok(()) })
        .on_window_event(|window, event| app_shell::on_window_event(window, event))
        .invoke_handler(tauri::generate_handler![
            // pmvpn — wallet-authenticated SSH
            pmvpn_connect,
            pmvpn_disconnect,
            pmvpn_send_data,
            pmvpn_resize,
            pmvpn_sign_challenge,
            // bankon_vault — file-based encrypted vault
            vault_status,
            vault_create,
            vault_unlock,
            vault_lock,
            vault_store_key,
            vault_export_secret,
            vault_reveal_new,
            vault_remove_v1_files,
            // bankon-vault/2 (0.2.5; the app moves onto it in 0.2.6–0.2.7)
            vault_v2_status,
            vault_v2_create,
            vault_v2_unlock,
            vault_store_key_bytes,
            vault_v2_remove_account,
            vault_change_passphrase,
            vault_add_signature_custodian,
            vault_remove_custodian,
            vault_binding_message,
            vault_migration_plan,
            vault_migrate,
            vault_kdf_profile,
            vault_passphrase_strength,
            vault_generate_passphrase,
            vault_set_auto_lock,
            vault_auto_lock_status,
            vault_touch,
            bankon_vault::approval::keycore_approve,
            bankon_vault::approval::keycore_allowance_grant,
            bankon_vault::approval::keycore_allowance_revoke,
            bankon_vault::approval::keycore_allowance_status,
            vault_remove_account,
            vault_list_accounts,
            vault_destroy,
            // bankon_vault — profiles: one vault per profile, `default` = the original
            vault_profiles,
            vault_profile_select,
            // bankon_vault — tomb integration (Linux cold storage)
            tomb_check,
            tomb_detect_usb,
            tomb_create,
            tomb_open,
            tomb_close,
            tomb_slam,
            tomb_status,
            // parsec_search — PostgreSQL + pgvectorscale search engine
            search_connect,
            search_disconnect,
            search_health,
            search_index,
            search_index_batch,
            search_query,
            search_delete,
            search_delete_filter,
            // parsec_mesh — P2P mesh (client = server) with IPFS handoffs
            mesh_init,
            mesh_start_server,
            mesh_resources,
            mesh_throttle,
            mesh_set_budget,
            mesh_resource_cost,
            mesh_ipfs_add,
            mesh_ipfs_get,
            mesh_ipfs_status,
            mesh_ipfs_pins,
            // parsec_throttle — resource-aware API rate limiting
            throttle_init,
            throttle_check,
            throttle_stats,
            throttle_update_config,
            throttle_reset_source,
            throttle_reset_all,
            // parsec_sandbox — dApp filesystem access (1-10 participant choice)
            sandbox_init,
            sandbox_level_info,
            sandbox_all_levels,
            sandbox_grant,
            sandbox_revoke,
            sandbox_update_level,
            sandbox_check,
            sandbox_get_permission,
            sandbox_list_permissions,
            sandbox_audit_log,
            sandbox_dapp_path,
            // parsec_connect — dApp WebSocket bridge
            connect_start,
            connect_stop,
            connect_sessions,
            connect_pending_requests,
            connect_approve_sign,
            connect_reject_sign,
            connect_disconnect_session,
            // parsec_validate — Rust-side chain address validators
            validate_address_algorand,
            validate_address_bitcoin,
            validate_address_evm,
            validate_address_solana,
            validate_address_cosmos,
            validate_address_any,
            // chain_btc — Bitcoin chain pack (scaffold: derivation + addresses only)
            chain_btc_validate_mnemonic,
            chain_btc_derive_address,
            chain_btc_import_account,
            chain_btc_create_account,
            chain_btc_derive_from_vault,
            chain_btc_sign_psbt,
            // chain_ltc — Litecoin (BIP-44 coin type 2', ltc1… native segwit)
            chain_ltc_derive_address,
            chain_ltc_import_account,
            chain_ltc_create_account,
            chain_ltc_derive_from_vault,
            chain_ltc_sign_psbt,
            // chain_algo — Algorand chain pack (25-word mnemonic, ed25519).
            // Signs the x402 payment group: the seed never leaves Rust.
            chain_algo_address_from_mnemonic,
            chain_algo_validate_mnemonic,
            chain_algo_create_account,
            chain_algo_import_account,
            chain_algo_sign_bytes,
            chain_algo_sign_transaction,
            // chain_evm — EVM chain pack (EIP-1559 transactions, EIP-3009 x402 authorizations)
            chain_evm_sign_tx,
            chain_evm_address_from_key,
            chain_evm_create_account,
            chain_evm_sign_transfer_authorization,
            // chain_ar — Arweave chain pack (RSA-4096 JWK, ANS-104 data items)
            chain_ar_create_account,
            chain_ar_import_account,
            chain_ar_account_info,
            chain_ar_sign,
            // chain_sol — Solana chain pack (ed25519, BIP-44 m/44'/501')
            chain_sol_address_from_mnemonic,
            chain_sol_create_account,
            chain_sol_import_account,
            chain_sol_sign,
            // network_monitor — opt-in local network + system snapshot
            network_monitor_set_enabled,
            network_info,
            network_set_mac,
            // app_shell — custom title bar controls, tray, start at login
            app_shell_minimize,
            app_shell_toggle_maximize,
            app_shell_close,
            app_shell_quit,
            app_shell_set_close_to_tray,
            app_shell_autostart_get,
            app_shell_autostart_set,
            app_shell_started_hidden,
            // x402 transport: HTTPS from Rust (no CORS, no CSP host list), narrow by design
            parsec_http::http_request,
        ])
        .run(tauri::generate_context!())
        .expect("error while running PARSEC Wallet");
}
