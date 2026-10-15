import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const workflow = readFileSync('.github/workflows/ios-testflight-status.yml', 'utf8');
const start = workflow.indexOf(`          if [ "$INCLUDE_APP_STORE_VERSIONS" = 'true' ]; then`);
const end = workflow.indexOf('          builds_json=', start);
assert(start > 0 && end > start);
const block = workflow.slice(start, end).replace(/^          /gm, '');
const dir = mkdtempSync(join(tmpdir(), 'ios-store-status-'));
try {
  const fixture = join(dir, 'fixture.json');
  const calls = join(dir, 'calls');
  const run = (enabled, body) => {
    rmSync(calls, { force: true });
    writeFileSync(fixture, JSON.stringify(body));
    const result = spawnSync('bash', ['-eu', '-c', `
      app_id=fixture-app
      asc_get() { test "$1" = apps/fixture-app/appStoreVersions; echo GET > "$CALLS"; cat "$FIXTURE"; }
      asc_write() { echo unexpected-write >&2; exit 99; }
      ${block}
    `], { env: { ...process.env, RUNNER_TEMP: dir, INCLUDE_APP_STORE_VERSIONS: String(enabled),
      CALLS: calls, FIXTURE: fixture }, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  };
  assert.equal(run(false, {}), '');
  assert.equal(existsSync(calls), false, 'disabled mode must make no App Store request');
  const body = { data: [{ id: 'version-1', attributes: {
    versionString: '0.2.259', appStoreState: 'PREPARE_FOR_SUBMISSION',
    appVersionState: 'PREPARE_FOR_SUBMISSION', downloadable: false,
    demoAccountPassword: 'secret-marker',
  }, relationships: { build: { data: { id: 'build-128' } } } }],
  included: [{ type: 'builds', id: 'build-128', attributes: {
    version: '128', processingState: 'VALID', expired: false, privateField: 'secret-marker',
  } }, { type: 'appStoreReviewDetails', attributes: { demoAccountPassword: 'secret-marker' } }],
  links: { next: null } };
  const output = run(true, body);
  assert.equal(readFileSync(calls, 'utf8').trim(), 'GET');
  assert(!output.includes('secret-marker'), 'private fields must not reach output');
  const snapshot = JSON.parse(output.slice(output.indexOf('{')));
  assert.equal(snapshot.complete, true);
  assert.equal(snapshot.versions[0].version, '0.2.259');
  assert.equal(snapshot.versions[0].state, 'PREPARE_FOR_SUBMISSION');
  assert.equal(snapshot.versions[0].buildId, 'build-128');
  assert.deepEqual(snapshot.builds, [{ id: 'build-128', version: '128', processingState: 'VALID', expired: false }]);
  body.links.next = 'https://api.appstoreconnect.apple.com/v1/apps/fixture-app/appStoreVersions?cursor=next';
  const partial = run(true, body);
  assert.equal(JSON.parse(partial.slice(partial.indexOf('{'))).complete, false);
  const empty = run(true, { data: [], links: {} });
  assert.deepEqual(JSON.parse(empty.slice(empty.indexOf('{'))).versions, []);
  console.log('PASS: workflow App Store query is optional, read-only, sanitized and marks partial lists');
} finally { rmSync(dir, { recursive: true, force: true }); }
