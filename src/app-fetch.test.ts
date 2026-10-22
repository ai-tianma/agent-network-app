// @ts-nocheck -- repository test scripts run directly under Bun; the app
// tsconfig intentionally excludes Node ambient types.
import { readFileSync } from 'node:fs';
import { appFetch, decodePooledResponse, pooledErrorAction, pooledHttpEnabled, setPooledHttpEnabled, POOLED_HTTP_OFF_KEY } from './app-fetch';

let passed = 0;
let total = 0;
const ck = (name: string, condition: boolean) => {
  total++;
  if (condition) { passed++; console.log('✅', name); }
  else console.log('❌', name);
};

const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const transportSource = readFileSync(new URL('./app-fetch.ts', import.meta.url), 'utf8');
const capabilities = JSON.parse(readFileSync(new URL('../src-tauri/capabilities/default.json', import.meta.url), 'utf8'));
const httpPermission = capabilities.permissions.find((permission: unknown) =>
  typeof permission === 'object' && permission !== null && permission.identifier === 'http:default'
);
const allowedHubUrls = new Set(httpPermission?.allow?.map(({ url }: { url: string }) => url));

ck('App never replaces the global fetch used by Tauri IPC', !/globalThis[^\n]*\.fetch\s*=/.test(appSource));
ck('Tauri transport calls the plugin explicitly', /tauriFetch\(input, init\)/.test(transportSource));
ck('web transport delegates to the current global fetch', /globalThis\.fetch\(input, init\)/.test(transportSource));
ck('Tauri transport permits HTTP hubs on explicit ports', allowedHubUrls.has('http://*:*/*'));
ck('Tauri transport permits HTTPS hubs on explicit ports', allowedHubUrls.has('https://*:*/*'));

const originalFetch = globalThis.fetch;
try {
  let seen = '';
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    seen = String(input);
    return new Response('{"ok":true}', { status: 200 });
  }) as typeof fetch;
  const response = await appFetch('http://127.0.0.1/test');
  ck('non-Tauri runtime uses the browser/RN transport', seen === 'http://127.0.0.1/test' && response.ok);
} finally {
  globalThis.fetch = originalFetch;
}

// ── Desktop: one pooled client (src-tauri/src/hub_http.rs) instead of a new client per request ──
const libSource = readFileSync(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8');
const hubHttpSource = readFileSync(new URL('../src-tauri/src/hub_http.rs', import.meta.url), 'utf8');
const cargoToml = readFileSync(new URL('../src-tauri/Cargo.toml', import.meta.url), 'utf8');
ck('pooled_fetch is registered with the Tauri shell', /hub_http::pooled_fetch,/.test(libSource));
ck('pooled_fetch keeps ONE client for the process (not a builder per request)', /static CLIENT: LazyLock</.test(hubHttpSource) && !/async fn pooled_fetch[\s\S]*ClientBuilder::new\(\)/.test(hubHttpSource));
const poolDep = cargoToml.match(/reqwest_pool = \{[^\n]*\}/)?.[0] ?? '';
// Same TLS / proxy / gzip as tauri-plugin-http's defaults + our gzip, so only the pooling changes.
ck('pooled client uses the plugin\'s reqwest line and features', /version = "0\.12"/.test(poolDep) && ['rustls-tls', 'http2', 'charset', 'macos-system-configuration', 'gzip'].every(f => poolDep.includes(`"${f}"`)));
ck('pooled transport applies the caller\'s redirect policy (3xx not followed for redirect:error)', /\.redirect\(redirect_policy\(/.test(hubHttpSource) && /"error" \| "manual" => reqwest_pool::redirect::Policy::none\(\)/.test(hubHttpSource));
ck('pooled body cap is enforced while streaming before buffering', /rename = "maxBytes"/.test(hubHttpSource) && /response\.chunk\(\)\.await/.test(hubHttpSource) && /read_body\(response, request\.max_bytes\)/.test(hubHttpSource) && /"stream"/.test(poolDep));
ck('native abort cancels the running request, not only the JS wrapper', /hub_http::pooled_fetch_cancel,/.test(libSource) && /fn pooled_fetch_cancel/.test(hubHttpSource) && /select\(Box::pin\(work\), rx\)/.test(hubHttpSource));

const settingsModel = readFileSync(new URL('./settings-model.ts', import.meta.url), 'utf8');
const settingsScreen = readFileSync(new URL('./SettingsScreen.tsx', import.meta.url), 'utf8');
// #695: the switch is no longer a searchable row in 设置 → 关于; it lives in the hidden 「诊断」 group
// (tap 版本 5 times, diagnostics-reveal.ts / diagnostics-reveal.test.ts). Storage is unchanged.
ck('kill switch is no longer a 关于 row', !/key: 'pooledHttp'/.test(settingsModel));
{
  // The screen may only use copy keys (i18n-copy-guard); a row inserted into the copy table
  // above ours shifts every index, so pin that the keys this row uses still name its own text.
  const { settingsTranslations } = await import('./i18n-settings');
  const keysUsed = [...settingsScreen.slice(settingsScreen.indexOf('testID="settings-diagnostics-group"')).matchAll(/tr\('(settings\.copy\.\d+)'\)/g)].slice(0, 2).map(m => m[1]);
  ck('kill switch row shows its own label and hint (copy indices not shifted)', settingsTranslations[keysUsed[0]]?.[0] === '连接复用' && settingsTranslations[keysUsed[1]]?.[0]?.startsWith('复用到 Hub 的连接'));
}
ck('kill switch row toggles the stored flag', /const onPooledHttpChange = \(value: boolean\) => \{ setPooledHttpEnabled\(value\); setPooledHttp\(value\); \};/.test(settingsScreen) && /<SettingsSwitchRow[^\n]*onValueChange=\{onPooledHttpChange\}[^\n]*settings-pooled-http-row/.test(settingsScreen));

const frame = (meta: object, body: string | Uint8Array) => {
  const m = new TextEncoder().encode(JSON.stringify(meta));
  const b = typeof body === 'string' ? new TextEncoder().encode(body) : body;
  const out = new Uint8Array(4 + m.length + b.length);
  new DataView(out.buffer).setUint32(0, m.length, false);
  out.set(m, 4); out.set(b, 4 + m.length);
  return out.buffer;
};
{
  const r = decodePooledResponse(frame({ status: 201, statusText: 'Created', url: 'http://h/x', headers: [['content-type', 'application/json'], ['etag', '"v1"']] }, '{"ok":true}'));
  ck('decoded response keeps status, url, headers and body', r.status === 201 && r.url === 'http://h/x' && r.headers.get('etag') === '"v1"' && (await r.json()).ok === true);
  const empty = decodePooledResponse(frame({ status: 204, statusText: 'No Content', url: 'http://h/x', headers: [] }, ''));
  ck('null-body status (204) decodes without throwing', empty.status === 204 && (await empty.text()) === '');
}

const g = globalThis as any;
const hadWindow = 'window' in g;
const origWindow = g.window;
g.window = g;
try {
  const calls: { cmd: string; args: any }[] = [];
  let answer: (cmd: string, args: any) => unknown = () => null;
  g.__TAURI_INTERNALS__ = { invoke: async (cmd: string, args: any) => { calls.push({ cmd, args }); return answer(cmd, args); }, transformCallback: () => 1 };

  answer = (cmd) => cmd === 'pooled_fetch' ? frame({ status: 200, statusText: 'OK', url: 'http://h/api/task', headers: [['content-type', 'application/json']] }, '{"ok":true,"n":1}') : null;
  const res = await appFetch('http://h/api/task', { method: 'POST', headers: { Authorization: 'Bearer t', 'Content-Type': 'application/json' }, body: '{"a":1}' });
  const sent = calls.find(c => c.cmd === 'pooled_fetch')?.args?.request;
  ck('desktop sends through pooled_fetch with method, url, headers and body bytes',
    !!sent && sent.method === 'POST' && sent.url === 'http://h/api/task'
    && sent.headers.some(([k, v]: [string, string]) => k === 'authorization' && v === 'Bearer t')
    && new TextDecoder().decode(new Uint8Array(sent.data)) === '{"a":1}');
  ck('desktop pooled response is readable as JSON', res.ok && (await res.json()).n === 1);
  ck('pooled path never touches the per-request plugin client', !calls.some(c => c.cmd.startsWith('plugin:http|')));
  ck('pooled request carries a cancellable id and the redirect policy', /^pooled-/.test(sent.requestId) && sent.redirect === 'follow');

  calls.length = 0;
  await appFetch('http://h/api/users/u/avatar/v.png', { redirect: 'error', maxBytes: 8 * 1024 * 1024 } as RequestInit & { maxBytes: number });
  const guarded = calls.find(c => c.cmd === 'pooled_fetch')?.args?.request;
  ck('redirect:error and maxBytes reach the native request', guarded?.redirect === 'error' && guarded?.maxBytes === 8 * 1024 * 1024);

  calls.length = 0;
  let finishSlow: ((value: unknown) => void) | null = null;
  answer = (cmd: string) => cmd === 'pooled_fetch' ? new Promise(resolve => { finishSlow = resolve; }) : null;
  const aborting = new AbortController();
  const slow = appFetch('http://h/slow', { signal: aborting.signal });
  await new Promise(resolve => setTimeout(resolve, 10));
  aborting.abort();
  let aborted: unknown = null;
  try { await slow; } catch (error) { aborted = error; }
  const cancelCall = calls.find(c => c.cmd === 'pooled_fetch_cancel');
  const slowRequestId = calls.find(c => c.cmd === 'pooled_fetch')?.args?.request?.requestId;
  ck('abort rejects the caller and cancels the native request id', String(aborted) === 'Error: Request cancelled' && !!cancelCall && cancelCall.args.requestId === slowRequestId);
  finishSlow?.(null);
  // Restore the default frame answer for the tests below (a leftover pending answer would hang them).
  answer = (cmd: string) => cmd === 'pooled_fetch' ? frame({ status: 200, statusText: 'OK', url: 'http://h/api/status', headers: [['content-type', 'application/json']] }, '{"ok":true}') : null;

  ck('body-cap and cancel errors never fall back to the plugin', ['pooled_fetch/too_large: body exceeds 8388608 bytes', 'pooled_fetch/cancelled'].every(message => pooledErrorAction(message, 'POST').fallback === false));

  calls.length = 0;
  const bodyless = await appFetch('http://h/api/status');
  ck('GET without a body sends data: null', calls[0]?.args?.request?.data === null && bodyless.ok);

  // Errors: fall back to the plugin when that cannot double-send; a POST that may have landed
  // surfaces its error instead of being replayed.
  const pluginAnswer = (cmd: string) => {
    if (cmd === 'plugin:http|fetch') return 101;
    if (cmd === 'plugin:http|fetch_send') return { status: 200, statusText: 'OK', url: 'http://h/x', headers: [['content-type', 'application/json']], rid: 102 };
    if (cmd === 'plugin:http|fetch_read_body') { const first = calls.filter(c => c.cmd === cmd).length === 1; return first ? [...new TextEncoder().encode('{"via":"plugin"}'), 0] : [1]; }
    return null;
  };
  const failWith = (msg: string) => (cmd: string) => { if (cmd === 'pooled_fetch') throw msg; return pluginAnswer(cmd); };

  calls.length = 0;
  answer = failWith('pooled_fetch/maybe_sent: error sending request for url (http://h/api/task)');
  let err: unknown = null;
  try { await appFetch('http://h/api/task', { method: 'POST', body: '{}' }); } catch (e) { err = e; }
  ck('POST that may have been sent rejects with the plain reqwest message', err === 'error sending request for url (http://h/api/task)');
  ck('POST that may have been sent is not replayed through the plugin', !calls.some(c => c.cmd.startsWith('plugin:http|')));

  calls.length = 0;
  answer = failWith('pooled_fetch/maybe_sent: error decoding response body');
  const getRetry = await appFetch('http://h/api/status');
  ck('GET that failed mid-flight falls back to the plugin for that request', (await getRetry.json()).via === 'plugin');

  calls.length = 0;
  answer = failWith('pooled_fetch/not_sent: error trying to connect');
  const postRetry = await appFetch('http://h/api/task', { method: 'POST', body: '{"a":1}' });
  const replay = calls.find(c => c.cmd === 'plugin:http|fetch')?.args?.clientConfig;
  ck('POST that never left (connect error) falls back to the plugin with the same body',
    (await postRetry.json()).via === 'plugin' && replay?.method === 'POST' && new TextDecoder().decode(new Uint8Array(replay.data)) === '{"a":1}');

  calls.length = 0;
  answer = failWith('command pooled_fetch not found');
  ck('an unmarked (IPC) failure falls back to the plugin', (await (await appFetch('http://h/x', { method: 'POST', body: '{}' })).json()).via === 'plugin');

  ck('error classifier: maybe_sent HEAD/OPTIONS are retryable', pooledErrorAction('pooled_fetch/maybe_sent: x', 'head').fallback === true && pooledErrorAction('pooled_fetch/maybe_sent: x', 'OPTIONS').fallback === true);
  ck('error classifier: maybe_sent PUT/PATCH/DELETE are not', ['PUT', 'PATCH', 'DELETE'].every(m => pooledErrorAction('pooled_fetch/maybe_sent: x', m).fallback === false));

  // Kill switch: off → plugin only, pooled_fetch never invoked.
  const store = new Map<string, string>();
  const hadLs = 'localStorage' in g; const origLs = g.localStorage;
  g.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); }, removeItem: (k: string) => { store.delete(k); } };
  try {
    ck('kill switch defaults to on', pooledHttpEnabled() === true);
    setPooledHttpEnabled(false);
    ck('turning it off persists one key', store.get(POOLED_HTTP_OFF_KEY) === '1' && pooledHttpEnabled() === false);
    calls.length = 0;
    answer = (cmd) => cmd === 'pooled_fetch' ? frame({ status: 200, statusText: 'OK', url: 'http://h/x', headers: [] }, '{"via":"pooled"}') : pluginAnswer(cmd);
    const off = await appFetch('http://h/x');
    ck('switch off: request goes through the plugin and pooled_fetch is never called', (await off.json()).via === 'plugin' && !calls.some(c => c.cmd === 'pooled_fetch'));
    setPooledHttpEnabled(true);
    calls.length = 0;
    ck('switch back on: pooled again', (await (await appFetch('http://h/x')).json()).via === 'pooled' && !store.has(POOLED_HTTP_OFF_KEY));
    g.localStorage = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); }, removeItem: () => { throw new Error('denied'); } };
    ck('unreadable storage counts as on (and setting it never throws)', pooledHttpEnabled() === true && (setPooledHttpEnabled(false), true));
  } finally {
    if (hadLs) g.localStorage = origLs; else delete g.localStorage;
  }

  // Abort: rejects with the plugin's own message so callers see one shape.
  answer = (cmd) => cmd === 'pooled_fetch' ? new Promise(() => {}) : null;
  const ctrl = new AbortController();
  const pending = appFetch('http://h/slow', { signal: ctrl.signal }).then(() => 'resolved', (e) => String(e?.message ?? e));
  setTimeout(() => ctrl.abort(), 5);
  ck('abort rejects a pending pooled request with "Request cancelled"', (await pending) === 'Request cancelled');

  // A shell that does not answer pooled_fetch (test stubs) falls back to the plugin.
  calls.length = 0;
  let rid = 0;
  answer = (cmd) => {
    if (cmd === 'pooled_fetch') return null;
    if (cmd === 'plugin:http|fetch') return ++rid;
    if (cmd === 'plugin:http|fetch_send') return { status: 200, statusText: 'OK', url: 'http://h/x', headers: [['content-type', 'application/json']], rid: ++rid };
    if (cmd === 'plugin:http|fetch_read_body') { const once = calls.filter(c => c.cmd === cmd).length === 1; return once ? [...new TextEncoder().encode('{"via":"plugin"}'), 0] : [1]; }
    return null;
  };
  const fallback = await appFetch('http://h/x');
  ck('shell without pooled_fetch falls back to the plugin', (await fallback.json()).via === 'plugin' && calls.some(c => c.cmd === 'plugin:http|fetch'));
} finally {
  delete g.__TAURI_INTERNALS__;
  if (hadWindow) g.window = origWindow; else delete g.window;
}

console.log(`\n${passed}/${total} passed`);
if (passed !== total) process.exit(1);
