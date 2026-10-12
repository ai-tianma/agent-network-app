// Exact package-file comparison only; no claim about publisher identity/signature.
import { readdirSync, readFileSync, lstatSync, existsSync, cpSync, mkdtempSync, rmSync, writeFileSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function files(root, prefix = '') {
  return readdirSync(join(root, prefix)).sort().flatMap(name => {
    const path = join(prefix, name), stat = lstatSync(join(root, path));
    assert.ok(!stat.isSymbolicLink(), `unexpected symlink: ${path}`);
    assert.ok(stat.isDirectory() || stat.isFile(), `unexpected file type: ${path}`);
    return stat.isDirectory() ? files(root, path) : [path];
  });
}
function verify(candidate, sourceRoot) {
  const shipped = files(candidate);
  assert.equal(shipped.length, 342, 'exact pinned package must contain 342 files');
  const mismatches = [];
  for (const path of shipped) {
    const source = join(sourceRoot, path);
    if (!existsSync(source)) mismatches.push({ path, reason: 'absent from exact server tree' });
    else if (!lstatSync(source).isFile()) mismatches.push({ path, reason: 'source is not a regular file' });
    else if (hash(readFileSync(join(candidate, path))) !== hash(readFileSync(source))) mismatches.push({ path, reason: 'byte mismatch' });
  }
  assert.equal(mismatches.length, 0, `published package contains unmatched files: ${JSON.stringify(mismatches)}`);
  return shipped.length;
}
const count = verify('/candidate', '/source/server');
console.log(`PASS: all ${count} published package files match exact main-ancestor server treee83cfc7d3b949a8751c43ee2f1c0614a2315dcf4`);
const fixtures = [
  ['modified byte', path => writeFileSync(join(path, 'package.json'), 'modified'), /byte mismatch/],
  ['missing file', path => rmSync(join(path, 'package.json')), /must contain 342 files/],
  ['extra file', path => writeFileSync(join(path, 'unexpected'), 'extra'), /must contain 342 files/],
  ['same-count substitution', path => { rmSync(join(path, 'package.json')); writeFileSync(join(path, 'unexpected'), 'extra'); }, /absent from exact server tree/],
  ['symlink', path => { rmSync(join(path, 'package.json')); symlinkSync('/candidate/package.json', join(path, 'package.json')); }, /unexpected symlink/],
];
for (const [name, mutate, expected] of fixtures) {
  const temp = mkdtempSync(join(tmpdir(), 'hub-provenance-'));
  try {
    cpSync('/candidate', temp, { recursive: true });
    mutate(temp);
    assert.throws(() => verify(temp, '/source/server'), expected);
    console.log(`PASS: precise rejection — ${name}`);
  } finally { rmSync(temp, { recursive: true, force: true }); }
}
