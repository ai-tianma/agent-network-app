// The GitHub org avatar and the repo social previews can only be uploaded by an
// owner through the web UI, so the artwork has to be committed *and* stay in
// step with the brand mark. A stale social preview is invisible to every other
// gate: nothing in the build reads these files, so nothing would ever notice
// that the mark changed underneath them.
//
// So this re-runs the generator against the current source in a temporary
// directory and compares pixels with what is committed — the same rule
// src/icon-assets.test.ts follows for the app icons.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string): Buffer => fs.readFileSync(path.join(REPO, rel));

let passed = 0;
let total = 0;
function check(name: string, ok: unknown, extra = '') {
  total += 1;
  if (ok) {
    passed += 1;
    console.log(`✅ ${name}`);
  } else {
    console.log(`❌ ${name}${extra ? ` (${extra})` : ''}`);
  }
}

const EXPECTED: Array<{ file: string; width: number; height: number }> = [
  { file: 'assets/github-avatar-500.png', width: 500, height: 500 },
  { file: 'assets/social-preview-1280x640.png', width: 1280, height: 640 },
  { file: 'assets/social-preview-1200x600.png', width: 1200, height: 600 },
  { file: 'assets/social-preview-640x320.png', width: 640, height: 320 },
];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'anet-github-social-'));
execFileSync(process.execPath, [path.join(REPO, 'scripts/generate-github-social-assets.mjs'), '--out', tmp], { cwd: REPO });

for (const want of EXPECTED) {
  const committed = PNG.sync.read(read(want.file));
  check(`${want.file} is ${want.width}×${want.height}`, committed.width === want.width && committed.height === want.height,
    `${committed.width}×${committed.height}`);
  const regenerated = PNG.sync.read(fs.readFileSync(path.join(tmp, path.basename(want.file))));
  let diff = -1;
  let pixels = committed.width * committed.height;
  if (regenerated.width === committed.width && regenerated.height === committed.height) {
    diff = 0;
    for (let i = 0; i < committed.data.length; i += 4) {
      if (committed.data[i] !== regenerated.data[i]
        || committed.data[i + 1] !== regenerated.data[i + 1]
        || committed.data[i + 2] !== regenerated.data[i + 2]
        || committed.data[i + 3] !== regenerated.data[i + 3]) {
        diff += 1;
      }
    }
  }
  check(`${want.file} matches the generator output`, diff === 0, `${diff} of ${pixels} pixels differ`);
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`github social assets: ${passed}/${total} checks passed`);
if (passed !== total) process.exit(1);
