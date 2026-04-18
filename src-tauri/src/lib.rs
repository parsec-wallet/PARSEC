mod bankon_vault;
mod pmvpn;
mod parsec_search;
mod parsec_mesh;
mod parsec_throttle;
mod parsec_sandbox;
mod parsec_validate;
mod parsec_connect;
mod chain_btc;

use bankon_vault::VaultState;
use bankon_vault::commands::*;
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
use chain_btc::commands::*;

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
        .manage(PmvpnState::default())
        .manage(SearchState::default())
        .manage(MeshState::default())
        .manage(ThrottleState::default())
        .manage(SandboxState::default())
        .manage(ConnectState::default())
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
            chain_btc_generate_mnemonic,
            chain_btc_validate_mnemonic,
            chain_btc_derive_address,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Parsec Wallet");
}
