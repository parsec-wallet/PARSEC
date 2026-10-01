//! connect_harness — run the real Connect server headless and stand in for the human.
//!
//! Everything here is the shipping code path: `start_connect_server`, the JSON-RPC router,
//! the op allowlist, the name validation, the pending-request queue and the approval channel.
//! The only thing faked is the part a GUI would do — a person reading the intent and pressing
//! Approve — which this replaces with a policy loop that prints each intent and answers it.
//!
//!   cargo run --example connect_harness -- [port]
//!
//! Policy, so one run can exercise every outcome:
//!   name == "rejectme"  -> rejected, as if the user pressed Reject
//!   name == "lockme"    -> locks the wallet, rejects, then RELEASES the lock after 1.5 s
//!                          so the suite is re-runnable against a single harness. It has to
//!                          release itself: once locked, the server refuses name requests
//!                          before they reach this loop, so there is no way to unlock through
//!                          the same door.
//!   anything else       -> approved, returning a synthetic { id }
//!
//! Prints one line per lifecycle event on stdout so the driver can assert against it.

use std::sync::Arc;
use tokio::sync::RwLock;

use parsec_wallet_lib::parsec_connect::{
    server::start_connect_server, ConnectSession, NameResponse,
};

#[tokio::main]
async fn main() {
    let port: u16 = std::env::args()
        .nth(1)
        .and_then(|s| s.parse().ok())
        .unwrap_or(9877);

    let session: Arc<RwLock<ConnectSession>> = Arc::new(RwLock::new(ConnectSession::default()));
    let active_addr = Arc::new(RwLock::new(Some(
        "Dhma3UDUUJGZDKeGAXKi3MjjSQgnQiUbmB47sufymvMg".to_string(),
    )));
    let wallet_unlocked = Arc::new(RwLock::new(true));
    let network = Arc::new(RwLock::new("mainnet".to_string()));
    let origins = vec![
        "https://bankon.pythai.net".to_string(),
        "https://agenticplace.pythai.net".to_string(),
        "https://mindx.pythai.net".to_string(),
    ];

    // The approver loop — the stand-in for the approval dialog.
    {
        let session = session.clone();
        let wallet_unlocked = wallet_unlocked.clone();
        tokio::spawn(async move {
            loop {
                tokio::time::sleep(std::time::Duration::from_millis(25)).await;

                let found = {
                    let sess = session.read().await;
                    sess.pending_name_requests
                        .values()
                        .next()
                        .map(|r| (r.request_id, r.op.clone(), r.name.clone(), r.origin.clone(),
                                  r.namespace.clone(), r.params.clone()))
                };
                let Some((id, op, name, origin, namespace, params)) = found else { continue };

                println!(
                    "INTENT id={id} origin={origin} namespace={namespace} op={op} name={name} params={params}"
                );

                let response = if name == "rejectme" {
                    println!("DECISION id={id} rejected");
                    NameResponse::Rejected { reason: "User rejected".into() }
                } else if name == "lockme" {
                    *wallet_unlocked.write().await = false;
                    println!("DECISION id={id} wallet-locked");
                    let unlock = wallet_unlocked.clone();
                    tokio::spawn(async move {
                        tokio::time::sleep(std::time::Duration::from_millis(1500)).await;
                        *unlock.write().await = true;
                        println!("DECISION wallet-unlocked (auto-release)");
                    });
                    NameResponse::Rejected { reason: "Wallet locked".into() }
                } else {
                    // A real approval returns whatever the NamespaceAdapter returned.
                    let sig = format!("sig-{}-{}", op, id);
                    println!("DECISION id={id} approved sig={sig}");
                    NameResponse::Approved {
                        result: serde_json::json!({ "id": sig }),
                    }
                };

                let mut sess = session.write().await;
                if let Some(tx) = sess.name_response_channels.remove(&id) {
                    let _ = tx.send(response).await;
                }
                sess.pending_name_requests.remove(&id);
            }
        });
    }

    println!("HARNESS listening on 127.0.0.1:{port}");
    if let Err(e) = start_connect_server(
        port, session, active_addr, wallet_unlocked, network, origins, None,
    )
    .await
    {
        eprintln!("HARNESS error: {e}");
        std::process::exit(1);
    }
}
