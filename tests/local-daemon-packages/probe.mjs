import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

assert.notEqual(process.getuid(), 0);
assert.equal(homedir(), '/home/node');
const prefix = '/home/node/.anet/app/local-daemon/anet';
const source = readFileSync('/fixture/policy.rs', 'utf8');
const version = key => {
  const value = source.match(new RegExp(`pub const ${key}: &str = "([^"]+)";`))?.[1];
  assert.ok(value, `missing product constant ${key}`);
  return value;
};
for (const [name, key, bin, entry] of [
  ['agent-network', 'ANET_VERSION', 'anet', 'dist/bin/anet.cjs'],
  ['agent-node', 'AGENT_NODE_VERSION', 'agent-node', 'dist/cli.js'],
]) {
  const root = join(prefix, 'lib/node_modules/@sleep2agi', name);
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  assert.equal(pkg.name, `@sleep2agi/${name}`);
  assert.equal(pkg.version, version(key));
  assert.equal(pkg.bin[bin], entry);
  assert.equal(realpathSync(join(prefix, 'bin', bin)), join(root, entry));
}
const cli = execFileSync(join(prefix, 'bin/anet'), ['--version'], { encoding: 'utf8', timeout: 30000 });
assert.deepEqual(cli.split(/\r?\n/).filter(line => line.startsWith('anet v')), [`anet v${version('ANET_VERSION')}`]);
const help = execFileSync(process.execPath, [join(prefix, 'lib/node_modules/@sleep2agi/agent-node/dist/cli.js'), '--help'], { encoding: 'utf8', timeout: 30000 });
assert.ok(help.includes('opencode-cli'));
// Merely probing packages must not register or start a daemon or write Hub auth.
assert.equal(existsSync('/home/node/.anet/config.json'), false);
assert.equal(existsSync('/home/node/.anet/app/local-daemon/.anet/nodes'), false);
assert.equal(existsSync('/home/node/.anet/app/local-daemon/home/.anet/config.json'), false);
console.log(`PASS: non-root private global-prefix pair ${version('ANET_VERSION')} / ${version('AGENT_NODE_VERSION')}, real version/help, no Hub config or daemon registration`);
console.log('LIMIT: package atomic gate only; not native installer/V2 lifecycle acceptance');
