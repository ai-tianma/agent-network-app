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
  runWithdrawTest();
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
 * The withdraw step removes superseded builds from the public beta group, so it
 * gets its own tests. What must hold:
 *   - a build number this app does not have ⇒ nothing is withdrawn
 *   - only builds STRICTLY OLDER than the one we keep are touched
 *   - only submissions still pending are acted on; approved/rejected stay
 *   - the build we keep is never removed
 *   - the outcome is measured, not assumed: the step re-reads the submission
 *     and says whether it is gone
 */
function runWithdrawTest() {
  const start = workflow.indexOf(`          if [ -n "$CANCEL_SUPERSEDED_BETA_REVIEWS" ]; then`);
  const end = workflow.indexOf('          if [ "$INCLUDE_APP_STORE_VERSIONS" = \'true\' ]; then', start);
  assert(start > 0 && end > start, 'withdraw block not found in the workflow');
  const block = workflow.slice(start, end).replace(/^          /gm, '');

  const dir = mkdtempSync(join(tmpdir(), 'ios-withdraw-'));
  try {
    const calls = join(dir, 'calls');
    const builds = join(dir, 'builds.json');
    const removed = join(dir, 'removed');

    const appBuilds = { data: [
      { type: 'builds', id: 'b-151', attributes: { version: '151' } },
      { type: 'builds', id: 'b-152', attributes: { version: '152' } },
      { type: 'builds', id: 'b-153', attributes: { version: '153' } },
      { type: 'builds', id: 'b-154', attributes: { version: '154' } },
    ] };
    const groups = { data: [
      { type: 'betaGroups', id: 'g-internal', attributes: { name: 'Internal', publicLinkId: null } },
      { type: 'betaGroups', id: 'g-public', attributes: { name: 'Public', publicLinkId: 'ZvqYnCA9' } },
    ] };
    // 151 and 152 have pending reviews; 153's review is already approved.
    const stateOf = { 'b-151': 'IN_REVIEW', 'b-152': 'WAITING_FOR_REVIEW', 'b-153': 'APPROVED', 'b-154': 'IN_REVIEW' };

    const run = ({ keep }) => {
      rmSync(calls, { force: true });
      rmSync(removed, { force: true });
      writeFileSync(builds, JSON.stringify(appBuilds));
      for (const [id, st] of Object.entries(stateOf)) {
        writeFileSync(join(dir, `src-subs-${id}.json`), JSON.stringify({ data: [
          { type: 'betaAppReviewSubmissions', id: `sub-${id}`, attributes: { betaReviewState: st } },
        ] }));
      }
      const result = spawnSync('bash', ['-eu', '-c', `
        app_id=fixture-app
        BUNDLE_ID=top.vansin.agentnetwork
        jwt=not-a-real-token
        CANCEL_SUPERSEDED_BETA_REVIEWS="${keep}"
        asc_get() {
          case "$1" in
            builds) echo "GET builds" >> "$CALLS"; cat "$BUILDS";;
            betaGroups) echo "GET betaGroups" >> "$CALLS"; cat "$GROUPS";;
            betaAppReviewSubmissions)
              echo "GET betaAppReviewSubmissions" >> "$CALLS"
              bid=''
              for a in "$@"; do
                case "$a" in
                  *filter\\[build\\]=*) bid=\${a##*=} ;;
                esac
              done
              # a build that was removed from the public group has no submission left
              if [ -n "$bid" ] && grep -qx "$bid" "$REMOVED" 2>/dev/null; then
                echo '{"data":[]}'
              else
                cat "$RUNNER_TEMP/src-subs-$bid.json"
              fi ;;
            *) echo "unexpected GET $1" >&2; exit 98;;
          esac
        }
        asc_write() {
          echo "WRITE $1 $2 $3" >> "$CALLS"
          case "$1 $2" in
            DELETE*relationships/builds)
              # the body names the build(s) being removed
              bid=$(echo "$3" | sed 's/.*"id":"\\([^"]*\\)".*/\\1/')
              echo "$bid" >> "$REMOVED";;
          esac
        }
        ${block}
      `], { env: { ...process.env, RUNNER_TEMP: dir, CALLS: calls, BUILDS: builds, GROUPS: join(dir, 'groups.json'), REMOVED: removed }, encoding: 'utf8' });
      return result;
    };
    writeFileSync(join(dir, 'groups.json'), JSON.stringify(groups));

    // 1) a build number this app does not have ⇒ refuse, remove nothing
    let r = run({ keep: '999' });
    assert.notEqual(r.status, 0, 'an unknown build number must fail the step');
    assert(!readFileSync(calls, 'utf8').includes('WRITE DELETE'), 'nothing may be removed when the build number is unknown');
    assert(r.stdout.includes('refusing to withdraw anything'), 'the refusal must say why');

    // 2) the happy path: the two older pending ones leave the public group,
    //    the approved one stays, and the outcome is measured
    r = run({ keep: '154' });
    assert.equal(r.status, 0, r.stderr);
    const wrote = readFileSync(calls, 'utf8').split('\n').filter((l) => l.startsWith('WRITE DELETE'));
    assert.equal(wrote.length, 2, `expected two removals, got ${wrote.length}: ${wrote.join(' | ')}`);
    assert(wrote.some((w) => w.includes('b-151')), 'build 151 was not removed');
    assert(wrote.some((w) => w.includes('b-152')), 'build 152 was not removed');
    assert(!wrote.some((w) => w.includes('b-153')), 'an approved review must not be touched');
    assert(!wrote.some((w) => w.includes('b-154')), 'the build we keep must never be removed');
    assert(r.stdout.includes('is gone'), 'the outcome must be measured, not assumed');
    assert(r.stdout.includes('removed 2'), 'the count must be printed');

    // 3) the build we keep is never removed even when its own review is pending
    r = run({ keep: '154' });
    const mine = readFileSync(calls, 'utf8').split('\n').filter((l) => l.startsWith('WRITE DELETE'));
    assert(!mine.some((w) => w.includes('b-154')), 'the build we keep must never be removed');

    console.log('PASS: withdrawing superseded builds from the public group is guarded and the outcome is measured');
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
