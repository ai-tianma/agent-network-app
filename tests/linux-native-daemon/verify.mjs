import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync, lstatSync, readlinkSync, realpathSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

const root = process.env.ANET_PACKAGED_SMOKE_ROOT;
assert.equal(root, '/home/smoke/native-daemon-test');
const prefix = join(root, 'local-daemon/anet');
const phase = process.argv[2];
const scenario = phase.replace(/^before-/, '');
assert.ok(['empty', 'exact', 'partial', 'old-cli', 'old-node', 'failed-cli', 'timeout-cli'].includes(scenario));
const policy = readFileSync('/fixture/daemon-policy.rs', 'utf8');
const expected = name => {
  const match = policy.match(new RegExp(`pub const ${name}: &str = "([^"]+)";`));
  assert.ok(match, `missing product constant ${name}`);
  return match[1];
};
for (const [name, constant] of [['agent-network', 'ANET_VERSION'], ['agent-node', 'AGENT_NODE_VERSION']]) {
  const pkg = JSON.parse(readFileSync(join(prefix, 'lib/node_modules/@sleep2agi', name, 'package.json'), 'utf8'));
  assert.equal(pkg.name, `@sleep2agi/${name}`);
  const version = scenario === 'old-cli' && name === 'agent-network' ? '2.3.0-preview.76'
    : scenario === 'old-node' && name === 'agent-node' ? '2.5.0-preview.58' : expected(constant);
  assert.equal(pkg.version, version);
}
const fingerprint = () => {
  const hash = createHash('sha256');
  const entries = {};
  const walk = relative => {
    const path = join(prefix, relative);
    const stat = lstatSync(path);
    hash.update(`${relative}\0${stat.mode}\0`);
    if (stat.isSymbolicLink()) hash.update(`link:${readlinkSync(path)}\0`);
    else if (stat.isDirectory()) for (const entry of readdirSync(path).sort()) walk(join(relative, entry));
    else if (stat.isFile()) hash.update(readFileSync(path));
    else assert.fail(`unexpected special file: ${relative}`);
    entries[relative] = { mode: stat.mode, content: stat.isSymbolicLink() ? readlinkSync(path) : stat.isFile() ? createHash('sha256').update(readFileSync(path)).digest('hex') : 'directory' };
  };
  walk('');
  return { hash: hash.digest('hex'), entries };
};
const agentEntry = join(prefix, 'lib/node_modules/@sleep2agi/agent-node/dist/cli.js');
if (phase === 'before-partial') {
  // Deliberate corruption only inside this fresh disposable test container.
  unlinkSync(agentEntry);
}
if (phase === 'before-failed-cli' || phase === 'before-timeout-cli') {
  const bin = join(prefix, 'bin/anet');
  assert.ok(lstatSync(bin).isSymbolicLink(), 'fault injection replaces only the private bin link');
  const entry = realpathSync(bin);
  assert.ok(entry.startsWith(join(prefix, 'lib/node_modules/@sleep2agi/agent-network/')));
  // Keep the real package entry intact. The wrapper forwards real output and
  // only then injects failure/hang for --version; other commands stay real.
  unlinkSync(bin);
  writeFileSync(bin, `#!/usr/local/bin/node
const {spawnSync} = require('node:child_process');
const {writeFileSync} = require('node:fs');
const args = process.argv.slice(2);
const result = spawnSync('/usr/local/bin/node', [${JSON.stringify(entry)}, ...args], {encoding:'utf8', timeout:10000});
process.stdout.write(result.stdout || '');
process.stderr.write(result.stderr || '');
if (args[0] === '--version') {
  if (result.status !== 0 || !(result.stdout || '').split(/\\r?\\n/).includes(${JSON.stringify(`anet v${expected('ANET_VERSION')}`)})) process.exit(88);
  writeFileSync('/evidence/real-cli-probe.json', JSON.stringify({version:${JSON.stringify(expected('ANET_VERSION'))}, realExit:result.status, scenario:${JSON.stringify(scenario)}}));
  ${scenario === 'failed-cli' ? 'process.exit(23);' : 'setTimeout(() => process.exit(24), 60000);'}
} else process.exit(result.status ?? 89);
`, { mode: 0o755 });
}
if (phase.startsWith('before-')) {
  writeFileSync('/evidence/private-prefix-before.json', JSON.stringify(fingerprint()));
} else {
  assert.ok(existsSync(join(root, 'local-hub/data/commhub.db')), 'real bundled Hub database');
  // Native smoke itself asserts successful Hub supervisor registration and
  // matching node_id/profile on rescan. Do not dump test auth configuration.
  if (phase !== 'empty') {
    const before = JSON.parse(readFileSync('/evidence/private-prefix-before.json', 'utf8'));
    const after = fingerprint();
    const changed = [...new Set([...Object.keys(before.entries), ...Object.keys(after.entries)])].filter(path => JSON.stringify(before.entries[path]) !== JSON.stringify(after.entries[path]));
    if (changed.length) console.error('Changed prefix entries (hashes/modes only):', changed.slice(0, 20).map(path => ({ path, before: before.entries[path], after: after.entries[path] })));
    assert.equal(after.hash, before.hash, 'existing package contents/modes/links unchanged');
  }
  if (phase === 'partial') {
    assert.ok(!existsSync(agentEntry), 'broken entry was not silently reinstalled');
  }
  if (['partial', 'old-cli', 'old-node', 'failed-cli', 'timeout-cli'].includes(phase)) {
    assert.ok(!existsSync(join(root, 'local-daemon/home/.anet/config.json')), 'no private Hub credentials written');
    assert.ok(!existsSync(join(root, 'local-daemon/.anet/nodes/local-daemon/config.json')), 'no daemon profile registered');
    assert.ok(!existsSync(join(root, 'local-daemon/start.log')), 'daemon launch not reached');
  }
  if (phase === 'failed-cli' || phase === 'timeout-cli') {
    const probe = JSON.parse(readFileSync('/evidence/real-cli-probe.json', 'utf8'));
    assert.deepEqual(probe, { version: expected('ANET_VERSION'), realExit: 0, scenario: phase }, 'real CLI succeeded and printed exact version BEFORE injection');
  }
  console.log(`PASS: ${phase} expected package versions; existing-prefix integrity when applicable`);
}
