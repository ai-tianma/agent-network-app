import type { HubConfig } from './api';
import { MAX_USER_AVATAR_BYTES, USER_AVATAR_EDGE, userAvatarPath } from './user-avatar-upload';

export type AvatarResource = { uri: string; dispose: () => void };
type SharedResource = AvatarResource & { refs: number };
const inflight = new Map<string, Promise<SharedResource>>();

/** Only pending authorizations are shared. A later mount always goes back to the Hub. */
export async function acquireUserAvatarWith(cfg: Pick<HubConfig, 'serverUrl' | 'token'>, value: string,
  load: (url: string, token: string) => Promise<AvatarResource>): Promise<{ uri: string; release: () => void }> {
  const avatar = userAvatarPath(value);
  if (!avatar || !cfg.token) throw new Error('avatar_authorization_required');
  const base = cfg.serverUrl.replace(/\/+$/, '');
  const key = JSON.stringify([base, cfg.token, avatar.path]);
  let pending = inflight.get(key);
  if (!pending) {
    pending = Promise.resolve().then(() => load(`${base}${avatar.path}`, cfg.token)).then(resource => ({ ...resource, refs: 0 }));
    inflight.set(key, pending);
    const remove = () => { if (inflight.get(key) === pending) inflight.delete(key); };
    void pending.then(remove, remove);
  }
  const resource = await pending;
  resource.refs++;
  let released = false;
  return { uri: resource.uri, release: () => {
    if (released) return;
    released = true;
    if (--resource.refs === 0) resource.dispose();
  } };
}

/** Read at most `max` bytes from a response body, cancelling the stream as soon as it overflows.
 *  Content-Length is advisory (missing or forged headers must not raise the cap). */
async function readCappedBytes(response: Response, max: number): Promise<Uint8Array> {
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > max) throw new Error('avatar_download_too_large');
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => {});
      throw new Error('avatar_download_too_large');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

export async function fetchUserAvatarBytes(fetcher: typeof fetch, url: string, token: string): Promise<Uint8Array> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30_000);
  try {
    let response: Response;
    try {
      response = await fetcher(url, {
        headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', redirect: 'error', signal: ctrl.signal,
        // Native pooled_fetch enforces this while streaming, before it buffers the body.
        maxBytes: MAX_USER_AVATAR_BYTES,
      } as RequestInit & { maxBytes: number });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/too_large/.test(message)) throw new Error('avatar_download_too_large');
      throw error;
    }
    if (response.status !== 200) throw new Error(`avatar_download_http_${response.status}`);
    if (response.redirected) throw new Error('avatar_download_redirected');
    const length = Number(response.headers.get('Content-Length'));
    if (Number.isFinite(length) && length > MAX_USER_AVATAR_BYTES) throw new Error('avatar_download_too_large');
    const bytes = await readCappedBytes(response, MAX_USER_AVATAR_BYTES);
    if (bytes.length < 24 || bytes.length > MAX_USER_AVATAR_BYTES
        || ![137, 80, 78, 71, 13, 10, 26, 10].every((byte, i) => bytes[i] === byte)
        || String.fromCharCode(...bytes.slice(12, 16)) !== 'IHDR') throw new Error('avatar_download_invalid_png');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const width = view.getUint32(16), height = view.getUint32(20);
    if (!width || !height || width > USER_AVATAR_EDGE || height > USER_AVATAR_EDGE) throw new Error('avatar_download_invalid_size');
    return bytes;
  } finally { clearTimeout(timer); }
}
