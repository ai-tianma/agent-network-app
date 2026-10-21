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
  runAttachTest();
  runCancelTest();
} finally { rmSync(dir, { recursive: true, force: true }); }

/**
 * The attach step can PATCH an App Store version, so it gets its own tests:
 * it must refuse a version that is under review, refuse any build that cannot
 * be reviewed, and — only then — write exactly one PATCH with the right body.
 */
function runAttachTest() {
  const start = workflow.indexOf(`          if [ -n "$ATTACH_APP_STORE_VERSION" ]; then`);
  const end = workflow.indexOf('          groups_json=', start);
  assert(start > 0 && end > start, 'attach block not found in the workflow');
  const block = workflow.slice(start, end).replace(/^          /gm, '');

  const dir = mkdtempSync(join(tmpdir(), 'ios-attach-'));
  try {
    const calls = join(dir, 'calls');
    const writeBody = join(dir, 'write-body');
    const versions = join(dir, 'versions.json');
    const builds = join(dir, 'builds.json');
    const one = join(dir, 'one.json');

    const versionDoc = (state, buildId) => ({ data: [{
      type: 'appStoreVersions', id: 'version-1',
      attributes: { versionString: '1.0', appStoreState: state, appVersionState: state, downloadable: true },
      relationships: { build: { data: { type: 'builds', id: buildId } } } }] });
    const buildDoc = (over = {}) => ({ data: [{ type: 'builds', id: 'build-151',
      attributes: { version: '151', processingState: 'VALID', expired: false,
        buildAudienceType: 'APP_STORE_ELIGIBLE', ...over } }] });

    const run = ({ version, build, attach, state = 'REJECTED', shape = 'document' }) => {
      rmSync(calls, { force: true });
      rmSync(writeBody, { force: true });
      writeFileSync(versions, JSON.stringify(versionDoc(state, 'build-3')));
      writeFileSync(builds, JSON.stringify(build));
      const resource = { type: 'appStoreVersions', id: 'version-1',
        attributes: { versionString: '1.0', appStoreState: state },
        relationships: { build: { data: { type: 'builds', id: 'build-151' } } } };
      // The single-resource GET answers with a JSON:API document when `include=` is
      // used, and with the bare resource otherwise. Both shapes exist in the wild.
      writeFileSync(one, JSON.stringify(shape === 'document' ? { data: resource, included: [] } : resource));
      const result = spawnSync('bash', ['-eu', '-c', `
        app_id=fixture-app
        build_id=build-151
        BUILD_NUMBER=151
        ATTACH_APP_STORE_VERSION="${attach}"
        builds_json="$BUILDS"
        asc_get() {
          case "$1" in
            apps/fixture-app/appStoreVersions) echo "GET $1" >> "$CALLS"; cat "$VERSIONS";;
            appStoreVersions/version-1) echo "GET $1" >> "$CALLS"; cat "$ONE";;
            *) echo "unexpected GET $1" >&2; exit 98;;
          esac
        }
        asc_write() { echo "$1 $2" >> "$CALLS"; printf '%s' "$3" > "$WRITEBODY"; }
        ${block}
      `], { env: { ...process.env, RUNNER_TEMP: dir, CALLS: calls, WRITEBODY: writeBody,
        VERSIONS: versions, BUILDS: builds, ONE: one }, encoding: 'utf8' });
      return result;
    };

    // 1) no request at all when the input is empty
    let r = run({ version: null, build: buildDoc(), attach: '' });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(existsSync(calls), false, 'empty input must make no App Store request');

    // 2) a version that is under review must not be touched
    r = run({ version: null, build: buildDoc(), attach: '1.0', state: 'WAITING_FOR_REVIEW' });
    assert.notEqual(r.status, 0, 'a version under review must fail the step');
    assert(!existsSync(writeBody), 'a version under review must not be written');

    // 3) an expired build must be refused (this is today's 1.0 problem)
    r = run({ version: null, build: buildDoc({ expired: true }), attach: '1.0' });
    assert.notEqual(r.status, 0, 'an expired build must be refused');
    assert(!existsSync(writeBody), 'an expired build must not be attached');

    // 4) a build that is not APP_STORE_ELIGIBLE must be refused
    r = run({ version: null, build: buildDoc({ buildAudienceType: 'TESTFLIGHT' }), attach: '1.0' });
    assert.notEqual(r.status, 0, 'a TestFlight-only build must be refused');
    assert(!existsSync(writeBody), 'a TestFlight-only build must not be attached');

    // 5) a build that is still processing must be refused
    r = run({ version: null, build: buildDoc({ processingState: 'PROCESSING' }), attach: '1.0' });
    assert.notEqual(r.status, 0, 'a processing build must be refused');

    // 6) a build whose expiry is unknown must be refused (fail closed)
    const unknown = buildDoc();
    delete unknown.data[0].attributes.expired;
    r = run({ version: null, build: unknown, attach: '1.0' });
    assert.notEqual(r.status, 0, 'an unknown expiry must be refused');

    // 7) the happy path: exactly one PATCH, pointing at the inspected build
    r = run({ version: null, build: buildDoc(), attach: '1.0' });
    assert.equal(r.status, 0, r.stderr);
    const callsMade = readFileSync(calls, 'utf8').trim().split('\n');
    assert.deepEqual(callsMade, ['GET apps/fixture-app/appStoreVersions', 'PATCH appStoreVersions/version-1',
      'GET appStoreVersions/version-1'], 'exactly one PATCH, then read back');
    const body = JSON.parse(readFileSync(writeBody, 'utf8'));
    assert.equal(body.data.type, 'appStoreVersions');
    assert.equal(body.data.id, 'version-1');
    assert.equal(body.data.relationships.build.data.id, 'build-151');
    // 8) and it must never submit for review
    assert(!callsMade.some(c => c.includes('appStoreVersionSubmission')), 'must not create a submission');
    // 9) the read-back must print the real fields, not a wall of nulls.
    //    The single-resource GET with `include=` answers with a JSON:API **document**
    //    ({data:{…}}), while without `include` it answers with the bare resource —
    //    both shapes exist, so the read-back has to accept both.
    const readback = JSON.parse(r.stdout.slice(r.stdout.indexOf('{')));
    assert.equal(readback.id, 'version-1');
    assert.equal(readback.version, '1.0');
    assert.equal(readback.state, 'REJECTED');
    assert.equal(readback.buildId, 'build-151');
    // 9b) and the same read-back must work when the API answers with the bare
    //     resource instead of a document.
    r = run({ version: null, build: buildDoc(), attach: '1.0', shape: 'bare' });
    assert.equal(r.status, 0, r.stderr);
    const bare = JSON.parse(r.stdout.slice(r.stdout.indexOf('{')));
    assert.equal(bare.id, 'version-1');
    assert.equal(bare.buildId, 'build-151');
    console.log('PASS: attaching a build to an App Store version is guarded and never submits');
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

/**
 * The cancel step withdraws Beta App Review submissions, so it gets its own
 * tests. What must hold:
 *   - a build number this app does not have ⇒ nothing is cancelled
 *   - only builds STRICTLY OLDER than the one we keep are touched
 *   - only submissions still pending are withdrawn; approved/rejected stay
 *   - the current build's own submission is never touched
 */
function runCancelTest() {
  const start = workflow.indexOf(`          if [ -n "$CANCEL_SUPERSEDED_BETA_REVIEWS" ]; then`);
  const end = workflow.indexOf('          if [ "$INCLUDE_APP_STORE_VERSIONS" = \'true\' ]; then', start);
  assert(start > 0 && end > start, 'cancel block not found in the workflow');
  const block = workflow.slice(start, end).replace(/^          /gm, '');

  const dir = mkdtempSync(join(tmpdir(), 'ios-cancel-'));
  try {
    const calls = join(dir, 'calls');
    const builds = join(dir, 'builds.json');
    const subs = join(dir, 'subs.json');

    // the app's builds: 151, 152, 153 (older) and 154 (the one we keep)
    const appBuilds = { data: [
      { type: 'builds', id: 'b-151', attributes: { version: '151' } },
      { type: 'builds', id: 'b-152', attributes: { version: '152' } },
      { type: 'builds', id: 'b-153', attributes: { version: '153' } },
      { type: 'builds', id: 'b-154', attributes: { version: '154' } },
    ] };
    // every build reports one submission; 153's review is already approved
    // (that one must be left alone).
    const subsFor = (buildId, state = 'IN_REVIEW') => ({ data: [
      { type: 'betaAppReviewSubmissions', id: `sub-${buildId}`,
        attributes: { betaReviewState: state } },
    ] });
    const writeSubs = (states = {}) => {
      for (const [id, state] of Object.entries({ 'b-151': 'IN_REVIEW', 'b-152': 'IN_REVIEW', 'b-153': 'APPROVED', 'b-154': 'IN_REVIEW', ...states })) {
        writeFileSync(join(dir, `src-subs-${id}.json`), JSON.stringify(subsFor(id, state)));
      }
    };

    const run = ({ keep }) => {
      rmSync(calls, { force: true });
      writeFileSync(builds, JSON.stringify(appBuilds));
      const result = spawnSync('bash', ['-eu', '-c', `
        app_id=fixture-app
        BUNDLE_ID=top.vansin.agentnetwork
        jwt=not-a-real-token
        CANCEL_SUPERSEDED_BETA_REVIEWS="${keep}"
        asc_get() {
          case "$1" in
            builds) echo "GET $1" >> "$CALLS"; cat "$BUILDS";;
            betaAppReviewSubmissions)
              echo "GET $1" >> "$CALLS"
              bid=''
              for a in "$@"; do
                case "$a" in
                  *filter\\[build\\]=*) bid=\${a##*=} ;;
                esac
              done
              cat "$RUNNER_TEMP/src-subs-$bid.json" 2>/dev/null || echo '{"data":[]}';;
            *) echo "unexpected GET $1" >&2; exit 98;;
          esac
        }
        curl() {
          # the delete call: record the url, answer 204
          for a in "$@"; do
            case "$a" in
              https://*) echo "DELETE $a" >> "$CALLS";;
            esac
          done
          printf '204'
        }
        ${block}
      `], { env: { ...process.env, RUNNER_TEMP: dir, CALLS: calls, BUILDS: builds, SUBS: subs }, encoding: 'utf8' });
      return result;
    };

    // 1) a build number this app does not have ⇒ refuse, cancel nothing
    writeSubs();
    let r = run({ keep: '999' });
    assert.notEqual(r.status, 0, 'an unknown build number must fail the step');
    const refused = readFileSync(calls, 'utf8');
    assert(!refused.includes('DELETE'), 'nothing may be deleted when the build number is unknown');
    assert(r.stdout.includes('refusing to cancel anything'), 'the refusal must say why');

    // 2) the happy path: only the older, still-pending submissions go
    writeSubs();
    r = run({ keep: '154' });
    assert.equal(r.status, 0, r.stderr);
    const made = readFileSync(calls, 'utf8').split('\n').filter((l) => l.startsWith('DELETE'));
    assert.equal(made.length, 2, `expected two withdrawals (151 and 152), got ${made.length}; calls=${JSON.stringify(readFileSync(calls, 'utf8'))} stdout=${JSON.stringify(r.stdout)} stderr=${JSON.stringify(r.stderr)}`);

    assert(made.some((m) => m.includes('sub-b-151')), `wrong submission withdrawn: ${made.join(' ')}`);
    assert(made.some((m) => m.includes('sub-b-152')), `build 152 was not withdrawn: ${made.join(' ')}`);
    assert(!made.some((m) => m.includes('sub-b-153')), 'an approved review must not be withdrawn');
    assert(!made[0].includes('sub-b-154'), 'the build we keep must never be withdrawn');
    assert(r.stdout.includes('withdrew 2'), 'the count must be printed');

    // 3) approved submissions are left alone
    writeSubs({ 'b-151': 'APPROVED', 'b-152': 'APPROVED', 'b-153': 'APPROVED' });
    r = run({ keep: '154' });
    assert.equal(r.status, 0, r.stderr);
    const kept = readFileSync(calls, 'utf8').split('\n').filter((l) => l.startsWith('DELETE'));
    assert.equal(kept.length, 0, 'an approved review must not be withdrawn');
    assert(r.stdout.includes('leaving build 151'), 'the skip must be printed');

    // 4) the build we keep is never withdrawn, even when its own review is pending
    writeSubs();
    r = run({ keep: '154' });
    assert.equal(r.status, 0, r.stderr);
    const mine = readFileSync(calls, 'utf8').split('\n').filter((l) => l.startsWith('DELETE'));
    assert(!mine.some((m) => m.includes('sub-b-154')), 'the build we keep must never be withdrawn');
    assert(mine.length === 2, `only the two older pending ones may go, got ${mine.length}`);

    console.log('PASS: cancelling superseded beta reviews is guarded by age, existence and review state');
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
