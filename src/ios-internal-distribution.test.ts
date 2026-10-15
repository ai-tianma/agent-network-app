import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generateKeyPairSync } from 'node:crypto';
import { ascUrl, createAscRequest, distributeInternalBuild } from '../scripts/ios-distribute-internal.mjs';

let passed = 0, total = 0;
async function check(name, fn) {
  total++;
  try { await fn(); passed++; console.log(`PASS: ${name}`); }
  catch (error) { console.error(`FAIL: ${name}: ${error.message}`); }
}

function fixture(options = {}) {
  let clock = 0, polls = 0, attached = options.attached ?? false;
  const writes = [];
  const request = async (method, value, body, timeoutMs) => {
    assert(timeoutMs > 0 && timeoutMs <= 20_000);
    const url = new URL(value);
    const path = url.pathname.slice('/v1/'.length);
    if (method === 'POST') {
      assert.equal(path, 'betaGroups/internal/relationships/builds');
      assert.deepEqual(body, { data: [{ type: 'builds', id: 'build-128' }] });
      writes.push(path);
      if (options.postError) throw new Error('ASC POST HTTP 403');
      attached = !options.lostReadback;
      return null;
    }
    assert.equal(method, 'GET', 'never PATCH group access or change testers');
    if (path === 'apps') return { data: [{ id: 'app', attributes: { bundleId: 'top.vansin.agentnetwork' } }] };
    if (path === 'builds') {
      polls++;
      if (options.delayed && polls === 1) return { data: [] };
      const state = options.invalid ? 'INVALID' : options.pending || (options.delayed && polls === 2) ? 'PROCESSING' : 'VALID';
      return { data: [{ id: 'build-128', attributes: {
        version: options.wrongVersion ? '127' : '128', processingState: state, expired: options.expired ?? false,
      } }] };
    }
    if (path === 'betaGroups') {
      if (options.noGroups) return { data: [] };
      if (!url.searchParams.has('cursor')) return { data: [{ id: 'public', attributes: { isInternalGroup: false } }],
        links: { next: `${ascUrl('betaGroups')}?cursor=2` } };
      return { data: [
        { id: 'auto', attributes: { isInternalGroup: true, hasAccessToAllBuilds: true } },
        { id: 'internal', attributes: { isInternalGroup: true, hasAccessToAllBuilds: false } },
      ] };
    }
    if (path === 'betaGroups/auto/relationships/builds') return { data: [{ id: 'build-128' }] };
    if (path === 'betaGroups/internal/relationships/builds') return { data: attached ? [{ id: 'build-128' }] : [] };
    throw new Error(`unexpected request ${path}`);
  };
  return { writes, run: buildNumber => distributeInternalBuild({ request, buildNumber: buildNumber ?? '128',
    waitMs: 50, pollMs: 10, now: () => clock, sleep: async ms => { clock += ms; }, log: () => {} }) };
}

await check('wait for visible VALID build, paginate groups, attach Internal only and read back', async () => {
  const f = fixture({ delayed: true });
  const result = await f.run();
  assert.deepEqual(f.writes, ['betaGroups/internal/relationships/builds']);
  assert.deepEqual(result.groups.map(g => g.mode), ['automatic', 'attached']);
});
await check('an already attached build is idempotent', async () => {
  const f = fixture({ attached: true }); await f.run(); assert.deepEqual(f.writes, []);
});
for (const [name, options, pattern] of [
  ['processing timeout', { pending: true }, /timed out/],
  ['wrong build number', { wrongVersion: true }, /timed out/],
  ['expired build', { expired: true }, /expired/],
  ['invalid build', { invalid: true }, /INVALID/],
  ['no internal group', { noGroups: true }, /No internal/],
  ['POST rejection', { postError: true }, /HTTP 403/],
  ['missing readback', { lostReadback: true }, /timed out/],
]) await check(`${name} cannot report successful distribution`, async () => {
  await assert.rejects(fixture(options).run(), pattern);
});
await check('invalid input and foreign pagination cannot reach Apple', async () => {
  await assert.rejects(fixture().run('128;other'), /numeric/);
  assert.throws(() => ascUrl('https://example.invalid/v1/apps'), /expected API/);
});
await check('ASC errors omit bodies and request credentials', async () => {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  let calls = 0;
  const request = createAscRequest({ ASC_KEY_ID: 'fixture', ASC_ISSUER_ID: 'fixture',
    ASC_KEY_BASE64: Buffer.from(privateKey.export({ type: 'pkcs8', format: 'pem' })).toString('base64') },
  async (_url, init) => {
    calls++; assert(init.headers.Authorization.startsWith('Bearer '));
    return { ok: false, status: 403, text: () => { throw new Error('body must not be printed'); } };
  });
  await assert.rejects(request('GET', 'apps', undefined, 100), /^Error: ASC GET \/v1\/apps HTTP 403$/);
  await assert.rejects(request('GET', 'https://example.invalid/v1/apps', undefined, 100), /expected API/);
  assert.equal(calls, 1);
});
await check('upload success wires the same helper inside the existing signing job', async () => {
  const build = readFileSync('.github/workflows/ios-build.yml', 'utf8');
  const recovery = readFileSync('.github/workflows/ios-testflight-status.yml', 'utf8');
  const upload = build.indexOf('- name: Upload to TestFlight (altool)');
  const distribution = build.indexOf('- name: Distribute uploaded build to all internal TestFlight groups');
  const cleanup = build.indexOf('- name: Remove local signing material;');
  assert(upload < distribution && distribution < cleanup);
  const block = build.slice(distribution, cleanup);
  assert(block.includes('if: ${{ inputs.upload_testflight }}'));
  assert(block.includes('"$IOS_BUILD_NUMBER"'));
  assert(block.includes('node ios-distribution-tools/scripts/ios-distribute-internal.mjs'));
  const checkout = build.slice(build.indexOf('- name: Checkout internal distribution automation'), distribution);
  assert(checkout.includes('ref: ${{ github.sha }}'));
  assert(checkout.includes('path: ios-distribution-tools'));
  assert(recovery.includes('node ios-distribution-tools/scripts/ios-distribute-internal.mjs "$BUILD_NUMBER"'));
});
console.log(`${passed}/${total} passed`);
process.exit(passed === total ? 0 : 1);
