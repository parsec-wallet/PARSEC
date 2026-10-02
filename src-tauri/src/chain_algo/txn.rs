// chain_algo::txn — read an Algorand transaction the Keycore is about to sign.
//
// The approval dialog states what the Keycore itself read from the signed bytes, separately
// from whatever the app says. Anything that can move control of the account or all of its
// funds — a rekey, a close-out, a clawback — is called out as a warning.

use crate::bankon_vault::msgpack::{self, Value};

use super::keys;

/// What the Keycore read from one transaction.
#[derive(Debug, Clone, PartialEq)]
pub struct AlgoTxn {
    pub kind: String,
    pub sender: String,
    pub fee: u64,
    pub genesis_id: String,
    pub receiver: Option<String>,
    /// µALGO for `pay`, base units for `axfer`.
    pub amount: u64,
    pub asset_id: Option<u64>,
    pub app_id: Option<u64>,
    pub close_to: Option<String>,
    pub rekey_to: Option<String>,
    pub clawback_from: Option<String>,
    pub note_len: usize,
    pub grouped: bool,
}

fn addr(v: Option<&Value>) -> Result<Option<String>, String> {
    match v.and_then(Value::as_bin) {
        None => Ok(None),
        Some(b) => {
            let arr: [u8; 32] = b.try_into().map_err(|_| "an address field is not 32 bytes")?;
            Ok(Some(keys::address_from_bytes(&arr)))
        }
    }
}

/// Decode the bytes passed to `chain_algo_sign_transaction` (`"TX" ‖ msgpack`).
pub fn decode(payload: &[u8]) -> Result<AlgoTxn, String> {
    let body = payload.strip_prefix(b"TX").ok_or("not an Algorand transaction (no TX prefix)")?;
    let v = msgpack::decode(body)?;
    let kind = v.get("type").and_then(Value::as_str).ok_or("transaction has no type")?.to_string();
    let sender = addr(v.get("snd"))?.ok_or("transaction has no sender")?;
    let u = |k: &str| v.get(k).and_then(Value::as_u64);
    let (receiver, amount, close_to) = match kind.as_str() {
        "pay" => (addr(v.get("rcv"))?, u("amt").unwrap_or(0), addr(v.get("close"))?),
        "axfer" => (addr(v.get("arcv"))?, u("aamt").unwrap_or(0), addr(v.get("aclose"))?),
        _ => (None, 0, None),
    };
    Ok(AlgoTxn {
        sender,
        fee: u("fee").unwrap_or(0),
        genesis_id: v.get("gen").and_then(Value::as_str).unwrap_or("").to_string(),
        receiver,
        amount,
        asset_id: u("xaid").or_else(|| if kind == "acfg" { u("caid") } else { None }),
        app_id: u("apid"),
        close_to,
        rekey_to: addr(v.get("rekey"))?,
        clawback_from: addr(v.get("asnd"))?,
        note_len: v.get("note").and_then(Value::as_bin).map_or(0, <[u8]>::len),
        grouped: v.get("grp").is_some(),
        kind,
    })
}

/// µALGO as ALGO with six decimals, exactly.
pub fn algo(micro: u64) -> String {
    format!("{}.{:06} ALGO", micro / 1_000_000, micro % 1_000_000)
}

impl AlgoTxn {
    /// Rekey, close-out or clawback: the things that can take the whole account.
    pub fn dangerous(&self) -> bool {
        self.rekey_to.is_some() || self.close_to.is_some() || self.clawback_from.is_some()
    }

    /// Plain statements for the approval dialog, warnings first.
    pub fn facts(&self, account: &str) -> Vec<String> {
        let mut out = Vec::new();
        if let Some(r) = &self.rekey_to {
            out.push(format!("WARNING: rekeys {} to {r} — that key would control the account", short(&self.sender)));
        }
        if let Some(c) = &self.close_to {
            out.push(match self.kind.as_str() {
                "axfer" => format!("WARNING: closes this asset holding — the whole balance goes to {c}"),
                _ => format!("WARNING: closes the account — every remaining ALGO goes to {c}"),
            });
        }
        if let Some(f) = &self.clawback_from {
            out.push(format!("WARNING: claws back the asset from {f}"));
        }
        if self.sender != account {
            out.push(format!("WARNING: sender is {}, not this account", self.sender));
        }
        let to = |r: &Option<String>| r.clone().unwrap_or_else(|| "(none)".to_string());
        out.push(match self.kind.as_str() {
            "pay" => format!("Pay {} to {}", algo(self.amount), to(&self.receiver)),
            "axfer" if self.amount == 0 && self.receiver.as_deref() == Some(self.sender.as_str()) && self.close_to.is_none() => {
                format!("Opt in to asset {}", self.asset_id.unwrap_or(0))
            }
            "axfer" => format!(
                "Send {} base units of asset {} to {}",
                self.amount,
                self.asset_id.unwrap_or(0),
                to(&self.receiver)
            ),
            "appl" => format!("Call application {}", self.app_id.unwrap_or(0)),
            "acfg" => match self.asset_id {
                Some(id) => format!("Configure asset {id}"),
                None => "Create an asset".to_string(),
            },
            "keyreg" => "Register participation keys".to_string(),
            "afrz" => "Freeze or unfreeze an asset holding".to_string(),
            other => format!("Transaction type {other}"),
        });
        out.push(format!("Fee {}", algo(self.fee)));
        if !self.genesis_id.is_empty() {
            out.push(format!("Network {}", self.genesis_id));
        }
        if self.note_len > 0 {
            out.push(format!("Note: {} bytes", self.note_len));
        }
        if self.grouped {
            out.push("Part of an atomic group".to_string());
        }
        out
    }
}

fn short(a: &str) -> String {
    if a.len() > 12 { format!("{}…{}", &a[..6], &a[a.len() - 4..]) } else { a.to_string() }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn enc_str(s: &str) -> Vec<u8> {
        let mut v = vec![0xa0 | s.len() as u8];
        v.extend_from_slice(s.as_bytes());
        v
    }
    fn enc_bin(b: &[u8]) -> Vec<u8> {
        let mut v = vec![0xc4, b.len() as u8];
        v.extend_from_slice(b);
        v
    }
    fn enc_u(n: u64) -> Vec<u8> {
        let mut v = vec![0xcf];
        v.extend_from_slice(&n.to_be_bytes());
        v
    }
    fn txn(fields: &[(&str, Vec<u8>)]) -> Vec<u8> {
        let mut v = b"TX".to_vec();
        v.push(0x80 | fields.len() as u8);
        for (k, val) in fields {
            v.extend(enc_str(k));
            v.extend(val.clone());
        }
        v
    }

    #[test]
    fn reads_a_payment_and_states_it_exactly() {
        let me = [1u8; 32];
        let you = [2u8; 32];
        let t = decode(&txn(&[
            ("amt", enc_u(1_500_000)),
            ("fee", enc_u(1000)),
            ("gen", enc_str("mainnet-v1.0")),
            ("rcv", enc_bin(&you)),
            ("snd", enc_bin(&me)),
            ("type", enc_str("pay")),
        ]))
        .unwrap();
        let me_addr = keys::address_from_bytes(&me);
        assert_eq!(t.amount, 1_500_000);
        assert!(!t.dangerous());
        let f = t.facts(&me_addr);
        assert_eq!(f[0], format!("Pay 1.500000 ALGO to {}", keys::address_from_bytes(&you)));
        assert!(f.contains(&"Fee 0.001000 ALGO".to_string()));
        assert!(f.contains(&"Network mainnet-v1.0".to_string()));
    }

    #[test]
    fn a_rekey_or_close_is_a_warning_and_first() {
        let me = [1u8; 32];
        let t = decode(&txn(&[
            ("close", enc_bin(&[3u8; 32])),
            ("rekey", enc_bin(&[4u8; 32])),
            ("snd", enc_bin(&me)),
            ("type", enc_str("pay")),
        ]))
        .unwrap();
        assert!(t.dangerous());
        let f = t.facts(&keys::address_from_bytes(&me));
        assert!(f[0].starts_with("WARNING: rekeys"));
        assert!(f[1].starts_with("WARNING: closes the account"));
    }

    #[test]
    fn an_opt_in_and_a_foreign_sender_are_named() {
        let me = [1u8; 32];
        let t = decode(&txn(&[
            ("arcv", enc_bin(&me)),
            ("snd", enc_bin(&me)),
            ("type", enc_str("axfer")),
            ("xaid", enc_u(31566704)),
        ]))
        .unwrap();
        assert_eq!(t.facts(&keys::address_from_bytes(&me))[0], "Opt in to asset 31566704");
        let f = t.facts(&keys::address_from_bytes(&[9u8; 32]));
        assert!(f[0].starts_with("WARNING: sender is"));
    }

    #[test]
    fn refuses_bytes_that_are_not_a_transaction() {
        assert!(decode(b"MXhello").is_err());
        assert!(decode(b"TX\x81\xa4type\xa3pay").is_err()); // no sender
    }
}
