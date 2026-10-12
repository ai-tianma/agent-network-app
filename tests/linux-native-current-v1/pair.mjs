import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
const proof = JSON.parse(readFileSync('/fixture/public-pair.json', 'utf8'));
assert.match(proof.source, /^[a-f0-9]{40}$/);
assert.equal(proof.source_candidate, false);
assert.equal(process.getuid(), 1000);
const prefix = '/home/node/.anet/app/local-daemon/anet';
for (const [name, version, bin, entry] of [
  ['agent-network', proof.cli_version, 'anet', 'dist/bin/anet.cjs'],
  ['agent-node', proof.runtime_version, 'agent-node', 'dist/cli.js'],
]) {
  const root = prefix + '/lib/node_modules/@sleep2agi/' + name;
  const pkg = JSON.parse(readFileSync(root + '/package.json', 'utf8'));
  assert.equal(pkg.version, version);
  assert.equal(pkg.bin[bin], entry);
  assert.equal(realpathSync(prefix + '/bin/' + bin), root + '/' + entry);
}
assert.ok(execFileSync(prefix + '/bin/anet', ['--version'], { encoding: 'utf8' }).includes('anet v' + proof.cli_version));
assert.ok(execFileSync(process.execPath, [prefix + '/lib/node_modules/@sleep2agi/agent-node/dist/cli.js', '--help'], { encoding: 'utf8' }).includes('opencode-cli'));
assert.equal(existsSync('/home/node/.anet/config.json'), false);
assert.equal(existsSync('/home/node/.anet/app/local-daemon/.anet/nodes'), false);
console.log('PASS: exact public CLI171/runtime137, real version/help, no Hub identity or daemon started');
