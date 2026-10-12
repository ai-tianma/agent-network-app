import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const files = readdirSync('/candidate').filter(name => name.endsWith('.tgz'));
assert.equal(files.length, 1);
const hash = file => createHash('sha256').update(readFileSync(file)).digest('hex');
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
assert.equal(pkg.name, '@sleep2agi/agent-node');
assert.equal(pkg.version, '2.5.0-preview.128');
assert.ok(readFileSync('dist/cli.js', 'utf8').includes('refusing default-model fallback'));
writeFileSync('/candidate/TEST_ONLY_SOURCE.json', JSON.stringify({
  test_only: true, registry_artifact: false,
  source: 'ded59ce7417ed8b0d22290d9c6fcb6e5c3fb324a',
  archive: files[0], archive_sha256: hash('/candidate/' + files[0]),
  cli_sha256: hash('dist/cli.js'), lock_sha256: hash('package-lock.json'),
  package_name: pkg.name, package_version: pkg.version,
}, null, 2));
