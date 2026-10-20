// The macOS release DMG step flakes after notarization. The workflow carries
// the retry wrapper itself: a later re-dispatch checks out the release SHA,
// which does not contain files added after that commit.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

if (process.platform === 'win32') {
  console.log('SKIP macOS DMG retry script on Windows; covered by Linux/macOS CI');
  process.exit(0);
}

const workflowPath = new URL('../.github/workflows/release-desktop-auto-update.yml', import.meta.url);
const workflow = readFileSync(workflowPath, 'utf8').replace(/\r\n?/g, '\n');
const scriptFile = new URL('../scripts/retry-macos-dmg.sh', import.meta.url);

function extractEmbeddedScript(text: string): string {
  const open = text.match(/^([ \t]*)cat > "\$RUNNER_TEMP\/retry-macos-dmg\.sh" << 'END_DMG_RETRY'\n/m);
  assert.ok(open, 'workflow writes the DMG retry wrapper with a quoted heredoc');
  const indent = open[1];
  const bodyStart = (open.index ?? 0) + open[0].length;
  const closeAt = text.indexOf(`\n${indent}END_DMG_RETRY\n`, bodyStart);
  assert.ok(closeAt > bodyStart, 'workflow heredoc is closed');
  return text.slice(bodyStart, closeAt).split('\n').map((line) => {
    assert.ok(line === '' || line.startsWith(indent), `heredoc line is indented with the workflow block: ${line}`);
    return line.slice(indent.length);
  }).join('\n') + '\n';
}

const embedded = extractEmbeddedScript(workflow);
const onDisk = readFileSync(scriptFile, 'utf8');
assert.equal(embedded, onDisk.endsWith('\n') ? onDisk : `${onDisk}\n`);

const machine = spawnSync('uname', ['-m'], { encoding: 'utf8' });
assert.equal(machine.status, 0, machine.stderr);
const arch = machine.stdout.trim() === 'arm64' || machine.stdout.trim() === 'aarch64' ? 'aarch64' : 'x64';

const password = 'test-password-not-for-prod';
const certificate = Buffer.from('test-cert').toString('base64');
const identity = 'Developer ID Application: Example (TEAMID)';

function stub(bin: string, name: string, body: string) {
  const path = join(bin, name);
  writeFileSync(path, `#!/bin/bash\nset -eu\n${body}\n`, { mode: 0o755 });
  chmodSync(path, 0o755);
}

function run(options: {
  tauriExit?: number;
  args?: string[];
  stapleExit?: number;
  dmgFails?: number;
  writeBundleScript?: boolean;
  writeApp?: boolean;
  identity?: string;
  certificate?: string;
  withIcon?: boolean;
}) {
  // macOS: os.tmpdir() is /var/folders/... while the script canonicalises to
  // /private/var/folders/... (the wrapper resolves the bundle path). The fake
  // hdiutil prints the un-canonical path, so the script's "does this image-path
  // contain my bundle dir" test compared /var/... against /private/var/... and
  // never matched -> no detach line -> this file failed ONLY on macOS runners.
  // realpathSync makes the fixture agree with what the script sees.
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'anet-dmg-retry-')));
  const bin = join(cwd, 'bin');
  const calls = join(cwd, 'calls');
  const state = join(cwd, 'dmg-fails');
  mkdirSync(bin);
  mkdirSync(join(cwd, 'src-tauri'), { recursive: true });
  writeFileSync(calls, '');
  writeFileSync(join(cwd, 'src-tauri/tauri.conf.json'), JSON.stringify({
    productName: 'ANet',
    version: '0.2.264',
    bundle: { macOS: { entitlements: './Entitlements.plist' } },
  }));
  writeFileSync(join(cwd, 'src-tauri/Entitlements.plist'), '<plist/>');
  const bundle = join(cwd, 'src-tauri/target/release/bundle');
  mkdirSync(join(bundle, 'macos/ANet.app'), { recursive: true });
  mkdirSync(join(bundle, 'dmg'), { recursive: true });
  if (options.writeApp === false) rmSync(join(bundle, 'macos/ANet.app'), { recursive: true, force: true });
  if (options.withIcon !== false) writeFileSync(join(bundle, 'dmg/icon.icns'), 'icns');
  if (options.writeBundleScript !== false) {
    writeFileSync(join(bundle, 'dmg/bundle_dmg.sh'), `#!/bin/bash
set -eu
printf '%s\\n' "bundle_dmg $*" >> "$CALLS"
left=0
if [[ -f "$ANET_DMG_STATE" ]]; then left=$(cat "$ANET_DMG_STATE"); fi
if [[ "$left" -gt 0 ]]; then
  echo $((left - 1)) > "$ANET_DMG_STATE"
  echo "hdiutil: create failed - Resource busy" >&2
  exit 1
fi
args=("$@")
n=\${#args[@]}
dmg="\${args[$((n-2))]}"
printf 'dmg-bytes' > "$dmg"
`, { mode: 0o755 });
  }
  writeFileSync(state, String(options.dmgFails ?? 0));
  const record = (label: string) => `printf '%s\\n' "${label} $*" >> "$CALLS"`;
  stub(bin, 'tauri-mock', `${record('tauri')}\necho 'keychain: "/tmp/deleted.keychain-db"'\nexit "\${ANET_TAURI_EXIT:-1}"`);
  stub(bin, 'bun', `${record('UNEXPECTED bun')}\nexit 97`);
  stub(bin, 'npx', `${record('UNEXPECTED npx')}\nexit 97`);
  stub(bin, 'xcrun', `${record('xcrun')}\nexit "\${ANET_STAPLER_EXIT:-0}"`);
  stub(bin, 'hdiutil', `${record('hdiutil')}\nif [[ "\${1:-}" == info ]]; then printf '%s\\n' '================================================' "image-path      : ${bundle}/macos/rw.1.ANet.dmg" $'/dev/disk9\\tGUID_partition_scheme' $'/dev/disk9s1\\tApple_HFS\\t/Volumes/dmg.ABC'; fi\nexit 0`);
  stub(bin, 'pkill', `${record('pkill')}\nexit 0`);
  stub(bin, 'sleep', `${record('sleep')}\nexit 0`);
  stub(bin, 'security', `${record('security')}\nexit 0`);
  stub(bin, 'codesign', `${record('codesign')}\nexit 0`);
  const result = spawnSync('bash', [embeddedPath(cwd), ...(options.args ?? ['build', '--bundles', 'app,dmg'])], {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      CALLS: calls,
      ANET_TAURI_BIN: join(bin, 'tauri-mock'),
      ANET_TAURI_EXIT: String(options.tauriExit ?? 1),
      ANET_STAPLER_EXIT: String(options.stapleExit ?? 0),
      ANET_DMG_STATE: state,
      ANET_DMG_ASSUME_DARWIN: '1',
      APPLE_SIGNING_IDENTITY: options.identity === undefined ? identity : options.identity,
      APPLE_CERTIFICATE: options.certificate === undefined ? certificate : options.certificate,
      APPLE_CERTIFICATE_PASSWORD: password,
      RUNNER_TEMP: cwd,
    },
  });
  const log = readFileSync(calls, 'utf8');
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    calls: log.trim().split('\n').filter(Boolean),
    dmg: join(bundle, 'dmg', `ANet_0.2.264_${arch}.dmg`),
    cwd,
  };
}

function embeddedPath(cwd: string) {
  const path = join(cwd, 'retry-macos-dmg.sh');
  writeFileSync(path, embedded, { mode: 0o755 });
  return path;
}

let passed = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) throw new Error(`FAIL: ${name}${detail ? `\n${detail}` : ''}`);
  passed++;
  console.log(`PASS: ${name}`);
};

const syntax = spawnSync('bash', ['-n', fileFrom(embedded)], { encoding: 'utf8' });
function fileFrom(text: string) {
  const path = join(mkdtempSync(join(tmpdir(), 'anet-dmg-syntax-')), 'retry.sh');
  writeFileSync(path, text);
  return path;
}
check('wrapper passes bash -n', syntax.status === 0, syntax.stderr);

const conf = JSON.parse(readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'));
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
// 这条只是把「当前版本」抄了一遍，与 version-consistency 重复；bump 时必须跟着改。
check('release version matches the bump', conf.version === '0.2.270' && pkg.version === '0.2.270');
check('include_linux still defaults to false', /include_linux:[\s\S]*?default:\s*false/.test(workflow));
check('macOS matrix still builds app and dmg', workflow.includes('{"platform":"macos-14","args":"--bundles app,dmg"}'));
check('tauri-action runs the wrapper from the workflow temp dir on macOS only',
  workflow.includes("tauriScript: ${{ runner.os == 'macOS' && format('bash {0}/retry-macos-dmg.sh', runner.temp) || '' }}"));
check('dry-run macOS build uses the same wrapper and other platforms still call tauri directly',
  workflow.includes('bash "$RUNNER_TEMP/retry-macos-dmg.sh" build ${{ matrix.args }}')
  && workflow.includes('npx tauri build ${{ matrix.args }}'));

const ok = run({ tauriExit: 0 });
check('successful tauri build is not retried', ok.status === 0 && !ok.calls.some((line) => line.startsWith('bundle_dmg ') || line.startsWith('codesign ')), ok.stdout + ok.stderr + ok.calls.join('\n'));
rmSync(ok.cwd, { recursive: true, force: true });

const noDmg = run({ args: ['build', '--bundles', 'app'] });
check('a non-DMG failure is returned as-is', noDmg.status === 1 && !noDmg.calls.some((line) => line.startsWith('bundle_dmg ') || line.startsWith('xcrun ')), noDmg.calls.join('\n'));
rmSync(noDmg.cwd, { recursive: true, force: true });

const early = run({ writeBundleScript: false });
check('missing bundle_dmg.sh is not treated as the hdiutil race', early.status === 1 && !early.calls.some((line) => line.startsWith('xcrun ') || line.startsWith('codesign ')));
rmSync(early.cwd, { recursive: true, force: true });

const unstapled = run({ stapleExit: 1 });
check('an unstapled app is not re-bundled', unstapled.status === 1 && unstapled.calls.some((line) => line.startsWith('xcrun stapler validate ')) && !unstapled.calls.some((line) => line.startsWith('bundle_dmg ')));
rmSync(unstapled.cwd, { recursive: true, force: true });

const recovered = run({ dmgFails: 1 });
const dmgCalls = recovered.calls.filter((line) => line.startsWith('bundle_dmg '));
const tauriCalls = recovered.calls.filter((line) => line.startsWith('tauri '));
check('DMG recovery keeps the single notarizing tauri build', recovered.status === 0 && tauriCalls.length === 1, recovered.stdout + recovered.stderr);
check('tauri is invoked with --verbose so bundle_dmg.sh stderr reaches the log', tauriCalls[0]?.includes('--verbose') === true, tauriCalls.join('\n'));
check('bundle_dmg.sh is retried after the in-build failure and then succeeds', dmgCalls.length === 2, dmgCalls.join('\n'));
check('retry uses the Tauri 2.11.2 default DMG layout and volume icon',
  dmgCalls[0]?.includes('--icon ANet.app 180 170') === true
  && dmgCalls[0]?.includes('--app-drop-link 480 170') === true
  && dmgCalls[0]?.includes('--window-size 660 400') === true
  && dmgCalls[0]?.includes('--volicon ') === true
  && dmgCalls[0]?.includes('ANet_0.2.264_' + arch + '.dmg ANet.app') === true,
  dmgCalls.join('\n'));
check('backoff is 10s then 20s', recovered.calls.includes('sleep 10') && recovered.calls.includes('sleep 20'));
check('leftover disk images are detached and diskimages-helper is stopped',
  recovered.calls.some((line) => line.startsWith('hdiutil detach /dev/disk9'))
  && recovered.calls.some((line) => line === 'pkill -x diskimages-helper'),
  recovered.calls.join('\n'));
check('recovered DMG is the file tauri-action uploads', recovered.status === 0 && readFileSync(recovered.dmg, 'utf8') === 'dmg-bytes');
const signLine = recovered.calls.find((line) => line.startsWith('codesign --force '));
check('DMG is codesigned with the Developer ID identity, keychain, and entitlements',
  !!signLine
  && signLine.includes(`-s ${identity}`)
  && signLine.includes('--keychain ')
  && signLine.includes('--entitlements ')
  && signLine.includes('src-tauri/Entitlements.plist')
  && !signLine.includes('--options'),
  signLine ?? recovered.calls.join('\n'));
check('DMG codesign does not turn on hardened runtime', !signLine?.includes('runtime'));
check('the Developer ID certificate is imported again after tauri deletes its keychain',
  recovered.calls.some((line) => line.startsWith('security create-keychain '))
  && recovered.calls.some((line) => line.startsWith('security import '))
  && recovered.calls.some((line) => line.startsWith('security delete-keychain ')));
check('certificate password is not written to the wrapper log',
  !recovered.stdout.includes(password) && !recovered.stderr.includes(password) && !recovered.stdout.includes(certificate));
check('bun and npx are not used when the tauri binary is already selected',
  !recovered.calls.some((line) => line.startsWith('UNEXPECTED ')));
rmSync(recovered.cwd, { recursive: true, force: true });

const exhausted = run({ dmgFails: 5 });
check('exhausted DMG retries fail without a second tauri build',
  exhausted.status === 1
  && exhausted.calls.filter((line) => line.startsWith('tauri ')).length === 1
  && exhausted.calls.filter((line) => line.startsWith('bundle_dmg ')).length === 2
  && !exhausted.calls.some((line) => line.startsWith('codesign --force ')),
  exhausted.stdout + exhausted.calls.join('\n'));
rmSync(exhausted.cwd, { recursive: true, force: true });

const adHoc = run({ dmgFails: 0, identity: '-' });
check('ad-hoc identity does not codesign the DMG and still publishes the file',
  adHoc.status === 0
  && !adHoc.calls.some((line) => line.startsWith('codesign ') || line.startsWith('security '))
  && readFileSync(adHoc.dmg, 'utf8') === 'dmg-bytes');
rmSync(adHoc.cwd, { recursive: true, force: true });

console.log(`${passed}/${passed} checks passed`);
