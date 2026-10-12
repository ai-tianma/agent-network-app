import fs from 'node:fs';
import { ANDROID_PACKAGE, androidVersionCode } from './android-update-core';

const expected = '0.2.254';
const packageJson = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const packageLock = JSON.parse(fs.readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));
const appJson = JSON.parse(fs.readFileSync(new URL('../app.json', import.meta.url), 'utf8'));
const tauriConfig = JSON.parse(fs.readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'));
const cargoToml = fs.readFileSync(new URL('../src-tauri/Cargo.toml', import.meta.url), 'utf8');
const cargoLock = fs.readFileSync(new URL('../src-tauri/Cargo.lock', import.meta.url), 'utf8');
const versionSource = fs.readFileSync(new URL('./version.ts', import.meta.url), 'utf8');
const normalizeNewlines = (text: string) => text.replace(/\r\n?/g, '\n');
const prerelease = expected.split('-', 2)[1];
const cargoPackagePattern = new RegExp(
  `name = "agent-network-desktop"\\nversion = "${expected.replaceAll('.', '\\.')}"`,
);

const checks: Array<[string, boolean]> = [
  ['release version is numeric major.minor.patch for Apple compatibility', /^\d+\.\d+\.\d+$/.test(expected)],
  ['Windows MSI prerelease identifier', !prerelease || /^\d+$/.test(prerelease) && Number(prerelease) <= 65535],
  ['package.json', packageJson.version === expected],
  ['package-lock root', packageLock.version === expected],
  ['package-lock workspace', packageLock.packages?.['']?.version === expected],
  ['app.json', appJson.expo?.version === expected],
  ['tauri.conf.json', tauriConfig.version === expected],
  ['Cargo.toml', new RegExp(`^version = "${expected.replaceAll('.', '\\.')}"$`, 'm').test(cargoToml)],
  ['Cargo.lock root package', cargoPackagePattern.test(normalizeNewlines(cargoLock))],
  ['Cargo.lock CRLF checkout', cargoPackagePattern.test(normalizeNewlines(normalizeNewlines(cargoLock).replaceAll('\n', '\r\n')))],
  ['display version', versionSource.includes(`APP_VERSION = '${expected}'`)],
  // 安卓 versionCode 必须随版本单调递增(以前恒为 1):bump 版本时同步改 app.json expo.android.versionCode,
  // 值 = major*1000000 + minor*1000 + patch(见 android-update-core.ts androidVersionCode)。
  [`app.json android.versionCode (= ${androidVersionCode(expected)})`, appJson.expo?.android?.versionCode === androidVersionCode(expected)],
  ['app.json android.package matches the in-app updater', appJson.expo?.android?.package === ANDROID_PACKAGE],
  ['app.json android.permissions has REQUEST_INSTALL_PACKAGES', (appJson.expo?.android?.permissions ?? []).includes('android.permission.REQUEST_INSTALL_PACKAGES')],
];

for (const [name, ok] of checks) {
  if (!ok) throw new Error(`FAIL: ${name} must be ${expected}`);
  console.log(`PASS: ${name} = ${expected}`);
}
