/**
 * App-owned HTTP transport.
 *
 * Tauri's HTTP plugin bypasses WKWebView CORS, but it must never replace the
 * global fetch. Tauri's own macOS IPC sends `invoke` commands with
 * `fetch(ipc://...)`; replacing that function with the plugin creates a loop:
 * plugin fetch -> invoke -> IPC fetch -> plugin fetch.
 *
 * Importing the plugin here also makes initialization part of the request
 * promise. Import or permission failures therefore reach the caller's normal
 * error UI instead of becoming an unhandled fire-and-forget rejection.
 *
 * Desktop requests go through the app's own `pooled_fetch` command
 * (src-tauri/src/hub_http.rs) first: the plugin builds a new HTTP client per
 * request, so every request paid a fresh TCP + TLS handshake (~0.5 s China →
 * US, on top of a 0.22 s round trip). The command keeps one client and its
 * connections. The plugin stays as the fallback for a shell that does not
 * answer the command (test stubs; it is compiled into the same binary as this
 * bundle, so a real shell always has it).
 */
export async function appFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const startedAt = Date.now();
  inflight++;
  starts.push(startedAt);
  if (starts.length > STARTS_CAP) starts.splice(0, starts.length - STARTS_CAP);
  try {
    return await transport(input, init);
  } finally {
    inflight--;
  }
}

// #518 —— 这个 JS 上下文里**此刻有多少个请求在路上**、最近一分钟发了多少个。发送时记进
// `[anet-chat] send_timing`(inflight / req_60s):「发送要等很久」时一眼看出是不是被别的请求淹了
// (轮询堆积、窗口越开越多),还是链路本身慢。只计数,不排队、不限流。
let inflight = 0;
const starts: number[] = [];
const STARTS_CAP = 2000;
export function appFetchLoad(now = Date.now()): { inflight: number; lastMinute: number } {
  let lastMinute = 0;
  for (let i = starts.length - 1; i >= 0 && now - starts[i] <= 60_000; i--) lastMinute++;
  return { inflight, lastMinute };
}

async function transport(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if ((globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) {
    if (pooledHttpEnabled()) {
      const pooled = await pooledFetch(input, init);
      if (pooled) return pooled;
    }
    const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http');
    return tauriFetch(input, init);
  }
  return globalThis.fetch(input, init);
}

/**
 * Kill switch (设置 → 关于 → 连接复用): off = every request goes through the plugin, the
 * behaviour before pooled_fetch. Per device, no release needed. Default on; unreadable storage
 * counts as on.
 */
export const POOLED_HTTP_OFF_KEY = 'anet.pooledHttp.off';
export function pooledHttpEnabled(): boolean {
  try { return globalThis.localStorage?.getItem(POOLED_HTTP_OFF_KEY) !== '1'; } catch { return true; }
}
export function setPooledHttpEnabled(on: boolean): void {
  try {
    if (on) globalThis.localStorage?.removeItem(POOLED_HTTP_OFF_KEY);
    else globalThis.localStorage?.setItem(POOLED_HTTP_OFF_KEY, '1');
  } catch { /* no storage: stays on */ }
}

const NOT_SENT = 'pooled_fetch/not_sent: ';
const MAYBE_SENT = 'pooled_fetch/maybe_sent: ';
const TOO_LARGE = 'pooled_fetch/too_large: ';
const CANCELLED = 'pooled_fetch/cancelled';
let pooledSequence = 0;

/** RequestInit plus the native-only body cap (bytes) enforced before buffering. */
export type PooledFetchInit = RequestInit & { maxBytes?: number };
const IDEMPOTENT = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * A pooled_fetch failure falls back to the plugin for that request whenever that is safe:
 * the request never left (connect / builder error), or it is idempotent. A POST that may have
 * reached the hub is NOT replayed — sending a task twice is worse than one visible error. The
 * error then carries the plain reqwest message, as the plugin's would.
 */
export function pooledErrorAction(error: unknown, method: string): { fallback: true } | { fallback: false; error: unknown } {
  const text = typeof error === 'string' ? error : error instanceof Error ? error.message : '';
  // A capped or cancelled native request must never be replayed through the plugin (a POST would
  // be sent twice and the cap would be bypassed).
  if (text.startsWith(TOO_LARGE) || text.startsWith(CANCELLED)) return { fallback: false, error: text };
  if (text.startsWith(NOT_SENT)) return { fallback: true };
  if (text.startsWith(MAYBE_SENT)) {
    return IDEMPOTENT.has(method.toUpperCase()) ? { fallback: true } : { fallback: false, error: text.slice(MAYBE_SENT.length) };
  }
  // Anything else (IPC failure, an unknown command in an older shell) happened before Rust sent
  // anything.
  return { fallback: true };
}

/** Same message the plugin rejects with, so callers see one abort shape on either path. */
const ERROR_REQUEST_CANCELLED = 'Request cancelled';
const NULL_BODY_STATUS = [101, 103, 204, 205, 304];

type PooledMeta = { status: number; statusText: string; url: string; headers: [string, string][] };

/** Wire format of `pooled_fetch`: [u32 BE meta length][meta JSON][body]. */
export function decodePooledResponse(raw: ArrayBuffer | Uint8Array): Response {
  const bytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const metaLen = view.getUint32(0, false);
  const meta = JSON.parse(new TextDecoder().decode(bytes.subarray(4, 4 + metaLen))) as PooledMeta;
  const body = NULL_BODY_STATUS.includes(meta.status) ? null : bytes.slice(4 + metaLen);
  const res = new Response(body, { status: meta.status, statusText: meta.statusText, headers: meta.headers });
  Object.defineProperty(res, 'url', { value: meta.url, writable: false });
  return res;
}

/** null ⇒ use the plugin for this request: the shell has no `pooled_fetch` (answered with a
 *  non-binary value), or it failed in a way that is safe to retry (pooledErrorAction). */
async function pooledFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response | null> {
  const signal = init?.signal;
  if (signal?.aborted) throw new Error(ERROR_REQUEST_CANCELLED);
  // Normalise exactly like the plugin: Request fills in method, URL and the body's content type
  // (FormData boundary, text/plain, …); the caller's own headers win.
  const headers = new Headers(init?.headers);
  const req = new Request(input, init);
  const buffer = await req.arrayBuffer();
  for (const [key, value] of req.headers) if (!headers.get(key)) headers.set(key, value);
  const maxBytes = (init as PooledFetchInit | undefined)?.maxBytes;
  const requestId = `pooled-${++pooledSequence}-${Date.now()}`;
  const request = {
    method: req.method,
    url: req.url,
    headers: Array.from(headers.entries()),
    data: buffer.byteLength ? Array.from(new Uint8Array(buffer)) : null,
    // The Request object does not carry the redirect policy into the IPC request; without this the
    // native client follows 3xx even for callers that asked redirect:'error' (Codex P2).
    redirect: init?.redirect ?? 'follow',
    // Per-request body cap enforced by the native client while streaming, before it buffers.
    ...(typeof maxBytes === 'number' ? { maxBytes } : {}),
    requestId,
  };
  const tauri = await import('@tauri-apps/api/core');
  const { invoke } = tauri;
  if (signal?.aborted) throw new Error(ERROR_REQUEST_CANCELLED);
  const sent = invoke<ArrayBuffer | Uint8Array | null>('pooled_fetch', { request }).catch((error: unknown) => {
    const action = pooledErrorAction(error, req.method);
    if (action.fallback) return null;
    throw action.error;
  });
  const raw = signal
    ? await new Promise<ArrayBuffer | Uint8Array | null>((resolve, reject) => {
      const onAbort = () => {
        // Aborting the JS wrapper alone leaves the Rust request running: cancel the actual request
        // so a timed-out avatar POST cannot commit after the UI said it failed (Codex P2).
        void invoke('pooled_fetch_cancel', { requestId }).catch(() => {});
        reject(new Error(ERROR_REQUEST_CANCELLED));
      };
      signal.addEventListener('abort', onAbort, { once: true });
      sent.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
    })
    : await sent;
  if (!(raw instanceof ArrayBuffer) && !(raw instanceof Uint8Array)) return null;
  return decodePooledResponse(raw);
}
