// The PARSEC Keycore's command surface, checked from its source (the 0.2.0 exit tests).
//
// 1. No registered command returns secret material — no secret-named field in a JSON reply
//    or in a returned struct, no reveal / export / retrieve / generate-phrase command —
//    except `vault_export_secret`, the one re-authenticated export.
// 2. Every command that signs goes through the Keycore's approval (`approval::authorize`,
//    or the allowance), except those that only relay a signature already made.
//
// A source scan, not a proof: it catches the shapes a secret has left by before (a JSON
// `"mnemonic":`, a `pub mnemonic: String` field, a `*_reveal_*` command). A new command that
// smuggles a secret under an innocent name would pass it, which is why the surface is also
// reviewed by hand at each milestone.

use std::fs;
use std::path::{Path, PathBuf};

const SECRET_NAMES: &[&str] = &[
    "secret", "secret_key", "mnemonic", "phrase", "seed", "jwk", "private_key", "xprv", "xpriv", "wif", "sk",
];
const SECRET_COMMAND_WORDS: &[&str] = &["reveal", "export", "retrieve", "generate_mnemonic"];
/// The re-authenticated export, and the one-time reveal of a key the Keycore just created.
const EXPORTS_ALLOWED: &[&str] = &["vault_export_secret", "vault_reveal_new"];
/// Commands with `sign` in the name that relay or refuse a signature made elsewhere.
const SIGN_RELAYS: &[&str] = &["connect_approve_sign", "connect_reject_sign"];

fn strip_comments(s: &str) -> String {
    s.lines().map(|l| match l.find("//") { Some(i) if !l[..i].contains('"') => &l[..i], _ => l }).collect::<Vec<_>>().join("\n")
}

fn sources() -> Vec<(PathBuf, String)> {
    fn walk(dir: &Path, out: &mut Vec<(PathBuf, String)>) {
        for e in fs::read_dir(dir).unwrap().flatten() {
            let p = e.path();
            if p.is_dir() {
                walk(&p, out);
            } else if p.extension().is_some_and(|x| x == "rs") {
                out.push((p.clone(), strip_comments(&fs::read_to_string(&p).unwrap())));
            }
        }
    }
    let mut out = Vec::new();
    walk(&Path::new(env!("CARGO_MANIFEST_DIR")).join("src"), &mut out);
    out
}

fn registered(srcs: &[(PathBuf, String)]) -> Vec<String> {
    let lib = &srcs.iter().find(|(p, _)| p.ends_with("src/lib.rs")).expect("lib.rs").1;
    let start = lib.find("generate_handler![").expect("generate_handler!") + "generate_handler![".len();
    let end = start + lib[start..].find(']').unwrap();
    lib[start..end]
        .split(',')
        .map(|n| n.trim().rsplit("::").next().unwrap_or("").to_string())
        .filter(|n| !n.is_empty())
        .collect()
}

/// The source of `fn name` up to the next item.
fn body<'a>(srcs: &'a [(PathBuf, String)], name: &str) -> Option<&'a str> {
    for (_, s) in srcs {
        for pat in [format!("fn {name}("), format!("fn {name}<")] {
            if let Some(i) = s.find(&pat) {
                let rest = &s[i..];
                let end = ["\n#[tauri::command]", "\n#[cfg(test)]", "\npub fn ", "\npub async fn ", "\nfn ", "\nasync fn "]
                    .iter()
                    .filter_map(|m| rest[3..].find(m).map(|j| j + 3))
                    .min()
                    .unwrap_or(rest.len());
                return Some(&rest[..end]);
            }
        }
    }
    None
}

fn struct_fields<'a>(srcs: &'a [(PathBuf, String)], ty: &str) -> Option<&'a str> {
    let pat = format!("struct {ty} {{");
    srcs.iter().find_map(|(_, s)| s.find(&pat).map(|i| {
        let rest = &s[i + pat.len()..];
        &rest[..rest.find('}').unwrap_or(rest.len())]
    }))
}

fn returned_type(body: &str) -> Option<String> {
    let i = body.find("-> Result<")? + "-> Result<".len();
    let t: String = body[i..].trim_start().chars().take_while(|c| c.is_alphanumeric() || *c == '_').collect();
    t.chars().next().filter(|c| c.is_uppercase()).map(|_| t)
}

fn secret_leaks(srcs: &[(PathBuf, String)], name: &str) -> Vec<String> {
    let mut why = Vec::new();
    for w in SECRET_COMMAND_WORDS {
        if name.contains(w) {
            why.push(format!("its name contains `{w}`"));
        }
    }
    let Some(b) = body(srcs, name) else { return vec!["its source was not found".to_string()] };
    for k in SECRET_NAMES {
        if b.contains(&format!("\"{k}\":")) || b.contains(&format!("\"{k}\" :")) {
            why.push(format!("it replies with a `{k}` field"));
        }
    }
    if let Some(ty) = returned_type(b) {
        if let Some(fields) = struct_fields(srcs, &ty) {
            for k in SECRET_NAMES {
                if fields.contains(&format!("pub {k}:")) || fields.contains(&format!("pub {k} :")) {
                    why.push(format!("it returns `{ty}`, which has a `{k}` field"));
                }
            }
        }
    }
    why
}

#[test]
fn no_registered_command_returns_secret_material_except_the_export() {
    let srcs = sources();
    let names = registered(&srcs);
    assert!(names.len() > 80, "the command list was not found ({} names)", names.len());
    for allowed in EXPORTS_ALLOWED {
        assert!(names.iter().any(|n| n == allowed), "{allowed} is allow-listed but not registered");
    }
    let leaks: Vec<String> = names
        .iter()
        .filter(|n| !EXPORTS_ALLOWED.contains(&n.as_str()))
        .filter_map(|n| {
            let why = secret_leaks(&srcs, n);
            (!why.is_empty()).then(|| format!("{n}: {}", why.join("; ")))
        })
        .collect();
    assert!(leaks.is_empty(), "commands that may return secret material:\n{}", leaks.join("\n"));
}

#[test]
fn every_signing_command_asks_the_keycore_first() {
    let srcs = sources();
    let unguarded: Vec<String> = registered(&srcs)
        .into_iter()
        .filter(|n| n.split('_').any(|w| w == "sign") && !SIGN_RELAYS.contains(&n.as_str()))
        .filter(|n| !body(&srcs, n).is_some_and(|b| b.contains("approval::authorize(") || b.contains("spend_allowance(")))
        .collect();
    assert!(unguarded.is_empty(), "signing commands without a Keycore approval: {unguarded:?}");
}

#[test]
fn the_scan_would_catch_the_old_leaks() {
    let srcs = vec![(
        PathBuf::from("x.rs"),
        "struct Leaky {\n    pub mnemonic: String,\n}\nfn a() -> Result<Leaky, String> {}\nfn b() -> Result<serde_json::Value, String> { json!({ \"secret\": s }) }\n".to_string(),
    )];
    assert!(!secret_leaks(&srcs, "a").is_empty());
    assert!(!secret_leaks(&srcs, "b").is_empty());
    assert!(!secret_leaks(&srcs, "chain_x_reveal_phrase").is_empty());
}
