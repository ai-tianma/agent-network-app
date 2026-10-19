import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import {
  diffAgainstRemote,
  latestAliasName,
  mirrorBaseUrl,
  planMirror,
  rewriteManifestForMirror,
  selectNewestDesktopRelease,
  sha256sums,
} from '../scripts/modelscope-mirror.mjs';
import { androidReleaseNotes, extractReleaseBody, stripDesktopPackagingHeader, versionItems } from '../scripts/android-release-notes.mjs';

let passed = 0;
const check = (name: string, condition: boolean) => {
  if (!condition) throw new Error(`FAIL: ${name}`);
  passed++;
  console.log(`PASS: ${name}`);
};
const throws = (fn: () => unknown, pattern: RegExp) => {
  try {
    fn();
  } catch (error: any) {
    return pattern.test(error.message);
  }
  return false;
};

const sha = (seed: string) => createHash('sha256').update(seed).digest('hex');
const base = mirrorBaseUrl('Org/releases');
const asset = (id: number, name: string, extra: Record<string, unknown> = {}) => ({
  id,
  name,
  state: 'uploaded',
  size: name.length * 1000,
  digest: `sha256:${sha(name)}`,
  url: `https://api.github.com/repos/o/r/releases/assets/${id}`,
  browser_download_url: `https://github.com/o/r/releases/download/desktop-v1.2.3/${name}`,
  ...extra,
});
const release = {
  tag_name: 'desktop-v1.2.3',
  draft: false,
  assets: [
    asset(1, 'Agent.Network_1.2.3_aarch64.app.tar.gz'),
    asset(2, 'Agent.Network_1.2.3_aarch64.app.tar.gz.sig'),
    asset(3, 'Agent.Network_1.2.3_aarch64.dmg'),
    asset(4, 'Agent.Network_1.2.3_x64-setup.exe'),
    asset(5, 'Agent.Network_1.2.3_x64-setup.exe.sig'),
    asset(6, 'Agent.Network_1.2.3_x64_en-US.msi'),
    asset(7, 'Agent.Network_1.2.3_x64_en-US.msi.sig'),
    asset(8, 'Agent.Network_1.2.3_android-universal.apk'),
    asset(9, 'latest.json'),
  ],
};
// tauri-action writes asset API URLs; fallback.json uses browser URLs. Mix both.
const manifest = {
  version: '1.2.3',
  notes: 'n',
  pub_date: '2026-01-01T00:00:00Z',
  platforms: {
    'darwin-aarch64': { url: release.assets[0].url, signature: 'SIG-MAC' },
    'windows-x86_64': { url: release.assets[3].browser_download_url, signature: 'SIG-WIN' },
    'windows-x86_64-msi': { url: release.assets[5].url, signature: 'SIG-MSI' },
  },
};

// --- updater manifest rewrite ---------------------------------------------------------
const rewritten = rewriteManifestForMirror(manifest, release, { version: '1.2.3', baseUrl: base });
check('mac platform points at the mirrored versioned file',
  rewritten.platforms['darwin-aarch64'].url === `${base}/desktop/1.2.3/Agent.Network_1.2.3_aarch64.app.tar.gz`);
check('browser-URL form is mapped too',
  rewritten.platforms['windows-x86_64'].url === `${base}/desktop/1.2.3/Agent.Network_1.2.3_x64-setup.exe`);
check('signatures are carried over byte for byte',
  Object.entries(manifest.platforms).every(([k, v]) => rewritten.platforms[k].signature === v.signature));
check('only url changes (version/notes/pub_date kept)',
  rewritten.version === manifest.version && rewritten.notes === manifest.notes && rewritten.pub_date === manifest.pub_date);
check('no platform URL is left pointing at GitHub',
  Object.values(rewritten.platforms).every((p: any) => !p.url.includes('github')));
check('input manifest is not mutated', manifest.platforms['darwin-aarch64'].url.startsWith('https://api.github.com/'));
check('unmapped URL fails closed', throws(() => rewriteManifestForMirror(
  { ...manifest, platforms: { x: { url: 'https://elsewhere/x', signature: 's' } } }, release, { version: '1.2.3', baseUrl: base }), /maps to 0/));
check('version mismatch fails closed',
  throws(() => rewriteManifestForMirror({ ...manifest, version: '1.2.2' }, release, { version: '1.2.3', baseUrl: base }), /does not match/));
check('missing signature fails closed', throws(() => rewriteManifestForMirror(
  { ...manifest, platforms: { x: { url: release.assets[0].url, signature: '' } } }, release, { version: '1.2.3', baseUrl: base }), /signature/));

// --- SHA256SUMS -------------------------------------------------------------------------
check('SHA256SUMS is sha256sum format, sorted, basenames only',
  sha256sums([['b.dmg', 'bb'], ['a.exe', 'aa']]) === 'aa  a.exe\nbb  b.dmg\n');

// --- latest aliases ---------------------------------------------------------------------
check('installer alias drops the version', latestAliasName('Agent.Network_1.2.3_aarch64.dmg', '1.2.3') === 'Agent.Network_aarch64.dmg');
check('updater bundles get no alias', latestAliasName('Agent.Network_1.2.3_aarch64.app.tar.gz', '1.2.3') === null);
check('another version\'s file gets no alias', latestAliasName('Agent.Network_1.2.2_aarch64.dmg', '1.2.3') === null);
for (const suffix of ['aarch64.dmg', 'x64-setup.exe', 'x64_en-US.msi', 'android-universal.apk', 'amd64.deb']) {
  check(`ANet ${suffix} preserves the old fixed download link`, latestAliasName(`ANet_1.2.3_${suffix}`, '1.2.3') === `Agent.Network_${suffix}`);
}
check('ANet updater bundles and signatures get no installer alias',
  ['aarch64.app.tar.gz', 'x64-setup.exe.sig', 'amd64.deb.sig'].every(s => latestAliasName(`ANet_1.2.3_${s}`, '1.2.3') === null));
check('ANet wrong version and unrelated prefix get no alias',
  latestAliasName('ANet_1.2.2_aarch64.dmg', '1.2.3') === null && latestAliasName('Other_1.2.3_aarch64.dmg', '1.2.3') === null);

// --- plan -------------------------------------------------------------------------------
const planNewest = planMirror({ release, manifest, isNewest: true, baseUrl: base });
const planOld = planMirror({ release, manifest, isNewest: false, baseUrl: base });
check('every release asset is planned under desktop/<ver>/',
  release.assets.every((a) => planNewest.get(`desktop/1.2.3/${a.name}`)?.sha256 === sha(a.name)));
check('SHA256SUMS lists every asset', planNewest.get('desktop/1.2.3/SHA256SUMS').source.bytes.toString().trim().split('\n').length === release.assets.length);
check('newest release writes desktop/latest/ (4 installers + latest.json + VERSION + SHA256SUMS)',
  [...planNewest.keys()].filter((p) => p.startsWith('desktop/latest/')).length === 7);
check('latest VERSION names the release', planNewest.get('desktop/latest/VERSION').source.bytes.toString() === '1.2.3\n');
check('re-syncing an older release never touches desktop/latest/',
  [...planOld.keys()].every((p) => !p.startsWith('desktop/latest/')));
check('latest alias has the same bytes (sha) as the versioned installer',
  planNewest.get('desktop/latest/Agent.Network_x64-setup.exe').sha256 === planNewest.get('desktop/1.2.3/Agent.Network_1.2.3_x64-setup.exe').sha256);
const renamedRelease = { ...release, assets: release.assets.map(a => ({ ...a,
  name: a.name.replace('Agent.Network_', 'ANet_'),
  browser_download_url: a.browser_download_url.replace('Agent.Network_', 'ANet_'),
})) };
const renamedManifest = { ...manifest, platforms: Object.fromEntries(Object.entries(manifest.platforms).map(([k, v]) =>
  [k, { ...v, url: v.url.replace('Agent.Network_', 'ANet_') }])) };
const renamedPlan = planMirror({ release: renamedRelease, manifest: renamedManifest, isNewest: true, baseUrl: base });
check('renamed installer old alias uses the exact same asset and digest',
  renamedPlan.get('desktop/latest/Agent.Network_x64-setup.exe').source.asset === renamedRelease.assets[3]
  && renamedPlan.get('desktop/latest/Agent.Network_x64-setup.exe').sha256 === renamedPlan.get('desktop/1.2.3/ANet_1.2.3_x64-setup.exe').sha256);
const renamedUpdate = JSON.parse(renamedPlan.get('desktop/latest/latest.json').source.bytes.toString());
check('ANet manifest keeps signatures and uses original versioned ANet filenames',
  Object.entries(manifest.platforms).every(([k, v]) => renamedUpdate.platforms[k].signature === v.signature
    && renamedUpdate.platforms[k].url.startsWith(`${base}/desktop/1.2.3/ANet_1.2.3_`)));
const withDeb = {
  ...release,
  assets: [...release.assets, asset(12, 'ANet_1.2.3_amd64.deb'), asset(13, 'ANet_1.2.3_amd64.deb.sig')],
};
const debPlan = planMirror({ release: withDeb, manifest, isNewest: true, baseUrl: base });
check('linux deb gets the stable download alias and its signature does not',
  debPlan.get('desktop/latest/Agent.Network_amd64.deb')?.source.asset.name === 'ANet_1.2.3_amd64.deb'
  && debPlan.get('desktop/latest/Agent.Network_amd64.deb')?.sha256 === sha('ANet_1.2.3_amd64.deb')
  && !debPlan.has('desktop/latest/Agent.Network_amd64.deb.sig')
  && debPlan.get('desktop/1.2.3/SHA256SUMS').source.bytes.toString().includes(sha('ANet_1.2.3_amd64.deb')));
check('renamed historical release cannot move latest', [...planMirror({ release: renamedRelease,
  manifest: renamedManifest, isNewest: false, baseUrl: base }).keys()].every(p => !p.startsWith('desktop/latest/')));
check('old and new names cannot silently overwrite the same installer alias', throws(() => planMirror({
  release: { ...release, assets: [...release.assets, renamedRelease.assets[3]] }, manifest, isNewest: true, baseUrl: base,
}), /duplicate installer alias/));
check('draft is refused', throws(() => planMirror({ release: { ...release, draft: true }, manifest, isNewest: false, baseUrl: base }), /draft/));
check('asset still uploading is refused', throws(() => planMirror({
  release: { ...release, assets: [...release.assets.slice(0, 8), asset(10, 'x', { state: 'starter' })] }, manifest, isNewest: false, baseUrl: base }), /uploading/));
check('asset without a GitHub digest is refused', throws(() => planMirror({
  release: { ...release, assets: [asset(11, 'y', { digest: null })] }, manifest, isNewest: false, baseUrl: base }), /digest/));

// --- idempotence --------------------------------------------------------------------------
const inSync = Object.fromEntries([...planNewest].map(([p, e]) => [p, e.sha256]));
check('in-sync mirror: nothing to upload', diffAgainstRemote(planNewest, inSync).length === 0);
check('one changed file: exactly that file is re-uploaded',
  JSON.stringify(diffAgainstRemote(planNewest, { ...inSync, 'desktop/1.2.3/SHA256SUMS': 'stale' })) === '["desktop/1.2.3/SHA256SUMS"]');
check('missing remote file is uploaded', diffAgainstRemote(planNewest, {}).length === planNewest.size);

// --- newest selection (must match the anet.sh endpoint) ------------------------------------
const rel = (tag: string, extra: Record<string, unknown> = {}) => ({ tag_name: tag, draft: false, assets: [{ name: 'latest.json' }], ...extra });
check('newest = highest semver, not list order',
  selectNewestDesktopRelease([rel('desktop-v0.2.9'), rel('desktop-v0.2.10'), rel('mobile-v9.9.9')])?.tag_name === 'desktop-v0.2.10');
check('drafts and releases without latest.json are ignored',
  selectNewestDesktopRelease([rel('desktop-v0.3.0', { draft: true }), rel('desktop-v0.2.99', { assets: [] }), rel('desktop-v0.2.98')])?.tag_name === 'desktop-v0.2.98');

// --- workflow wiring --------------------------------------------------------------------------
const workflow = readFileSync(new URL('../.github/workflows/modelscope-mirror.yml', import.meta.url), 'utf8');
check('workflow runs on release published, schedule and manual dispatch with a tag input',
  /release:\s*\n\s*types: \[published\]/.test(workflow) && workflow.includes('schedule:') && /workflow_dispatch:[\s\S]*tag:/.test(workflow));
check('every `uses:` is pinned to a full commit SHA', [...workflow.matchAll(/uses:\s*(\S+)/g)].every((m) => /@[0-9a-f]{40}$/.test(m[1])));
check('ModelScope SDK version is pinned', /modelscope==\d+\.\d+\.\d+/.test(workflow));
check('token comes from the secret via env only', workflow.includes('MODELSCOPE_API_TOKEN: ${{ secrets.MODELSCOPE_API_TOKEN }}')
  && !/echo[^\n]*MODELSCOPE_API_TOKEN/.test(workflow));

// --- android channel publish workflow (android/latest/VERSION, see src/android-update-core.ts) ------------
const android = readFileSync(new URL('../.github/workflows/modelscope-android-publish.yml', import.meta.url), 'utf8');
const androidScript = readFileSync(new URL('../scripts/modelscope-android-publish.py', import.meta.url), 'utf8');
check('android publish: manual dispatch with a run_id input only', /workflow_dispatch:[\s\S]*run_id:/.test(android) && !/^\s*(push|pull_request|schedule|release):/m.test(android));
check('android publish: job runs from main only', android.includes("if: github.ref == 'refs/heads/main'"));
check('android publish: source run must be android-build, on main, successful',
  android.includes('.github/workflows/android-build.yml') && android.includes('"$branch" != "main"') && android.includes('"$conclusion" != "success"'));
// Not the mirror's group: a mirror cron queued behind it would replace (cancel) a pending publish.
check('android publish: own concurrency group, never cancelled by a queued mirror run',
  /concurrency:\s*\n\s*group: modelscope-android-publish\s*\n\s*cancel-in-progress: false/.test(android));
check('android publish: every `uses:` is pinned to a full commit SHA', [...android.matchAll(/uses:\s*(\S+)/g)].every((m) => /@[0-9a-f]{40}$/.test(m[1])));
check('android publish: ModelScope SDK pinned to the same version as the mirror',
  (android.match(/modelscope==(\d+\.\d+\.\d+)/) ?? [])[1] === (workflow.match(/modelscope==(\d+\.\d+\.\d+)/) ?? [])[1]);
check('android publish: token from the secret via env only', android.includes('MODELSCOPE_API_TOKEN: ${{ secrets.MODELSCOPE_API_TOKEN }}')
  && !/echo[^\n]*MODELSCOPE_API_TOKEN/.test(android) && !/print\([^\n]*token/i.test(androidScript));
check('android publish: writes exactly the layout the updater reads',
  androidScript.includes("f'agent-network-{version}.apk'") && androidScript.includes("f'android/{name}.sha256'") && androidScript.includes("'android/latest/VERSION'")
  && androidScript.includes("f'{sha}  {name}\\n'"));
check('android publish: anonymous verification downloads the full APK and compares sha256',
  /def verify\(/.test(androidScript) && androidScript.includes('anonymous full download, sha256 match'));
check('android publish: refuses to move android/latest/VERSION backwards', androidScript.includes('refusing to move it back'));

// --- android channel release notes (android/<ver>/notes.md) ---------------------------------------------------
const releaseWorkflow = readFileSync(new URL('../.github/workflows/release-desktop-auto-update.yml', import.meta.url), 'utf8');
const pkgVersion = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version as string;
const bodyOf = extractReleaseBody(releaseWorkflow) ?? '';
check('notes: releaseBody extracted from the real release workflow, indentation stripped',
  bodyOf.startsWith('Signed and notarized') && bodyOf.includes(`What's new in ${pkgVersion}:`) && !/^\s/.test(bodyOf.split('\n')[2] ?? ''));
check('notes: the current version has items (the bump PR wrote them)', versionItems(bodyOf, pkgVersion).length > 0);
const notes = androidReleaseNotes(releaseWorkflow, pkgVersion);
check('notes: notes.md = release body without the desktop packaging paragraph + trailing newline', typeof notes === 'string' && notes === `${stripDesktopPackagingHeader(bodyOf)}\n` && !notes.startsWith('Signed and notarized'));
check('notes: a body without the desktop header is left intact', stripDesktopPackagingHeader("Intro.\n\nWhat's new in 1.2.3:\n- x") === "Intro.\n\nWhat's new in 1.2.3:\n- x");
check('notes: a version with no section → error (publish refuses)', androidReleaseNotes(releaseWorkflow, '99.0.0') instanceof Error);
check('notes: no releaseBody block → error', androidReleaseNotes('jobs: {}\n', pkgVersion) instanceof Error);
const synthetic = [
  'jobs:', '  x:', '    steps:', '      - with:', '          releaseBody: |-', '            Intro.', '', "            What's new in 1.2.3:", '', "            What's new in 1.2.2:", '            - old item', '          other: 1',
].join('\n');
check('notes: heading with no items → error', androidReleaseNotes(synthetic, '1.2.3') instanceof Error);
check('notes: block ends at the next key of the same or lower indentation', !String(extractReleaseBody(synthetic)).includes('other: 1'));
check('notes: items of the version only, not the next section', versionItems(extractReleaseBody(synthetic), '1.2.2').join() === 'old item');
check('android publish: notes come from the release workflow at the APK commit and are uploaded + verified',
  android.includes('git show "$SOURCE_SHA:.github/workflows/release-desktop-auto-update.yml"') && android.includes('--notes "$NOTES"')
  && androidScript.includes("f'android/{version}/notes.md': notes") && androidScript.includes('refusing to publish without notes'));

console.log(`\n${passed} passed`);
