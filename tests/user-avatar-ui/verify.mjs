import { writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { run } from '../agent-org-ui/harness.mjs';

const out = new URL('./artifacts/', import.meta.url);
const token = 'Bearer utok_local_fixture_only';
function png(width, height, blue) {
  const image = new PNG({ width, height });
  for (let i = 0; i < image.data.length; i += 4) {
    image.data[i] = blue ? 32 : 220;
    image.data[i + 1] = 100;
    image.data[i + 2] = blue ? 230 : 48;
    image.data[i + 3] = 255;
  }
  return PNG.sync.write(image);
}
const original = png(64, 64, false);
const large = png(1200, 800, true);

await run(out.pathname, async ({ c, page, test, shot, navigate, state }) => {
  const el = id => page.getByTestId(id);
  const uploads = [], downloads = [], requests = [], profiles = [], responses = [];
  let avatar = '/api/users/self/avatar/old.png', bytes = original, status = 200;
  await page.addInitScript(() => {
    window.__avatarFetches = [];
    window.__avatarRequests = [];
    const NativeRequest = window.Request;
    window.Request = class extends NativeRequest {
      constructor(input, init) {
        super(input, init);
        window.__avatarRequests.push({ url: this.url, cache: this.cache, redirect: this.redirect });
      }
    };
    const fetcher = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : input.url;
      window.__avatarFetches.push({ url, cache: init?.cache, redirect: init?.redirect });
      return fetcher(input, init);
    };
  });
  page.on('request', req => requests.push({ url: req.url(), method: req.method() }));
  page.on('response', response => {
    if (/\/api\/users\/self\/avatar\//.test(response.url())) responses.push({ url: response.url(), status: response.status(), cacheControl: response.headers()['cache-control'], type: response.headers()['content-type'] });
  });
  await page.route('**/api/auth/me', async route => {
    const response = await route.fetch();
    const body = await response.json();
    body.user.avatar_url = avatar;
    profiles.push(structuredClone(body.user));
    await route.fulfill({ response, json: body });
  });
  await page.route('**/api/users/self/avatar/*.png', async route => {
    const req = route.request();
    const authorized = req.headers().authorization === token;
    downloads.push({ url: req.url(), method: req.method(), authorized });
    await route.fulfill({ status: authorized ? 200 : 401, contentType: authorized ? 'image/png' : 'application/json', headers: { 'cache-control': 'no-store' }, body: authorized ? bytes : Buffer.from('{"error":"unauthorized"}') });
  });
  await page.route('**/api/auth/me/avatar/upload', async route => {
    const req = route.request();
    const entry = { method: req.method(), url: req.url(), authorized: req.headers().authorization === token, contentType: req.headers()['content-type'], status };
    try {
      const form = await new Request(req.url(), { method: 'POST', headers: { 'content-type': entry.contentType }, body: req.postDataBuffer() }).formData();
      const file = form.get('file');
      const uploaded = Buffer.from(await file.arrayBuffer());
      const decoded = PNG.sync.read(uploaded);
      Object.assign(entry, { fields: [...form.keys()], name: file.name, type: file.type, size: uploaded.length, width: decoded.width, height: decoded.height, pixel: [...decoded.data.subarray(0, 4)] });
      if (status === 200 && entry.authorized && entry.method === 'POST') { bytes = uploaded; avatar = `/api/users/self/avatar/v${uploads.length + 1}.png`; }
    } catch (e) { entry.error = e.message; }
    uploads.push(entry);
    await new Promise(resolve => setTimeout(resolve, 180));
    await route.fulfill({ status: entry.authorized ? status : 401, contentType: 'application/json', headers: { 'cache-control': 'no-store' }, body: JSON.stringify(status === 200 ? { ok: true, user_id: 'self', avatar_url: avatar } : { ok: false, error: `fixture_${status}` }) });
  });
  const account = async () => {
    if (c.phone) { await el('settings-back').click(); await el('settings-row-account').click(); }
    else await el('settings-sidebar').getByText('账号', { exact: true }).click();
    await el('user-avatar-upload').waitFor();
    await page.waitForFunction(() => {
      const root = document.querySelector('[data-testid="user-avatar-preview"]');
      const img = root?.matches('img') ? root : root?.querySelector('img');
      return img?.complete && img.naturalWidth > 0;
    });
  };
  const preview = () => el('user-avatar-preview').evaluate(root => {
    const img = root.matches('img') ? root : root.querySelector('img');
    return img?.currentSrc || img?.src || '';
  });
  const select = async file => {
    const pending = page.waitForEvent('filechooser');
    await el('user-avatar-upload').click();
    const chooser = await pending;
    test(`real Expo DocumentPicker input ${file.name}`, await chooser.element().getAttribute('type') === 'file' && !chooser.isMultiple());
    await chooser.element().setInputFiles(file);
    await el('user-avatar-message').waitFor();
    await page.waitForFunction(() => !document.querySelector('[data-testid="user-avatar-progress"]'));
  };
  const valid = { name: 'large-fixture.png', mimeType: 'image/png', buffer: large };
  const message = () => el('user-avatar-message').innerText();
  try {
    await navigate('users');
    test('full App user-management harness navigation', await el('user-management').isVisible());
    await account();
    test('initial protected avatar decoded', (await preview()).startsWith('blob:') && downloads.some(d => d.url.endsWith('/old.png') && d.authorized));
    await shot('initial');
    const before = await preview();
    await select(valid);
    const upload = uploads.at(-1);
    test('atomic authenticated multipart PNG POST', upload?.method === 'POST' && upload.authorized && upload.contentType.startsWith('multipart/form-data; boundary=') && upload.fields.length === 1 && upload.fields[0] === 'file' && upload.name === 'avatar.png' && upload.type === 'image/png', upload);
    test('actual image preparation resizes 1200x800 to 512x341', upload?.width === 512 && upload.height === 341 && upload.size < large.length && upload.pixel.join(',') === '32,100,230,255');
    await page.waitForFunction(old => {
      const root = document.querySelector('[data-testid="user-avatar-preview"]');
      const img = root?.matches('img') ? root : root?.querySelector('img');
      return img?.complete && img.naturalWidth > 0 && img.src !== old;
    }, before);
    test('receipt displays new decoded preview and success', await preview() !== before && await message() === '已保存到 Hub' && downloads.some(d => d.url.endsWith('/v1.png') && d.authorized));
    await shot('uploaded');
    // Remount through real Settings navigation to verify persisted profile reads.
    if (c.phone) { await el('settings-back').click(); await el('settings-row-users').click(); }
    else await el('settings-sidebar').getByText('用户管理', { exact: true }).click();
    await account();
    test('user profile reread contains committed avatar', profiles.at(-1)?.avatar_url === '/api/users/self/avatar/v1.png' && (await preview()).startsWith('blob:'));
    const committed = await preview();
    for (const code of [404, 405, 500]) {
      status = code;
      const count = uploads.length;
      await select(valid);
      test(`HTTP ${code} message and unchanged preview/profile`, (await message()).includes(code === 500 ? '未覆盖当前显示' : '尚不支持本地头像上传') && await preview() === committed && avatar === '/api/users/self/avatar/v1.png' && uploads.length === count + 1);
      await shot(`http-${code}`);
    }
    status = 200;
    for (const [file, expected] of [
      [{ name: 'corrupt.png', mimeType: 'image/png', buffer: Buffer.from('not a PNG') }, '无法解码'],
      [{ name: 'unsupported.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>') }, '请选择 JPEG'],
      [{ name: 'oversize.png', mimeType: 'image/png', buffer: Buffer.concat([large, Buffer.alloc(8 * 1024 * 1024)]) }, '不超过 8 MiB'],
      [{ name: 'empty.png', mimeType: 'image/png', buffer: Buffer.alloc(0) }, '不超过 8 MiB'],
    ]) {
      const count = uploads.length, mutations = requests.filter(r => r.method !== 'GET').length;
      await select(file);
      test(`${file.name} rejected before network mutation`, (await message()).includes(expected) && uploads.length === count && requests.filter(r => r.method !== 'GET').length === mutations && await preview() === committed);
    }
    await shot('invalid-file');
    const count = uploads.length;
    const pending = page.waitForEvent('filechooser');
    await el('user-avatar-upload').click();
    const chooser = await pending;
    test('selection opens without network mutation', uploads.length === count && await preview() === committed);
    // Native chooser dismissal is outside Playwright; exercise Expo's real cancel listener.
    await chooser.element().dispatchEvent('cancel');
    await page.waitForTimeout(250);
    test('picker cancellation leaves avatar and network unchanged', uploads.length === count && await preview() === committed && avatar === '/api/users/self/avatar/v1.png');
    test('picker cancellation releases busy state', await el('user-avatar-upload').getAttribute('aria-disabled') !== 'true' && await el('user-avatar-progress').count() === 0);
    await shot('cancelled');
    test('responsive page has no horizontal overflow', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  } finally {
    const s = await state();
    const fetches = await page.evaluate(() => window.__avatarFetches || []);
    const constructed = await page.evaluate(() => window.__avatarRequests || []);
    test('no attachment upload or PUT fallback', !requests.some(r => new URL(r.url).pathname === '/api/upload' || r.method === 'PUT') && s.writes.length === 0 && s.unhandled.length === 0);
    test('all avatar GETs authenticated on current Hub', downloads.length > 0 && downloads.every(d => d.authorized && d.method === 'GET' && new URL(d.url).origin === new URL(page.url()).origin));
    // The shared Tauri stub forwards only method/headers/body to browser fetch.
    // Observe original Request intent separately from the actual response contract.
    const avatarRequests = constructed.filter(f => /\/api\/users\/self\/avatar\//.test(f.url));
    test('App constructs protected GET with no-store and redirect error', avatarRequests.length > 0 && avatarRequests.every(f => f.cache === 'no-store' && f.redirect === 'error'), avatarRequests);
    test('protected PNG responses have no-store', responses.length > 0 && responses.every(r => r.status === 200 && r.cacheControl === 'no-store' && r.type === 'image/png'), responses);
    test('no credentials in any request or rendered image URL', requests.every(r => !/utok_|Bearer|[?&](token|authorization)=/i.test(r.url)) && await page.locator('img').evaluateAll(images => images.every(img => !/utok_|Bearer|[?&](token|authorization)=/i.test(img.src))));
    writeFileSync(new URL(`${c.name}-avatar.json`, out), JSON.stringify({ uploads, downloads, profiles, fetches, constructed, responses, requests }, null, 2));
  }
});
