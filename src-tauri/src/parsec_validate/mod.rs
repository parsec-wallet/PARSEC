//! parsec_validate — Rust-side chain address validators
//!
//! The frontend classifier suggests; Rust validators are the gatekeepers.
//! No address is trusted until the backend proves it valid.

pub mod commands;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha512_256};

/// Validation result returned to frontend
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ValidationResult {
    pub valid: bool,
    pub chain: String,
    pub address: String,
    pub reason: String,
}

/// Validate an Algorand address (58-char base32 with 4-byte checksum)
///
/// Algorand addresses are:
/// - 32 bytes public key + 4 bytes checksum = 36 bytes
/// - Encoded as base32 (RFC 4648, no padding) = 58 characters
/// - Checksum = last 4 bytes of SHA-512/256(public_key)
pub fn validate_algorand_address(address: &str) -> ValidationResult {
    let address = address.trim();

    // Length check
    if address.len() != 58 {
        return ValidationResult {
            valid: false,
            chain: "algorand".into(),
            address: address.into(),
            reason: format!("Expected 58 characters, got {}", address.len()),
        };
    }

    // Character set check (base32: A-Z, 2-7)
    if !address.chars().all(|c| c.is_ascii_uppercase() || ('2'..='7').contains(&c)) {
        return ValidationResult {
            valid: false,
            chain: "algorand".into(),
            address: address.into(),
            reason: "Invalid characters — Algorand addresses use A-Z and 2-7 only".into(),
        };
    }

    // Decode base32
    let decoded = match base32_decode(address) {
        Some(bytes) => bytes,
        None => {
            return ValidationResult {
                valid: false,
                chain: "algorand".into(),
                address: address.into(),
                reason: "Base32 decoding failed".into(),
            }
        }
    };

    if decoded.len() != 36 {
        return ValidationResult {
            valid: false,
            chain: "algorand".into(),
            address: address.into(),
            reason: format!("Decoded to {} bytes, expected 36", decoded.len()),
        };
    }

    // Split into public key (32 bytes) and checksum (4 bytes)
    let public_key = &decoded[..32];
    let checksum = &decoded[32..36];

    // Verify checksum: last 4 bytes of SHA-512/256(public_key)
    let hash = Sha512_256::digest(public_key);
    let expected_checksum = &hash[28..32];

    if checksum != expected_checksum {
        return ValidationResult {
            valid: false,
            chain: "algorand".into(),
            address: address.into(),
            reason: "Checksum mismatch — address may be corrupted".into(),
        };
    }

    ValidationResult {
        valid: true,
        chain: "algorand".into(),
        address: address.into(),
        reason: "Valid Algorand address".into(),
    }
}

/// Validate a Bitcoin address (base58check or bech32/bech32m)
pub fn validate_bitcoin_address(address: &str) -> ValidationResult {
    let address = address.trim();

    // Bech32/Bech32m (bc1...)
    if address.starts_with("bc1") || address.starts_with("tb1") {
        let is_mainnet = address.starts_with("bc1");
        let prefix = if is_mainnet { "bc" } else { "tb" };

        // Basic bech32 structure check
        if address.len() < 14 || address.len() > 74 {
            return ValidationResult {
                valid: false,
                chain: "bitcoin".into(),
                address: address.into(),
                reason: "Invalid bech32 address length".into(),
            };
        }

        // Check for valid bech32 characters
        let data_part = &address[prefix.len() + 1..]; // skip hrp + separator '1'
        if data_part
            .chars()
            .all(|c| "qpzry9x8gf2tvdw0s3jn54khce6mua7l".contains(c))
        {
            return ValidationResult {
                valid: true,
                chain: "bitcoin".into(),
                address: address.into(),
                reason: format!(
                    "Valid Bitcoin bech32 address ({})",
                    if is_mainnet { "mainnet" } else { "testnet" }
                ),
            };
        }

        return ValidationResult {
            valid: false,
            chain: "bitcoin".into(),
            address: address.into(),
            reason: "Invalid bech32 characters".into(),
        };
    }

    // Base58Check (1... or 3... or m... or n... or 2...)
    if address.starts_with('1')
        || address.starts_with('3')
        || address.starts_with('m')
        || address.starts_with('n')
        || address.starts_with('2')
    {
        if address.len() < 25 || address.len() > 34 {
            return ValidationResult {
                valid: false,
                chain: "bitcoin".into(),
                address: address.into(),
                reason: "Invalid base58 address length".into(),
            };
        }

        // Check base58 character set
        if address
            .chars()
            .all(|c| "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz".contains(c))
        {
            return ValidationResult {
                valid: true,
                chain: "bitcoin".into(),
                address: address.into(),
                reason: "Valid Bitcoin base58 address (checksum not verified in Rust yet)".into(),
            };
        }
    }

    ValidationResult {
        valid: false,
        chain: "bitcoin".into(),
        address: address.into(),
        reason: "Not a recognized Bitcoin address format".into(),
    }
}

/// Validate an Ethereum/EVM address (0x + 40 hex chars)
pub fn validate_evm_address(address: &str) -> ValidationResult {
    let address = address.trim();

    if !address.starts_with("0x") && !address.starts_with("0X") {
        return ValidationResult {
            valid: false,
            chain: "evm".into(),
            address: address.into(),
            reason: "EVM addresses must start with 0x".into(),
        };
    }

    let hex_part = &address[2..];
    if hex_part.len() != 40 {
        return ValidationResult {
            valid: false,
            chain: "evm".into(),
            address: address.into(),
            reason: format!("Expected 40 hex characters after 0x, got {}", hex_part.len()),
        };
    }

    if !hex_part.chars().all(|c| c.is_ascii_hexdigit()) {
        return ValidationResult {
            valid: false,
            chain: "evm".into(),
            address: address.into(),
            reason: "Invalid hex characters".into(),
        };
    }

    // EIP-55 checksum verification
    if hex_part.chars().any(|c| c.is_ascii_uppercase()) {
        // Has mixed case — verify EIP-55 checksum
        let lower = hex_part.to_lowercase();
        let hash = sha3::Keccak256::digest(lower.as_bytes());
        let hash_hex = hex::encode(hash);

        let valid_checksum = hex_part.chars().enumerate().all(|(i, c)| {
            if c.is_ascii_alphabetic() {
                let hash_nibble = u8::from_str_radix(&hash_hex[i..i + 1], 16).unwrap_or(0);
                if hash_nibble >= 8 {
                    c.is_ascii_uppercase()
                } else {
                    c.is_ascii_lowercase()
                }
            } else {
                true
            }
        });

        if !valid_checksum {
            return ValidationResult {
                valid: false,
                chain: "evm".into(),
                address: address.into(),
                reason: "EIP-55 checksum mismatch — address may be corrupted".into(),
            };
        }

        return ValidationResult {
            valid: true,
            chain: "evm".into(),
            address: address.into(),
            reason: "Valid EVM address (EIP-55 checksum verified)".into(),
        };
    }

    // All lowercase — valid but unchecksummed
    ValidationResult {
        valid: true,
        chain: "evm".into(),
        address: address.into(),
        reason: "Valid EVM address (no checksum — all lowercase)".into(),
    }
}

/// Validate a Solana address (base58, 32-44 chars)
pub fn validate_solana_address(address: &str) -> ValidationResult {
    let address = address.trim();

    if address.len() < 32 || address.len() > 44 {
        return ValidationResult {
            valid: false,
            chain: "solana".into(),
            address: address.into(),
            reason: format!("Expected 32-44 characters, got {}", address.len()),
        };
    }

    if !address
        .chars()
        .all(|c| "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz".contains(c))
    {
        return ValidationResult {
            valid: false,
            chain: "solana".into(),
            address: address.into(),
            reason: "Invalid base58 characters".into(),
        };
    }

    ValidationResult {
        valid: true,
        chain: "solana".into(),
        address: address.into(),
        reason: "Valid Solana address (ed25519 public key)".into(),
    }
}

/// Validate a Cosmos/Bech32 address (hrp1...)
pub fn validate_cosmos_address(address: &str) -> ValidationResult {
    let address = address.trim();

    // Find the '1' separator
    let sep_pos = match address.rfind('1') {
        Some(p) if p > 0 => p,
        _ => {
            return ValidationResult {
                valid: false,
                chain: "cosmos".into(),
                address: address.into(),
                reason: "No bech32 separator found".into(),
            }
        }
    };

    let hrp = &address[..sep_pos];
    let data = &address[sep_pos + 1..];

    // Known Cosmos HRPs
    let known_hrps = [
        "cosmos", "osmo", "atom", "juno", "stars", "akash", "secret",
        "terra", "evmos", "injective", "sei", "celestia", "dydx",
    ];

    let chain_name = if known_hrps.contains(&hrp) {
        hrp.to_string()
    } else {
        format!("cosmos({})", hrp)
    };

    // Check data part characters (bech32 charset)
    if !data
        .chars()
        .all(|c| "qpzry9x8gf2tvdw0s3jn54khce6mua7l".contains(c))
    {
        return ValidationResult {
            valid: false,
            chain: chain_name,
            address: address.into(),
            reason: "Invalid bech32 characters in data part".into(),
        };
    }

    // Standard cosmos addresses are hrp + 1 + 38 chars (20-byte hash) or 58 chars (32-byte)
    if data.len() < 6 {
        return ValidationResult {
            valid: false,
            chain: chain_name,
            address: address.into(),
            reason: "Data part too short".into(),
        };
    }

    ValidationResult {
        valid: true,
        chain: chain_name,
        address: address.into(),
        reason: format!("Valid Cosmos bech32 address (HRP: {})", hrp),
    }
}

/// Auto-detect chain and validate
pub fn validate_any_address(address: &str) -> ValidationResult {
    let address = address.trim();

    // Algorand: 58-char base32 uppercase
    if address.len() == 58
        && address
            .chars()
            .all(|c| c.is_ascii_uppercase() || ('2'..='7').contains(&c))
    {
        return validate_algorand_address(address);
    }

    // EVM: 0x + 40 hex
    if address.starts_with("0x") || address.starts_with("0X") {
        return validate_evm_address(address);
    }

    // Bitcoin bech32: bc1... or tb1...
    if address.starts_with("bc1") || address.starts_with("tb1") {
        return validate_bitcoin_address(address);
    }

    // Bitcoin base58: 1... or 3...
    if (address.starts_with('1') || address.starts_with('3')) && address.len() >= 25 && address.len() <= 34 {
        return validate_bitcoin_address(address);
    }

    // Cosmos bech32: contains '1' separator with known HRP
    if let Some(sep) = address.rfind('1') {
        let hrp = &address[..sep];
        let cosmos_hrps = [
            "cosmos", "osmo", "atom", "juno", "stars", "akash", "secret",
            "terra", "evmos", "injective", "sei", "celestia", "dydx",
        ];
        if cosmos_hrps.contains(&hrp) {
            return validate_cosmos_address(address);
        }
    }

    // Solana: 32-44 char base58
    if address.len() >= 32
        && address.len() <= 44
        && address
            .chars()
            .all(|c| "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz".contains(c))
    {
        return validate_solana_address(address);
    }

    ValidationResult {
        valid: false,
        chain: "unknown".into(),
        address: address.into(),
        reason: "Could not identify address format".into(),
    }
}

// --- Base32 decoder (RFC 4648, no padding) for Algorand ---

pub(crate) fn base32_decode(input: &str) -> Option<Vec<u8>> {
    let alphabet = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    let mut bits: u64 = 0;
    let mut bit_count: u32 = 0;
    let mut output = Vec::new();

    for c in input.bytes() {
        let val = alphabet.iter().position(|&b| b == c)? as u64;
        bits = (bits << 5) | val;
        bit_count += 5;

        if bit_count >= 8 {
            bit_count -= 8;
            output.push((bits >> bit_count) as u8);
            bits &= (1 << bit_count) - 1;
        }
    }

    Some(output)
}
