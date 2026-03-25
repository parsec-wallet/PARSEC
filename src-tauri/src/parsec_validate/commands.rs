//! Tauri IPC commands for address validation
//!
//! The frontend classifier suggests candidates. These Rust validators prove them.

use tauri::State;

use super::{
    validate_algorand_address, validate_any_address, validate_bitcoin_address,
    validate_cosmos_address, validate_evm_address, validate_solana_address, ValidationResult,
};

/// Validate an Algorand address (58-char base32 with SHA-512/256 checksum)
#[tauri::command]
pub async fn validate_address_algorand(address: String) -> Result<ValidationResult, String> {
    Ok(validate_algorand_address(&address))
}

/// Validate a Bitcoin address (base58check or bech32/bech32m)
#[tauri::command]
pub async fn validate_address_bitcoin(address: String) -> Result<ValidationResult, String> {
    Ok(validate_bitcoin_address(&address))
}

/// Validate an EVM address (0x + 40 hex, EIP-55 checksum)
#[tauri::command]
pub async fn validate_address_evm(address: String) -> Result<ValidationResult, String> {
    Ok(validate_evm_address(&address))
}

/// Validate a Solana address (base58 ed25519)
#[tauri::command]
pub async fn validate_address_solana(address: String) -> Result<ValidationResult, String> {
    Ok(validate_solana_address(&address))
}

/// Validate a Cosmos bech32 address
#[tauri::command]
pub async fn validate_address_cosmos(address: String) -> Result<ValidationResult, String> {
    Ok(validate_cosmos_address(&address))
}

/// Auto-detect chain and validate any address
#[tauri::command]
pub async fn validate_address_any(address: String) -> Result<ValidationResult, String> {
    Ok(validate_any_address(&address))
}
