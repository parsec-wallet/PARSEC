// parsec_http — HTTP for x402, made from Rust.
//
// x402 has to reach whatever seller a resource names. From the webview that
// fails twice over: a seller's CORS policy will not list PARSEC's origin, and
// a packaged build's CSP only allows a fixed list of hosts. So the x402
// client's transport is this one command, and it is deliberately narrow:
//
//   * https only (http only to the loopback, for local development);
//   * GET, POST and HEAD; no cookies, no credentials, no proxy settings;
//   * at most 3 redirects, each of which must still be https;
//   * 30 s timeout; request body ≤ 1 MiB, response body ≤ 8 MiB;
//   * at most 32 request headers, none of the hop-by-hop or identity ones
//     (Host, Cookie, Authorization, Proxy-*, Connection, …).
//
// It returns status, headers and the body as base64; the frontend rebuilds a
// Response from it. It holds no key and sees no secret beyond what the request
// already carries (an x402 PAYMENT-SIGNATURE is a signed payment, meant for the
// seller).

use base64::Engine;
use serde::{Deserialize, Serialize};
use std::time::Duration;

const MAX_REQ_BODY: usize = 1 << 20;
const MAX_RESP_BODY: usize = 8 << 20;
const MAX_HEADERS: usize = 32;
const BLOCKED_HEADERS: &[&str] = &[
    "host", "cookie", "authorization", "proxy-authorization", "connection", "keep-alive",
    "transfer-encoding", "te", "upgrade", "content-length", "origin", "referer",
];

#[derive(Deserialize)]
pub struct HttpRequest {
    pub method: String,
    pub url: String,
    #[serde(default)]
    pub headers: Vec<(String, String)>,
    /// Request body as UTF-8 text (x402 bodies are JSON).
    #[serde(default)]
    pub body: Option<String>,
}

#[derive(Serialize)]
pub struct HttpResponse {
    pub status: u16,
    pub headers: Vec<(String, String)>,
    pub body_b64: String,
    pub url: String,
}

fn allowed_url(u: &reqwest::Url) -> bool {
    match u.scheme() {
        "https" => true,
        "http" => matches!(u.host_str(), Some("localhost") | Some("127.0.0.1") | Some("[::1]")),
        _ => false,
    }
}

/// Check a request before it leaves; returns the reason it is refused, if any.
pub fn check(req: &HttpRequest) -> Result<reqwest::Url, String> {
    let url = reqwest::Url::parse(&req.url).map_err(|e| format!("not a URL: {e}"))?;
    if !allowed_url(&url) {
        return Err("only https URLs can be requested".to_string());
    }
    if !matches!(req.method.as_str(), "GET" | "POST" | "HEAD") {
        return Err(format!("method {} is not allowed", req.method));
    }
    if req.headers.len() > MAX_HEADERS {
        return Err("too many request headers".to_string());
    }
    for (name, value) in &req.headers {
        let n = name.to_ascii_lowercase();
        if BLOCKED_HEADERS.contains(&n.as_str()) || n.starts_with("proxy-") || n.starts_with("sec-") {
            return Err(format!("header {name} cannot be set"));
        }
        if name.len() > 256 || value.len() > 16 * 1024 {
            return Err(format!("header {name} is too long"));
        }
    }
    if req.body.as_ref().map_or(0, |b| b.len()) > MAX_REQ_BODY {
        return Err("request body is too large".to_string());
    }
    Ok(url)
}

#[tauri::command]
pub async fn http_request(request: HttpRequest) -> Result<HttpResponse, String> {
    let url = check(&request)?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() >= 3 {
                attempt.error("too many redirects")
            } else if !allowed_url(attempt.url()) {
                attempt.error("redirect away from https refused")
            } else {
                attempt.follow()
            }
        }))
        .no_proxy()
        .user_agent(concat!("PARSEC/", env!("CARGO_PKG_VERSION"), " (x402)"))
        .build()
        .map_err(|e| format!("client: {e}"))?;

    let method = reqwest::Method::from_bytes(request.method.as_bytes()).map_err(|e| e.to_string())?;
    let mut builder = client.request(method, url);
    for (name, value) in &request.headers {
        builder = builder.header(name.as_str(), value.as_str());
    }
    if let Some(body) = request.body {
        builder = builder.body(body);
    }

    let resp = builder.send().await.map_err(|e| format!("request failed: {e}"))?;
    let status = resp.status().as_u16();
    let final_url = resp.url().to_string();
    let headers: Vec<(String, String)> = resp
        .headers()
        .iter()
        .filter_map(|(k, v)| v.to_str().ok().map(|s| (k.as_str().to_string(), s.to_string())))
        .collect();
    if resp.content_length().map_or(false, |n| n as usize > MAX_RESP_BODY) {
        return Err("response is too large".to_string());
    }
    let bytes = resp.bytes().await.map_err(|e| format!("reading body: {e}"))?;
    if bytes.len() > MAX_RESP_BODY {
        return Err("response is too large".to_string());
    }
    Ok(HttpResponse {
        status,
        headers,
        body_b64: base64::engine::general_purpose::STANDARD.encode(&bytes),
        url: final_url,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn req(method: &str, url: &str) -> HttpRequest {
        HttpRequest { method: method.into(), url: url.into(), headers: vec![], body: None }
    }

    #[test]
    fn https_only() {
        assert!(check(&req("GET", "https://example.com/x")).is_ok());
        assert!(check(&req("GET", "http://example.com/x")).is_err());
        assert!(check(&req("GET", "http://localhost:4022/x")).is_ok());
        assert!(check(&req("GET", "file:///etc/passwd")).is_err());
    }

    #[test]
    fn methods_and_headers() {
        assert!(check(&req("DELETE", "https://example.com")).is_err());
        let mut r = req("POST", "https://example.com");
        r.headers = vec![("Cookie".into(), "a=b".into())];
        assert!(check(&r).is_err());
        r.headers = vec![("PAYMENT-SIGNATURE".into(), "eyJ…".into()), ("content-type".into(), "application/json".into())];
        assert!(check(&r).is_ok());
    }
}
