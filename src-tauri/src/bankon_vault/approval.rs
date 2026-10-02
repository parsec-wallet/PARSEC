// bankon_vault::approval — the PARSEC Keycore's own approval before it signs.
//
// The web layer cannot forge it. A signing command signs only when one of these holds:
//
//   1. the person confirmed a native dialog the Keycore itself showed for this request;
//   2. the request carries an approval token issued by such a dialog (a batch: a
//      transaction group, an upload) and the SHA-256 of these exact bytes is one it covers —
//      single-use, bound to the account, two minutes;
//   3. it is an Algorand asset payment inside an allowance the person granted in a native
//      dialog (the x402 auto-approve cap), checked against the amount the Keycore decoded.
//
// The dialog states what the Keycore read from the bytes ("the Keycore read") separately
// from the app's own description ("the app says"), which it cannot verify.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use rand::RngCore;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use tauri::AppHandle;

pub type Digest32 = [u8; 32];

const APPROVAL_TTL: Duration = Duration::from_secs(120);
/// A batch larger than this needs more than one dialog.
const MAX_BATCH: usize = 512;
/// Lines of decoded detail shown before "and N more".
const MAX_FACT_LINES: usize = 14;

pub fn digest(payload: &[u8]) -> Digest32 {
    Sha256::digest(payload).into()
}

struct Grant {
    address: String,
    digests: Vec<Digest32>,
    expires: Instant,
}

/// A session allowance for Algorand asset payments made without a dialog.
#[derive(Debug, Clone, PartialEq)]
pub struct Allowance {
    pub address: String,
    pub genesis_id: String,
    pub asset_id: u64,
    pub per_payment: u64,
    pub remaining: u64,
    pub expires: Instant,
}

#[derive(Default)]
pub struct Approvals {
    grants: HashMap<String, Grant>,
    allowance: Option<Allowance>,
}

impl Approvals {
    pub fn issue(&mut self, address: &str, digests: Vec<Digest32>, now: Instant) -> String {
        self.grants.retain(|_, g| g.expires > now);
        let mut raw = [0u8; 32];
        rand::rngs::OsRng.fill_bytes(&mut raw);
        let token = hex::encode(raw);
        self.grants.insert(
            token.clone(),
            Grant { address: address.to_string(), digests, expires: now + APPROVAL_TTL },
        );
        token
    }

    /// Spend one item of an approval. False when the token is unknown, expired, for another
    /// account, or does not cover these bytes.
    pub fn consume(&mut self, token: &str, address: &str, d: &Digest32, now: Instant) -> bool {
        let Some(g) = self.grants.get_mut(token) else { return false };
        if g.expires <= now {
            self.grants.remove(token);
            return false;
        }
        // Bound to one account: another account's request is refused, the grant kept.
        if g.address != address {
            return false;
        }
        let Some(at) = g.digests.iter().position(|x| x == d) else { return false };
        g.digests.swap_remove(at);
        if g.digests.is_empty() {
            self.grants.remove(token);
        }
        true
    }

    pub fn set_allowance(&mut self, a: Option<Allowance>) {
        self.allowance = a;
    }

    pub fn allowance(&self, now: Instant) -> Option<&Allowance> {
        self.allowance.as_ref().filter(|a| a.expires > now)
    }

    /// Spend from the allowance if this decoded transaction fits it exactly: an asset
    /// transfer from the account, of the allowed asset on the allowed network, no larger
    /// than the per-payment cap or what is left, and nothing that could take the account.
    pub fn spend_allowance(&mut self, t: &crate::chain_algo::txn::AlgoTxn, account: &str, now: Instant) -> bool {
        let Some(a) = self.allowance.as_mut() else { return false };
        if a.expires <= now {
            self.allowance = None;
            return false;
        }
        let fits = t.kind == "axfer"
            && t.sender == account
            && a.address == account
            && t.genesis_id == a.genesis_id
            && t.asset_id == Some(a.asset_id)
            && !t.dangerous()
            && t.amount > 0
            && t.amount <= a.per_payment
            && t.amount <= a.remaining
            && t.receiver.as_deref() != Some(account);
        if fits {
            a.remaining -= t.amount;
        }
        fits
    }
}

/// The Keycore's approval state: grants, the allowance, and a lock so dialogs queue.
#[derive(Default)]
pub struct ApprovalState {
    pub inner: Mutex<Approvals>,
    pub dialog: tokio::sync::Mutex<()>,
}

/// One approval dialog.
pub struct Request {
    pub title: String,
    pub address: String,
    pub chain: String,
    /// What the Keycore read from the bytes itself.
    pub facts: Vec<String>,
    /// What the app says (not verified).
    pub claims: Vec<String>,
    pub items: usize,
    pub fingerprint: String,
    pub confirm: String,
}

impl Request {
    pub fn new(title: &str, chain: &str, address: &str, digests: &[Digest32]) -> Self {
        let mut h = Sha256::new();
        for d in digests {
            h.update(d);
        }
        let fp = hex::encode(&h.finalize()[..6]);
        Request {
            title: title.to_string(),
            address: address.to_string(),
            chain: chain.to_string(),
            facts: Vec::new(),
            claims: Vec::new(),
            items: digests.len(),
            fingerprint: fp,
            confirm: "Sign".to_string(),
        }
    }

    pub fn warns(&self) -> bool {
        self.facts.iter().any(|f| f.starts_with("WARNING"))
    }

    pub fn body(&self) -> String {
        let mut s = format!("Account ({}): {}\n", self.chain, self.address);
        if !self.facts.is_empty() {
            s.push_str("\nThe Keycore read:\n");
            for f in self.facts.iter().take(MAX_FACT_LINES) {
                s.push_str(&format!("  • {f}\n"));
            }
            if self.facts.len() > MAX_FACT_LINES {
                s.push_str(&format!("  • and {} more\n", self.facts.len() - MAX_FACT_LINES));
            }
        }
        let claims: Vec<&String> = self.claims.iter().filter(|c| !c.trim().is_empty()).take(6).collect();
        if !claims.is_empty() {
            s.push_str("\nThe app says (not verified):\n");
            for c in claims {
                let c: String = c.chars().take(160).collect();
                s.push_str(&format!("  • {c}\n"));
            }
        }
        s.push_str(&format!(
            "\n{} item{} · fingerprint {}",
            self.items,
            if self.items == 1 { "" } else { "s" },
            self.fingerprint
        ));
        s
    }
}

/// Show the request as a native dialog, one at a time. False on cancel or any failure.
pub async fn confirm(app: &AppHandle, state: &ApprovalState, req: Request) -> bool {
    let _queue = state.dialog.lock().await;
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
        app.dialog()
            .message(req.body())
            .title(format!("PARSEC Keycore — {}", req.title))
            .kind(if req.warns() { MessageDialogKind::Warning } else { MessageDialogKind::Info })
            .buttons(MessageDialogButtons::OkCancelCustom(req.confirm.clone(), "Cancel".to_string()))
            .blocking_show()
    })
    .await
    .unwrap_or(false)
}

/// Authorize signing `payload` as `address`: a covering approval token, or a native dialog.
/// A token that does not cover these bytes is an error, never a silent fallback.
pub async fn authorize(
    app: &AppHandle,
    state: &ApprovalState,
    approval: Option<&str>,
    address: &str,
    payload: &[u8],
    request: impl FnOnce(&Digest32) -> Request,
) -> Result<(), String> {
    let d = digest(payload);
    if let Some(token) = approval {
        let ok = state.inner.lock().map_err(|_| "approval state poisoned")?.consume(token, address, &d, Instant::now());
        return if ok {
            Ok(())
        } else {
            Err("the approval does not cover this item (expired, already used, or for something else); nothing was signed".to_string())
        };
    }
    if confirm(app, state, request(&d)).await {
        Ok(())
    } else {
        Err("declined in the PARSEC Keycore dialog; nothing was signed".to_string())
    }
}

/// A message as the dialog shows it: its text when it is printable, else its size and first bytes.
pub fn preview(payload: &[u8]) -> String {
    match std::str::from_utf8(payload) {
        Ok(t) if !t.chars().any(|c| c.is_control() && c != '\n' && c != '\t') => {
            let shown: String = t.chars().take(160).collect();
            let more = if t.chars().count() > 160 { "…" } else { "" };
            format!("\"{shown}{more}\" ({} bytes)", payload.len())
        }
        _ => format!("{} bytes of binary data, starting {}", payload.len(), hex::encode(&payload[..payload.len().min(8)])),
    }
}

/// What the Keycore reads from a PSBT: each output's amount and destination, and the fee
/// when every input states its value. `render` names a destination for the chain at hand.
pub fn psbt_facts(
    psbt_base64: &str,
    coin: &str,
    render: impl Fn(&bitcoin::ScriptBuf) -> Option<String>,
) -> Vec<String> {
    let raw = match b64(psbt_base64) {
        Ok(r) => r,
        Err(_) => return vec!["WARNING: the PSBT is not valid base64".to_string()],
    };
    let psbt = match bitcoin::psbt::Psbt::deserialize(&raw) {
        Ok(p) => p,
        Err(e) => return vec![format!("WARNING: the Keycore could not read this PSBT ({e})")],
    };
    let amount = |sat: u64| format!("{}.{:08} {coin}", sat / 100_000_000, sat % 100_000_000);
    let mut f = Vec::new();
    let mut out_total: u64 = 0;
    for (i, o) in psbt.unsigned_tx.output.iter().enumerate() {
        let sat = o.value.to_sat();
        out_total = out_total.saturating_add(sat);
        let to = render(&o.script_pubkey).unwrap_or_else(|| format!("script {}", hex::encode(o.script_pubkey.as_bytes())));
        f.push(format!("Output {}: {} to {to}", i + 1, amount(sat)));
    }
    let ins: Option<u64> = psbt.inputs.iter().map(|i| i.witness_utxo.as_ref().map(|u| u.value.to_sat())).sum();
    match ins {
        Some(total) if total >= out_total => f.push(format!("Fee {}", amount(total - out_total))),
        _ => f.push("Fee unknown (an input does not state its value)".to_string()),
    }
    f
}

fn b64(s: &str) -> Result<Vec<u8>, String> {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD.decode(s.as_bytes()).map_err(|_| "payload is not valid base64".to_string())
}

#[derive(Debug, Deserialize)]
pub struct ApproveArgs {
    pub address: String,
    pub chain: String,
    pub title: String,
    #[serde(default)]
    pub claims: Vec<String>,
    /// Base64 of each payload exactly as it will be passed to the signing command.
    pub payloads_b64: Vec<String>,
}

/// Approve a batch in one native dialog. Returns a single-use token covering exactly these
/// payloads, for this account, for two minutes.
#[tauri::command]
pub async fn keycore_approve(
    app: AppHandle,
    state: tauri::State<'_, ApprovalState>,
    args: ApproveArgs,
) -> Result<serde_json::Value, String> {
    if args.payloads_b64.is_empty() || args.payloads_b64.len() > MAX_BATCH {
        return Err(format!("a batch holds 1 to {MAX_BATCH} items"));
    }
    let payloads = args.payloads_b64.iter().map(|p| b64(p)).collect::<Result<Vec<_>, _>>()?;
    for p in &payloads {
        super::binding::refuse_binding(p)?;
    }
    let digests: Vec<Digest32> = payloads.iter().map(|p| digest(p)).collect();
    let mut req = Request::new(&args.title, &args.chain, &args.address, &digests);
    req.claims = args.claims;
    if args.chain == "algorand" {
        for (i, p) in payloads.iter().enumerate() {
            match crate::chain_algo::txn::decode(p) {
                Ok(t) => {
                    let mut f = t.facts(&args.address);
                    if payloads.len() > 1 {
                        f[0] = format!("#{} {}", i + 1, f[0]);
                    }
                    req.facts.extend(f);
                }
                Err(_) => req.facts.push(format!("#{} is not a readable transaction ({} bytes)", i + 1, p.len())),
            }
        }
    }
    if !confirm(&app, &state, req).await {
        return Err("declined in the PARSEC Keycore dialog".to_string());
    }
    let token = state.inner.lock().map_err(|_| "approval state poisoned")?.issue(&args.address, digests, Instant::now());
    Ok(serde_json::json!({ "approval": token, "items": payloads.len(), "expires_in_s": APPROVAL_TTL.as_secs() }))
}

#[derive(Debug, Deserialize)]
pub struct AllowanceArgs {
    pub address: String,
    pub genesis_id: String,
    pub asset_id: u64,
    /// Largest single payment, in the asset's base units.
    pub per_payment: u64,
    /// Total for the session, in base units.
    pub total: u64,
    pub minutes: u64,
    /// How the app labels the asset and amounts (shown, not trusted).
    #[serde(default)]
    pub claims: Vec<String>,
}

/// Grant a session allowance for Algorand asset payments without a dialog each time.
#[tauri::command]
pub async fn keycore_allowance_grant(
    app: AppHandle,
    state: tauri::State<'_, ApprovalState>,
    args: AllowanceArgs,
) -> Result<serde_json::Value, String> {
    if args.per_payment == 0 || args.total < args.per_payment || args.minutes == 0 || args.minutes > 24 * 60 {
        return Err("an allowance needs a per-payment cap, a total at least that large, and 1 minute to 24 hours".to_string());
    }
    let mut req = Request::new("allow payments without asking", "algorand", &args.address, &[]);
    req.items = 0;
    req.confirm = "Allow".to_string();
    req.facts = vec![
        format!("Asset {} on {}", args.asset_id, args.genesis_id),
        format!("Up to {} base units per payment", args.per_payment),
        format!("Up to {} base units in total", args.total),
        format!("For {} minutes, or until PARSEC locks", args.minutes),
        "Only plain transfers from this account; never a rekey, close-out or clawback".to_string(),
    ];
    req.claims = args.claims;
    if !confirm(&app, &state, req).await {
        return Err("declined in the PARSEC Keycore dialog".to_string());
    }
    let expires = Instant::now() + Duration::from_secs(args.minutes * 60);
    state.inner.lock().map_err(|_| "approval state poisoned")?.set_allowance(Some(Allowance {
        address: args.address,
        genesis_id: args.genesis_id,
        asset_id: args.asset_id,
        per_payment: args.per_payment,
        remaining: args.total,
        expires,
    }));
    Ok(serde_json::json!({ "ok": true }))
}

/// End the allowance (also done on lock).
#[tauri::command]
pub fn keycore_allowance_revoke(state: tauri::State<'_, ApprovalState>) -> Result<serde_json::Value, String> {
    state.inner.lock().map_err(|_| "approval state poisoned")?.set_allowance(None);
    Ok(serde_json::json!({ "ok": true }))
}

/// What is left of the allowance, if any.
#[tauri::command]
pub fn keycore_allowance_status(state: tauri::State<'_, ApprovalState>) -> Result<serde_json::Value, String> {
    let g = state.inner.lock().map_err(|_| "approval state poisoned")?;
    let now = Instant::now();
    Ok(match g.allowance(now) {
        Some(a) => serde_json::json!({
            "active": true, "address": a.address, "genesis_id": a.genesis_id, "asset_id": a.asset_id,
            "per_payment": a.per_payment, "remaining": a.remaining,
            "expires_in_s": a.expires.saturating_duration_since(now).as_secs(),
        }),
        None => serde_json::json!({ "active": false }),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::chain_algo::txn::AlgoTxn;

    fn axfer(sender: &str, amount: u64) -> AlgoTxn {
        AlgoTxn {
            kind: "axfer".into(), sender: sender.into(), fee: 1000, genesis_id: "mainnet-v1.0".into(),
            receiver: Some("PAYTO".into()), amount, asset_id: Some(31566704), app_id: None,
            close_to: None, rekey_to: None, clawback_from: None, note_len: 0, grouped: true,
        }
    }

    #[test]
    fn an_approval_covers_exactly_its_items_once() {
        let mut a = Approvals::default();
        let now = Instant::now();
        let (x, y) = (digest(b"x"), digest(b"y"));
        let t = a.issue("ME", vec![x, y], now);
        assert!(!a.consume(&t, "ME", &digest(b"z"), now), "other bytes");
        assert!(!a.consume(&t, "YOU", &x, now), "other account");
        assert!(a.consume(&t, "ME", &x, now));
        assert!(!a.consume(&t, "ME", &x, now), "single use");
        assert!(a.consume(&t, "ME", &y, now));
        assert!(!a.consume(&t, "ME", &y, now), "spent");
    }

    #[test]
    fn an_approval_expires() {
        let mut a = Approvals::default();
        let now = Instant::now();
        let t = a.issue("ME", vec![digest(b"x")], now);
        assert!(!a.consume(&t, "ME", &digest(b"x"), now + APPROVAL_TTL + Duration::from_secs(1)));
        assert!(!a.consume("not-a-token", "ME", &digest(b"x"), now));
    }

    #[test]
    fn the_allowance_pays_only_what_it_was_granted() {
        let mut a = Approvals::default();
        let now = Instant::now();
        a.set_allowance(Some(Allowance {
            address: "ME".into(), genesis_id: "mainnet-v1.0".into(), asset_id: 31566704,
            per_payment: 500_000, remaining: 1_000_000, expires: now + Duration::from_secs(600),
        }));
        assert!(a.spend_allowance(&axfer("ME", 500_000), "ME", now));
        assert!(!a.spend_allowance(&axfer("ME", 500_001), "ME", now), "over the per-payment cap");
        assert!(a.spend_allowance(&axfer("ME", 400_000), "ME", now));
        assert!(!a.spend_allowance(&axfer("ME", 200_000), "ME", now), "over what is left");
        let mut rekey = axfer("ME", 1);
        rekey.rekey_to = Some("THEM".into());
        assert!(!a.spend_allowance(&rekey, "ME", now), "never a rekey");
        let mut other = axfer("ME", 1);
        other.asset_id = Some(1);
        assert!(!a.spend_allowance(&other, "ME", now), "another asset");
        let mut testnet = axfer("ME", 1);
        testnet.genesis_id = "testnet-v1.0".into();
        assert!(!a.spend_allowance(&testnet, "ME", now), "another network");
        assert!(!a.spend_allowance(&axfer("ME", 1), "ME", now + Duration::from_secs(601)), "expired");
    }

    #[test]
    fn the_dialog_separates_what_was_read_from_what_the_app_says() {
        let mut r = Request::new("send", "algorand", "ME", &[digest(b"x")]);
        r.facts = vec!["WARNING: rekeys".into(), "Pay 1.000000 ALGO to YOU".into()];
        r.claims = vec!["Coffee".into()];
        let b = r.body();
        assert!(r.warns());
        assert!(b.find("The Keycore read").unwrap() < b.find("The app says (not verified)").unwrap());
        assert!(b.contains("1 item · fingerprint"));
    }
}
