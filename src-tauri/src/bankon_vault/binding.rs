// bankon_vault::binding — the key-binding message no signer may sign.
//
// In `bankon-vault/2` a participant's wallet signature over `BANKON-VAULT-KEY-BINDING/v1`
// is a custodian: it can open the vault key (`overseer.rs`). So a signature over that
// message must only ever be made on purpose, by the binding flow — never because a dApp,
// a payment or a message-signing request asked for one. Every PARSEC Keycore signer calls
// `refuse_binding` on the bytes it is about to sign, and refuses any payload carrying the
// message's prefix anywhere (alone, prefixed with `MX`, or wrapped in a larger message).

/// The version-independent prefix of `overseer::binding_message` (v1 and v2).
pub const BINDING_PREFIX: &[u8] = b"BANKON-VAULT-KEY-BINDING";

/// Refuse to sign `payload` if it carries the key-binding message.
pub fn refuse_binding(payload: &[u8]) -> Result<(), String> {
    if payload.windows(BINDING_PREFIX.len()).any(|w| w == BINDING_PREFIX) {
        return Err("refused: this is the vault key-binding message, which no signing request may sign".to_string());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_binding_message_is_refused_alone_prefixed_or_embedded() {
        assert!(refuse_binding(b"BANKON-VAULT-KEY-BINDING/v1").is_err());
        assert!(refuse_binding(b"MXBANKON-VAULT-KEY-BINDING/v1").is_err());
        assert!(refuse_binding(b"please sign: BANKON-VAULT-KEY-BINDING/v2 thanks").is_err());
    }

    #[test]
    fn ordinary_payloads_pass() {
        assert!(refuse_binding(b"").is_ok());
        assert!(refuse_binding(b"BANKON-VAULT-KEY").is_ok());
        assert!(refuse_binding(&[0u8; 300]).is_ok());
    }
}
