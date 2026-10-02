//! chain_evm — EVM chain pack: vault-held secp256k1 key, EIP-1559 (type-2) signing.
//!
//! Big numbers cross the IPC boundary as decimal strings (u128 on the Rust side);
//! `to` and `data` are 0x-hex. Outputs are 0x-prefixed hex.

pub mod commands;
pub mod eip712;
pub mod rlp;
pub mod sign;

use serde::{Deserialize, Serialize};

/// Unsigned EIP-1559 transaction as sent by the frontend.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct EvmTxRequest {
    pub chain_id: u64,
    pub nonce: u64,
    /// Decimal wei string.
    pub max_priority_fee_per_gas: String,
    /// Decimal wei string.
    pub max_fee_per_gas: String,
    pub gas_limit: u64,
    /// 0x-hex, 20 bytes (empty for contract creation).
    pub to: String,
    /// Decimal wei string (up to u128).
    pub value: String,
    /// 0x-hex calldata (may be empty).
    pub data: String,
}

/// Signed type-2 envelope, ready for `eth_sendRawTransaction`.
#[derive(Debug, Clone, Serialize)]
pub struct SignedEvmTx {
    /// 0x02 || rlp([...]) as 0x-hex.
    pub raw_hex: String,
    /// keccak256(raw) as 0x-hex.
    pub tx_hash: String,
}
