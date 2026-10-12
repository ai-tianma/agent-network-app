import fs from 'node:fs';

const packageJson = JSON.parse(fs.readFileSync(new URL('../local-hub-sidecar/package.json', import.meta.url), 'utf8'));
const packageLock = JSON.parse(fs.readFileSync(new URL('../local-hub-sidecar/package-lock.json', import.meta.url), 'utf8'));
const config = JSON.parse(fs.readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'));
const buildScript = fs.readFileSync(new URL('../scripts/build-local-hub-sidecar.mjs', import.meta.url), 'utf8');
const desktopWorkflow = fs.readFileSync(new URL('../.github/workflows/desktop-tauri.yml', import.meta.url), 'utf8');
const releaseWorkflow = fs.readFileSync(new URL('../.github/workflows/release-desktop-auto-update.yml', import.meta.url), 'utf8');

const pinned = '0.9.0-preview.128';
const supervisorSource = fs.readFileSync(new URL('../src-tauri/src/local_hub.rs', import.meta.url), 'utf8');
const checks: Array<[string, boolean]> = [
  ['native supervisor expects the bundled Hub version', supervisorSource.includes(`const EXPECTED_HUB_VERSION: &str = "${pinned}";`)],
  ['CommHub dependency is exact', packageJson.dependencies['@sleep2agi/commhub-server'] === pinned],
  ['lock resolves exact CommHub', packageLock.packages['node_modules/@sleep2agi/commhub-server'].version === pinned],
  ['lock records npm integrity', packageLock.packages['node_modules/@sleep2agi/commhub-server'].integrity.startsWith('sha512-')],
  ['Tauri bundles local Hub sidecar', config.bundle.externalBin.includes('binaries/commhub')],
  ['Tauri bundles integrity manifest', config.bundle.resources.includes('binaries/commhub-manifest.json')],
  ['build embeds pinned version', buildScript.includes('const SERVER_VERSION =') && buildScript.includes('versionBlock')],
  ['build records an explicitly pre-bundle SHA256', buildScript.includes('preBundleSha256') && buildScript.includes("createHash('sha256')")],
  ['manifest does not claim a post-signature binary hash', !buildScript.includes('\n    sha256:')],
  ['build enforces raw-size cap', buildScript.includes('110 * 1024 * 1024')],
  ['unsigned Mac/Windows workflow builds sidecar', desktopWorkflow.match(/Build pinned local CommHub sidecar/g)?.length === 2],
  ['signed workflow builds sidecar', releaseWorkflow.includes('Build pinned local CommHub sidecar')],
  ['unsigned Mac/Windows artifacts have a 55 MiB gate', desktopWorkflow.match(/55 MiB distribution ceiling/g)?.length === 2],
  ['signed artifacts have a 55 MiB gate', releaseWorkflow.includes('55 MiB distribution ceiling')],
];

for (const [name, ok] of checks) {
  if (!ok) throw new Error(`FAIL: ${name}`);
  console.log(`PASS: ${name}`);
}
