// Read-only production resolver after the actual disposable candidate preparer.
// No Hub identity, daemon, OpenCode process, vendor credential or model request.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { validateAgentNodePackageEntrypoint, OPENCODE_AGENT_NODE_SPEC,
  OPENCODE_AGENT_NODE_VERSION } from '/source/agent-network/src/opencode-agent-node-pair';
import { writeCreatedOpencodeProfile } from '/source/agent-node/src/runtime/opencode-create-profile';
import { homedir } from 'node:os';

const source = 'ded59ce7417ed8b0d22290d9c6fcb6e5c3fb324a';
assert.equal(process.getuid(), 10001);
assert.match(process.env.APP_SOURCE_COMMIT, /^[a-f0-9]{40}$/);
assert.equal(OPENCODE_AGENT_NODE_VERSION, '2.5.0-preview.128');
const root = process.env.ANET_PACKAGED_SMOKE_ROOT;
const installed = '/fixture/exact-prefix/lib/node_modules/@sleep2agi/agent-node/dist/cli.js';
const installedMode = statSync(installed).mode & 0o777;
assert.ok(installedMode & 0o111, 'registry npm installation supplies executable bin');
mkdirSync(root + '/profiles', { recursive: true, mode: 0o700 });
// This is only the preparer's sentinel; no profile identity or secret is seeded.
writeFileSync(root + '/profiles/index.json', '{}', { mode: 0o600 });
const manifest = JSON.parse(readFileSync('/candidate/TEST_ONLY_SOURCE.json', 'utf8'));
assert.equal(manifest.source, source);
const archiveMode = Number(execFileSync('python3', ['-c',
  'import sys,tarfile; print(tarfile.open(sys.argv[1]).getmember("package/dist/cli.js").mode & 0o777)',
  '/candidate/' + manifest.archive], { encoding: 'utf8' }).trim());
execFileSync('python3', ['/fixture/prepare.py'], { stdio: 'inherit' });
const entry = root + '/local-daemon/anet/lib/node_modules/@sleep2agi/agent-node/dist/cli.js';
const preparedMode = statSync(entry).mode & 0o777;
assert.equal(createHash('sha256').update(readFileSync(entry)).digest('hex'), manifest.cli_sha256);
let reason = 'accepted';
try {
  assert.equal(validateAgentNodePackageEntrypoint(entry, OPENCODE_AGENT_NODE_SPEC,
    OPENCODE_AGENT_NODE_VERSION), entry);
} catch (error) {
  // Emit only one known constant. Never export arbitrary errors, paths or argv.
  reason = String(error.message) === 'resolved agent-node package entrypoint is not executable'
    ? 'package_entrypoint_not_executable' : 'other_package_refusal';
}
writeFileSync('/evidence/package-bootstrap.json', JSON.stringify({
  test_only: true, app_source: process.env.APP_SOURCE_COMMIT, backend_source: source,
  archive_sha256: manifest.archive_sha256, cli_sha256: manifest.cli_sha256,
  installed_mode: installedMode.toString(8), archive_mode: archiveMode.toString(8),
  prepared_mode: preparedMode.toString(8), resolver_result: reason,
  native_ui_tested: false, registration_tested: false, model_tested: false,
}, null, 2));
console.log(`BOOTSTRAP: installed=${installedMode.toString(8)} archive=${archiveMode.toString(8)} prepared=${preparedMode.toString(8)} resolver=${reason}`);
assert.equal(reason, 'accepted', 'production package resolver rejected actual candidate preparation');
console.log('PASS: candidate preparation accepted by exact production package resolver; NO native/registration/model proof');
const project = homedir() + '/v1-native';
mkdirSync(project, { recursive: true, mode: 0o700 });
// The exact production creator establishes the binding; no hand-written marker
// or bypass of CLI compatibility admission is allowed in this fixture.
writeCreatedOpencodeProfile(project + '/.anet/nodes/v1-native', {
  node_id: 'node_test894_bootstrap', node_name: 'v1-native', alias: 'v1-native',
  runtime: 'opencode-cli', model: 'opencode/mimo-v2.6-flash-free',
  hub: 'http://127.0.0.1:18883', token: 'ntok_test_only_bootstrap',
  opencodeGeneration: 'v1', opencodeMode: 'headless',
  flags: { opencodeUnsafeTools: false },
});
execFileSync('python3', ['/fixture/launch.py'], { stdio: 'inherit' });
