// App HTTP (hub + everything else appFetch reaches) over ONE long-lived client, so requests
// reuse connections. JS side: src/app-fetch.ts.
//
// tauri-plugin-http builds a new reqwest Client for every fetch (commands.rs,
// `reqwest::ClientBuilder::new()` … `builder.build()?` per call, still so in 2.8.0), so every
// hub request paid a fresh TCP + TLS handshake. From China to the US hub that is ~0.5 s on top
// of the ~0.22 s round trip — a cold request cost 0.7–0.8 s, and every screen is a few of them.
// This command is the same request with a process-wide pool: after the first request to a hub,
// the rest ride warm connections (HTTP/2 multiplexed where the hub's front end speaks it).
//
// Same reqwest line (0.12) and features as the plugin (rustls, http2, charset, macOS system
// proxy, gzip), so TLS, proxy and decompression behave as before. No cookie jar: the hub
// authenticates with a bearer header and sets no cookies.
//
// Wire format back to JS (raw IPC bytes, no JSON array of numbers):
//   [u32 big-endian meta length][meta JSON {status,statusText,url,headers}][body bytes]

use futures_util::future::{select, Either};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};
use std::time::Duration;
use tokio::sync::oneshot;

// Attachments / images come through here too: the cap is for a stuck body, not a slow link.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(300);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(20);

static CLIENT: LazyLock<Result<reqwest_pool::Client, String>> = LazyLock::new(|| {
    reqwest_pool::Client::builder()
        .connect_timeout(CONNECT_TIMEOUT)
        .timeout(REQUEST_TIMEOUT)
        .pool_idle_timeout(Duration::from_secs(90))
        .tcp_keepalive(Duration::from_secs(30))
        .user_agent(concat!("agent-network-desktop/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|error| error.to_string())
});

// Every error says whether the request can have reached the server, so the JS side knows when
// retrying through the plugin is safe: `not_sent` → always; `maybe_sent` → only idempotent methods
// (a POST that may have landed must not be sent twice).
const NOT_SENT: &str = "pooled_fetch/not_sent: ";
const MAYBE_SENT: &str = "pooled_fetch/maybe_sent: ";
const CANCELLED: &str = "pooled_fetch/cancelled";
const TOO_LARGE: &str = "pooled_fetch/too_large: ";

// request_id → cancel signal. JS aborts used to stop only the wrapper; the native request kept
// running (a timed-out avatar POST could still commit). pooled_fetch_cancel removes the sender and
// select! drops the reqwest future, closing the connection.
static PENDING: LazyLock<Mutex<HashMap<String, oneshot::Sender<()>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

#[tauri::command]
pub fn pooled_fetch_cancel(request_id: String) {
    let sender = PENDING.lock().ok().and_then(|mut map| map.remove(&request_id));
    if let Some(sender) = sender {
        let _ = sender.send(());
    }
}

fn redirect_policy(mode: Option<&str>) -> reqwest_pool::redirect::Policy {
    match mode.unwrap_or("follow") {
        // `manual` cannot expose the Location through this wire format; refusing to follow is the
        // safe half of it, and callers that matter (avatar) only need 3xx to be rejected.
        "error" | "manual" => reqwest_pool::redirect::Policy::none(),
        _ => reqwest_pool::redirect::Policy::limited(10),
    }
}

fn not_sent(message: impl std::fmt::Display) -> String {
    format!("{NOT_SENT}{message}")
}

pub fn send_error(error: &reqwest_pool::Error) -> String {
    // Connect / builder errors fail before a single request byte is written.
    if error.is_connect() || error.is_builder() {
        not_sent(error)
    } else {
        format!("{MAYBE_SENT}{error}")
    }
}

#[derive(Deserialize)]
pub struct HubFetchRequest {
    method: String,
    url: String,
    headers: Vec<(String, String)>,
    data: Option<Vec<u8>>,
    #[serde(default)]
    redirect: Option<String>,
    /// Streamed-body cap, enforced before the body is buffered (missing/forged Content-Length
    /// cannot raise it). None = the historical unbounded behaviour for non-avatar traffic.
    #[serde(default, rename = "maxBytes")]
    max_bytes: Option<u64>,
    #[serde(default, rename = "requestId")]
    request_id: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ResponseMeta {
    status: u16,
    status_text: String,
    url: String,
    headers: Vec<(String, String)>,
}

pub fn frame(meta: &[u8], body: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(4 + meta.len() + body.len());
    out.extend_from_slice(&(meta.len() as u32).to_be_bytes());
    out.extend_from_slice(meta);
    out.extend_from_slice(body);
    out
}

#[tauri::command]
pub async fn pooled_fetch(request: HubFetchRequest) -> Result<tauri::ipc::Response, String> {
    let cancel = request.request_id.as_ref().map(|id| {
        let (tx, rx) = oneshot::channel::<()>();
        if let Ok(mut map) = PENDING.lock() {
            map.insert(id.clone(), tx);
        }
        rx
    });

    let work = async {
        let client = CLIENT.as_ref().map_err(not_sent)?;
        let url = reqwest_pool::Url::parse(&request.url).map_err(|_| not_sent("invalid URL"))?;
        if !matches!(url.scheme(), "http" | "https") {
            return Err(not_sent("URL must use http or https"));
        }
        let method = reqwest_pool::Method::from_bytes(request.method.as_bytes())
            .map_err(|_| not_sent("invalid method"))?;
        let mut builder = client
            .request(method.clone(), url)
            .redirect(redirect_policy(request.redirect.as_deref()));
        for (name, value) in &request.headers {
            // reqwest owns these on a pooled connection; a caller's copy would conflict.
            if name.eq_ignore_ascii_case("host")
                || name.eq_ignore_ascii_case("content-length")
                || name.eq_ignore_ascii_case("connection")
            {
                continue;
            }
            builder = builder.header(name.as_str(), value.as_str());
        }
        match &request.data {
            Some(data) => builder = builder.body(data.clone()),
            // Same rule as the plugin: a body-less POST / PUT still sends Content-Length: 0.
            None if matches!(method, reqwest_pool::Method::POST | reqwest_pool::Method::PUT) => {
                builder = builder.header("content-length", "0")
            }
            None => {}
        }
        let response = builder.send().await.map_err(|error| send_error(&error))?;
        let status = response.status();
        let meta = ResponseMeta {
            status: status.as_u16(),
            status_text: status.canonical_reason().unwrap_or("").to_string(),
            url: response.url().to_string(),
            headers: response
                .headers()
                .iter()
                .filter_map(|(name, value)| value.to_str().ok().map(|v| (name.to_string(), v.to_string())))
                .collect(),
        };
        let body = read_body(response, request.max_bytes).await?;
        let meta = serde_json::to_vec(&meta).map_err(|error| format!("{MAYBE_SENT}{error}"))?;
        Ok(tauri::ipc::Response::new(frame(&meta, &body)))
    };

    let result = match cancel {
        Some(rx) => match select(Box::pin(work), rx).await {
            Either::Left((result, _)) => result,
            Either::Right((_, _)) => Err(CANCELLED.to_string()),
        },
        None => work.await,
    };
    if let Some(id) = request.request_id.as_ref() {
        if let Ok(mut map) = PENDING.lock() {
            map.remove(id);
        }
    }
    result
}

async fn read_body(
    mut response: reqwest_pool::Response,
    max_bytes: Option<u64>,
) -> Result<Vec<u8>, String> {
    let Some(limit) = max_bytes else {
        return response
            .bytes()
            .await
            .map(|bytes| bytes.to_vec())
            .map_err(|error| format!("{MAYBE_SENT}{error}"));
    };
    let mut body: Vec<u8> = Vec::new();
    loop {
        match response.chunk().await {
            Ok(Some(chunk)) => {
                if body.len() as u64 + chunk.len() as u64 > limit {
                    // Non-retryable: replaying through the plugin would bypass the cap.
                    return Err(format!("{TOO_LARGE}body exceeds {limit} bytes"));
                }
                body.extend_from_slice(&chunk);
            }
            Ok(None) => break,
            Err(error) => return Err(format!("{MAYBE_SENT}{error}")),
        }
    }
    Ok(body)
}

#[cfg(test)]
mod tests {
    use super::{frame, send_error, MAYBE_SENT, NOT_SENT};

    #[test]
    fn pooled_fetch_frame_is_length_prefixed_meta_then_body() {
        let out = frame(b"{\"status\":200}", b"hello");
        assert_eq!(&out[..4], &14u32.to_be_bytes());
        assert_eq!(&out[4..18], b"{\"status\":200}");
        assert_eq!(&out[18..], b"hello");
    }

    #[test]
    fn pooled_fetch_connect_failure_is_marked_not_sent() {
        // Nothing listens on port 9 (discard) of loopback in CI; the connect fails before sending.
        let error = tauri::async_runtime::block_on(reqwest_pool::Client::new().get("http://127.0.0.1:9/").send())
            .unwrap_err();
        let message = send_error(&error);
        assert!(message.starts_with(NOT_SENT), "{message}");
        assert!(!message.starts_with(MAYBE_SENT));
    }
}
