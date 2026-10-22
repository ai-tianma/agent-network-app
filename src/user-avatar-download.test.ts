import assert from 'node:assert/strict';
import { acquireUserAvatarWith, fetchUserAvatarBytes, type AvatarResource } from './user-avatar-download';

const cfg = { serverUrl: 'https://hub.example.test', token: 'fixture-token' };
const path = '/api/users/user-a/avatar/version_1.png';
let n = 0;
const check = (name: string, condition: boolean) => { assert(condition, name); n++; console.log('PASS', name); };
let loads = 0, disposals = 0;
let resolve!: (resource: AvatarResource) => void;
const loader = async (url: string, token: string) => {
  loads++;
  assert.equal(url, cfg.serverUrl + path); assert.equal(token, cfg.token);
  return new Promise<AvatarResource>(done => { resolve = done; });
};
const first = acquireUserAvatarWith(cfg, path, loader);
const second = acquireUserAvatarWith(cfg, path, loader);
await Promise.resolve();
check('concurrent same Hub/token/path authorizations single-flight', loads === 1);
resolve({ uri: 'file:///unique-temp.png', dispose: () => { disposals++; } });
const [a, b] = await Promise.all([first, second]);
check('concurrent mounts share authorized ephemeral pixels', a.uri === b.uri);
a.release(); a.release(); check('release is idempotent, other mount still owns resource', disposals === 0);
b.release(); check('last unmount disposes shared pixels', disposals === 1);
let sequential = 0;
const immediate = async () => ({ uri: `blob:fresh-${++sequential}`, dispose: () => { disposals++; } });
const c = await acquireUserAvatarWith(cfg, path, immediate);
const d = await acquireUserAvatarWith(cfg, path, immediate);
check('resolved downloads never serve as ACL cache even while another mount is live', sequential === 2 && c.uri !== d.uri);
c.release(); d.release();

let failures = 0;
const fail = async () => { failures++; throw new Error('denied'); };
await assert.rejects(acquireUserAvatarWith(cfg, path, fail), /denied/);
await assert.rejects(acquireUserAvatarWith(cfg, path, fail), /denied/);
check('failed authorization is evicted and retried', failures === 2);

let isolated = 0;
const gates: Array<() => void> = [];
const gate = async () => { isolated++; await new Promise<void>(done => gates.push(done)); return { uri: 'blob:isolated', dispose: () => {} }; };
const pending = [
  acquireUserAvatarWith(cfg, path, gate),
  acquireUserAvatarWith({ ...cfg, token: 'another-token' }, path, gate),
  acquireUserAvatarWith({ ...cfg, serverUrl: 'https://another-hub.test' }, path, gate),
  acquireUserAvatarWith(cfg, '/api/users/user-a/avatar/version_2.png', gate),
];
await Promise.resolve();
check('Hub, credential and avatar version isolate in-flight requests', isolated === 4);
gates.forEach(done => done());
(await Promise.all(pending)).forEach(lease => lease.release());

let unsafeLoads = 0;
for (const value of [`https://evil.test${path}`, `${cfg.serverUrl}${path}`, '/api/files/f_123', path + '?token=secret', '//evil.test' + path, path + '\n']) {
  await assert.rejects(acquireUserAvatarWith(cfg, value, async () => { unsafeLoads++; throw new Error('must not fetch'); })); n++;
}
await assert.rejects(acquireUserAvatarWith({ ...cfg, token: '' }, path, gate));
check('unsafe paths/missing credential never start a download', unsafeLoads === 0 && isolated === 4);

const png = new Uint8Array(24);
png.set([137, 80, 78, 71, 13, 10, 26, 10]); png.set([73, 72, 68, 82], 12);
const view = new DataView(png.buffer); view.setUint32(16, 1); view.setUint32(20, 1);
const requests: RequestInit[] = [];
const fetcher = (async (url, init) => {
  assert.equal(url, cfg.serverUrl + path); requests.push(init!);
  return new Response(png, { headers: { 'Content-Type': 'image/png' } });
}) as typeof fetch;
assert.deepEqual(await fetchUserAvatarBytes(fetcher, cfg.serverUrl + path, cfg.token), png); n++;
check('credential is a header only; network cache/redirects disabled', (requests[0].headers as Record<string, string>).Authorization === `Bearer ${cfg.token}`
  && requests[0].cache === 'no-store' && requests[0].redirect === 'error');
for (const status of [401, 403, 404, 500]) {
  await assert.rejects(fetchUserAvatarBytes((async () => new Response('denied', { status })) as typeof fetch, cfg.serverUrl + path, cfg.token), new RegExp(`http_${status}`)); n++;
}
for (const body of [new Uint8Array(), new TextEncoder().encode('<html>login</html>')]) {
  await assert.rejects(fetchUserAvatarBytes((async () => new Response(body)) as typeof fetch, cfg.serverUrl + path, cfg.token), /invalid_png/); n++;
}
for (const width of [0, 513]) {
  view.setUint32(16, width);
  await assert.rejects(fetchUserAvatarBytes((async () => new Response(png)) as typeof fetch, cfg.serverUrl + path, cfg.token), /invalid_size/); n++;
}
console.log(`${n}/${n} passed`);
