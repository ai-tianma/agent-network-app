import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MAX_USER_AVATAR_BYTES, postUserAvatarWith, uploadUserAvatarWith, userAvatarPath, UserAvatarUnsupportedError, validateUserAvatarFile } from './user-avatar-upload';
import { fetchAuthMe, forgetAuthMe, HubRequestError } from './user-admin-api';
import type { PickedImage } from './attach';
import type { HubConfig } from './api';

const cfg = { serverUrl: 'https://hub.example.test', token: 'fixture-token', networkId: 'net-a', profileId: 'profile-a' };
const image: PickedImage = { uri: 'file:///cache/avatar.png', fileName: 'avatar.png', mimeType: 'image/png', fileSize: 10 };
const path = '/api/users/user-a/avatar/v_123.png';
let n = 0;
const check = (name: string, condition: boolean) => { assert(condition, name); n++; console.log('PASS', name); };
for (const size of [1, MAX_USER_AVATAR_BYTES]) validateUserAvatarFile({ ...image, fileSize: size });
for (const size of [undefined, 0, -1, NaN, Infinity, MAX_USER_AVATAR_BYTES + 1]) {
  assert.throws(() => validateUserAvatarFile({ ...image, fileSize: size })); n++;
}
for (const mimeType of ['image/svg+xml', 'image/gif', 'text/plain', 'image/heic', '']) {
  assert.throws(() => validateUserAvatarFile({ ...image, mimeType })); n++;
}
assert.throws(() => validateUserAvatarFile({ ...image, webFile: new Blob([new Uint8Array(MAX_USER_AVATAR_BYTES + 1)]) })); n++;
assert.deepEqual(userAvatarPath(path), { path, userId: 'user-a', version: 'v_123' }); n++;
for (const value of [null, {}, `https://evil.test${path}`, `${cfg.serverUrl}${path}`, '//evil.test' + path, '/api/files/f_123',
  path + '?token=secret', path + '#x', path + '\n', '/api/users/../avatar/v.png', '/api/users/%61/avatar/v.png',
  '/api/users/a/avatar/../v.png', '/api/users/a/avatar/v.svg', '/api/users/a/avatar/v%2f.png',
  '/api/users/a/avatar/.png', '/api/users/a/avatar/' + 'x'.repeat(129) + '.png']) {
  check('unsafe protected path rejected ' + String(value), userAvatarPath(value) === null);
}

let calls: Array<{ url: string; token: string }> = [];
const send = async (url: string, picked: PickedImage, token: string) => {
  calls.push({ url, token }); assert.equal(picked, image);
  return { status: 200, body: JSON.stringify({ ok: true, user_id: 'user-a', avatar_url: path }) };
};
assert.equal(await postUserAvatarWith(cfg, 'user-a', image, send), path); n++;
check('one dedicated atomic POST; no network attribution or credential URL', calls.length === 1
  && calls[0].url === `${cfg.serverUrl}/api/auth/me/avatar/upload` && calls[0].token === cfg.token);
for (const status of [404, 405]) {
  await assert.rejects(postUserAvatarWith(cfg, 'user-a', image, async () => ({ status, body: '<html>old Hub</html>' })),
    e => e instanceof UserAvatarUnsupportedError && e.status === status); n++;
}
for (const status of [400, 401, 403, 413, 415, 500]) {
  await assert.rejects(postUserAvatarWith(cfg, 'user-a', image, async () => ({ status, body: '{}' })),
    e => e instanceof HubRequestError && !(e instanceof UserAvatarUnsupportedError) && e.status === status); n++;
}
for (const receipt of [null, {}, { ok: false }, { ok: true, user_id: 'other', avatar_url: path },
  { ok: true, user_id: 'user-a', avatar_url: '/api/users/other/avatar/v.png' },
  { ok: true, user_id: 'user-a', avatar_url: `${cfg.serverUrl}${path}` },
  { ok: true, user_id: 'user-a', avatar_url: '/api/files/f123' }]) {
  await assert.rejects(postUserAvatarWith(cfg, 'user-a', image, async () => ({ status: 200, body: JSON.stringify(receipt) }))); n++;
}
await assert.rejects(postUserAvatarWith(cfg, 'user-a', image, async () => ({ status: 200, body: '<html>not an API</html>' }))); n++;
for (const [id, picked] of [['', image], ['../other', image], ['user-a', { ...image, mimeType: 'image/jpeg' }]] as const) {
  await assert.rejects(postUserAvatarWith(cfg, id, picked, async () => { throw new Error('must not send'); }), e => (e as Error).message !== 'must not send'); n++;
}

// Only the saved account's /auth/me cache is invalidated, after receipt validation.
const original = globalThis.fetch;
let reads = 0;
try {
  globalThis.fetch = (async () => { reads++; return Response.json({ user: { user_id: 'user-a' } }); }) as typeof fetch;
  forgetAuthMe();
  const other = { ...cfg, token: 'other-token' };
  await fetchAuthMe(cfg); await fetchAuthMe(other);
  await assert.rejects(postUserAvatarWith(cfg, 'user-a', image, async () => ({ status: 404, body: '' })));
  await fetchAuthMe(cfg); check('unsupported leaves identity cache intact', reads === 2);
  await postUserAvatarWith(cfg, 'user-a', image, send);
  await fetchAuthMe(other); check('other account cache preserved', reads === 2);
  await fetchAuthMe(cfg); check('successful atomic upload invalidates self cache', reads === 3);
} finally { globalThis.fetch = original; forgetAuthMe(); }

function fixture() {
  const events: string[] = [];
  let active = true;
  const deps = {
    pick: async (): Promise<PickedImage | null> => { events.push('pick'); return image; },
    prepare: async (picked: PickedImage) => { assert.equal(picked, image); events.push('prepare'); return image; },
    upload: async (account: HubConfig, id: string, picked: PickedImage) => {
      assert.equal(account, cfg); assert.equal(id, 'user-a'); assert.equal(picked, image); events.push('upload'); return path;
    },
    active: () => active,
    stage: (stage: string) => { events.push(stage); },
  };
  return { deps, events, deactivate: () => { active = false; } };
}
{
  const { deps, events } = fixture();
  assert.equal(await uploadUserAvatarWith(cfg, 'user-a', deps), path);
  assert.deepEqual(events, ['pick', 'preparing', 'prepare', 'uploading', 'upload']); n++;
}
{
  const { deps, events } = fixture(); deps.pick = async () => null;
  check('cancel is silent, no upload', await uploadUserAvatarWith(cfg, 'user-a', deps) === undefined && !events.length);
}
for (const phase of ['prepare', 'upload'] as const) {
  const { deps } = fixture(); deps[phase] = async () => { throw new Error('fixture failure'); };
  await assert.rejects(uploadUserAvatarWith(cfg, 'user-a', deps), /fixture failure/); n++;
}
for (const phase of ['pick', 'prepare', 'upload'] as const) {
  const { deps, deactivate } = fixture();
  if (phase === 'pick') deps.pick = async () => { deactivate(); return image; };
  if (phase === 'prepare') deps.prepare = async () => { deactivate(); return image; };
  if (phase === 'upload') deps.upload = async () => { deactivate(); return path; };
  check('disposed editor stops after ' + phase, await uploadUserAvatarWith(cfg, 'user-a', deps) === undefined);
}
{
  const disposed: string[] = [];
  const { deps } = fixture(); deps.dispose = image => { disposed.push(image.uri); };
  await uploadUserAvatarWith(cfg, 'user-a', deps);
  check('picker cache copy disposed after a successful upload (picked + prepared)', disposed.length === 2 && disposed.every(uri => uri === image.uri));
}
{
  const disposed: string[] = [];
  const { deps } = fixture(); deps.dispose = image => { disposed.push(image.uri); };
  deps.prepare = async () => { throw new Error('decode failed'); };
  await assert.rejects(uploadUserAvatarWith(cfg, 'user-a', deps), /decode failed/);
  check('picker cache copy disposed when preparation fails', disposed.length === 1 && disposed[0] === image.uri);
}
{
  const disposed: string[] = [];
  const { deps } = fixture(); deps.dispose = image => { disposed.push(image.uri); };
  deps.upload = async () => { throw new Error('upload failed'); };
  await assert.rejects(uploadUserAvatarWith(cfg, 'user-a', deps), /upload failed/);
  check('picker cache copy disposed when upload fails', disposed.length === 2);
}
{
  const disposed: string[] = [];
  const { deps, deactivate } = fixture(); deps.dispose = image => { disposed.push(image.uri); };
  deps.pick = async () => { deactivate(); return image; };
  check('superseded pick is disposed without preparing', await uploadUserAvatarWith(cfg, 'user-a', deps) === undefined && disposed.length === 1);
}

const source = (name: string) => readFileSync(new URL(name, import.meta.url), 'utf8');
const editor = source('./UserAvatarEditor.tsx');
const local = source('./user-avatar-local.ts');
const picture = source('./UserAvatarImage.tsx');
check('editor wires dedicated atomic upload, not attachment upload or second save', editor.includes('upload: uploadLocalUserAvatar, active:') && !editor.includes('uploadImage') && !editor.includes('save: putUserAvatar'));
check('no general upload fallback anywhere in avatar uploader', !local.includes('/api/upload') && !local.includes('uploadImage') && !source('./user-avatar-upload.ts').includes('/api/upload'));
check('multipart has exactly file, PNG, authenticated web/native transport', local.includes("body.append('file', prepared.webFile, 'avatar.png')") && local.includes("fieldName: 'file', mimeType: 'image/png', parameters: {}") && local.includes('FileSystem.createUploadTask') && local.includes('await appFetch(url,'));
check('UI success awaits receipt and unsupported is truthful', editor.includes('const avatar = await uploadUserAvatarWith') && editor.includes("'userAvatar.uploadUnsupported'"));
check('picker is single-file cached non-base64', local.includes('multiple: false, copyToCacheDirectory: true, base64: false'));
check('native manipulation uses URI and releases decoded images', local.includes('const uri = image.uri') && local.includes('ImageManipulator.manipulate(uri).resize(size)') && local.includes('ref.release()') && local.includes('context.release()'));
check('protected renderer uses leases, ephemeral native bytes, no attachment cache', picture.includes('acquireUserAvatarWith(') && picture.includes('writeAsStringAsync') && picture.includes('deleteAsync') && !picture.includes('downloadAttachmentWith') && !picture.includes('getInfoAsync'));
check('settings preview supplies current token', editor.includes('hubUrl={cfg.serverUrl} token={cfg.token}'));
check('picker cache cleanup is wired into the real upload lifecycle', local.includes('export async function disposePickedImage') && local.includes('FileSystem.deleteAsync(uri, { idempotent: true })') && editor.includes('dispose: disposePickedImage') && source('./user-avatar-upload.ts').includes('await deps.dispose?.(image)'));
console.log(`${n}/${n} passed`);
