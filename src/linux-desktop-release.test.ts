// When Linux is selected, the release workflow builds the Ubuntu 24.04 .deb with the
// production updater endpoints and upload it on the same draft as macOS and
// Windows. The test-only overlay in tests/linux-deb-package stays off this path.
import { readFileSync } from 'node:fs';
import { LATEST_ALIAS_SUFFIXES } from '../scripts/modelscope-mirror.mjs';
import { assertDesktopReleaseDraft, releaseAssetNames } from '../scripts/verify-desktop-release-draft.mjs';

let passed = 0;
const check = (name: string, ok: boolean) => {
  if (!ok) throw new Error(`FAIL: ${name}`);
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

// actions/checkout on windows-latest writes CRLF. Normalize before matching so
// the Ubuntu 24.04 `--bundles deb` line stays required on every runner.
const readWorkflow = (text: string) => text.replace(/\r\n?/g, '\n');
const workflow = readWorkflow(readFileSync(new URL('../.github/workflows/release-desktop-auto-update.yml', import.meta.url), 'utf8'));
const config = JSON.parse(readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'));
const secrets = [...workflow.matchAll(/secrets\.([A-Z0-9_]+)/g)].map((match) => match[1]);
const secretSet = [...new Set(secrets)].sort();
const matrices = (text: string) => {
  const match = text.match(/include: \$\{\{ fromJSON\(inputs\.include_linux && '(\[.*\])' \|\| '(\[.*\])'\) \}\}/);
  if (!match) throw new Error('missing explicit platform selection');
  return [JSON.parse(match[1]), JSON.parse(match[2])];
};
const [withLinux, primaryOnly] = matrices(workflow);
check('opt-in release matrix builds the deb on Ubuntu 24.04',
  withLinux.some((row: any) => row.platform === 'ubuntu-24.04' && row.args === '--bundles deb'));
check('platform selection survives a Windows CRLF checkout',
  JSON.stringify(matrices(readWorkflow(workflow.replace(/\n/g, '\r\n')))) === JSON.stringify([withLinux, primaryOnly]));
check('default release matrix contains only the exact macOS and Windows bundles',
  JSON.stringify(primaryOnly) === JSON.stringify([
    { platform: 'macos-14', args: '--bundles app,dmg' },
    { platform: 'windows-latest', args: '--bundles nsis,msi' },
  ]));
check('Linux selection defaults off and is passed to the draft verifier',
  /include_linux:[\s\S]*?default: false\n\s+type: boolean/.test(workflow)
  && workflow.includes('INCLUDE_LINUX: ${{ inputs.include_linux }}'));
check('release build does not apply the test updater overlay or --no-sign',
  !workflow.includes('tauri.test.conf.json') && !workflow.includes('--no-sign'));
check('linux smoke runs the ELF, not the Windows exe',
  workflow.includes("binary='src-tauri/target/release/agent-network-desktop'")
  && workflow.includes('ANET_ISOLATED_KEYRING_TEST=1'));
check('linux keyring helper is read by sh, not executed as a file',
  (workflow.match(/exec sh "\$GITHUB_WORKSPACE\/scripts\/with-linux-test-keyring\.sh"/g) || []).length === 4
  && !workflow.includes('exec "$GITHUB_WORKSPACE/scripts/with-linux-test-keyring.sh"'));
check('macOS npm test uses a bash that rejects a short SHA',
  workflow.indexOf('Use Bash 4+ for macOS release tests') < workflow.indexOf('run: npm test')
  && workflow.includes('BASH_VERSINFO[0]} -ge 4')
  && workflow.includes('still accepts a short SHA'));
check('release commit gate does not use the macOS bash 3.2 compound test',
  workflow.includes('[[ "$requested" =~ ^[0-9a-f]{40}$ ]]')
  && workflow.includes('[[ "$resolved" == "$requested" ]]')
  && !workflow.includes('[[ "$requested" =~ ^[0-9a-f]{40}$ && "$resolved" == "$requested" ]]'));
check('deb is inside the 55 MiB ceiling', workflow.includes("-name '*.deb'"));
const linuxAudit = workflow.slice(workflow.indexOf('- name: Audit Linux deb removal and reinstall data retention'), workflow.indexOf('- name: Enforce desktop distribution size ceiling'));
check('linux retention audit installs the absolute built .deb',
  linuxAudit.includes('deb_dir="$GITHUB_WORKSPACE/src-tauri/target/release/bundle/deb"')
  && linuxAudit.includes('test -f "$deb"')
  && linuxAudit.includes('case "$deb" in')
  && (linuxAudit.match(/apt-get install -y --no-install-recommends "\$deb"/g) || []).length === 2
  && linuxAudit.includes('sudo dpkg -r "$pkg"')
  && linuxAudit.includes('test ! -e "$binary"')
  && linuxAudit.includes('test -s "$retention_root/local-hub/data/commhub.db"')
  && linuxAudit.includes('test -s "$retention_root/profiles/index.json"')
  && !linuxAudit.includes('find src-tauri/target/release/bundle/deb'));
check('publish defaults to creating the draft and can be turned off',
  /publish:[\s\S]*default: true[\s\S]*type: boolean/.test(workflow)
  && workflow.includes('inputs.publish == true')
  && workflow.includes('inputs.publish == false')
  && workflow.includes('Build signed bundles without uploading a release'));
check('draft verification runs only when publishing',
  workflow.includes('verify-desktop-release-draft.mjs')
  && /verify-draft:[\s\S]{0,120}needs: \[prepare-release, build-release\]/.test(workflow));
check('linux reuses the existing updater key and adds no secret',
  secretSet.join() === [
    'APPLE_API_ISSUER',
    'APPLE_API_KEY',
    'APPLE_API_KEY_BASE64',
    'APPLE_CERTIFICATE',
    'APPLE_CERTIFICATE_PASSWORD',
    'TAURI_SIGNING_PRIVATE_KEY',
    'TAURI_SIGNING_PRIVATE_KEY_PASSWORD',
  ].join()
  && workflow.includes('TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}'));
check('production updater endpoints stay in tauri.conf.json',
  JSON.stringify(config.plugins.updater.endpoints) === JSON.stringify([
    'https://anet.sh/desktop/update/latest.json',
    'https://modelscope.cn/datasets/SmartFlowAI/agent-network-releases/resolve/master/desktop/latest/latest.json',
  ]) && config.bundle.createUpdaterArtifacts === true);
check('mirror gives the deb a stable download alias', LATEST_ALIAS_SUFFIXES.includes('amd64.deb'));

const product = 'ANet';
const version = '1.2.3';
const sha = 'ab'.repeat(32);
const asset = (name: string, id: number) => ({
  name,
  state: 'uploaded',
  digest: `sha256:${sha}`,
  apiUrl: `https://api.github.com/repos/o/r/releases/assets/${id}`,
  url: `https://github.com/o/r/releases/download/desktop-v${version}/${name}`,
});
const names = releaseAssetNames(product, version);
const release = {
  isDraft: true,
  targetCommitish: 'a'.repeat(40),
  assets: names.map((name, index) => asset(name, index + 1)),
};
const deb = release.assets[0];
const exe = release.assets.find((item) => item.name.endsWith('_x64-setup.exe'));
const mac = release.assets.find((item) => item.name.endsWith('_aarch64.app.tar.gz'));
const manifest = {
  version,
  platforms: {
    'darwin-aarch64': { url: mac.apiUrl, signature: 'SIG-MAC' },
    'windows-x86_64': { url: exe.apiUrl, signature: 'SIG-WIN' },
    'linux-x86_64': { url: deb.apiUrl, signature: 'SIG-LINUX' },
    'linux-x86_64-deb': { url: deb.url, signature: 'SIG-LINUX' },
  },
};
const ok = assertDesktopReleaseDraft({
  product, version, release, manifest, expectedCommit: 'a'.repeat(40),
});
check('draft check returns the deb checksum', ok.debSha256 === sha && ok.sigSha256 === sha);
check('missing linux platform fails closed', throws(() => assertDesktopReleaseDraft({
  product, version, release, manifest: { ...manifest, platforms: { ...manifest.platforms, 'linux-x86_64-deb': undefined } }, expectedCommit: 'a'.repeat(40),
}), /linux-x86_64-deb/));
check('linux entry pointing at another file fails closed', throws(() => assertDesktopReleaseDraft({
  product, version, release,
  manifest: { ...manifest, platforms: { ...manifest.platforms, 'linux-x86_64': { url: exe.apiUrl, signature: 'SIG-LINUX' } } },
  expectedCommit: 'a'.repeat(40),
}), /does not point at/));
check('published release is refused', throws(() => assertDesktopReleaseDraft({
  product, version, release: { ...release, isDraft: false }, manifest, expectedCommit: 'a'.repeat(40),
}), /not a draft/));
check('deb without a digest is refused', throws(() => assertDesktopReleaseDraft({
  product, version,
  release: { ...release, assets: release.assets.map((item) => item.name.endsWith('.deb') && !item.name.endsWith('.sig') ? { ...item, digest: null } : item) },
  manifest, expectedCommit: 'a'.repeat(40),
}), /sha256 digest/));

const primaryRelease = { ...release, assets: release.assets.filter(item => !/\.deb(?:\.sig)?$/.test(item.name)) };
const primaryManifest = { ...manifest, platforms: {
  'darwin-aarch64': manifest.platforms['darwin-aarch64'],
  'windows-x86_64': manifest.platforms['windows-x86_64'],
} };
const primaryInput = { product, version, release: primaryRelease, manifest: primaryManifest, expectedCommit: 'a'.repeat(40), includeLinux: false };
check('primary-only draft succeeds without claiming a Linux digest',
  assertDesktopReleaseDraft(primaryInput).debSha256 === null);
check('selecting Linux still requires the omitted deb', throws(() => assertDesktopReleaseDraft({ ...primaryInput, includeLinux: true }), /missing.*\.deb/));
check('primary-only draft rejects an unexpected Linux updater entry', throws(() => assertDesktopReleaseDraft({ ...primaryInput, manifest }), /Linux updater entries/));
check('primary-only draft rejects unexpected Linux assets', throws(() => assertDesktopReleaseDraft({ ...primaryInput, release }), /Linux assets/));
check('primary-only draft still rejects a missing Windows installer', throws(() => assertDesktopReleaseDraft({
  ...primaryInput, release: { ...primaryRelease, assets: primaryRelease.assets.filter(item => !item.name.endsWith('_x64-setup.exe')) },
}), /missing.*setup\.exe/));
check('primary-only draft still rejects a missing macOS signature', throws(() => assertDesktopReleaseDraft({
  ...primaryInput, manifest: { ...primaryManifest, platforms: { ...primaryManifest.platforms, 'darwin-aarch64': { ...primaryManifest.platforms['darwin-aarch64'], signature: '' } } },
}), /darwin-aarch64 signature/));
check('primary-only draft still rejects a mismatched source SHA', throws(() => assertDesktopReleaseDraft({
  ...primaryInput, expectedCommit: 'b'.repeat(40),
}), /targetCommitish/));

console.log(`\n${passed} passed`);
